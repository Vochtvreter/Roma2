// src/render/view.ts — MapView: frame, draw list, picking, placement routing, fx (ARCHITECTURE §12.2, §12.4). Owner: WP-F.
// The only render object the UI touches. It never mutates game state: clicks, drags and placement verdicts go out
// through ViewCallbacks and main.ts runs the actions. Frame order (§12.2): ground chunks (crossfaded) → ground layer
// (fields, stakes, selection ring) → trees → overlay → placement under-layer → y-sorted objects → status and overlay
// marks → particles → birds → placement ghost → flashes. All coordinates passed in and out are CSS px.
// The canvas stays full-bleed under the UI. The layout engine (ui/layout.ts) says what the UI covers (setInsets); the
// rest is the free rect, where centring, the zoom anchor, the clamp, the minimap's rectangle and ensureVisible work.
// Battery (P7): frame() draws only when a frame can differ from the last. While the UI covers all of the map (suspend:
// the SHEET or the DRAWER full, the DOCK's wide pane under 960 px, a phone's modal sheet) it draws nothing and the
// canvas keeps its last picture; the colony runs on (main.ts, loop.ts). While paused it skips the frames where nothing
// moves (no fling, glide or zoom ease, no flash, particle, placing ghost, demolish warning, title drift or season fade,
// no chunk waiting its bake) and nothing changed (invalidate: an action, an input, a resize, the insets, an overlay, the
// selection or the hover; and the state's day and epochs): the paused map holds still, its marks' bob and the selection's
// pulse with it.
import type { BuildingId, CoverageLayerId, FxEvent, GameState, NeedId, OverlayId, PlaceCheck, Rect } from '../game/types';
import { BUILDING_DEFS } from '../game/data/buildings';
import { H, W, getMap, inBounds } from '../game/map';
import { derived } from '../game/derived';
import { getBuilding } from '../game/state';
import { censusEpoch, structEpoch } from '../game/memo';
import type { Camera, Push, Xform } from './camera';
import type { Insets } from './camera';
import {
  Motion, NO_INSETS, TILE, ZOOM_LEVELS, canvasDpr, centerOnFree, clampCamera, defaultLevel, ensureVisibleDelta, freeCentre, makeCamera, nearestLevel,
  scaleFor, screenToWorld, tilesIn, worldToScreen,
} from './camera';
import { Input } from './input';
import { TerrainPainter } from './terrain';
import { ForestLayer, forestItems, natureItems } from './forest';
import { OVERLAY_ALPHA, OverlayPainter } from './overlays';
import { Minimap } from './minimap';
import { Placement, lPath } from './placement';
import { Particles } from './particles';
import { Actors } from './actors';
import { BuildingPainter, footprintRect } from './buildings';
import { linearItems } from './linear';
import { demolitionImpact } from '../game/demolition';
import type { Doom } from './demolish';
import { covers, demolishTap, drawDoom, rearmDue, sweepIds, sweepRect } from './demolish';
import { hasSprite, sprite, spriteNames, spriteSize } from './sprites';
import { REQUIRED_SPRITES } from './art/index';

/** What the player is placing: a building (optionally replacing an Ordo stake or pre-positioned) or a map tool. */
export type PlacingState =
  // at: pre-positioned origin tile (remedies); home: the house whose want it answers (a house card's Place: the ghost
  // says whether it reaches that home)
  | { kind: 'building'; type: BuildingId; replaceId?: number; at?: number; home?: { id: number; need: NeedId } }
  | { kind: 'road' } | { kind: 'pave' } | { kind: 'reserve' } | { kind: 'demolish' };

/** How the view reports input to the app (main.ts runs the actions). */
export interface ViewCallbacks {
  onHover(tile: number | null, buildingId: number | null): void;
  onClick(tile: number, buildingId: number | null, e: { button: 0 | 2; shift: boolean }): void;
  onDrag(kind: 'road' | 'pave', tiles: number[], done: boolean): void;      // L-shaped path preview; done on release
  onDemolish(ids: number[]): void;                                           // the demolish tool's second click: pull these down
  onCancel(): void;                                                          // right-click / two-finger tap while placing
  onPlacementPreview(check: PlaceCheck | null, tile: number | null): void;   // banner + inspector verdict (desktop hover, touch tap)
}

const BG = '#15100d';
const FLASH_MS = 1500;
const EDGE_CSS = 64;                                // a pre-positioned ghost glides this far inside the free map (the ticker, the tools)
const DRIFT = { r: 220, rate: 0.045 };              // title drift: world px around the forum, radians per second
const DEV_SHEET = typeof location !== 'undefined' && /[?&]dev\b/.test(location.search) && /[?&]sheet\b/.test(location.search);

interface Item { y: number; x: number; draw: (g: CanvasRenderingContext2D) => void }

/** The map view: owns the canvas, camera, input and every render layer. */
export class MapView {
  private readonly g: CanvasRenderingContext2D;
  private readonly cam: Camera = makeCamera();
  private readonly motion = new Motion();
  private dpr = 1;
  private ratio = 1;                                 // device px per CSS px of the canvas
  private cssW = 0;
  private cssH = 0;
  private readonly input: Input;
  private readonly terrain = new TerrainPainter();
  private readonly forest = new ForestLayer();
  private readonly overlays = new OverlayPainter();
  private readonly mini: Minimap | null;
  private readonly place = new Placement();
  private readonly particles = new Particles();
  private readonly actors = new Actors();
  private readonly painter = new BuildingPainter();
  private readonly items: Item[] = [];
  private s: GameState | null = null;
  private _placing: PlacingState | null = null;
  private _overlay: OverlayId = 'none';
  private _layer: CoverageLayerId = 'shrine';
  private prevOverlay: { o: OverlayId; layer: CoverageLayerId } | null = null;
  private _selected: number | null = null;
  private hoverTile: number | null = null;
  private hoverId: number | null = null;
  private mouseGhost = false;   // the placing ghost is the mouse's (a hover moved it): the mouse leaving the map takes it away
  private flashes: { r: Rect; until: number; ms: number }[] = [];
  private time = 0;
  private doomed: Doom | null = null;                // the demolish tool's armed works (render/demolish.ts)
  private doomEpoch = 0;                             // … their impact as of this structure epoch
  private doomRead = 0;                              // … read at this time (ms, this.time: rearm waits REARM_MS)
  private sweep: { from: number; touch: boolean; doom: Doom | null } | null = null;   // a demolish sweep dragged from a tile
  private dragFrom: number | null = null;
  private titleT = 0;
  private sheetY = 0;
  private sheet: HTMLCanvasElement | null = null;     // ?dev&sheet: a full-page canvas above every UI layer
  private titleUntil = 0;                            // titleDrift() was called this frame: a clean map, no marks
  private insCss: Insets = NO_INSETS;                // CSS px the UI covers on each side of the canvas (setInsets)
  private zoomed = false;                            // the player zoomed by hand since attach: a new host keeps the level
  private canvasZoom = false;                        // desktop columns: the default zoom follows the canvas width (setInsets)
  private labelEdge = 0;                             // CSS px more on the right the map's labels keep clear of (the COLUMNS' ▸ and ⤢ handles)
  private dirty = true;                              // something the map shows changed since the last draw (invalidate)
  private sig = '';                                  // the state as last drawn: its day and its structure and census epochs
  private sigState: GameState | null = null;         // … and the state object itself
  private covered = false;                           // the UI covers all of the map: nothing is drawn (suspend)
  private drawn = 0;                                 // map frames drawn since the page loaded (draws)
  /** A road or paving drag turns after its vertical leg (the placing banner's ↕ toggle: a finger has no Shift); Shift
   *  turns it the other way again. */
  verticalFirst = false;

  constructor(private readonly canvas: HTMLCanvasElement, minimap: HTMLCanvasElement | null, private readonly cb: ViewCallbacks) {
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    this.mini = minimap ? new Minimap(minimap, (wx, wy) => this.centerWorld(wx, wy)) : null;   // the picked point to the free centre
    this.input = new Input(canvas, {
      hover: (x, y) => this.onHoverPx(x, y),
      leave: () => this.onLeave(),
      pan: (dx, dy) => this.drag(dx, dy),
      fling: (vx, vy) => (vx || vy ? this.motion.fling((-vx * this.ratio) / this.cam.scale, (-vy * this.ratio) / this.cam.scale) : this.motion.stop()),
      zoom: (steps, x, y) => this.zoomBy(steps, { sx: x, sy: y }),
      tap: (x, y, info) => this.onTap(x, y, info.button, info.shift, info.touch),
      toolDrag: (phase, x, y, shift, touch) => this.onToolDrag(phase, x, y, shift, touch === true),
      cancel: () => { if (!this.disarm()) this.cb.onCancel(); },   // a right-click first drops armed works
    });
    if (DEV_SHEET) this.sheet = sheetCanvas((dy) => { this.sheetY = Math.min(0, this.sheetY - dy * this.dpr); this.dirty = true; });
    this.resize();
  }

  // ───────────────────────────── public state ─────────────────────────────
  /** The current placing mode, or null. */
  get placing(): PlacingState | null { return this._placing; }
  /** The active overlay. */
  get overlay(): OverlayId { return this._overlay; }
  /** The Officia overlay's coverage layer (kept between uses; default 'shrine'). */
  get overlayLayer(): CoverageLayerId { return this._layer; }
  /** The selected building id, or null. */
  get selected(): number | null { return this._selected; }
  /** The UI covers all of the map: frame() draws nothing (suspend). */
  get suspended(): boolean { return this.covered; }
  /** Map frames drawn since the page loaded (?dev: the battery checks count them over a few seconds). */
  get draws(): number { return this.drawn; }
  /** The demolish tool holds armed works (a second click pulls them down; Esc and Back disarm them first). */
  get armed(): boolean { return this.doomed !== null; }

  /** Drops the demolish tool's armed works (Esc, Back, a right-click); false when none were armed. */
  disarm(): boolean {
    if (!this.doomed) return false;
    this.doomed = null;
    this.dirty = true;
    return true;
  }

  // ───────────────────────────── lifecycle ─────────────────────────────
  /** New or loaded game: drop caches, reset modes, the default zoom for the free map, centre on the forum. */
  attach(s: GameState): void {
    this.s = s;
    this.terrain.reset();
    this.forest.reset();
    this.overlays.reset();
    this.particles.clear();
    this.actors.reset();
    this.place.cancel();
    this.motion.stop();
    this._placing = null;
    this.prevOverlay = null;
    this._overlay = 'none';
    this._selected = this.hoverTile = this.hoverId = this.doomed = this.sweep = this.dragFrom = null;
    this.flashes = [];
    this.zoomed = false;
    this.dirty = true;
    this.resize();
    this.setZoom(this.defaultLevel());
    this.centerOnForum();
    this.mini?.invalidate();
  }

  /** Re-reads the canvas CSS size and devicePixelRatio. A hidden canvas (0×0) keeps its last size: falling back to the
   *  window would make frame() see a mismatch and reallocate the backing store every frame. */
  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = canvasDpr(window.devicePixelRatio);
    this.cssW = r.width;
    this.cssH = r.height;
    this.canvas.width = Math.max(1, Math.round(this.cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.cssH * this.dpr));
    this.ratio = this.canvas.width / this.cssW;
    this.cam.vw = this.canvas.width;
    this.cam.vh = this.canvas.height;
    this.cam.scale = scaleFor(this.cam.level, this.dpr);
    clampCamera(this.cam, this.ins);
    this.mini?.invalidate();
    this.dirty = true;   // (setting the canvas size cleared it)
  }

  /** What the UI covers on each side of the canvas, in CSS px (ui/layout.ts, whenever its free rect changes). The camera
   *  does not recentre: the next centring, zoom step and ensureVisible use the new free rect. It is clamped to it at once,
   *  though: at a map edge a bigger free rect (the panel folding away) moves the clamp, and that step belongs with the
   *  panel's own slide, not with the next drag (which would snap the map against the drag). `host`: the layout changed
   *  shape (a rotation, a fold, a resized window): the default zoom is chosen again for the new free map, unless the
   *  player has zoomed by hand. */
  setInsets(css: Insets, opts?: { host?: boolean; canvasZoom?: boolean; labelEdge?: number }): void {
    if (opts?.canvasZoom !== undefined) this.canvasZoom = opts.canvasZoom;
    if (opts?.labelEdge !== undefined && opts.labelEdge !== this.labelEdge) { this.labelEdge = opts.labelEdge; this.dirty = true; }
    const i ={ top: Math.max(0, css.top), right: Math.max(0, css.right), bottom: Math.max(0, css.bottom), left: Math.max(0, css.left) };
    const same = i.top === this.insCss.top && i.right === this.insCss.right && i.bottom === this.insCss.bottom && i.left === this.insCss.left;
    this.insCss = i;
    if (!same) {
      if (this.s) clampCamera(this.cam, this.ins);
      this.mini?.invalidate();
      this.dirty = true;
    }
    if (opts?.host && !this.zoomed && this.s) {
      if (this.canvas.clientWidth !== Math.round(this.cssW) || this.canvas.clientHeight !== Math.round(this.cssH)) this.resize();
      this.applyLevel(this.defaultLevel());
    }
    this.keepGhost();
  }

  /** A ghost the player set (pre-positioned, or the last tap), not the mouse's, glides back into the new free rect: a
   *  rotation or a resized window moves the map under it, and Place must never stake a site the player cannot see. A
   *  ghost still in view stays put (ensureVisible moves nothing). */
  private keepGhost(): void {
    const p = this._placing, c = this.place.check;
    if (!p || p.kind !== 'building' || this.mouseGhost || !this.s) return;
    const at = c?.ok ? c.y * W + c.x : this.place.hoverTile;
    if (at === null) return;
    if (this.canvas.clientWidth !== Math.round(this.cssW) || this.canvas.clientHeight !== Math.round(this.cssH)) this.resize();
    const [w, h] = BUILDING_DEFS[p.type].size;
    this.ensureVisible({ x: at % W, y: Math.floor(at / W), w, h }, EDGE_CSS);
  }

  /** The free rect: the canvas less the insets, in canvas CSS px (the whole canvas when the insets would leave none). */
  freeRect(): { left: number; top: number; right: number; bottom: number } {
    const i = this.insCss, w = this.cssW, hh = this.cssH;
    if (w - i.left - i.right < 1 || hh - i.top - i.bottom < 1) return { left: 0, top: 0, right: w, bottom: hh };
    return { left: i.left, top: i.top, right: w - i.right, bottom: hh - i.bottom };
  }

  /** The canvas's box relative to #app, in CSS px: add its left and top to a canvas-px point (screenRect, buildingRect)
   *  to place DOM in #app. (0, 0) while the canvas fills #app. */
  mapRect(): { left: number; top: number; width: number; height: number } {
    const app = this.canvas.ownerDocument.getElementById('app') ?? this.canvas.parentElement;
    const r = this.canvas.getBoundingClientRect(), a = app ? app.getBoundingClientRect() : { left: 0, top: 0 };
    return { left: r.left - a.left, top: r.top - a.top, width: r.width, height: r.height };
  }

  /** One turn of main.ts's loop (an animation frame; while suspended, its covered timer): draws the frame, unless the UI
   *  covers all of the map (suspend) or the map is paused and idle (nothing moves, nothing changed: see the header). */
  frame(dtMs: number, s: GameState, speed: number, paused: boolean): void {
    this.s = s;
    this.time += dtMs;   // (the flashes and the demolish warning's pulse run out in real time, drawn or not)
    if (this.covered) return;
    if (this.canvas.clientWidth !== Math.round(this.cssW) || this.canvas.clientHeight !== Math.round(this.cssH)) this.resize();
    if (this.doomed && structEpoch(s) !== this.doomEpoch) this.rearm(s, paused);
    const sig = `${s.day}|${structEpoch(s)}|${censusEpoch(s)}`;
    if (sig !== this.sig || s !== this.sigState) { this.sig = sig; this.sigState = s; this.dirty = true; }
    if (paused && !this.dirty && !this.animating()) { this.idle(s); return; }
    this.dirty = false;
    this.drawn++;
    if (this._placing) this.place.refresh(s);
    this.motion.step(this.cam, dtMs, this.ins);
    const xf = this.motion.xform(this.cam);
    const vis = tilesIn(xf, this.cam.vw, this.cam.vh, 4);
    this.terrain.update(s, dtMs);
    const { cur, prev, fade } = this.terrain.seasons;
    this.particles.update(dtMs);
    this.actors.update(dtMs, s, paused ? 0 : speed, vis);
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = BG;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.sheet) { this.drawSheet(this.sheet); return; }
    g.setTransform(xf.k, 0, 0, xf.k, xf.ox, xf.oy);
    g.imageSmoothingEnabled = false;
    // 1–2 · ground, ground layer, trees
    this.terrain.draw(g, s, vis);
    this.painter.ground(g, s, vis, cur, this._selected, this._placing ? null : this.hoverId, this.time);
    this.forest.draw(g, s, vis, cur, prev, fade);
    // 3 · overlay
    const ov = this.overlays.canvas(s, this._overlay, this._layer);
    if (ov) {
      g.imageSmoothingEnabled = true;
      g.globalAlpha = OVERLAY_ALPHA;
      g.drawImage(ov, 0, 0, W * TILE, H * TILE);
      g.globalAlpha = 1;
      g.imageSmoothingEnabled = false;
    }
    // 4 · placement under-layer
    this.place.drawUnder(g, s, vis, this.time, this._overlay === 'desir');
    // 5 · y-sorted objects
    this.items.length = 0;
    const push: Push = (y, x, draw) => { this.items.push({ y, x, draw }); };
    this.painter.items(s, vis, cur, push);
    linearItems(s, vis, push);
    natureItems(s, vis, push);
    forestItems(s, vis, cur, push);
    this.actors.items(s, vis, push);
    this.items.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const it of this.items) it.draw(g);
    // 6–9 · marks, particles, birds, ghost, flashes
    const title = this.time < this.titleUntil;
    if (!title) this.painter.marks(g, s, this.cam.level, this.time, this._selected, this._placing ? null : this.hoverId, this._overlay === 'domus');
    this.overlays.marks(g, s, this._overlay, vis, this.time);
    this.particles.ambient(dtMs, s, this.painter.drawn, cur, !paused);
    this.particles.draw(g, { x: vis.x * TILE, y: vis.y * TILE, w: vis.w * TILE, h: vis.h * TILE });
    this.actors.sky(g, vis);
    const li = this.ins;
    this.place.drawOver(g, s, this.time, cur, this.labelEdge ? { ...li, right: li.right + this.labelEdge * this.ratio } : li);
    this.drawFlashes(g, s, xf);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.mini?.draw(s, this.cam, this.terrain.miniCanvas(s), ov, this._placing !== null, this.time, this.ins);
  }

  /** Routes sim and action fx to particles, actors and flashes (§12.6); `season` crossfades on its own. While the map is
   *  covered (suspend) the bursts, flashes and columns are dropped: nobody sees them, and kept they would all play at
   *  once when it shows again. A fire is no burst but a building's state for a while (its flames and smoke): it is kept,
   *  so the building whose crackle was heard burns when the map shows. */
  handleFx(events: FxEvent[], s: GameState): void {
    if (events.some((e) => e.kind === 'built' || e.kind === 'ordoPlaced' || e.kind === 'rank')) this.mini?.invalidate();
    this.dirty = true;
    if (this.covered) {
      const fires = events.filter((e) => e.kind === 'fire');
      if (fires.length) this.particles.handleFx(fires, s, () => undefined);
      return;
    }
    this.particles.handleFx(events, s, (r) => this.flashes.push({ r, until: this.time + FLASH_MS, ms: FLASH_MS }));
    this.actors.handleFx(events, s);
  }

  /** The UI covers all of the map (main.ts asks layout.ts every turn: mapCovered), or no longer does. Covered, frame()
   *  draws nothing and the canvas keeps its last picture (nothing of it shows); handleFx drops what would play. Shown
   *  again, the next frame draws at once: the particles and walkers go on from where they stood, and no burst of what
   *  happened meanwhile replays. */
  suspend(on: boolean): void {
    if (on === this.covered) return;
    this.covered = on;
    if (on) return;
    this.flashes = [];
    this.dirty = true;
    this.mini?.invalidate();
  }

  /** Something the map shows changed outside the view (an action, a loaded or changed state, the fonts): the next frame
   *  draws, paused or not. */
  invalidate(): void {
    this.dirty = true;
  }

  // ───────────────────────────── camera ─────────────────────────────
  /** Glides the map content by (dx, dy) CSS px, like a drag (positive dx shows more of the west); eased. */
  panBy(dxCss: number, dyCss: number): void {
    this.motion.glide((-dxCss * this.ratio) / this.cam.scale, (-dyCss * this.ratio) / this.cam.scale);
  }

  /** Centres a tile (or the middle of a tile rect: a building's footprint) in the free rect, optionally at a zoom level. */
  centerOn(target: number | Rect, level?: number): void {
    if (level !== undefined) this.setZoom(level);
    const r = typeof target === 'number' ? { x: target % W, y: Math.floor(target / W), w: 1, h: 1 } : target;
    this.centerWorld((r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE);
  }

  /** Glides the camera (eased, Motion.glide) by the least that brings a tile, or a tile rect, into the free rect at least
   *  `marginCss` from its edges; nothing moves when it is there already. Returns how far the target will move on screen
   *  (CSS px, right and down positive; 0, 0 when it stays), so a caller can add a further panBy to the same glide. */
  ensureVisible(target: number | Rect, marginCss = 24): { dx: number; dy: number } {
    const r = typeof target === 'number' ? { x: target % W, y: Math.floor(target / W), w: 1, h: 1 } : target;
    const d = ensureVisibleDelta(this.cam, { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE }, this.ins, marginCss * this.ratio);
    const k = this.cam.scale / this.ratio;   // CSS px per world px
    if (Math.abs(d.dx * k) < 0.5 && Math.abs(d.dy * k) < 0.5) return { dx: 0, dy: 0 };
    this.motion.stop();
    this.motion.glide(d.dx, d.dy);
    return { dx: -d.dx * k, dy: -d.dy * k };
  }

  /** Centres the view on the forum. */
  centerOnForum(): void {
    if (!this.s) return;
    const f = getMap(this.s.seed).survey.forum;
    this.centerWorld((f.x + f.w / 2) * TILE, (f.y + f.h / 2) * TILE);
  }

  /** Steps the zoom level (the player's own: wheel, pinch, keys, buttons), keeping the world point under the anchor (CSS
   *  px; by default the free-rect centre) fixed; eased over 140 ms. */
  zoomBy(steps: number, anchor?: { sx: number; sy: number }): void {
    this.zoomed = true;
    const cur = ZOOM_LEVELS.indexOf(nearestLevel(this.cam.level));
    this.applyLevel(ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, cur + Math.round(steps)))], anchor);
  }

  /** Sets the zoom level (snapped to ZOOM_LEVELS), keeping the free-rect centre. */
  setZoom(level: number): void {
    this.applyLevel(nearestLevel(level));
  }

  // ───────────────────────────── placing, overlays, selection ─────────────────────────────
  /** Enters a placing mode; auto-selects the matching overlay (§12.5) and remembers the previous one. */
  startPlacing(p: PlacingState, s: GameState): void {
    if (this._placing) this.cancelPlacing();
    this.s = s;
    this.prevOverlay = { o: this._overlay, layer: this._layer };
    if (p.kind === 'building') {
      const auto = autoOverlay(p.type);
      if (auto) this.setOverlay(auto.o, auto.layer);
    }
    this._placing = p;
    this.doomed = this.sweep = null;
    this.dragFrom = null;
    this.mouseGhost = p.kind !== 'building' || p.at === undefined;   // a pre-positioned ghost stays until a hover takes it
    this.place.start(p, s);
    if (p.kind === 'building' && p.at !== undefined) {
      // a pre-positioned ghost already in the free map leaves the camera where the eye is; one under the UI or off
      // screen glides in by the least it needs (never a jump)
      const [w, h] = BUILDING_DEFS[p.type].size;
      this.ensureVisible({ x: p.at % W, y: Math.floor(p.at / W), w, h }, EDGE_CSS);
      this.cb.onPlacementPreview(this.place.check, p.at);
    }
  }

  /** Leaves placing mode and restores the previous overlay. */
  cancelPlacing(): void {
    if (!this._placing) return;
    this._placing = null;
    this.place.cancel();
    this.dragFrom = null;
    this.doomed = this.sweep = null;
    this.dirty = true;
    this.mini?.invalidate();   // (hidden while placing: it shows again with what was placed)
    if (this.prevOverlay) this.setOverlay(this.prevOverlay.o, this.prevOverlay.layer);
    this.prevOverlay = null;
  }

  /** Shows an overlay; 'officia' keeps its last layer unless one is given. */
  setOverlay(o: OverlayId, layer?: CoverageLayerId): void {
    this._overlay = o;
    if (o === 'officia' && layer) this._layer = layer;
    this.mini?.invalidate();
    this.dirty = true;
  }

  /** Selects a building (ring and chevron) or clears the selection. */
  select(id: number | null): void {
    if (id !== this._selected) this.dirty = true;
    this._selected = id;
  }

  /** Flashes a w×h tile rectangle whose top-left is `tile`. */
  flash(tile: number, w: number, h: number, ms: number = FLASH_MS): void {
    this.flashes.push({ r: { x: tile % W, y: Math.floor(tile / W), w, h }, until: this.time + ms, ms });
  }

  // ───────────────────────────── picking ─────────────────────────────
  /** The tile under a CSS-px point of the canvas, or null off the map. */
  tileAt(sxCss: number, syCss: number): number | null {
    const { wx, wy } = screenToWorld(this.cam, sxCss * this.ratio, syCss * this.ratio);
    const x = Math.floor(wx / TILE), y = Math.floor(wy / TILE);
    return inBounds(x, y) ? y * W + x : null;
  }

  /** The building under a CSS-px point: y-sorted sprites front to back with their alpha masks, then the footprint map. */
  pickBuilding(sxCss: number, syCss: number): number | null {
    if (!this.s) return null;
    const { wx, wy } = screenToWorld(this.cam, sxCss * this.ratio, syCss * this.ratio);
    const hit = this.painter.pick(wx, wy);
    if (hit !== null) return hit;
    const t = this.tileAt(sxCss, syCss);
    const id = t === null ? 0 : derived(this.s).buildingAt[t];
    return id > 0 ? id : null;
  }

  /** The CSS-px centre of a tile for anchoring DOM, or null when it is off screen. */
  screenOf(tile: number): { x: number; y: number } | null {
    const p = worldToScreen(this.cam, ((tile % W) + 0.5) * TILE, (Math.floor(tile / W) + 0.5) * TILE);
    const x = p.sx / this.ratio, y = p.sy / this.ratio;
    return x < 0 || y < 0 || x > this.cssW || y > this.cssH ? null : { x, y };
  }

  /** The CSS-px box of a w×h tile rectangle whose top-left tile is (x, y), for anchoring DOM; it may lie off screen. */
  screenRect(x: number, y: number, w: number, h: number): { left: number; top: number; right: number; bottom: number } {
    const a = worldToScreen(this.cam, x * TILE, y * TILE), b = worldToScreen(this.cam, (x + w) * TILE, (y + h) * TILE);
    return { left: a.sx / this.ratio, top: a.sy / this.ratio, right: b.sx / this.ratio, bottom: b.sy / this.ratio };
  }

  /** The CSS-px box of a building's footprint, or null when it is gone. */
  buildingRect(id: number): { left: number; top: number; right: number; bottom: number } | null {
    const r = this.buildingTiles(id);
    return r ? this.screenRect(r.x, r.y, r.w, r.h) : null;
  }

  /** A building's footprint as a tile rect (for centerOn and ensureVisible), or null when it is gone. */
  buildingTiles(id: number): Rect | null {
    const b = this.s ? getBuilding(this.s, id) : undefined;
    return this.s && b ? footprintRect(this.s, b) : null;
  }

  /** The slow drift behind the title screen: a wide, lazy ellipse around the forum. */
  titleDrift(dtMs: number, s: GameState): void {
    this.s = s;
    this.titleT += dtMs / 1000;
    this.titleUntil = this.time + dtMs + 50;
    const f = getMap(s.seed).survey.forum, a = this.titleT * DRIFT.rate;
    this.centerWorld((f.x + f.w / 2) * TILE + Math.sin(a) * DRIFT.r, (f.y + f.h / 2) * TILE + Math.sin(a * 0.7 + 1) * DRIFT.r * 0.5);
  }

  /** The press of this pointer on the map closes a layer above it (the Breviarium): it pans, but taps nothing. */
  muteTap(pointerId: number): void {
    this.input.muteTap(pointerId);
  }

  /** Enables or disables map input (off under the catch-up veil and modals). */
  setInputEnabled(on: boolean): void {
    this.input.enabled = on;
    if (!on && (this.hoverTile !== null || this.hoverId !== null)) { this.hoverTile = this.hoverId = null; this.dirty = true; }
  }

  // ───────────────────────────── internals ─────────────────────────────
  /** Something on the map moves by itself this frame, paused or not: the camera (a fling, a glide, a zoom ease), a flash,
   *  the demolish warning, a particle in flight, the placing ghost and its plots, the title's drift, the ground (a season
   *  fading, a chunk waiting its bake). What moves only with the clock (walkers, birds, smoke rising, the marks' bob, the
   *  selection's pulse) holds still while paused. */
  private animating(): boolean {
    return this.motion.busy || this.flashes.length > 0 || this.doomed !== null || this._placing !== null || this.particles.busy
      || this.time < this.titleUntil || this.terrain.busy;
  }

  /** A frame with nothing to draw: the canvas keeps its picture; the minimap pays a redraw its throttle held back, and
   *  the ground paints an off-screen chunk now and then. */
  private idle(s: GameState): void {
    if (this.mini?.pending) this.mini.draw(s, this.cam, this.terrain.miniCanvas(s), this.overlays.canvas(s, this._overlay, this._layer), this._placing !== null, this.time, this.ins);
    this.terrain.bakeIdle(s);
  }

  /** The insets in device px (CSS × the canvas's device px per CSS px). */
  private get ins(): Insets {
    const i = this.insCss, k = this.ratio;
    return { top: i.top * k, right: i.right * k, bottom: i.bottom * k, left: i.left * k };
  }

  /** The default zoom for the free map: from its shorter side (the whole window before the canvas has a size). On the
   *  desktop columns (`canvasZoom`) it follows the canvas width as it always has, so a 1366 px laptop keeps level 3. */
  private defaultLevel(): number {
    if (this.canvasZoom) return defaultLevel(this.cssW || window.innerWidth);
    const f = this.freeRect();
    const w = this.cssW ? f.right - f.left : window.innerWidth, hh = this.cssH ? f.bottom - f.top : window.innerHeight;
    return defaultLevel(Math.min(w, hh));
  }

  /** Puts a world point at the free-rect centre (clamped), stopping any glide. */
  private centerWorld(wx: number, wy: number): void {
    this.motion.stop();
    const ins = this.ins;
    centerOnFree(this.cam, wx, wy, ins);
    clampCamera(this.cam, ins);
    this.dirty = true;
  }

  private drag(dxCss: number, dyCss: number): void {
    this.cam.x -= (dxCss * this.ratio) / this.cam.scale;
    this.cam.y -= (dyCss * this.ratio) / this.cam.scale;
    clampCamera(this.cam, this.ins);
    this.dirty = true;
  }

  private applyLevel(level: number, anchor?: { sx: number; sy: number }): void {
    if (level === this.cam.level && this.cam.scale === scaleFor(level, this.dpr)) return;
    const fc = freeCentre(this.cam, this.ins);
    const ax = anchor ? anchor.sx * this.ratio : fc.sx, ay = anchor ? anchor.sy * this.ratio : fc.sy;
    const before = screenToWorld(this.cam, ax, ay), s0 = this.motion.xform(this.cam).k;
    this.cam.level = level;
    this.cam.scale = scaleFor(level, this.dpr);
    const after = screenToWorld(this.cam, ax, ay);
    this.cam.x += before.wx - after.wx;
    this.cam.y += before.wy - after.wy;
    clampCamera(this.cam, this.ins);
    this.dirty = true;
    if (this.s) this.motion.easeZoom(s0, ax, ay);
  }

  private onHoverPx(x: number, y: number): void {
    const s = this.s;
    if (!s) return;
    const tile = this.tileAt(x, y);
    const id = tile === null ? null : this.pickBuilding(x, y);
    if (tile === this.hoverTile && id === this.hoverId) return;
    const tileChanged = tile !== this.hoverTile;
    this.hoverTile = tile;
    this.hoverId = id;
    this.dirty = true;
    this.cb.onHover(tile, id);
    if (this.doomed && !this.doomed.touch && !covers(this.doomed, id, tile)) this.doomed = null;   // the mouse left the armed works
    if (this._placing && tileChanged && this.dragFrom === null) {
      this.mouseGhost = true;
      const check = this.place.hover(tile, s);
      if (this._placing.kind === 'building') this.cb.onPlacementPreview(check, tile);
    }
  }

  /** The mouse left the map: the hover goes, and with it a ghost the mouse was moving. A pre-positioned ghost (startAt:
   *  a remedy's plot, a finger's best plot) or one a tap moved stays: the mouse never had it (a banner or a card that
   *  appears under a resting mouse makes it 'leave' the map without a move). */
  private onLeave(): void {
    this.hoverTile = this.hoverId = null;
    this.dirty = true;
    if (this.doomed && !this.doomed.touch) this.doomed = null;
    this.cb.onHover(null, null);
    if (this._placing && this.s && this.dragFrom === null && this.mouseGhost) {
      this.place.hover(null, this.s);
      if (this._placing.kind === 'building') this.cb.onPlacementPreview(null, null);
    }
  }

  private onTap(x: number, y: number, button: 0 | 2, shift: boolean, touch: boolean): void {
    const s = this.s;
    const tile = this.tileAt(x, y);
    if (!s || tile === null) return;
    const id = this.pickBuilding(x, y);
    const p = this._placing;
    this.dirty = true;
    if (p && touch) { this.place.hover(tile, s); this.mouseGhost = false; }
    if (p?.kind === 'building' && touch) {
      // touch: a tap previews (ghost + verdict); the place banner's Place button confirms
      this.cb.onPlacementPreview(this.place.check, tile);
      return;
    }
    if (p?.kind === 'demolish') {
      const v = demolishTap(this.doomed, id, tile, this.time);
      if (v === 'confirm' && this.doomed?.impact.ids.length) {
        const ids = this.doomed.impact.ids;
        this.doomed = null;
        this.cb.onDemolish(ids);
      } else if (v === 'arm' && id !== null) this.arm([id], null, touch);
      else if (v === 'disarm') this.doomed = null;
      return;   // ('early': a second click under CONFIRM_GUARD_MS, a double-click, pulls nothing down)
    }
    this.cb.onClick(tile, id, { button, shift });
  }

  private onToolDrag(phase: 'start' | 'move' | 'end' | 'abort', x: number, y: number, shift: boolean, touch: boolean): boolean {
    const p = this._placing;
    if (p?.kind === 'demolish') return this.onSweep(phase, x, y, touch);
    if (!p || (p.kind !== 'road' && p.kind !== 'pave')) return false;
    if (phase === 'abort') {                       // a pinch or a cancelled pointer: drop the path, never commit it
      this.dragFrom = null;
      this.place.path = null;
      return true;
    }
    const kind = p.kind;
    const tile = this.tileAt(x, y);
    if (phase === 'start') {
      if (tile === null) return false;
      this.dragFrom = tile;
      this.place.path = [tile];
      this.cb.onDrag(kind, [tile], false);
      return true;
    }
    if (this.dragFrom === null) return true;
    const path = tile === null ? this.place.path ?? [this.dragFrom] : lPath(this.dragFrom, tile, shift !== this.verticalFirst);
    this.place.path = path;
    if (phase === 'move') this.cb.onDrag(kind, path, false);
    else {
      this.dragFrom = null;
      this.place.path = null;
      this.cb.onDrag(kind, path, true);
    }
    return true;
  }

  /** Arms works for the demolish tool: what pulling them down would do is worked out once, here (and again when the
   *  structure changes: rearm). A sweep that touched nothing arms nothing. */
  private arm(ids: number[], rect: Rect | null, touch: boolean): void {
    const s = this.s;
    if (!s || ids.length === 0) { this.doomed = null; return; }
    this.doomed = { ids, rect, at: this.time, touch, impact: demolitionImpact(s, ids) };
    this.doomEpoch = structEpoch(s);
    this.doomRead = this.time;
  }

  /** The structure changed under armed works (a work finished, the Ordo built, a fire): works gone meanwhile drop out
   *  (all gone: nothing stays armed) and their impact is read again, while the colony runs at most every REARM_MS
   *  (rearmDue: the last impact stands until then, and a later frame reads it). */
  private rearm(s: GameState, paused: boolean): void {
    const d = this.doomed;
    if (!d) return;
    const ids = d.ids.filter((id) => getBuilding(s, id));
    if (ids.length === 0) { this.doomed = null; this.dirty = true; return; }
    if (!rearmDue(this.doomRead, this.time, paused, ids.length < d.ids.length)) return;
    this.doomed = { ...d, ids, impact: demolitionImpact(s, ids) };
    this.doomEpoch = structEpoch(s);
    this.doomRead = this.time;
    this.dirty = true;
  }

  /** The demolish tool owns a press: dragged, it sweeps a rectangle over the works (their count and salvage shown as it
   *  grows) and arms them on release; a press that never moved returns false at 'end', and Input taps it instead. */
  private onSweep(phase: 'start' | 'move' | 'end' | 'abort', x: number, y: number, touch: boolean): boolean {
    const s = this.s, tile = this.tileAt(x, y);
    if (phase === 'start') {
      if (tile === null) return false;
      this.sweep = { from: tile, touch, doom: null };
      return true;
    }
    const sw = this.sweep;
    if (phase === 'abort' || !sw || !s) { this.sweep = null; this.dirty = true; return phase !== 'end'; }
    this.dirty = true;
    if (phase === 'move') {
      if (tile === null) return true;
      const rect = sweepRect(sw.from, tile), at = sw.doom?.rect;
      if (at && at.x === rect.x && at.y === rect.y && at.w === rect.w && at.h === rect.h) return true;
      const ids = sweepIds(s, rect);
      this.doomed = null;
      sw.doom = { ids, rect, at: this.time, touch: sw.touch, impact: demolitionImpact(s, ids, { needs: false }) };
      return true;
    }
    this.sweep = null;
    if (!sw.doom) return false;                     // never dragged: a click (Input taps it)
    this.arm(sw.doom.ids, sw.doom.rect, sw.touch);
    return true;
  }

  private drawFlashes(g: CanvasRenderingContext2D, s: GameState, xf: Xform): void {
    this.flashes = this.flashes.filter((f) => f.until > this.time);
    for (const f of this.flashes) {
      const a = Math.max(0, (f.until - this.time) / f.ms), grow = Math.round((1 - a) * 4);
      const X = f.r.x * TILE - grow, Y = f.r.y * TILE - grow, w = f.r.w * TILE + 2 * grow, h = f.r.h * TILE + 2 * grow;
      g.fillStyle = `rgba(242,201,76,${a})`;
      g.fillRect(X, Y, w, 2); g.fillRect(X, Y + h - 2, w, 2); g.fillRect(X, Y, 2, h); g.fillRect(X + w - 2, Y, 2, h);
    }
    const d = this.sweep?.doom ?? this.doomed;
    if (d) drawDoom(g, s, d, d !== this.doomed, this.time, xf.k, this.ins);
  }

  /** ?dev&sheet: every registered and every required sprite in a labelled grid by group at 2× (missing ones in red). */
  private drawSheet(cv: HTMLCanvasElement): void {
    const d = this.dpr, sc = 2 * Math.max(1, Math.round(d));
    if (cv.width !== Math.round(innerWidth * d) || cv.height !== Math.round(innerHeight * d)) { cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); }
    const g = cv.getContext('2d');
    if (!g) return;
    g.fillStyle = BG;
    g.fillRect(0, 0, cv.width, cv.height);
    const names = [...new Set([...spriteNames(), ...REQUIRED_SPRITES])].sort();
    const missing = names.filter((n) => !hasSprite(n)).length;
    g.font = `${Math.round(10 * d)}px monospace`;
    g.textBaseline = 'top';
    g.imageSmoothingEnabled = false;
    g.fillStyle = missing ? '#e5554a' : '#9ccc5a';
    g.fillText(`${names.length - missing} registered · ${missing} required but missing (drag or wheel to scroll)`, 8, 8 + this.sheetY);
    let x = 8, y = 8 + 18 * d + this.sheetY, rowH = 0, group = '';
    for (const n of names) {
      const grp = n.slice(0, n.indexOf('_') + 1);
      if (grp !== group) {
        group = grp;
        x = 8; y += rowH + (rowH ? 8 : 0); rowH = 0;
        g.fillStyle = '#f0a04b';
        g.fillText(`${grp}*`, 8, y);
        y += 16 * d;
      }
      const { w, h } = spriteSize(n), cw = Math.max(w * sc, 96 * d);
      if (x + cw > cv.width) { x = 8; y += rowH + 8; rowH = 0; }
      if (y > -200 && y < cv.height) {
        g.fillStyle = '#2c201b';
        g.fillRect(x, y, w * sc, h * sc);
        g.drawImage(sprite(n), x, y, w * sc, h * sc);
        g.fillStyle = hasSprite(n) ? '#f4ead6' : '#e5554a';
        g.fillText(n, x, y + h * sc + 2);
      }
      rowH = Math.max(rowH, h * sc + 14 * d);
      x += cw + 8;
    }
  }
}

/** The ?dev&sheet canvas: fixed over the whole page, scrolled by the wheel or a drag (dy in CSS px). */
function sheetCanvas(scroll: (dy: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.assign(c.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '10000', imageRendering: 'pixelated' });
  document.body.appendChild(c);
  let last: number | null = null;
  c.addEventListener('wheel', (e) => { e.preventDefault(); scroll(e.deltaY); }, { passive: false });
  c.addEventListener('pointerdown', (e) => { last = e.clientY; });
  c.addEventListener('pointermove', (e) => { if (last !== null) { scroll(last - e.clientY); last = e.clientY; } });
  c.addEventListener('pointerup', () => { last = null; });
  return c;
}

/** The overlay a building auto-selects while placing (§12.5), or null to keep the current one. */
function autoOverlay(type: BuildingId): { o: OverlayId; layer?: CoverageLayerId } | null {
  const def = BUILDING_DEFS[type];
  if (type === 'area') return { o: 'domus' };
  if (type === 'hortus') return { o: 'desir' };
  if (def.cat === 'aqua') return { o: 'aqua' };
  if (def.service?.length) return { o: 'officia', layer: def.service[0].layer };
  if (def.place.length > 0 && def.place.every((c) => c === 'rural')) return { o: 'terra' };
  return null;
}

// src/render/view.ts — MapView: frame, draw list, picking, placement routing, fx (ARCHITECTURE §12.2, §12.4). Owner: WP-F.
// The only render object the UI touches. It never mutates game state: clicks, drags and placement verdicts go out
// through ViewCallbacks and main.ts runs the actions. Frame order (§12.2): ground chunks (crossfaded) → ground layer
// (fields, stakes, selection ring) → trees → overlay → placement under-layer → y-sorted objects → status and overlay
// marks → particles → birds → placement ghost → flashes. All coordinates passed in and out are CSS px.
import type { BuildingId, CoverageLayerId, FxEvent, GameState, OverlayId, PlaceCheck, Rect } from '../game/types';
import { BUILDING_DEFS } from '../game/data/buildings';
import { H, W, getMap, inBounds } from '../game/map';
import { derived } from '../game/derived';
import { getBuilding } from '../game/state';
import type { Camera, Push, Xform } from './camera';
import { Motion, TILE, ZOOM_LEVELS, clampCamera, defaultLevel, makeCamera, nearestLevel, scaleFor, screenToWorld, tilesIn, worldToScreen } from './camera';
import { Input } from './input';
import { TerrainPainter } from './terrain';
import { ForestLayer, forestItems, natureItems } from './forest';
import { OVERLAY_ALPHA, OverlayPainter } from './overlays';
import { Minimap } from './minimap';
import { Placement, label, lPath } from './placement';
import { Particles } from './particles';
import { Actors } from './actors';
import { BuildingPainter, footprintRect } from './buildings';
import { linearItems } from './linear';
import { hasSprite, sprite, spriteNames, spriteSize } from './sprites';
import { REQUIRED_SPRITES } from './art/index';

/** What the player is placing: a building (optionally replacing an Ordo stake or pre-positioned) or a map tool. */
export type PlacingState =
  | { kind: 'building'; type: BuildingId; replaceId?: number; at?: number }   // at: pre-positioned origin tile (remedies)
  | { kind: 'road' } | { kind: 'pave' } | { kind: 'reserve' } | { kind: 'demolish' };

/** How the view reports input to the app (main.ts runs the actions). */
export interface ViewCallbacks {
  onHover(tile: number | null, buildingId: number | null): void;
  onClick(tile: number, buildingId: number | null, e: { button: 0 | 2; shift: boolean }): void;
  onDrag(kind: 'road' | 'pave', tiles: number[], done: boolean): void;      // L-shaped path preview; done on release
  onCancel(): void;                                                          // right-click / two-finger tap while placing
  onPlacementPreview(check: PlaceCheck | null, tile: number | null): void;   // banner + inspector verdict (desktop hover, touch tap)
}

const BG = '#15100d';
const DEMOLISH_MS = 3000;
const FLASH_MS = 1500;
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
  private flashes: { r: Rect; until: number; ms: number }[] = [];
  private time = 0;
  private doomed: { id: number; until: number } | null = null;
  private dragFrom: number | null = null;
  private titleT = 0;
  private sheetY = 0;
  private sheet: HTMLCanvasElement | null = null;     // ?dev&sheet: a full-page canvas above every UI layer
  private titleUntil = 0;                            // titleDrift() was called this frame: a clean map, no marks

  constructor(private readonly canvas: HTMLCanvasElement, minimap: HTMLCanvasElement | null, private readonly cb: ViewCallbacks) {
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    this.mini = minimap ? new Minimap(minimap, (wx, wy) => this.centerWorld(wx, wy)) : null;
    this.input = new Input(canvas, {
      hover: (x, y) => this.onHoverPx(x, y),
      leave: () => this.onLeave(),
      pan: (dx, dy) => this.drag(dx, dy),
      fling: (vx, vy) => (vx || vy ? this.motion.fling((-vx * this.ratio) / this.cam.scale, (-vy * this.ratio) / this.cam.scale) : this.motion.stop()),
      zoom: (steps, x, y) => this.zoomBy(steps, { sx: x, sy: y }),
      tap: (x, y, info) => this.onTap(x, y, info.button, info.shift, info.touch),
      toolDrag: (phase, x, y, shift) => this.onToolDrag(phase, x, y, shift),
      cancel: () => this.cb.onCancel(),
    });
    if (DEV_SHEET) this.sheet = sheetCanvas((dy) => { this.sheetY = Math.min(0, this.sheetY - dy * this.dpr); });
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

  // ───────────────────────────── lifecycle ─────────────────────────────
  /** New or loaded game: drop caches, reset modes, default zoom, centre on the forum. */
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
    this._selected = this.hoverTile = this.hoverId = this.doomed = this.dragFrom = null;
    this.flashes = [];
    this.resize();
    this.setZoom(defaultLevel(this.cssW || window.innerWidth));
    this.centerOnForum();
    this.mini?.invalidate();
  }

  /** Re-reads the canvas CSS size and devicePixelRatio. */
  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cssW = Math.max(1, r.width || window.innerWidth);
    this.cssH = Math.max(1, r.height || window.innerHeight);
    this.canvas.width = Math.max(1, Math.round(this.cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.cssH * this.dpr));
    this.ratio = this.canvas.width / this.cssW;
    this.cam.vw = this.canvas.width;
    this.cam.vh = this.canvas.height;
    this.cam.scale = scaleFor(this.cam.level, this.dpr);
    clampCamera(this.cam);
    this.mini?.invalidate();
  }

  /** Draws one frame (called every animation frame by main.ts). */
  frame(dtMs: number, s: GameState, speed: number, paused: boolean): void {
    this.s = s;
    this.time += dtMs;
    if (this.canvas.clientWidth !== Math.round(this.cssW) || this.canvas.clientHeight !== Math.round(this.cssH)) this.resize();
    if (this.doomed && this.time > this.doomed.until) this.doomed = null;
    if (this._placing) this.place.refresh(s);
    this.motion.step(this.cam, dtMs);
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
    this.place.drawOver(g, s, this.time, cur);
    this.drawFlashes(g, s, xf);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.mini?.draw(s, this.cam, this.terrain.miniCanvas(s), ov, this._placing !== null, this.time);
  }

  /** Routes sim and action fx to particles, actors and flashes (§12.6); `season` crossfades on its own. */
  handleFx(events: FxEvent[], s: GameState): void {
    this.particles.handleFx(events, s, (r) => this.flashes.push({ r, until: this.time + FLASH_MS, ms: FLASH_MS }));
    this.actors.handleFx(events, s);
    if (events.some((e) => e.kind === 'built' || e.kind === 'ordoPlaced' || e.kind === 'rank')) this.mini?.invalidate();
  }

  // ───────────────────────────── camera ─────────────────────────────
  /** Glides the map content by (dx, dy) CSS px, like a drag (positive dx shows more of the west); eased. */
  panBy(dxCss: number, dyCss: number): void {
    this.motion.glide((-dxCss * this.ratio) / this.cam.scale, (-dyCss * this.ratio) / this.cam.scale);
  }

  /** Centres the view on a tile, optionally at a zoom level. */
  centerOn(tile: number, level?: number): void {
    if (level !== undefined) this.setZoom(level);
    this.centerWorld(((tile % W) + 0.5) * TILE, (Math.floor(tile / W) + 0.5) * TILE);
  }

  /** Centres the view on the forum. */
  centerOnForum(): void {
    if (!this.s) return;
    const f = getMap(this.s.seed).survey.forum;
    this.centerWorld((f.x + f.w / 2) * TILE, (f.y + f.h / 2) * TILE);
  }

  /** Steps the zoom level, keeping the world point under the anchor (CSS px) fixed; eased over 140 ms. */
  zoomBy(steps: number, anchor?: { sx: number; sy: number }): void {
    const cur = ZOOM_LEVELS.indexOf(nearestLevel(this.cam.level));
    this.applyLevel(ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, cur + Math.round(steps)))], anchor);
  }

  /** Sets the zoom level (snapped to ZOOM_LEVELS), keeping the centre. */
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
    this.doomed = null;
    this.dragFrom = null;
    this.place.start(p, s);
    if (p.kind === 'building' && p.at !== undefined) {
      this.centerOn(p.at);
      this.cb.onPlacementPreview(this.place.check, p.at);
    }
  }

  /** Leaves placing mode and restores the previous overlay. */
  cancelPlacing(): void {
    if (!this._placing) return;
    this._placing = null;
    this.place.cancel();
    this.dragFrom = null;
    this.doomed = null;
    if (this.prevOverlay) this.setOverlay(this.prevOverlay.o, this.prevOverlay.layer);
    this.prevOverlay = null;
  }

  /** Shows an overlay; 'officia' keeps its last layer unless one is given. */
  setOverlay(o: OverlayId, layer?: CoverageLayerId): void {
    this._overlay = o;
    if (o === 'officia' && layer) this._layer = layer;
    this.mini?.invalidate();
  }

  /** Selects a building (ring and chevron) or clears the selection. */
  select(id: number | null): void {
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
    const b = this.s ? getBuilding(this.s, id) : undefined;
    if (!this.s || !b) return null;
    const r = footprintRect(this.s, b);
    return this.screenRect(r.x, r.y, r.w, r.h);
  }

  /** The slow drift behind the title screen: a wide, lazy ellipse around the forum. */
  titleDrift(dtMs: number, s: GameState): void {
    this.s = s;
    this.titleT += dtMs / 1000;
    this.titleUntil = this.time + dtMs + 50;
    const f = getMap(s.seed).survey.forum, a = this.titleT * DRIFT.rate;
    this.centerWorld((f.x + f.w / 2) * TILE + Math.sin(a) * DRIFT.r, (f.y + f.h / 2) * TILE + Math.sin(a * 0.7 + 1) * DRIFT.r * 0.5);
  }

  /** Enables or disables map input (off under the catch-up veil and modals). */
  setInputEnabled(on: boolean): void {
    this.input.enabled = on;
    if (!on) this.hoverTile = this.hoverId = null;
  }

  // ───────────────────────────── internals ─────────────────────────────
  private centerWorld(wx: number, wy: number): void {
    this.motion.stop();
    this.cam.x = wx;
    this.cam.y = wy;
    clampCamera(this.cam);
  }

  private drag(dxCss: number, dyCss: number): void {
    this.cam.x -= (dxCss * this.ratio) / this.cam.scale;
    this.cam.y -= (dyCss * this.ratio) / this.cam.scale;
    clampCamera(this.cam);
  }

  private applyLevel(level: number, anchor?: { sx: number; sy: number }): void {
    if (level === this.cam.level && this.cam.scale === scaleFor(level, this.dpr)) return;
    const ax = anchor ? anchor.sx * this.ratio : this.cam.vw / 2, ay = anchor ? anchor.sy * this.ratio : this.cam.vh / 2;
    const before = screenToWorld(this.cam, ax, ay), s0 = this.motion.xform(this.cam).k;
    this.cam.level = level;
    this.cam.scale = scaleFor(level, this.dpr);
    const after = screenToWorld(this.cam, ax, ay);
    this.cam.x += before.wx - after.wx;
    this.cam.y += before.wy - after.wy;
    clampCamera(this.cam);
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
    this.cb.onHover(tile, id);
    if (this._placing && tileChanged && this.dragFrom === null) {
      const check = this.place.hover(tile, s);
      if (this._placing.kind === 'building') this.cb.onPlacementPreview(check, tile);
    }
  }

  private onLeave(): void {
    this.hoverTile = this.hoverId = null;
    this.cb.onHover(null, null);
    if (this._placing && this.s && this.dragFrom === null) {
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
    if (p && touch) this.place.hover(tile, s);
    if (p?.kind === 'building' && touch) {
      // touch: a tap previews (ghost + verdict); the place banner's Place button confirms
      this.cb.onPlacementPreview(this.place.check, tile);
      return;
    }
    if (p?.kind === 'demolish') {
      if (id === null) return;
      if (this.doomed?.id === id && this.time <= this.doomed.until) {
        this.doomed = null;
        this.cb.onClick(tile, id, { button, shift });
      } else this.doomed = { id, until: this.time + DEMOLISH_MS };
      return;
    }
    this.cb.onClick(tile, id, { button, shift });
  }

  private onToolDrag(phase: 'start' | 'move' | 'end' | 'abort', x: number, y: number, shift: boolean): boolean {
    const p = this._placing;
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
    const path = tile === null ? this.place.path ?? [this.dragFrom] : lPath(this.dragFrom, tile, shift);
    this.place.path = path;
    if (phase === 'move') this.cb.onDrag(kind, path, false);
    else {
      this.dragFrom = null;
      this.place.path = null;
      this.cb.onDrag(kind, path, true);
    }
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
    const b = this.doomed ? getBuilding(s, this.doomed.id) : undefined;
    if (b) {
      const r = footprintRect(s, b);
      g.fillStyle = `rgba(229,85,74,${0.3 + 0.2 * Math.sin(this.time / 120)})`;
      g.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      label(g, 'Click again to demolish', (r.x + r.w / 2) * TILE, r.y * TILE - 8 - 12 / xf.k, '#e5554a');
    }
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

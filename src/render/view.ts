// src/render/view.ts — MapView: frame, draw list, picking, placement routing, fx (ARCHITECTURE §12.2, §12.4). Owner: WP-F.
// The only render object the UI touches. It never mutates game state: clicks, drags and placement verdicts go out
// through ViewCallbacks and main.ts runs the actions.
// SCAFFOLD (debug): terrain colour per tile, footprints coloured by category, roads, walls; the public API is final.
import type { BuildingId, CoverageLayerId, FxEvent, GameState, OverlayId, PlaceCheck, Rect } from '../game/types';
import { BUILDING_DEFS } from '../game/data/buildings';
import { H, W, getMap, inBounds } from '../game/map';
import { derived } from '../game/derived';
import { getBuilding } from '../game/state';
import type { Camera } from './camera';
import { TILE, ZOOM_LEVELS, clampCamera, defaultLevel, makeCamera, nearestLevel, scaleFor, screenToWorld, visibleTiles, worldToScreen } from './camera';
import { Input } from './input';
import { TerrainPainter } from './terrain';
import { OVERLAY_ALPHA, OverlayPainter } from './overlays';
import { Minimap } from './minimap';
import { Placement, lPath } from './placement';
import { Particles } from './particles';
import { Actors } from './actors';
import { drawBuildings, footprintRect } from './buildings';
import { drawRoads, drawWalls } from './linear';
import { sprite, spriteNames, spriteSize } from './sprites';

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
const DRIFT_R = { x: 160, y: 90 };                  // title drift radius, world px
const DRIFT_RATE = { x: 0.05, y: 0.037 };           // rad per second
const DEV_SHEET = typeof location !== 'undefined' && /[?&]dev\b/.test(location.search) && /[?&]sheet\b/.test(location.search);

/** The map view: owns the canvas, camera, input and every render layer. */
export class MapView {
  private readonly g: CanvasRenderingContext2D;
  private readonly cam: Camera = makeCamera();
  private dpr = 1;
  private ratio = 1;                                 // device px per CSS px of the canvas
  private cssW = 0;
  private cssH = 0;
  private readonly input: Input;
  private readonly terrain = new TerrainPainter();
  private readonly overlays = new OverlayPainter();
  private readonly mini: Minimap | null;
  private readonly place = new Placement();
  private readonly particles = new Particles();
  private readonly actors = new Actors();
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

  constructor(private readonly canvas: HTMLCanvasElement, minimap: HTMLCanvasElement | null, private readonly cb: ViewCallbacks) {
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    this.mini = minimap ? new Minimap(minimap, (wx, wy) => this.centerWorld(wx, wy)) : null;
    this.input = new Input(canvas, {
      hover: (x, y) => this.onHoverPx(x, y),
      leave: () => this.onLeave(),
      pan: (dx, dy) => this.panBy(dx, dy),
      zoom: (steps, x, y) => this.zoomBy(steps, { sx: x, sy: y }),
      tap: (x, y, info) => this.onTap(x, y, info.button, info.shift, info.touch),
      toolDrag: (phase, x, y, shift) => this.onToolDrag(phase, x, y, shift),
      cancel: () => this.cb.onCancel(),
    });
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
    this.overlays.reset();
    this.particles.clear();
    this.actors.reset();
    this.place.cancel();
    this._placing = null;
    this.prevOverlay = null;
    this._overlay = 'none';
    this._selected = null;
    this.hoverTile = null;
    this.hoverId = null;
    this.flashes = [];
    this.doomed = null;
    this.dragFrom = null;
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
    this.particles.update(dtMs);
    this.actors.update(dtMs, s, paused ? 0 : speed);
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = BG;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (DEV_SHEET) { this.drawSheet(); return; }

    const k = this.cam.scale;
    g.setTransform(k, 0, 0, k, Math.round(this.cam.vw / 2 - this.cam.x * k), Math.round(this.cam.vh / 2 - this.cam.y * k));
    g.imageSmoothingEnabled = false;
    const ground = this.terrain.canvas(s);
    g.drawImage(ground, 0, 0, W * TILE, H * TILE);
    const vis = visibleTiles(this.cam, 4);
    drawRoads(g, s, vis);
    const ov = this.overlays.canvas(s, this._overlay, this._layer);
    if (ov) {
      g.imageSmoothingEnabled = true;
      g.globalAlpha = OVERLAY_ALPHA;
      g.drawImage(ov, 0, 0, W * TILE, H * TILE);
      g.globalAlpha = 1;
      g.imageSmoothingEnabled = false;
    }
    drawWalls(g, s, vis);
    drawBuildings(g, s, {
      vis, selected: this._selected, hover: this._placing ? null : this.hoverId, doomed: this.doomed?.id ?? null, time: this.time,
    });
    this.actors.draw(g, vis);
    this.particles.draw(g);
    this.place.draw(g, s, vis, this.time);
    this.drawMarks(g, s);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.mini?.draw(s, this.cam, ground, ov, this._placing !== null, this.time);
  }

  /** Routes sim and action fx to particles, actors and flashes (§12.6). */
  handleFx(events: FxEvent[], s: GameState): void {
    this.particles.handleFx(events, s, (r) => this.flashes.push({ r, until: this.time + FLASH_MS, ms: FLASH_MS }));
    this.actors.handleFx(events, s);
    if (events.some((e) => e.kind === 'built' || e.kind === 'ordoPlaced' || e.kind === 'rank')) this.mini?.invalidate();
  }

  // ───────────────────────────── camera ─────────────────────────────
  /** Moves the map content by (dx, dy) CSS px, like a drag (positive dx shows more of the west). */
  panBy(dxCss: number, dyCss: number): void {
    this.cam.x -= (dxCss * this.ratio) / this.cam.scale;
    this.cam.y -= (dyCss * this.ratio) / this.cam.scale;
    clampCamera(this.cam);
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

  /** Steps the zoom level, keeping the world point under the anchor (CSS px) fixed. */
  zoomBy(steps: number, anchor?: { sx: number; sy: number }): void {
    const cur = ZOOM_LEVELS.indexOf(nearestLevel(this.cam.level));
    const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, cur + Math.round(steps)))];
    this.applyLevel(next, anchor);
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

  /** Selects a building (outline) or clears the selection. */
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

  /** The building under a CSS-px point (scaffold: by footprint via derived.buildingAt), or null. */
  pickBuilding(sxCss: number, syCss: number): number | null {
    const t = this.tileAt(sxCss, syCss);
    if (t === null || !this.s) return null;
    const id = derived(this.s).buildingAt[t];
    return id > 0 ? id : null;
  }

  /** The CSS-px centre of a tile for anchoring DOM, or null when it is off screen. */
  screenOf(tile: number): { x: number; y: number } | null {
    const p = worldToScreen(this.cam, ((tile % W) + 0.5) * TILE, (Math.floor(tile / W) + 0.5) * TILE);
    const x = p.sx / this.ratio, y = p.sy / this.ratio;
    return x < 0 || y < 0 || x > this.cssW || y > this.cssH ? null : { x, y };
  }

  /** The slow drift behind the title screen. */
  titleDrift(dtMs: number, s: GameState): void {
    this.s = s;
    this.titleT += dtMs / 1000;
    const f = getMap(s.seed).survey.forum;
    this.centerWorld(
      (f.x + f.w / 2) * TILE + Math.sin(this.titleT * DRIFT_RATE.x) * DRIFT_R.x,
      (f.y + f.h / 2) * TILE + Math.sin(this.titleT * DRIFT_RATE.y) * DRIFT_R.y,
    );
  }

  /** Enables or disables map input (off under the catch-up veil and modals). */
  setInputEnabled(on: boolean): void {
    this.input.enabled = on;
    if (!on) {
      this.hoverTile = null;
      this.hoverId = null;
    }
  }

  // ───────────────────────────── internals ─────────────────────────────
  private centerWorld(wx: number, wy: number): void {
    this.cam.x = wx;
    this.cam.y = wy;
    clampCamera(this.cam);
  }

  private applyLevel(level: number, anchor?: { sx: number; sy: number }): void {
    const before = anchor ? screenToWorld(this.cam, anchor.sx * this.ratio, anchor.sy * this.ratio) : null;
    this.cam.level = level;
    this.cam.scale = scaleFor(level, this.dpr);
    if (before && anchor) {
      const after = screenToWorld(this.cam, anchor.sx * this.ratio, anchor.sy * this.ratio);
      this.cam.x += before.wx - after.wx;
      this.cam.y += before.wy - after.wy;
    }
    clampCamera(this.cam);
  }

  private onHoverPx(x: number, y: number): void {
    const s = this.s;
    if (!s) return;
    const tile = this.tileAt(x, y);
    const id = tile === null ? null : this.pickBuilding(x, y);
    if (tile !== this.hoverTile || id !== this.hoverId) {
      const tileChanged = tile !== this.hoverTile;
      this.hoverTile = tile;
      this.hoverId = id;
      this.cb.onHover(tile, id);
      if (this._placing && tileChanged && this.dragFrom === null) {
        const check = this.place.hover(tile, s);
        if (this._placing.kind === 'building') this.cb.onPlacementPreview(check, tile);
      }
    }
  }

  private onLeave(): void {
    this.hoverTile = null;
    this.hoverId = null;
    this.cb.onHover(null, null);
    if (this._placing?.kind === 'building' && this.s) {
      this.place.hover(null, this.s);
      this.cb.onPlacementPreview(null, null);
    }
  }

  private onTap(x: number, y: number, button: 0 | 2, shift: boolean, touch: boolean): void {
    const s = this.s;
    const tile = this.tileAt(x, y);
    if (!s || tile === null) return;
    const id = this.pickBuilding(x, y);
    const p = this._placing;
    if (p?.kind === 'building' && touch) {
      // touch: a tap previews; the place banner's Place button confirms
      const check = this.place.hover(tile, s);
      this.cb.onPlacementPreview(check, tile);
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

  private onToolDrag(phase: 'start' | 'move' | 'end', x: number, y: number, shift: boolean): boolean {
    const p = this._placing;
    if (!p || (p.kind !== 'road' && p.kind !== 'pave')) return false;
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

  private drawMarks(g: CanvasRenderingContext2D, s: GameState): void {
    this.flashes = this.flashes.filter((f) => f.until > this.time);
    for (const f of this.flashes) {
      const a = Math.max(0, (f.until - this.time) / f.ms);
      g.strokeStyle = `rgba(242,201,76,${a})`;
      g.lineWidth = 2;
      g.strokeRect(f.r.x * TILE + 1, f.r.y * TILE + 1, f.r.w * TILE - 2, f.r.h * TILE - 2);
    }
    if (this.doomed) {
      const b = getBuilding(s, this.doomed.id);
      if (b) {
        const r = footprintRect(s, b);
        g.font = '8px monospace';
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.fillStyle = '#e5554a';
        g.fillText('Click again to demolish', (r.x + r.w / 2) * TILE, r.y * TILE - 2);
        g.textAlign = 'start';
      }
    }
  }

  /** ?dev&sheet: every registered sprite in a labelled grid at 2× (device px). */
  private drawSheet(): void {
    const g = this.g;
    const names = spriteNames();
    g.fillStyle = '#f4ead6';
    g.font = `${Math.round(10 * this.dpr)}px monospace`;
    g.textBaseline = 'top';
    if (!names.length) { g.fillText('No sprites registered yet.', 16, 16); return; }
    const sc = 2 * Math.max(1, Math.round(this.dpr));
    let x = 8, y = 8, rowH = 0;
    for (const n of names) {
      const { w, h } = spriteSize(n);
      const cw = Math.max(w * sc, 96 * this.dpr);
      if (x + cw > this.canvas.width) { x = 8; y += rowH + 8; rowH = 0; }
      g.imageSmoothingEnabled = false;
      g.drawImage(sprite(n), x, y, w * sc, h * sc);
      g.fillText(n, x, y + h * sc + 2);
      rowH = Math.max(rowH, h * sc + 14 * this.dpr);
      x += cw + 8;
    }
  }
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

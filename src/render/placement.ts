// src/render/placement.ts — placement ghost, valid slots, verdict, coverage preview, laurel, road/pave drag (ARCHITECTURE
// §12.2 steps 4 and 8, §12.4). Owner: WP-F.
// The view never mutates state: this module only reads (validSlots, bestSlot, snapSlot, canPlace, previewCoverage,
// housesUnlockedBy, previewDesir) and draws. Slots and the best slot are computed on start and again when the structure
// epoch changes; the hover verdict and previews only when the snapped origin changes.
import type { BuildingId, CoverageLayerId, GameState, PlaceCheck, Rect, SeasonIndex } from '../game/types';
import { H, W, getMap, idx, inBounds } from '../game/map';
import { T } from '../game/types';
import { canPlace, snapSlot, validSlots } from '../game/place';
import { bestSlot } from '../game/site';
import { blockOfTile, classAt, derived, sizeOf } from '../game/derived';
import { previewCoverage, previewDesir } from '../game/coverage';
import { housesUnlockedBy } from '../game/housing';
import { structEpoch } from '../game/memo';
import { B } from '../game/balance';
import { LAYER_META } from '../game/data/housing';
import { houseSprite, seasonal } from './art/index';
import { makeCanvas, sprite } from './sprites';
import type { PlacingState } from './view';
import { TILE } from './camera';
import { footprintRect, lookOf } from './buildings';

const GOLD_MULT = 1.05;
const C = { ok: '#9ccc5a', bad: '#e5554a', gold: '#f2c94c', white: '#f4ead6', ember: '#f0a04b', dim: 'rgba(244,234,214,0.35)' } as const;

/** An L-shaped tile path from a to b: horizontal first (or vertical first), inclusive of both ends. */
export function lPath(a: number, b: number, verticalFirst: boolean): number[] {
  const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
  const out: number[] = [];
  const sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
  if (!verticalFirst) {
    for (let x = ax; x !== bx; x += sx) out.push(idx(x, ay));
    for (let y = ay; y !== by; y += sy) out.push(idx(bx, y));
  } else {
    for (let y = ay; y !== by; y += sy) out.push(idx(ax, y));
    for (let x = ax; x !== bx; x += sx) out.push(idx(x, by));
  }
  out.push(b);
  return out;
}

/** A line of pixel text on a dark plate, centred at (x, y) in world px. */
export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  g.font = '7px Silkscreen, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = Math.ceil(g.measureText(text).width) + 6;
  g.fillStyle = 'rgba(14,11,22,0.85)';
  g.fillRect(Math.round(x - w / 2), Math.round(y) - 5, w, 10);
  g.fillStyle = color;
  g.fillText(text, Math.round(x), Math.round(y) + 0.5);
  g.textAlign = 'start';
}

interface Slot { r: Rect; mult: number; rural: boolean }
interface Preview { cov: { layer: CoverageLayerId; tiles: Uint8Array }[]; houses: number[]; desir: { tile: number; v: number }[] }

const redCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function reddened(c: HTMLCanvasElement): HTMLCanvasElement {
  let r = redCache.get(c);
  if (r) return r;
  r = makeCanvas(c.width, c.height);
  const g = r.getContext('2d');
  if (g) { g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(229,85,74,0.55)'; g.fillRect(0, 0, c.width, c.height); }
  redCache.set(c, r);
  return r;
}

/** Placement-mode state of the view: valid slots, hover verdict, previews, drag path. */
export class Placement {
  state: PlacingState | null = null;
  check: PlaceCheck | null = null;
  hoverTile: number | null = null;
  path: number[] | null = null;
  private slots: Slot[] = [];
  private best: Rect | null = null;
  private epoch = -1;
  private origin = -1;
  private preview: Preview | null = null;

  /** Enters a placing mode; for buildings computes valid slots and the best slot once. */
  start(p: PlacingState, s: GameState): void {
    this.state = p;
    this.check = null;
    this.hoverTile = null;
    this.path = null;
    this.epoch = -1;
    this.origin = -1;
    this.refresh(s);
    if (p.kind === 'building' && p.at !== undefined) this.hover(p.at, s);
  }

  /** Leaves placing mode. */
  cancel(): void {
    this.state = this.check = this.hoverTile = this.path = this.best = this.preview = null;
    this.slots = [];
  }

  /** Recomputes the slot glow when the structure changed. */
  refresh(s: GameState): void {
    const p = this.state;
    if (!p || p.kind !== 'building') { this.slots = []; this.best = null; return; }
    const ep = structEpoch(s);
    if (ep === this.epoch) return;
    this.epoch = ep;
    this.origin = -1;
    this.slots = [];
    for (const [tile, mult] of validSlots(s, p.type, 'player')) {
      const x = tile % W, y = Math.floor(tile / W), cls = classAt(s, p.type, x, y);
      const [w, h] = sizeOf(p.type, cls);
      this.slots.push({ r: { x, y, w, h }, mult, rural: cls === 'rural' });
    }
    const b = bestSlot(s, p.type, { owner: 'player' });
    this.best = b ? { x: b.x, y: b.y, w: sizeOf(p.type, classAt(s, p.type, b.x, b.y))[0], h: sizeOf(p.type, classAt(s, p.type, b.x, b.y))[1] } : null;
    if (this.hoverTile !== null) this.hover(this.hoverTile, s);
  }

  /** Hover (desktop) or tap (touch) at a tile: snaps and checks a building placement; null for other tools. */
  hover(tile: number | null, s: GameState): PlaceCheck | null {
    this.hoverTile = tile;
    const p = this.state;
    if (!p || p.kind !== 'building' || tile === null) { this.check = null; this.preview = null; return null; }
    const snap = snapSlot(s, p.type, tile);
    const at = snap ? idx(snap.x, snap.y) : tile;
    this.check = canPlace(s, p.type, at, { owner: 'player', replaceId: p.replaceId });
    if (at !== this.origin) {
      this.origin = at;
      const x = at % W, y = Math.floor(at / W);
      this.preview = this.check.ok
        ? { cov: previewCoverage(s, p.type, x, y), houses: housesUnlockedBy(s, p.type, x, y), desir: previewDesir(s, p.type, x, y) }
        : null;
    }
    return this.check;
  }

  /** Under-layer (step 4): glowing valid slots, coverage preview on road tiles, the desirability footprint, tool paths. */
  drawUnder(g: CanvasRenderingContext2D, s: GameState, vis: Rect, time: number, desirOverlay: boolean): void {
    const p = this.state;
    if (!p) return;
    const inView = (r: Rect): boolean => r.x <= vis.x + vis.w && r.y <= vis.y + vis.h && r.x + r.w >= vis.x && r.y + r.h >= vis.y;
    if (p.kind === 'building') {
      const pulse = 0.16 + 0.08 * Math.sin(time / 300);
      for (const sl of this.slots) {
        const r = sl.rural ? { x: sl.r.x, y: sl.r.y, w: 1, h: 1 } : sl.r;
        if (!inView(r)) continue;
        const gold = sl.mult >= GOLD_MULT;
        g.fillStyle = gold ? `rgba(242,201,76,${pulse + 0.12})` : `rgba(156,204,90,${pulse})`;
        g.fillRect(r.x * TILE + 1, r.y * TILE + 1, r.w * TILE - 2, r.h * TILE - 2);
        if (!sl.rural) { g.fillStyle = gold ? 'rgba(242,201,76,0.8)' : 'rgba(244,234,214,0.45)'; edge(g, r); }
      }
      const pv = this.preview;
      if (pv) {
        for (const c of pv.cov) {
          g.fillStyle = LAYER_META[c.layer].color;
          for (let y = vis.y; y < vis.y + vis.h; y++)
            for (let x = vis.x; x < vis.x + vis.w; x++) {
              const i = y * W + x;
              if (!c.tiles[i]) continue;
              g.globalAlpha = 0.5;
              g.fillRect(x * TILE, y * TILE, TILE, TILE);
              g.globalAlpha = 1;
              const out = (nx: number, ny: number): boolean => !inBounds(nx, ny) || !c.tiles[ny * W + nx];
              if (out(x, y - 1)) g.fillRect(x * TILE, y * TILE, TILE, 1);
              if (out(x, y + 1)) g.fillRect(x * TILE, y * TILE + 15, TILE, 1);
              if (out(x - 1, y)) g.fillRect(x * TILE, y * TILE, 1, TILE);
              if (out(x + 1, y)) g.fillRect(x * TILE + 15, y * TILE, 1, TILE);
            }
        }
        if (desirOverlay) for (const d of pv.desir) {
          g.fillStyle = d.v >= 0 ? `rgba(156,204,90,${Math.min(0.7, 0.15 + d.v / 10)})` : `rgba(229,85,74,${Math.min(0.7, 0.15 - d.v / 10)})`;
          g.fillRect((d.tile % W) * TILE, Math.floor(d.tile / W) * TILE, TILE, TILE);
        }
      }
      if (p.replaceId !== undefined) {
        const b = s.buildings.find((x) => x.id === p.replaceId);
        if (b) { g.fillStyle = C.ember; edge(g, footprintRect(s, b), 2); }
      }
    } else if (p.kind === 'reserve') {
      const sv = getMap(s.seed).survey;
      g.fillStyle = 'rgba(240,160,75,0.5)';
      for (const id of s.ordo.reserved) {
        const b = sv.blocks[id];
        if (!b) continue;
        for (let k = 0; k < 8; k++) g.fillRect(b.x * TILE + k * 8, b.y * TILE, 2, 4 * TILE);
      }
      const blk = this.hoverTile === null ? null : blockOfTile(s, this.hoverTile);
      if (blk) { g.fillStyle = C.ember; edge(g, { x: blk.x, y: blk.y, w: 4, h: 4 }, 2); }
    } else if ((p.kind === 'road' || p.kind === 'pave') && this.path) {
      const d = derived(s), map = getMap(s.seed);
      for (const t of this.path) {
        const x = (t % W) * TILE, y = Math.floor(t / W) * TILE;
        const bad = p.kind === 'pave' ? d.road[t] === 0 : (d.pomerium[t] === 1 && !map.survey.street[t]) || map.terrain[t] === T.crag
          || (map.terrain[t] === T.river && !map.survey.bridge.includes(t)) || d.buildingAt[t] > 0;
        const have = p.kind === 'pave' ? d.road[t] === 2 : d.road[t] > 0;
        g.fillStyle = bad ? 'rgba(229,85,74,0.6)' : have ? C.dim : p.kind === 'road' ? 'rgba(155,122,82,0.9)' : 'rgba(92,93,102,0.9)';
        g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
        g.fillStyle = bad ? C.bad : C.white;
        edge(g, { x: t % W, y: Math.floor(t / W), w: 1, h: 1 });
      }
    }
  }

  /** Over-layer (step 8): the ghost, verdict, bonus, felling yield, laurel, ↑ over houses that could evolve, costs. */
  drawOver(g: CanvasRenderingContext2D, s: GameState, time: number, season: SeasonIndex): void {
    const p = this.state;
    if (!p) return;
    if (p.kind === 'building') {
      if (this.best) {
        const ic = sprite('i_laurel'), bob = Math.round(Math.sin(time / 260) * 1.5);
        g.drawImage(ic, Math.round((this.best.x + this.best.w / 2) * TILE - ic.width / 2), this.best.y * TILE - ic.height - 2 + bob);
      }
      this.ghost(g, s, p.type, time, season);
    } else if ((p.kind === 'road' || p.kind === 'pave') && this.path?.length) {
      const d = derived(s), last = this.path[this.path.length - 1];
      const n = this.path.filter((t) => (p.kind === 'road' ? d.road[t] === 0 : d.road[t] === 1)).length;
      const text = p.kind === 'road' ? `${n} new · free` : `${n} × ${B.map.PAVE_STONE} stone`;
      label(g, text, (last % W) * TILE + 8, Math.floor(last / W) * TILE - 8, C.white);
    } else if (this.hoverTile !== null && p.kind === 'demolish') {
      const id = derived(s).buildingAt[this.hoverTile];
      const b = id ? s.buildings.find((x) => x.id === id) : undefined;
      if (b) { g.fillStyle = 'rgba(229,85,74,0.35)'; const r = footprintRect(s, b); g.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE); }
    }
  }

  private ghost(g: CanvasRenderingContext2D, s: GameState, type: BuildingId, time: number, season: SeasonIndex): void {
    const t = this.hoverTile;
    if (t === null) return;
    const c = this.check, ok = !!c && c.ok;
    const snap = snapSlot(s, type, t);
    const ox = c && c.ok ? c.x : snap?.x ?? t % W, oy = c && c.ok ? c.y : snap?.y ?? Math.floor(t / W);
    if (ox < 0 || oy < 0 || ox >= W || oy >= H) return;
    const [w, h] = sizeOf(type, classAt(s, type, ox, oy));
    const name = type === 'area' ? houseSprite('tentoria', false, ox, oy) : seasonal(`b_${type}`, season);
    const { cv } = lookOf(name, type, type === 'area' ? 'tentoria' : null, w);
    const X = ox * TILE, Y = oy * TILE, bottom = (oy + h) * TILE, cx = X + (w * TILE) / 2;
    g.globalAlpha = 0.6;
    g.drawImage(ok ? cv : reddened(cv), Math.round(cx - cv.width / 2), bottom - cv.height);
    g.globalAlpha = 1;
    g.fillStyle = ok ? C.ok : C.bad;
    edge(g, { x: ox, y: oy, w, h });
    let y = bottom - cv.height - 8;
    if (!ok) {
      g.fillStyle = C.bad;
      for (let k = -3; k <= 3; k++) { g.fillRect(cx + k, Y + (h * TILE) / 2 + k, 2, 2); g.fillRect(cx + k, Y + (h * TILE) / 2 - k, 2, 2); }
      if (c && !c.ok) label(g, c.reason, cx, y, '#ff9b8f');
      return;
    }
    if (c.mult >= GOLD_MULT) { label(g, `+${Math.round((c.mult - 1) * 100)}%`, cx, y, C.gold); y -= 11; }
    if (c.fell > 0) { label(g, `+${Math.round(c.fell)} timber`, cx, y, C.ok); y -= 11; }
    const houses = this.preview?.houses ?? [];
    if (houses.length) {
      label(g, `+${houses.length} ${houses.length === 1 ? 'house' : 'houses'} could evolve`, cx, y, C.ok);
      const bob = Math.round(Math.sin(time / 200) * 2);
      for (const id of houses) {
        const b = s.buildings.find((x) => x.id === id);
        if (!b) continue;
        const r = footprintRect(s, b), ax = (r.x + r.w / 2) * TILE, ay = r.y * TILE - 6 + bob;
        g.fillStyle = '#1d1410'; g.fillRect(ax - 4, ay - 1, 9, 5); g.fillRect(ax - 2, ay + 4, 5, 5);
        g.fillStyle = C.ok; g.fillRect(ax - 3, ay + 2, 7, 1); g.fillRect(ax - 2, ay + 1, 5, 1); g.fillRect(ax - 1, ay, 3, 1); g.fillRect(ax - 1, ay + 3, 3, 5);
      }
    }
    if (c.warn) label(g, c.warn, cx, bottom + 8, C.gold);
  }
}

/** A 1 px (or thicker) outline just inside a tile rectangle, in the current fill colour. */
function edge(g: CanvasRenderingContext2D, r: Rect, t = 1): void {
  const X = r.x * TILE, Y = r.y * TILE, w = r.w * TILE, h = r.h * TILE;
  g.fillRect(X, Y, w, t); g.fillRect(X, Y + h - t, w, t); g.fillRect(X, Y, t, h); g.fillRect(X + w - t, Y, t, h);
}

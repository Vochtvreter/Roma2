// src/render/forest.ts — woods and scattered trees as a live layer with dirty-tile repaint (ARCHITECTURE §12.2). Owner: WP-F.
// Trees reflect the woods in the sim (felled stands show stumps, regrowth brings them back) and vanish under buildings
// and roads. Each chunk keeps one canvas per season; every frame each visible chunk recomputes a tiny "stage" number per
// tree tile and repaints only the tiles whose stage changed (clipped, redrawing neighbours in map order). A whole wood
// therefore costs one drawImage per chunk per frame (the Hearthlands ForestLayer). Trees just south of a building or a
// road (front tiles) are y-sorted objects instead (forestItems), so their canopies stand in front of what they overlap.
// Map props (grove, ruins, springs, rocks, reeds) are y-sorted objects.
import { F, T } from '../game/types';
import type { GameState, Rect, SeasonIndex } from '../game/types';
import { H, W, getMap, idx, inBounds, woodAt } from '../game/map';
import { hash2 } from '../game/rng';
import { derived } from '../game/derived';
import { makeCanvas, sprite } from './sprites';
import { seasonal } from './art/index';
import type { Push } from './camera';
import { TILE } from './camera';
import { CHUNKS } from './terrain';

interface Slot { x: number; y: number; kind: 0 | 1 | 2; v: number; k: number }   // feet in world px; oak/pine/cypress
interface Layer { cv: HTMLCanvasElement; tiles: number[]; stage: Int16Array }

const SCATTER = { plain: 0.03, dry: 0.07 };       // share of open tiles with a lone tree (cypress, umbrella pine, oak)
const OVER = { x: 10, up: 30 };                    // tree overhang beyond its tile (repaint clip)
const FULL_REPAINT = 120;
const SHADOW = 'rgba(20,28,12,0.28)';

let slotSeed = -1;
let slotMap = new Map<number, Slot[]>();

/** Fixed tree spots per tile of a map: woods 2–4 trees, a few lone trees on open land (never on the survey or castrum). */
function slots(seed: number): Map<number, Slot[]> {
  if (seed === slotSeed) return slotMap;
  slotSeed = seed;
  slotMap = new Map();
  const map = getMap(seed);
  const sv = map.survey, c = sv.castrum;
  for (let ty = 0; ty < H; ty++)
    for (let tx = 0; tx < W; tx++) {
      const i = idx(tx, ty), t = map.terrain[i];
      const h = (k: number): number => hash2(tx, ty, k);
      const X = tx * TILE, Y = ty * TILE;
      const list: Slot[] = [];
      if (t === T.forest || t === T.dense) {
        const dense = t === T.dense;
        const n = dense ? 4 : 2 + (h(1) > 0.55 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const r = h(10 + k), kind = r < (dense ? 0.5 : 0.72) ? 0 : r < (dense ? 0.85 : 0.92) ? 1 : 2;
          const x = dense ? X + 4 + (k % 2) * 8 + Math.floor(h(20 + k) * 3) - 1 : X + 3 + Math.floor(h(20 + k) * 11);
          const y = dense ? Y + 7 + Math.floor(k / 2) * 7 + Math.floor(h(30 + k) * 3) : Y + 6 + Math.floor(h(30 + k) * 10);
          list.push({ x, y, kind: kind as 0 | 1 | 2, v: Math.floor(h(40 + k) * 3), k });
        }
      } else if (t !== T.river && t !== T.crag && t !== T.rock && map.feature[i] === F.none && !sv.street[i] && sv.blockAt[i] < 0
        && !(tx >= c.x - 1 && ty >= c.y - 1 && tx <= c.x + c.w && ty <= c.y + c.h)) {
        const dry = t === T.scrub || t === T.hills;
        if (h(2) < (dry ? SCATTER.dry : SCATTER.plain)) {
          const r = h(3), kind = dry ? (r < 0.5 ? 2 : 1) : r < 0.45 ? 2 : r < 0.75 ? 1 : 0;
          list.push({ x: X + 4 + Math.floor(h(4) * 8), y: Y + 9 + Math.floor(h(5) * 6), kind: kind as 0 | 1 | 2, v: Math.floor(h(6) * 3), k: 0 });
        }
      }
      if (list.length) slotMap.set(i, list.sort((a, b) => a.y - b.y || a.x - b.x));
    }
  return slotMap;
}

/**
 * A front tile: a building or a road stands in the row just north of it (x ± 1), so its canopies reach over that
 * object's row. Its trees leave the cached layer and are y-sorted with the objects (forestItems), or the building
 * would cut their canopies flat and walkers on the road would walk over them.
 */
function front(i: number, occupied: Int32Array, road: Uint8Array): boolean {
  const x = i % W, n = i - W;
  if (n < 0) return false;
  return !!(occupied[n] || road[n] || (x > 0 && (occupied[n - 1] || road[n - 1])) || (x < W - 1 && (occupied[n + 1] || road[n + 1])));
}

/** A tile's trees as a small number that changes only when their picture does (0 = nothing drawn). */
function treeLook(s: GameState, i: number, occupied: Int32Array, road: Uint8Array, n: number): number {
  if (occupied[i] || road[i]) return 0;
  const max = getMap(s.seed).woodMax[i];
  if (max <= 0) return 1;
  const frac = Math.max(0, Math.min(1, woodAt(s, i) / max));
  return 2 + Math.round(frac * n) * 2 + (frac < 0.999 ? 1 : 0);
}

/** The look a tile has in the cached layer: 0 for front tiles (their trees are y-sorted objects instead). */
function stageOf(s: GameState, i: number, occupied: Int32Array, road: Uint8Array, n: number): number {
  return front(i, occupied, road) ? 0 : treeLook(s, i, occupied, road, n);
}

/** Calls `each` for every tree or stump of a tile drawn at a given look. */
function eachSlot(i: number, stage: number, season: SeasonIndex, each: (t: Slot, name: string) => void): void {
  const list = slotMap.get(i);
  if (!list || !stage) return;
  const grown = stage === 1 ? list.length : (stage - 2) >> 1;
  const stumps = stage > 1 && (stage & 1) === 1;
  for (const t of list) {
    const standing = t.k < grown;
    if (!standing && !stumps) continue;
    each(t, !standing ? 'n_stump' : t.kind === 0 ? seasonal(`n_oak_${t.v}`, season) : t.kind === 1 ? 'n_pine' : 'n_cypress');
  }
}

/** One tree or stump with its shadow, feet at the slot. */
function drawSlot(g: CanvasRenderingContext2D, t: Slot, name: string): void {
  const spr = sprite(name);
  g.fillStyle = SHADOW;
  g.fillRect(t.x - 3, t.y - 1, 7, 2);
  g.drawImage(spr, t.x - (spr.width >> 1), t.y - spr.height);
}

function drawTile(g: CanvasRenderingContext2D, i: number, stage: number, season: SeasonIndex): void {
  eachSlot(i, stage, season, (t, name) => drawSlot(g, t, name));
}

/** Pushes the trees and stumps of the front tiles in view onto the y-sorted list (feet = sort key). */
export function forestItems(s: GameState, vis: Rect, season: SeasonIndex, push: Push): void {
  const all = slots(s.seed), d = derived(s);
  for (let y = Math.max(1, vis.y); y < Math.min(H, vis.y + vis.h + 2); y++)
    for (let x = Math.max(0, vis.x - 1); x < Math.min(W, vis.x + vis.w + 1); x++) {
      const i = idx(x, y), list = all.get(i);
      if (!list || !front(i, d.buildingAt, d.road)) continue;
      eachSlot(i, treeLook(s, i, d.buildingAt, d.road, list.length), season, (t, name) => push(t.y, t.x, (g) => drawSlot(g, t, name)));
    }
}

/** The live tree layer, painted per chunk and season. */
export class ForestLayer {
  private layers = new Map<string, Layer>();
  private seed = -1;

  /** Forget everything (new or loaded game). */
  reset(): void {
    this.layers.clear();
    this.seed = -1;
  }

  /** Draws the trees over the visible chunks, crossfading the previous season like the ground. */
  draw(g: CanvasRenderingContext2D, s: GameState, vis: Rect, cur: SeasonIndex, prev: SeasonIndex | -1, fade: number): void {
    if (s.seed !== this.seed) { this.reset(); this.seed = s.seed; }
    const d = derived(s);
    const { size, nx, ny, px } = CHUNKS;
    const pass = (season: SeasonIndex, live: boolean): void => {
      for (let cy = Math.max(0, Math.floor(vis.y / size)); cy <= Math.min(ny - 1, Math.floor((vis.y + vis.h) / size)); cy++)
        for (let cx = Math.max(0, Math.floor(vis.x / size)); cx <= Math.min(nx - 1, Math.floor((vis.x + vis.w) / size)); cx++) {
          const L = live ? this.layer(s, season, cx, cy, d.buildingAt, d.road) : this.layers.get(`${season}:${cx}:${cy}`);
          if (L) g.drawImage(L.cv, cx * px, cy * px);
        }
    };
    if (prev >= 0) { pass(prev as SeasonIndex, false); g.globalAlpha = fade; }
    pass(cur, true);
    g.globalAlpha = 1;
    if (prev < 0 && this.layers.size > nx * ny) for (const k of [...this.layers.keys()]) if (!k.startsWith(`${cur}:`)) this.layers.delete(k);
  }

  private layer(s: GameState, season: SeasonIndex, cx: number, cy: number, occupied: Int32Array, road: Uint8Array): Layer | null {
    const key = `${season}:${cx}:${cy}`;
    const { size, px } = CHUNKS;
    const all = slots(s.seed);
    let L = this.layers.get(key);
    if (!L) {
      const tiles: number[] = [];
      for (let y = Math.max(0, cy * size - 1); y < Math.min(H, (cy + 1) * size + 3); y++)
        for (let x = Math.max(0, cx * size - 1); x < Math.min(W, (cx + 1) * size + 1); x++) if (all.has(idx(x, y))) tiles.push(idx(x, y));
      if (!tiles.length) return null;
      L = { cv: makeCanvas(px, px), tiles, stage: new Int16Array(tiles.length).fill(-1) };
      this.layers.set(key, L);
    }
    const changed: number[] = [];
    const now = new Map<number, number>();
    for (let k = 0; k < L.tiles.length; k++) {
      const i = L.tiles[k];
      const st = stageOf(s, i, occupied, road, all.get(i)?.length ?? 0);
      now.set(i, st);
      if (st !== L.stage[k]) { L.stage[k] = st; changed.push(i); }
    }
    if (!changed.length) return L;
    const g = L.cv.getContext('2d');
    if (!g) return L;
    g.save();
    g.imageSmoothingEnabled = false;
    g.translate(-cx * px, -cy * px);
    if (changed.length > FULL_REPAINT) {
      g.clearRect(cx * px, cy * px, px, px);
      for (const i of L.tiles) drawTile(g, i, now.get(i) ?? 0, season);
    } else {
      for (const i of changed) {
        const x = i % W, y = Math.floor(i / W);
        g.save();
        g.beginPath();
        g.rect(x * TILE - OVER.x, y * TILE - OVER.up, TILE + 2 * OVER.x, TILE + OVER.up);
        g.clip();
        g.clearRect(x * TILE - OVER.x, y * TILE - OVER.up, TILE + 2 * OVER.x, TILE + OVER.up);
        for (let yy = y - 2; yy <= y + 2; yy++)
          for (let xx = x - 1; xx <= x + 1; xx++) {
            if (!inBounds(xx, yy)) continue;
            const j = idx(xx, yy);
            const st = now.get(j) ?? (all.has(j) ? stageOf(s, j, occupied, road, all.get(j)?.length ?? 0) : 0);
            if (st) drawTile(g, j, st, season);
          }
        g.restore();
      }
    }
    g.restore();
    return L;
  }
}

interface Prop { i: number; name: string; x: number; y: number }
let propSeed = -1;
let props: Prop[] = [];

/** Fixed props of a map: the sacred grove, ruins, the springs, rocks on the hills and reeds along the river banks. */
function propsOf(seed: number): Prop[] {
  if (seed === propSeed) return props;
  propSeed = seed;
  props = [];
  const map = getMap(seed), sv = map.survey;
  for (let i = 0; i < W * H; i++) {
    const tx = i % W, ty = Math.floor(i / W), t = map.terrain[i], f = map.feature[i];
    const X = tx * TILE + 8, Y = ty * TILE + 12, h = (k: number): number => hash2(tx, ty, k);
    if (sv.street[i] || sv.fossa[i] || sv.wall[i]) continue;
    if (f === F.lucus) props.push({ i, name: 'n_lucus', x: X, y: Y + 3 });
    else if (f === F.ruins) props.push({ i, name: 'n_ruins', x: X, y: Y + 2 });
    else if (f === F.fons) props.push({ i, name: 'n_spring', x: X, y: Y + 2 });
    else if ((t === T.rock && h(80) < 0.35) || (t === T.hills && h(80) < 0.1) || (t === T.crag && h(80) < 0.5))
      props.push({ i, name: `n_rock_${h(81) < 0.5 ? 0 : 1}`, x: X - 4 + Math.floor(h(82) * 8), y: Y - 2 + Math.floor(h(83) * 6) });
    else if (t === T.loam && map.riverDist[i] === 1 && h(84) < 0.4) props.push({ i, name: 'n_reeds', x: X - 4 + Math.floor(h(85) * 8), y: Y + 2 });
  }
  return props;
}

/** Pushes the map's props in view onto the y-sorted list (hidden under buildings and roads). */
export function natureItems(s: GameState, vis: Rect, push: Push): void {
  const d = derived(s);
  for (const p of propsOf(s.seed)) {
    const x = p.i % W, y = Math.floor(p.i / W);
    if (x < vis.x || y < vis.y || x >= vis.x + vis.w || y >= vis.y + vis.h || d.buildingAt[p.i] || d.road[p.i]) continue;
    const spr = sprite(p.name);
    push(p.y, p.x, (g) => g.drawImage(spr, p.x - (spr.width >> 1), p.y - spr.height));
  }
}

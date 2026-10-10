// src/game/derived.ts — structural derived data, memoised on the structure epoch (ARCHITECTURE §4 Derived, §8.2). Owner: WP-A.
// SCAFFOLD: buildingAt, road, counts, all, houses, sites, plotOwner, territory and stepsToForum are real; the
// pomerium and reserved-tile layers are first approximations (STUB(WP-A) markers below).
import { B } from './balance';
import type { Block, Building, BuildingId, Derived, GameState, PlaceClass } from './types';
import { getMap, H, W, idx, inBounds, tx, ty } from './map';
import { activeRings, isActiveBlock } from './survey';
import { memo, structEpoch } from './memo';
import { BUILDING_DEFS } from './data/buildings';
import { RANK_DEFS } from './data/ranks';

const PLOT = B.map.PLOT;
const BLOCK = B.map.BLOCK;
const URBAN: readonly PlaceClass[] = ['plot', 'half', 'block'];

/** Structural derived data of a state (memo on structEpoch). */
export function derived(s: GameState): Derived {
  return memo(s, 'derived', structEpoch(s), () => computeDerived(s));
}

/** Footprint size of a type in a placement class: plot 2×2, half 4×2, block 4×4, rural/fixed from the def. */
export function sizeOf(type: BuildingId, cls: PlaceClass): [number, number] {
  switch (cls) {
    case 'plot': return [PLOT, PLOT];
    case 'half': return [BLOCK, PLOT];
    case 'block': return [BLOCK, BLOCK];
    default: return [BUILDING_DEFS[type].size[0], BUILDING_DEFS[type].size[1]];
  }
}

/** Tile indices covered by a building's footprint (clipped to the map), row by row. */
export function footprintOf(b: Pick<Building, 'type' | 'x' | 'y'>, s: GameState): number[] {
  const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
  const out: number[] = [];
  for (let y = b.y; y < b.y + h; y++) {
    for (let x = b.x; x < b.x + w; x++) if (inBounds(x, y)) out.push(idx(x, y));
  }
  return out;
}

/** Placement class of a type at (x, y): its urban class on an active block, else rural (fixed types: fixed). */
export function classAt(s: GameState, type: BuildingId, x: number, y: number): PlaceClass {
  const def = BUILDING_DEFS[type];
  if (def.place.includes('fixed')) return 'fixed';
  const urban = def.place.find((c) => URBAN.includes(c));
  if (urban) {
    const sv = getMap(s.seed).survey;
    const bid = inBounds(x, y) ? sv.blockAt[idx(x, y)] : -1;
    if (bid >= 0 && isActiveBlock(sv, sv.blocks[bid], s.rank)) return urban;
    if (!def.place.includes('rural')) return urban;
  }
  return 'rural';
}

/** The ring of tiles just outside a w×h rect at (x, y), clockwise from its top-left corner; off-map tiles skipped. */
export function ringOf(x: number, y: number, w: number, h: number): { tiles: number[]; corner: boolean[] } {
  const tiles: number[] = [];
  const corner: boolean[] = [];
  const x0 = x - 1, y0 = y - 1, x1 = x + w, y1 = y + h;
  const push = (px: number, py: number): void => {
    if (!inBounds(px, py)) return;
    tiles.push(idx(px, py));
    corner.push((px === x0 || px === x1) && (py === y0 || py === y1));
  };
  for (let px = x0; px <= x1; px++) push(px, y0);
  for (let py = y0 + 1; py <= y1; py++) push(x1, py);
  for (let px = x1 - 1; px >= x0; px--) push(px, y1);
  for (let py = y1 - 1; py > y0; py--) push(x0, py);
  return { tiles, corner };
}

/** The survey block containing a tile, or null. */
export function blockOfTile(s: GameState, i: number): Block | null {
  if (i < 0 || i >= W * H) return null;
  const sv = getMap(s.seed).survey;
  const id = sv.blockAt[i];
  return id >= 0 ? sv.blocks[id] : null;
}

/** Built road tiles N4-adjacent to a building's footprint (ascending tile order). */
export function roadNeighbors(s: GameState, b: Building): number[] {
  const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
  const ring = ringOf(b.x, b.y, w, h);
  const road = derived(s).road;
  const out: number[] = [];
  for (let k = 0; k < ring.tiles.length; k++) if (!ring.corner[k] && road[ring.tiles[k]] > 0) out.push(ring.tiles[k]);
  return out.sort((a, c) => a - c);
}

/** Works order: player sites first, then `order`, then id. */
function worksCmp(a: Building, b: Building): number {
  const pa = a.owner === 'player' ? 0 : 1;
  const pb = b.owner === 'player' ? 0 : 1;
  return pa - pb || a.order - b.order || a.id - b.id;
}

function computeDerived(s: GameState): Derived {
  const map = getMap(s.seed);
  const sv = map.survey;
  const N = W * H;
  const buildingAt = new Int32Array(N);
  const road = new Uint8Array(N);
  const pomerium = new Uint8Array(N);
  const territory = new Uint8Array(N);
  const reservedTile = new Uint8Array(N);
  const plotOwner = new Int32Array(sv.blocks.length * 4);
  const counts: Partial<Record<BuildingId, number>> = {};
  const all: Partial<Record<BuildingId, number>> = {};
  const houses: number[] = [];
  const unfinished: Building[] = [];
  let castellumActive = false;

  for (const b of s.buildings) {
    for (const i of footprintOf(b, s)) {
      buildingAt[i] = b.id;
      const bid = sv.blockAt[i];
      if (bid >= 0) {
        const blk = sv.blocks[bid];
        const plot = (ty(i) - blk.y >= PLOT ? 2 : 0) + (tx(i) - blk.x >= PLOT ? 1 : 0);
        plotOwner[bid * 4 + plot] = b.id;
      }
    }
    all[b.type] = (all[b.type] ?? 0) + 1;
    if (b.status === 'done') {
      counts[b.type] = (counts[b.type] ?? 0) + 1;
      if (b.type === 'area' && b.house) houses.push(b.id);
      if (b.type === 'castellum') castellumActive = true;
    } else {
      unfinished.push(b);
      if (b.route) for (const i of b.route) reservedTile[i] = 1;
    }
  }
  // STUB(WP-A): the Area Capitolina stays reserved (DESIGN §3.4); refine once the Capitolium rules land.
  const cap = sv.capitolium;
  for (let y = cap.y; y < cap.y + cap.h; y++) for (let x = cap.x; x < cap.x + cap.w; x++) if (inBounds(x, y)) reservedTile[idx(x, y)] = 1;

  for (const i of s.roads) road[i] = 1;
  for (const i of s.paved) road[i] = 2;

  // pomerium: blocks of active rings that are not masked (reserved forum/capitolium blocks included), active streets
  // STUB(WP-A): confirm whether reserved blocks count as pomerium.
  const rings = activeRings(s.rank);
  for (const blk of sv.blocks) {
    if (blk.masked || !rings.includes(blk.ring)) continue;
    for (let y = blk.y; y < blk.y + BLOCK; y++) for (let x = blk.x; x < blk.x + BLOCK; x++) if (inBounds(x, y)) pomerium[idx(x, y)] = 1;
  }
  for (let i = 0; i < N; i++) if (sv.street[i] === 1 && rings.includes(sv.streetRing[i])) pomerium[i] = 1;
  const fr = sv.forum;
  for (let y = fr.y; y < fr.y + fr.h; y++) for (let x = fr.x; x < fr.x + fr.w; x++) if (inBounds(x, y)) pomerium[idx(x, y)] = 1;

  // territory: Chebyshev distance from the castrum (fossa) rectangle ≤ the rank's territory
  const reach = RANK_DEFS[s.rank].territory;
  const c = sv.castrum;
  for (let y = 0; y < H; y++) {
    const dy = Math.max(c.y - y, 0, y - (c.y + c.h - 1));
    for (let x = 0; x < W; x++) {
      const dx = Math.max(c.x - x, 0, x - (c.x + c.w - 1));
      if (Math.max(dx, dy) <= reach) territory[idx(x, y)] = 1;
    }
  }

  // road-BFS steps from the road tiles of the forum's ring
  const stepsToForum = new Int16Array(N).fill(-1);
  const queue: number[] = [];
  const fring = ringOf(fr.x, fr.y, fr.w, fr.h);
  for (let k = 0; k < fring.tiles.length; k++) {
    const i = fring.tiles[k];
    if (!fring.corner[k] && road[i] > 0 && stepsToForum[i] < 0) { stepsToForum[i] = 0; queue.push(i); }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = tx(i), y = ty(i);
    const nd = stepsToForum[i] + 1;
    const visit = (nx: number, ny: number): void => {
      if (!inBounds(nx, ny)) return;
      const j = idx(nx, ny);
      if (road[j] > 0 && stepsToForum[j] < 0) { stepsToForum[j] = nd; queue.push(j); }
    };
    visit(x, y - 1); visit(x + 1, y); visit(x, y + 1); visit(x - 1, y);
  }

  const sites = unfinished.sort(worksCmp).map((b) => b.id);
  return { buildingAt, road, pomerium, territory, reservedTile, plotOwner, counts, all, houses, sites, castellumActive, stepsToForum };
}

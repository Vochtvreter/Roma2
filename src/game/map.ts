// src/game/map.ts — the world map (ARCHITECTURE §8.2, DESIGN §3.1–3.3). Owner: WP-A.
// `getMap` is a pure function of the seed: terrain (world/gen.ts), then the best castrum site that passes every
// guarantee (world/castrum.ts), retrying the next-best sites and then regenerated terrain (seed + 1000·k, k ≤ 8).
// Only the seed is saved; the last four maps are cached.
import { B } from './balance';
import type { GameState, Rect, Terrain, WorldMap } from './types';
import { genTerrain } from './world/gen';
import { finishSite, rankSites } from './world/castrum';
import type { Attempt } from './world/castrum';
import { fertilityOf, isFertileT } from './world/rules';

/** Map width in tiles (112). */
export const W: number = B.map.W;
/** Map height in tiles (84). */
export const H: number = B.map.H;
/** Tile index of (x, y): y × W + x. */
export const idx = (x: number, y: number): number => y * W + x;

/** Tile x of an index. */
export function tx(i: number): number {
  return i % W;
}

/** Tile y of an index. */
export function ty(i: number): number {
  return Math.floor(i / W);
}

/** True when (x, y) lies on the map. */
export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < W && y < H;
}

/** Fertile terrain (fields may count it): grass, meadow, loam, scrub. */
export function isFertile(t: Terrain): boolean {
  return isFertileT(t);
}

/** Fertility of a terrain: grass 1.0, meadow 1.1, loam 1.25, scrub 0.75; 0 otherwise. */
export function fertility(t: Terrain): number {
  return fertilityOf(t);
}

/** Standing timber on a tile: the sparse diff in `s.wood`, else the map's initial stock. */
export function woodAt(s: GameState, i: number): number {
  const v = s.wood[i];
  return v !== undefined ? v : getMap(s.seed).woodMax[i];
}

/** A forest tile with at least 25% of its maximum timber standing. */
export function isWooded(s: GameState, i: number): boolean {
  const max = getMap(s.seed).woodMax[i];
  return max > 0 && woodAt(s, i) >= max * B.economy.WOOD.STUMP;
}

/** Chebyshev distance from tile i to a rect (0 inside). */
export function distToRect(i: number, r: Rect): number {
  const x = tx(i), y = ty(i);
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w - 1));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h - 1));
  return Math.max(dx, dy);
}

/** Generates the map of a seed (DESIGN §3.3): best site first, then the next-best, then new terrain; never fails. */
function generate(seed: number): WorldMap {
  const G = B.map.GEN;
  let fallback: Attempt | null = null;
  for (let k = 0; k <= G.RETRIES; k++) {
    const bt = genTerrain(seed + G.RETRY_STEP * k);
    const sites = rankSites(bt);
    for (let a = 0; a < sites.length; a++) {
      const att = finishSite(bt, seed, sites[a], a);
      if (att.fails.length === 0) return att.map;
      if (!fallback || att.fails.length < fallback.fails.length) fallback = att;
    }
  }
  if (!fallback) throw new Error(`no castrum site on seed ${seed}`);
  return fallback.map;
}

const CACHE_SIZE = 4;
const cache: WorldMap[] = [];

/** The world map of a seed: pure, cached for the last 4 seeds. */
export function getMap(seed: number): WorldMap {
  for (let k = cache.length - 1; k >= 0; k--) {
    if (cache[k].seed === seed) return cache[k];
  }
  const m = generate(seed);
  cache.push(m);
  if (cache.length > CACHE_SIZE) cache.shift();
  return m;
}

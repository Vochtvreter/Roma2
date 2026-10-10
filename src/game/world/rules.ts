// src/game/world/rules.ts — terrain rules shared by map generation, placement and scoring (DESIGN §3.2, §3.7, §3.8, §5.1).
// Owner: WP-A. Pure functions of terrain arrays; no game state, no map cache.
import { B } from '../balance';
import { T } from '../types';
import type { Terrain } from '../types';
import { GH, GW, onGrid } from './grid';
import { BUILDING_DEFS } from '../data/buildings';

const S = B.site;

/** Fertility of a terrain: grass 1.0, meadow 1.1, loam 1.25, scrub 0.75; 0 otherwise. */
export function fertilityOf(t: number): number {
  const f = B.map.FERTILITY;
  switch (t) {
    case T.grass: return f.grass;
    case T.meadow: return f.meadow;
    case T.loam: return f.loam;
    case T.scrub: return f.scrub;
    default: return 0;
  }
}

/** Fertile terrain (counts toward the fields' seven tiles). */
export function isFertileT(t: number): boolean {
  return t === T.grass || t === T.meadow || t === T.loam || t === T.scrub;
}

/** Forest or old forest. */
export function isForestT(t: number): boolean {
  return t === T.forest || t === T.dense;
}

/** Count of tiles in a w×h rect (clipped) whose terrain passes `pred`. */
export function countT(terrain: ArrayLike<number>, x: number, y: number, w: number, h: number, pred: (t: number) => boolean): number {
  let n = 0;
  for (let ty = Math.max(0, y); ty < Math.min(GH, y + h); ty++) {
    for (let tx = Math.max(0, x); tx < Math.min(GW, x + w); tx++) if (pred(terrain[ty * GW + tx])) n++;
  }
  return n;
}

/** Count of the ring tiles (incl. corners) around a w×h footprint whose terrain passes `pred`. */
export function countRingT(terrain: ArrayLike<number>, x: number, y: number, w: number, h: number, pred: (t: number) => boolean): number {
  return countT(terrain, x - 1, y - 1, w + 2, h + 2, pred) - countT(terrain, x, y, w, h, pred);
}

/** Fields at (x, y) before neighbouring fields: average fertility × (1 + min(0.20, 0.04 · river-or-loam ring tiles)). */
export function agerBase(terrain: ArrayLike<number>, x: number, y: number): { mult: number; fert: number; riverLoam: number; riverBonus: number } {
  const [w, h] = BUILDING_DEFS.ager.size;
  let sum = 0;
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (onGrid(tx, ty)) sum += fertilityOf(terrain[ty * GW + tx]);
  const fert = sum / (w * h);
  const riverLoam = countRingT(terrain, x, y, w, h, (t) => t === T.river || t === T.loam);
  const riverBonus = Math.min(S.AGER_RIVER[1], S.AGER_RIVER[0] * riverLoam);
  return { mult: fert * (1 + riverBonus), fert, riverLoam, riverBonus };
}

/** Quarry ground factor: clamp(0.6 + 0.1 · hills/rock tiles in footprint + ring, 0.6, 1.4). */
export function quarryFactor(hillsRock: number): number {
  const q = S.QUARRY;
  return Math.min(q.max, Math.max(q.min, q.base + q.per * hillsRock));
}

/** Hills or rock (quarry ground). */
export function isHillsRockT(t: number): boolean {
  return t === T.hills || t === T.rock;
}

/** Hills or scrub (olive ground). */
export function isHillsScrubT(t: number): boolean {
  return t === T.hills || t === T.scrub;
}

/** Road step cost of a terrain (DESIGN §3.7); Infinity where a road may never run. */
export function roadCostT(t: number): number {
  const c = B.map.ROAD_COST;
  switch (t) {
    case T.river: case T.crag: return Infinity;
    case T.hills: return c.hills;
    case T.rock: return c.rock;
    case T.forest: case T.dense: return c.forest;
    default: return c.flat;
  }
}

/** Aqueduct step cost of a terrain (DESIGN §3.8): hills 0.8 (rock counts as high ground), flat 1, forest 1.4, river 2.5 (arches); crag blocks. */
export function aqueductCostT(t: Terrain | number): number {
  const c = B.map.AQUEDUCT_COST;
  switch (t) {
    case T.crag: return Infinity;
    case T.river: return c.river;
    case T.hills: case T.rock: return c.hills;
    case T.forest: case T.dense: return c.forest;
    default: return c.flat;
  }
}

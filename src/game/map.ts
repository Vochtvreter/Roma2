// src/game/map.ts — the world map (ARCHITECTURE §8.2).
// SCAFFOLD: `getMap` returns the hand-made TOY MAP for every seed until WP-A lands real generation
// (DESIGN §3.3). The tile helpers (idx/tx/ty/inBounds/fertility/woodAt/isWooded/distToRect) are final.
import { B } from './balance';
import { F, T } from './types';
import type { GameState, Rect, Terrain, WorldMap } from './types';
import { computeSurvey } from './survey';

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
  return t === T.grass || t === T.meadow || t === T.loam || t === T.scrub;
}

/** Fertility of a terrain: grass 1.0, meadow 1.1, loam 1.25, scrub 0.75; 0 otherwise. */
export function fertility(t: Terrain): number {
  const f = B.map.FERTILITY;
  switch (t) {
    case T.grass: return f.grass;
    case T.meadow: return f.meadow;
    case T.loam: return f.loam;
    case T.scrub: return f.scrub;
    default: return 0;
  }
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

// ───────────────────────────── the toy map (ARCHITECTURE §8.2) ─────────────────────────────
// Fixture data, not tunables: grass everywhere; river x 92–93 (3 wide from y 42) with loam within 2; castrum
// interior origin (36, 28), via west along y 38; forest x 4–22, y 4–24 (dense 8–18 × 8–20); hills x 76–88,
// y 60–80 with rock x 80–84, y 64–70; ore (82,72) (83,72) (82,73) q 1.1; fons (86,78); clay on the west-bank
// tiles with y % 3 == 0; scrub x 10–30, y 60–78; lucus (20,50); startAger (40,60).
const TOY = {
  river: { x0: 92, x1: 93, wideFrom: 42, x1Wide: 94 },
  castrum: { ix: 36, iy: 28, viaDir: 'W' as const },
  forest: { x0: 4, x1: 22, y0: 4, y1: 24 },
  dense: { x0: 8, x1: 18, y0: 8, y1: 20 },
  hills: { x0: 76, x1: 88, y0: 60, y1: 80 },
  rock: { x0: 80, x1: 84, y0: 64, y1: 70 },
  scrub: { x0: 10, x1: 30, y0: 60, y1: 78 },
  ore: [[82, 72], [83, 72], [82, 73]] as const,
  vein: 1.1,
  fons: [[86, 78]] as const,
  clayEvery: 3,
  lucus: [20, 50] as const,
  startAger: { x: 40, y: 60 },
  // per-terrain elevation and moisture (grass sits on the water table so the opening wells draw fully)
  elev: [0.3, 0.3, 0.2, 0.45, 0.35, 0.4, 0.65, 0.8, 0.9, 0.1],
  moist: [0.62, 0.7, 0.8, 0.3, 0.6, 0.72, 0.4, 0.3, 0.2, 1],
};

function within(x: number, y: number, r: { x0: number; x1: number; y0: number; y1: number }): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

function buildToyMap(seed: number): WorldMap {
  const N = W * H;
  const terrain = new Uint8Array(N).fill(T.grass);
  const feature = new Uint8Array(N).fill(F.none);
  const elev = new Float32Array(N);
  const moist = new Float32Array(N);
  const woodMax = new Float32Array(N);
  const vein = new Float32Array(N);
  const waterTable = new Uint8Array(N);
  const riverDist = new Uint8Array(N).fill(255);

  // river
  for (let y = 0; y < H; y++) {
    const x1 = y >= TOY.river.wideFrom ? TOY.river.x1Wide : TOY.river.x1;
    for (let x = TOY.river.x0; x <= x1; x++) terrain[idx(x, y)] = T.river;
  }
  // Chebyshev distance to the river (8-neighbour multi-source BFS)
  const queue: number[] = [];
  for (let i = 0; i < N; i++) if (terrain[i] === T.river) { riverDist[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = tx(i), y = ty(i);
    const d = riverDist[i] + 1;
    if (d > 255) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx === 0 && dy === 0) || !inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (riverDist[j] > d) { riverDist[j] = d; queue.push(j); }
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (terrain[i] === T.river) continue;
      if (riverDist[i] <= B.map.RIVER_LOAM) terrain[i] = T.loam;
      else if (within(x, y, TOY.rock)) terrain[i] = T.rock;
      else if (within(x, y, TOY.hills)) terrain[i] = T.hills;
      else if (within(x, y, TOY.dense)) terrain[i] = T.dense;
      else if (within(x, y, TOY.forest)) terrain[i] = T.forest;
      else if (within(x, y, TOY.scrub)) terrain[i] = T.scrub;
    }
  }
  // features
  for (const [x, y] of TOY.ore) { feature[idx(x, y)] = F.ore; vein[idx(x, y)] = TOY.vein; }
  const fontes: number[] = [];
  for (const [x, y] of TOY.fons) { feature[idx(x, y)] = F.fons; fontes.push(idx(x, y)); }
  feature[idx(TOY.lucus[0], TOY.lucus[1])] = F.lucus;
  for (let y = 0; y < H; y++) {
    if (y % TOY.clayEvery !== 0) continue;
    for (let x = 0; x < TOY.river.x0; x++) {
      const i = idx(x, y);
      if (terrain[i] === T.loam && terrain[i + 1] === T.river) feature[i] = F.clay;   // west bank
    }
  }
  // per-tile values
  for (let i = 0; i < N; i++) {
    const t = terrain[i];
    elev[i] = TOY.elev[t];
    moist[i] = TOY.moist[t];
    if (t === T.forest) woodMax[i] = B.map.WOOD_FOREST;
    else if (t === T.dense) woodMax[i] = B.map.WOOD_DENSE;
    waterTable[i] = riverDist[i] <= B.map.WATER_TABLE_DIST || moist[i] > B.map.WATER_TABLE_MOIST ? 1 : 0;
  }
  const base: Omit<WorldMap, 'survey'> = {
    seed, W, H, terrain, feature, elev, moist, woodMax, vein, waterTable, riverDist, fontes,
    startAger: { ...TOY.startAger },
  };
  const survey = computeSurvey(base, TOY.castrum.ix, TOY.castrum.iy, TOY.castrum.viaDir);
  return { ...base, survey };
}

const CACHE_SIZE = 4;
const cache: WorldMap[] = [];

/** The world map of a seed: pure, cached for the last 4 seeds (scaffold: the toy map for every seed). */
export function getMap(seed: number): WorldMap {
  for (let k = cache.length - 1; k >= 0; k--) {
    if (cache[k].seed === seed) return cache[k];
  }
  const m = buildToyMap(seed);
  cache.push(m);
  if (cache.length > CACHE_SIZE) cache.shift();
  return m;
}

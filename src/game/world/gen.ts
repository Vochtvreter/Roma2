// src/game/world/gen.ts — seeded terrain: elevation, moisture, the river and the terrain classes (DESIGN §3.3 steps 1–4).
// Owner: WP-A. Pure function of the terrain seed. Features, the castrum and the guarantees live in castrum.ts.
import { B } from '../balance';
import { T } from '../types';
import { MAP_SEED_XOR, Rng, hash2 } from '../rng';
import { GH, GN, GW, chebDistance } from './grid';
import { fbmField, noise1, stretch } from './noise';

const G = B.map.GEN;
// Shape constants of the noise and the river course (TODO(balance): move to B.map.GEN).
const SHAPE = {
  WARP_SCALE: 30, WARP_AMP: 14,                 // domain warp: organic hill and wood outlines
  ELEV_STRETCH: 0.35, MOIST_STRETCH: 1.3,        // fBm clusters near 0.5; stretch it to use the DESIGN thresholds
  RIVER_OFFSET: [0.22, 0.32],                   // river centre offset from the map centre, share of the cross size
  MEANDER_1: { amp: [0.05, 0.085], len: [34, 56] },   // the big bends (amp: share of the cross size)
  MEANDER_2: { amp: [0.6, 1.5], len: [17, 27] },      // small wiggles, tiles
  MEANDER_NOISE: { amp: 2.5, scale: 9 },
  EDGE_KEEP: 6,                                 // the river centre stays this far from the side edges
  CARVE: 0.06, CARVE_R: 6,                      // valley carved along the river (elevation units, tiles)
  WET: 0.1, WET_R: 6,                           // moisture added near the river
  MEADOW_MOIST: 0.48, MEADOW_RIVER: 5,          // meadow: moist lowland, or the river's wet margin
  COPSE_P: 0.02, COPSE_MOIST: 0.44, GLADE_P: 0.03,     // single trees in the fields, glades in the woods
} as const;

/** The side of the map the tilt raises (the river's source edge). */
export type Side = 'N' | 'E' | 'S' | 'W';

/** Terrain before the castrum and its features are placed. */
export interface BaseTerrain {
  tseed: number;                 // the terrain seed (seed + RETRY_STEP · k)
  terrain: Uint8Array; elev: Float32Array; moist: Float32Array; riverDist: Uint8Array;
  high: Side;
}

/** The q-quantile of a sorted array. */
function quantile(sorted: Float32Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

/** River tiles: a meandering band from the high edge to the opposite edge, 2 wide upstream and 3 downstream. */
function carveRiver(rng: Rng, high: Side, seedN: number): Uint8Array {
  const river = new Uint8Array(GN);
  const vertical = high === 'N' || high === 'S';
  const along = vertical ? GH : GW;
  const cross = vertical ? GW : GH;
  const side = rng.chance(0.5) ? -1 : 1;
  const c0 = cross / 2 + side * rng.range(SHAPE.RIVER_OFFSET[0], SHAPE.RIVER_OFFSET[1]) * cross;
  const a1 = rng.range(SHAPE.MEANDER_1.amp[0], SHAPE.MEANDER_1.amp[1]) * cross;
  const l1 = rng.range(SHAPE.MEANDER_1.len[0], SHAPE.MEANDER_1.len[1]);
  const p1 = rng.range(0, Math.PI * 2);
  const a2 = rng.range(SHAPE.MEANDER_2.amp[0], SHAPE.MEANDER_2.amp[1]);
  const l2 = rng.range(SHAPE.MEANDER_2.len[0], SHAPE.MEANDER_2.len[1]);
  const p2 = rng.range(0, Math.PI * 2);
  const fromStart = high === 'N' || high === 'W';
  let prevLo = -1, prevHi = -1;
  for (let t = 0; t < along; t++) {
    const u = fromStart ? t : along - 1 - t;                 // distance downstream from the source edge
    const c = c0 + a1 * Math.sin((2 * Math.PI * t) / l1 + p1) + a2 * Math.sin((2 * Math.PI * t) / l2 + p2)
      + SHAPE.MEANDER_NOISE.amp * 2 * (noise1(t / SHAPE.MEANDER_NOISE.scale, seedN) - 0.5);
    const width = u < along / 2 ? G.RIVER_WIDTH[0] : G.RIVER_WIDTH[1];
    const cc = Math.min(cross - SHAPE.EDGE_KEEP, Math.max(SHAPE.EDGE_KEEP, c));
    let lo = Math.round(cc - width / 2);
    let hi = lo + width - 1;
    if (prevLo >= 0) {                                       // keep the band N4-connected row to row
      if (lo > prevHi) lo = prevHi;
      if (hi < prevLo) hi = prevLo;
    }
    for (let k = lo; k <= hi; k++) river[vertical ? t * GW + k : k * GW + t] = 1;
    prevLo = lo; prevHi = hi;
  }
  return river;
}

/** Elevation, moisture, river and terrain classes for one terrain seed (DESIGN §3.3 steps 1–4). */
export function genTerrain(tseed: number): BaseTerrain {
  const rng = new Rng((tseed ^ MAP_SEED_XOR) | 0);
  const sE = rng.int(1, 1e9), sM = rng.int(1, 1e9), sWx = rng.int(1, 1e9), sWy = rng.int(1, 1e9);
  const sN = rng.int(1, 1e9), sT = rng.int(1, 1e9);
  const high = (['N', 'E', 'S', 'W'] as const)[rng.int(0, 3)];
  const elev = new Float32Array(GN);
  const moist = new Float32Array(GN);
  const ws = SHAPE.WARP_SCALE, wa = SHAPE.WARP_AMP;
  const warpX = fbmField(sWx, 2, 0, GW / ws, 0, GH / ws);
  const warpY = fbmField(sWy, 2, 0, GW / ws, 0, GH / ws);
  const lo = -wa, hiX = GW + wa, hiY = GH + wa;           // warped coordinates stay inside these bounds
  const es = G.ELEV_SCALE, ms = G.MOIST_SCALE;
  const elevN = fbmField(sE, G.ELEV_OCTAVES, lo / es, hiX / es, lo / es, hiY / es);
  const moistN = fbmField(sM, G.ELEV_OCTAVES, lo / ms + G.MOIST_OFFSET, hiX / ms + G.MOIST_OFFSET, lo / ms, hiY / ms);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const wx = x + (warpX(x / ws, y / ws) - 0.5) * wa;
      const wy = y + (warpY(x / ws, y / ws) - 0.5) * wa;
      const tilt = high === 'N' ? 1 - y / (GH - 1) : high === 'S' ? y / (GH - 1) : high === 'W' ? 1 - x / (GW - 1) : x / (GW - 1);
      elev[i] = stretch(elevN(wx / es, wy / es), SHAPE.ELEV_STRETCH) * G.ELEV_FBM + tilt * G.TILT;
      moist[i] = stretch(moistN(wx / ms + G.MOIST_OFFSET, wy / ms), SHAPE.MOIST_STRETCH);
    }
  }
  const river = carveRiver(rng, high, sN);
  const riverDist = chebDistance(river);
  const carve = new Float64Array(256), wet = new Float64Array(256);
  for (let d = 0; d < 256; d++) {
    carve[d] = SHAPE.CARVE * Math.exp(-((d / SHAPE.CARVE_R) ** 2));
    wet[d] = SHAPE.WET * Math.exp(-d / SHAPE.WET_R);
  }
  for (let i = 0; i < GN; i++) {
    elev[i] -= carve[riverDist[i]];
    moist[i] = Math.min(1, moist[i] + wet[riverDist[i]]);
  }
  const land = new Float32Array(GN);
  let nLand = 0;
  for (let i = 0; i < GN; i++) if (!river[i]) land[nLand++] = elev[i];
  land.subarray(0, nLand).sort();
  const sorted = land.subarray(0, nLand);
  const qHills = quantile(sorted, G.HILLS_Q), qRock = quantile(sorted, G.ROCK_Q), qCrag = quantile(sorted, G.CRAG_Q);

  const terrain = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) {
    const e = elev[i], m = moist[i], d = riverDist[i];
    const x = i % GW, y = (i - x) / GW;
    let t: number;
    if (river[i]) t = T.river;
    else if (e > qCrag) t = T.crag;
    else if (e > qRock) t = T.rock;
    else if (d <= B.map.RIVER_LOAM) t = T.loam;
    else if (e > qHills) t = T.hills;
    else if (m > G.DENSE_MOIST) t = T.dense;
    else if (m > G.FOREST_MOIST) t = hash2(x, y, sT) < SHAPE.GLADE_P ? T.meadow : T.forest;
    else if (m < G.SCRUB_MOIST) t = T.scrub;
    else if (m > SHAPE.COPSE_MOIST && hash2(x, y, sT + 1) < SHAPE.COPSE_P) t = T.forest;
    else if (m > SHAPE.MEADOW_MOIST || d <= SHAPE.MEADOW_RIVER) t = T.meadow;
    else t = T.grass;
    terrain[i] = t;
  }
  return { tseed, terrain, elev, moist, riverDist, high };
}

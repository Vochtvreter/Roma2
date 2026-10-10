// src/game/world/castrum.ts — castrum site search, features, guarantees and the start field (DESIGN §3.3 steps 5–9,
// §18.1). Owner: WP-A. Pure functions of a BaseTerrain; map.ts runs the retry loop and caches the result.
import { B } from '../balance';
import { F, T } from '../types';
import type { Rect, Survey, WorldMap } from '../types';
import { MAP_SEED_XOR, Rng } from '../rng';
import { computeSurvey } from '../survey';
import { GH, GN, GW, PrefixSum, anySide, chebToRect, forN4, maskOf, rectDistances, rectGap } from './grid';
import { stepField } from './search';
import type { BaseTerrain } from './gen';
import { valueNoise } from './noise';
import { agerBase, aqueductCostT, isFertileT, isForestT, isHillsRockT, roadCostT } from './rules';
import { RANK_DEFS } from '../data/ranks';
import { BUILDING_DEFS } from '../data/buildings';

const M = B.map;
const G = M.GEN;
const FOSSA_OUT = 1 + M.FOSSA;
const EXT_X = (G.POMERIUM_BOX[0] - M.INTERIOR_W) / 2;            // 15: rings reach this far beyond the interior
const EXT_Y = (G.POMERIUM_BOX[1] - M.INTERIOR_H) / 2;
const TERR = RANK_DEFS.map((r) => r.territory);                   // [20, 26, 34, 44, 999]
const SITE_TRIES = 6;                // distinct castrum sites tried per terrain (TODO(balance): move to B.map.GEN)
const SITE_SPREAD = 4;               // tried sites differ by at least this many tiles (TODO(balance): move to B.map.GEN)
const ORE_SPREAD = 8;                // the two veins start at least this far apart (TODO(balance): move to B.map.GEN)
const FONS_SPREAD = 12;              // two springs at least this far apart (TODO(balance): move to B.map.GEN)

/** A candidate castrum site: interior origin and its DESIGN §3.3 score. */
export interface SiteCand { ix: number; iy: number; score: number }

/** A finished map attempt and the guarantees it fails (empty = good). */
export interface Attempt { map: WorldMap; fails: string[] }

/** The castrum rectangle (interior + wall + fossa) of an interior origin. */
export function castrumRectOf(ix: number, iy: number): Rect {
  return { x: ix - FOSSA_OUT, y: iy - FOSSA_OUT, w: M.CASTRUM_W, h: M.CASTRUM_H };
}

/** Candidate castrum sites, best first (score desc, then lowest origin tile): DESIGN §3.3 step 5. */
export function rankSites(bt: BaseTerrain): SiteCand[] {
  const t = bt.terrain;
  const bad = new PrefixSum(maskOf((i) => t[i] === T.river || t[i] === T.crag || t[i] === T.rock || t[i] === T.hills));
  const loam = new PrefixSum(maskOf((i) => t[i] === T.loam));
  const forest = new PrefixSum(maskOf((i) => isForestT(t[i])));
  const hills = new PrefixSum(maskOf((i) => isHillsRockT(t[i])));
  const m = G.SITE_MARGIN;
  const out: SiteCand[] = [];
  for (let iy = EXT_Y + m; iy + M.INTERIOR_H - 1 + EXT_Y + m <= GH - 1; iy++) {
    for (let ix = EXT_X + m; ix + M.INTERIOR_W - 1 + EXT_X + m <= GW - 1; ix++) {
      const r = castrumRectOf(ix, iy);
      if (bad.sum(r.x, r.y, r.w, r.h) > 0) continue;
      let dmin = 255;
      for (let x = r.x; x < r.x + r.w; x++) dmin = Math.min(dmin, bt.riverDist[r.y * GW + x], bt.riverDist[(r.y + r.h - 1) * GW + x]);
      for (let y = r.y; y < r.y + r.h; y++) dmin = Math.min(dmin, bt.riverDist[y * GW + r.x], bt.riverDist[y * GW + r.x + r.w - 1]);
      if (dmin < G.SITE_RIVER[0] || dmin > G.SITE_RIVER[1]) continue;
      const grown = (n: number, ps: PrefixSum): number => ps.sum(r.x - n, r.y - n, r.w + 2 * n, r.h + 2 * n);
      const score = grown(G.SCORE_LOAM_R, loam) + grown(G.SCORE_FOREST_R, forest) + grown(G.SCORE_HILLS_R, hills);
      out.push({ ix, iy, score });
    }
  }
  out.sort((a, b) => b.score - a.score || (a.iy * GW + a.ix) - (b.iy * GW + b.ix));
  const picked: SiteCand[] = [];
  for (const c of out) {
    if (picked.some((p) => Math.max(Math.abs(p.ix - c.ix), Math.abs(p.iy - c.iy)) < SITE_SPREAD)) continue;
    picked.push(c);
    if (picked.length >= SITE_TRIES) break;
  }
  return picked;
}

/** Porta Praetoria side: away from the nearest river tile, or toward the nearer map edge if the river runs alongside. */
function viaSide(bt: BaseTerrain, r: Rect): 'E' | 'W' {
  let best = Infinity, dx = 0, dy = 0, sx = 0;
  for (let i = 0; i < GN; i++) {
    if (bt.terrain[i] !== T.river) continue;
    const x = i % GW, y = (i - x) / GW;
    const d = chebToRect(x, y, r.x, r.y, r.w, r.h);
    if (d < best) {
      best = d;
      dx = Math.max(r.x - x, 0, x - (r.x + r.w - 1));
      dy = Math.max(r.y - y, 0, y - (r.y + r.h - 1));
      sx = x < r.x ? -1 : 1;
    }
  }
  if (dx >= dy && dx > 0) return sx < 0 ? 'E' : 'W';
  return r.x + r.w / 2 < GW / 2 ? 'W' : 'E';
}

/** Land reachable from the castrum without crossing the river (except over the via bridge) or a crag. */
function reachable(terrain: Uint8Array, sv: Survey): Uint8Array {
  const bridge = new Uint8Array(GN);
  for (const i of sv.bridge) bridge[i] = 1;
  const seen = new Uint8Array(GN);
  const start = (sv.iy + 1) * GW + sv.ix + 1;
  const q = [start];
  seen[start] = 1;
  for (let k = 0; k < q.length; k++) {
    forN4(q[k], (j) => {
      if (seen[j] || ((terrain[j] === T.river && !bridge[j]) || terrain[j] === T.crag)) return;
      seen[j] = 1;
      q.push(j);
    });
  }
  return seen;
}

/** Tiles of unmasked survey blocks of any ring, and street tiles: land the features must leave alone. */
function surveyMask(sv: Survey): Uint8Array {
  const m = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) if (sv.street[i] || (sv.blockAt[i] >= 0 && !sv.blocks[sv.blockAt[i]].masked)) m[i] = 1;
  for (const i of sv.via) m[i] = 1;
  return m;
}

/** The static start network: castrum streets (with the causeways), gates and the via. */
export function startNetwork(sv: Survey): number[] {
  const net = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) if (sv.street[i] && sv.streetRing[i] === 0) net[i] = 1;
  for (const g of sv.gates) net[g.tile] = 1;
  for (const i of sv.via) net[i] = 1;
  const out: number[] = [];
  for (let i = 0; i < GN; i++) if (net[i]) out.push(i);
  return out;
}

/** Grows a cluster of `n` tiles from `start` over N4 neighbours passing `ok` (random order). */
function cluster(rng: Rng, start: number, n: number, ok: (i: number) => boolean): number[] {
  const got = [start];
  for (let k = 1; k < n; k++) {
    const cand: number[] = [];
    for (const i of got) forN4(i, (j) => { if (ok(j) && !got.includes(j) && !cand.includes(j)) cand.push(j); });
    if (cand.length === 0) break;
    got.push(cand.sort((a, b) => a - b)[rng.int(0, cand.length - 1)]);
  }
  return got;
}

/** Builds one map for a terrain and a castrum site: clearing, features, survey, guarantees and the start field. */
export function finishSite(bt: BaseTerrain, seed: number, c: SiteCand, attempt: number): Attempt {
  const rng = new Rng(((bt.tseed ^ MAP_SEED_XOR) + 7919 * (attempt + 1)) | 0);
  const terrain = bt.terrain.slice();
  const feature = new Uint8Array(GN);
  const vein = new Float32Array(GN);
  const rect = castrumRectOf(c.ix, c.iy);
  const viaDir = viaSide(bt, rect);
  const cy = c.iy + (M.INTERIOR_H - 1) / 2;
  // the groma clears the camp and the via corridor
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) if (isForestT(terrain[y * GW + x])) terrain[y * GW + x] = T.grass;
  const viaX0 = viaDir === 'W' ? 0 : rect.x + rect.w;
  const viaX1 = viaDir === 'W' ? rect.x - 1 : GW - 1;
  for (let x = viaX0; x <= viaX1; x++) {
    const i = cy * GW + x;
    if (isForestT(terrain[i])) terrain[i] = T.grass;
    else if (terrain[i] === T.crag) terrain[i] = T.hills;
  }
  const base: Omit<WorldMap, 'survey'> = {
    seed, W: GW, H: GH, terrain, feature, elev: bt.elev, moist: bt.moist, woodMax: new Float32Array(GN), vein,
    waterTable: new Uint8Array(GN), riverDist: bt.riverDist, fontes: [], startAger: { x: 0, y: 0 },
  };
  let sv = computeSurvey(base, c.ix, c.iy, viaDir);
  const reach = reachable(terrain, sv);
  const keep = surveyMask(sv);
  const distArr = rectDistances(rect);
  const inBand = (i: number, band: readonly number[]): boolean => distArr[i] >= band[0] && distArr[i] <= band[1];
  const free = (i: number): boolean => reach[i] === 1 && keep[i] === 0 && feature[i] === F.none;

  // lucus: a sacred grove on open or wooded land, preferably at a wood's edge, framed by its trees
  const lucusCands: { w: number; v: number }[] = [];
  for (let i = 0; i < GN; i++) {
    const t = terrain[i];
    if (!free(i) || !inBand(i, G.LUCUS_DIST) || !(t === T.grass || t === T.meadow || t === T.scrub || isForestT(t))) continue;
    let woods = 0;
    forN4(i, (j) => { if (isForestT(terrain[j])) woods++; });
    lucusCands.push({ w: woods > 0 ? 3 : 1, v: i });
  }
  const lucus = rng.weighted(lucusCands);
  if (lucus !== null) {
    feature[lucus] = F.lucus;
    terrain[lucus] = T.meadow;
    const lx = lucus % GW, ly = (lucus - lx) / GW;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = (ly + dy) * GW + lx + dx;
      if ((dx || dy) && lx + dx >= 0 && lx + dx < GW && ly + dy >= 0 && ly + dy < GH && free(j)
        && (terrain[j] === T.grass || terrain[j] === T.meadow || terrain[j] === T.scrub)) terrain[j] = T.forest;
    }
  }
  // ruins: a small cluster of old Celtic stones on open ground
  const ruinsOk = (i: number): boolean => free(i) && inBand(i, G.RUINS_DIST)
    && (terrain[i] === T.grass || terrain[i] === T.meadow || terrain[i] === T.scrub || terrain[i] === T.hills);
  const ruinsCands: number[] = [];
  for (let i = 0; i < GN; i++) if (ruinsOk(i)) ruinsCands.push(i);
  if (ruinsCands.length > 0) for (const i of cluster(rng, rng.pick(ruinsCands), rng.int(2, 3), ruinsOk)) feature[i] = F.ruins;
  sv = computeSurvey(base, c.ix, c.iy, viaDir);

  // fons: springs on the hills, within an aqueduct's reach of some surveyed plot
  const aqTargets: number[] = [];
  for (let i = 0; i < GN; i++) {
    if (!sv.street[i]) continue;
    let plot = false;
    forN4(i, (j) => { const b = sv.blockAt[j]; if (b >= 0 && !sv.blocks[b].masked && !sv.blocks[b].reserved) plot = true; });
    if (plot) aqTargets.push(i);
  }
  const aqPass = new Uint8Array(GN);
  for (let j = 0; j < GN; j++) aqPass[j] = feature[j] === F.lucus || feature[j] === F.ruins || aqueductCostT(terrain[j]) === Infinity ? 0 : 1;
  const aq = stepField(aqTargets, aqPass, M.AQUEDUCT_MAX, 1);
  const fonsCands: number[] = [];
  for (let i = 0; i < GN; i++) if (terrain[i] === T.hills && free(i) && inBand(i, G.FONS_DIST) && aq[i] <= M.AQUEDUCT_MAX) fonsCands.push(i);
  const fontes: number[] = [];
  const nFons = rng.int(G.FONS[0], G.FONS[1]);
  for (let k = 0; k < nFons; k++) {
    const cands = fonsCands.filter((i) => fontes.every((f) => Math.max(Math.abs(f % GW - i % GW), Math.abs(Math.floor(f / GW) - Math.floor(i / GW))) >= FONS_SPREAD));
    if (cands.length === 0) break;
    const f = rng.pick(cands);
    fontes.push(f);
    feature[f] = F.fons;
  }
  fontes.sort((a, b) => a - b);

  // ore: two veins of 2–4 tiles on hills or rock, each with open ground beside it for the mine
  const oreOk = (i: number): boolean => free(i) && isHillsRockT(terrain[i]);
  const oreCands: number[] = [];
  for (let i = 0; i < GN; i++) {
    if (!oreOk(i) || !inBand(i, G.ORE_DIST)) continue;
    let open = false;
    forN4(i, (j) => { if (terrain[j] !== T.rock && terrain[j] !== T.crag && terrain[j] !== T.river) open = true; });
    if (open) oreCands.push(i);
  }
  const starts: number[] = [];
  for (let k = 0; k < G.ORE_VEINS; k++) {
    const cands = oreCands.filter((i) => feature[i] === F.none && starts.every((s) => Math.max(Math.abs(s % GW - i % GW), Math.abs(Math.floor(s / GW) - Math.floor(i / GW))) >= ORE_SPREAD));
    const pool = cands.length > 0 ? cands : oreCands.filter((i) => feature[i] === F.none);
    if (pool.length === 0) break;
    const s0 = rng.pick(pool);
    starts.push(s0);
    const q = rng.range(G.VEIN_QUALITY[0], G.VEIN_QUALITY[1]);
    for (const i of cluster(rng, s0, rng.int(G.VEIN_TILES[0], G.VEIN_TILES[1]), oreOk)) { feature[i] = F.ore; vein[i] = q; }
  }

  // clay: patches along the banks (CLAY_SHARE of the river-adjacent land)
  const sClay = rng.int(1, 1e9);
  const banks: { i: number; n: number }[] = [];
  for (let i = 0; i < GN; i++) {
    if (bt.riverDist[i] !== 1 || terrain[i] === T.rock || terrain[i] === T.crag || keep[i] || feature[i] !== F.none) continue;
    banks.push({ i, n: valueNoise((i % GW) / 2.5, Math.floor(i / GW) / 2.5, sClay) });
  }
  banks.sort((a, b) => a.n - b.n || a.i - b.i);
  for (const b of banks.slice(0, Math.round(banks.length * G.CLAY_SHARE))) feature[b.i] = F.clay;

  // per-tile layers
  for (let i = 0; i < GN; i++) {
    const t = terrain[i];
    base.woodMax[i] = t === T.forest ? M.WOOD_FOREST : t === T.dense ? M.WOOD_DENSE : 0;
    base.waterTable[i] = bt.riverDist[i] <= M.WATER_TABLE_DIST || bt.moist[i] > M.WATER_TABLE_MOIST ? 1 : 0;
  }
  base.fontes = fontes;
  const map: WorldMap = { ...base, survey: sv };
  const fails = checkGuarantees(map, reach, aq, distArr);
  return { map, fails };
}

/** DESIGN §3.3 step 8 on a finished map; sets map.startAger to the Ordo's best start field. Returns the failures. */
function checkGuarantees(map: WorldMap, reach: Uint8Array, aqSteps: Uint16Array, dist: Uint8Array): string[] {
  const { terrain, feature, survey: sv } = map;
  const fails: string[] = [];
  const net = startNetwork(sv);
  const isNet = new Uint8Array(GN);
  for (const i of net) isNet[i] = 1;
  const rect = sv.castrum;
  const pass = new Uint8Array(GN);
  const blockedFlatM = new Uint8Array(GN), blockedDigM = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) {
    const b = sv.blockAt[i];
    const future = b >= 0 && sv.blocks[b].ring > 0 && !sv.blocks[b].masked;
    const f = feature[i], t = terrain[i];
    const sacred = f === F.lucus || f === F.ruins || f === F.fons;
    const inRect = dist[i] === 0;
    pass[i] = inRect || sacred || roadCostT(t) === Infinity ? 0 : 1;
    const blocked = dist[i] > TERR[0] || inRect || sv.street[i] === 1 || isNet[i] === 1 || future
      || t === T.river || t === T.crag || sacred || f === F.ore;
    blockedDigM[i] = blocked ? 1 : 0;
    blockedFlatM[i] = blocked || t === T.rock ? 1 : 0;
  }
  const road = stepField(net, pass, M.ROAD_MAX);
  const reachRoad = (i: number): boolean => road[i] <= M.ROAD_MAX;
  const roadOk = (x: number, y: number, w: number, h: number): boolean => anySide(x, y, w, h, reachRoad);
  const blockedFlat = new PrefixSum(blockedFlatM);
  const blockedDig = new PrefixSum(blockedDigM);
  const fertile = new PrefixSum(maskOf((i) => isFertileT(terrain[i])));
  const hillsRock = new PrefixSum(maskOf((i) => isHillsRockT(terrain[i])));
  const wood = new PrefixSum(map.woodMax);

  // fields: count non-overlapping valid 3×3 sites; the best (Ordo score) becomes the start field
  const [fw, fh] = BUILDING_DEFS.ager.size;
  const taken = new Uint8Array(GN);
  let farms = 0, best = -Infinity, bestTile = -1;
  for (let y = 0; y + fh <= GH; y++) {
    for (let x = 0; x + fw <= GW; x++) {
      if (blockedFlat.sum(x, y, fw, fh) > 0 || fertile.sum(x, y, fw, fh) < B.site.AGER_FERTILE || !roadOk(x, y, fw, fh)) continue;
      const score = B.score.AGER.SITE * agerBase(terrain, x, y).mult + B.score.AGER.DIST * rectGap({ x, y, w: fw, h: fh }, rect);
      if (score > best) { best = score; bestTile = y * GW + x; }
      let free = true;
      for (let k = 0; k < fw * fh && free; k++) if (taken[(y + Math.floor(k / fw)) * GW + x + (k % fw)]) free = false;
      if (!free) continue;
      farms++;
      for (let k = 0; k < fw * fh; k++) taken[(y + Math.floor(k / fw)) * GW + x + (k % fw)] = 1;
    }
  }
  if (farms < M.FARM_SITES_MIN) fails.push(`farms ${farms}`);
  if (bestTile >= 0) map.startAger = { x: bestTile % GW, y: Math.floor(bestTile / GW) };
  else fails.push('start field');

  // a quarry and a lumber camp inside Castra territory
  const [qw, qh] = BUILDING_DEFS.lapicidina.size;
  const [lw, lh] = BUILDING_DEFS.lignarius.size;
  const r4 = B.economy.WOOD.CATCHMENT;
  let quarry = false, lumber = false;
  for (let y = 0; y < GH && !(quarry && lumber); y++) {
    for (let x = 0; x < GW; x++) {
      if (!quarry && x + qw <= GW && y + qh <= GH && blockedDig.sum(x, y, qw, qh) === 0
        && hillsRock.sum(x - 1, y - 1, qw + 2, qh + 2) >= B.site.QUARRY_MIN && roadOk(x, y, qw, qh)) quarry = true;
      if (!lumber && x + lw <= GW && y + lh <= GH && blockedFlat.sum(x, y, lw, lh) === 0
        && wood.sum(x - r4, y - r4, lw + 2 * r4, lh + 2 * r4) - wood.sum(x, y, lw, lh) >= G.LUMBER_SITE_WOOD && roadOk(x, y, lw, lh)) lumber = true;
    }
  }
  if (!quarry) fails.push('quarry');
  if (!lumber) fails.push('lumber');

  // clay (Vicus), ore (Oppidum) and a spring (Municipium, within an aqueduct's reach), all on our side of the river
  const any = (pred: (i: number) => boolean): boolean => { for (let i = 0; i < GN; i++) if (pred(i)) return true; return false; };
  if (!any((i) => feature[i] === F.clay && reach[i] === 1 && dist[i] <= TERR[1])) fails.push('clay');
  if (!any((i) => feature[i] === F.ore && reach[i] === 1 && dist[i] <= TERR[2])) fails.push('ore');
  if (!map.fontes.some((i) => reach[i] === 1 && dist[i] <= TERR[3] && aqSteps[i] <= M.AQUEDUCT_MAX)) fails.push('fons');
  const last = sv.via[sv.via.length - 1];
  if (last === undefined || (last % GW !== 0 && last % GW !== GW - 1)) fails.push('via');
  return fails;
}

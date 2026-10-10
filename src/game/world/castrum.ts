// src/game/world/castrum.ts — castrum site search, features, guarantees and the start field (DESIGN §3.3 steps 5–9,
// §18.1). Owner: WP-A. Pure functions of a BaseTerrain; map.ts runs the retry loop and caches the result.
import { B } from '../balance';
import { F, T } from '../types';
import type { Rect, Survey, WorldMap } from '../types';
import { MAP_SEED_XOR, Rng, hash2 } from '../rng';
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
const SITE_TRIES = B.map.GEN.SITE_TRIES;     // distinct castrum sites tried per terrain
const SITE_SPREAD = B.map.GEN.SITE_SPREAD;   // tried sites differ by at least this many tiles
const ORE_SPREAD = B.map.GEN.ORE_SPREAD;     // the two veins start at least this far apart
const FONS_SPREAD = B.map.GEN.FONS_SPREAD;   // two springs at least this far apart
const GLACIS = B.map.GEN.GLACIS;             // chance a wood tile 1, 2, 3 tiles outside the fossa is cleared

/** A candidate castrum site: interior origin and its DESIGN §3.3 score. */
export interface SiteCand { ix: number; iy: number; score: number }

/** A finished map attempt and the guarantees it fails (empty = good). */
export interface Attempt { map: WorldMap; fails: string[] }

/** The castrum rectangle (interior + wall + fossa) of an interior origin. */
function castrumRectOf(ix: number, iy: number): Rect {
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
function startNetwork(sv: Survey): number[] {
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
  // the groma clears the camp, a ragged glacis around it, and the via corridor
  const m = GLACIS.length;
  for (let y = Math.max(0, rect.y - m); y < Math.min(GH, rect.y + rect.h + m); y++) {
    for (let x = Math.max(0, rect.x - m); x < Math.min(GW, rect.x + rect.w + m); x++) {
      const d = chebToRect(x, y, rect.x, rect.y, rect.w, rect.h);
      if (isForestT(terrain[y * GW + x]) && (d === 0 || hash2(x, y, bt.tseed) < GLACIS[d - 1])) terrain[y * GW + x] = d === 0 ? T.grass : T.meadow;
    }
  }
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
  const road = startRoads(sv, terrain, feature, distArr);
  const sites = new Sites(sv, terrain, feature, distArr, road);

  // ore: two veins of 2–4 tiles on hills or rock, each with room for a mine the roads can reach
  const oreOk = (i: number): boolean => free(i) && isHillsRockT(terrain[i]);
  const mine = sites.blocked(TERR[2], true, true);
  const [mw, mh] = BUILDING_DEFS.fodina.size;
  const oreCands: number[] = [];
  for (let i = 0; i < GN; i++) {
    if (!oreOk(i) || !inBand(i, G.ORE_DIST)) continue;
    const x = i % GW, y = (i - x) / GW;
    let room = false;
    for (let oy = y - mh + 1; oy <= y && !room; oy++) for (let ox = x - mw + 1; ox <= x && !room; ox++) room = sites.fits(mine, ox, oy, mw, mh);
    if (room) oreCands.push(i);
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

  // per-tile layers. The groma sites the camp over ground water: wells inside the walls draw in full, as the opening
  // arithmetic (DESIGN §18.2) assumes for the start well, whose plot is 13–22 tiles from a river kept 3–10 tiles off.
  const inner = sv.interior;
  for (let i = 0; i < GN; i++) {
    const t = terrain[i];
    base.woodMax[i] = t === T.forest ? M.WOOD_FOREST : t === T.dense ? M.WOOD_DENSE : 0;
    const x = i % GW, y = Math.floor(i / GW);
    const camp = x >= inner.x && x < inner.x + inner.w && y >= inner.y && y < inner.y + inner.h;
    base.waterTable[i] = camp || bt.riverDist[i] <= M.WATER_TABLE_DIST || bt.moist[i] > M.WATER_TABLE_MOIST ? 1 : 0;
  }
  base.fontes = fontes;
  const map: WorldMap = { ...base, survey: sv };
  const fails = checkGuarantees(map, reach, aq, distArr, sites);
  return { map, fails };
}

/** Road reach from the start network (castrum streets, gates, via) in tiles, BFS up to ROAD_MAX; 0xffff beyond. */
function startRoads(sv: Survey, terrain: Uint8Array, feature: Uint8Array, dist: Uint8Array): Uint16Array {
  const pass = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) {
    const f = feature[i];
    pass[i] = dist[i] === 0 || f === F.lucus || f === F.ruins || f === F.fons || roadCostT(terrain[i]) === Infinity ? 0 : 1;
  }
  return stepField(startNetwork(sv), pass, M.ROAD_MAX);
}

/** Rural site tests on a finished map at the start network (the Ordo's rules: off every unmasked ring block). */
class Sites {
  /** Wraps the map layers used by every test. */
  constructor(private sv: Survey, private terrain: Uint8Array, private feature: Uint8Array, private dist: Uint8Array, private road: Uint16Array) {}

  /** Prefix sums of the tiles a rural work may not cover within `terr` of the castrum (rock and ore only if allowed). */
  blocked(terr: number, rock: boolean, ore: boolean): PrefixSum {
    const { sv, terrain, feature, dist } = this;
    const m = new Uint8Array(GN);
    for (let i = 0; i < GN; i++) {
      const b = sv.blockAt[i];
      const f = feature[i], t = terrain[i];
      m[i] = dist[i] > terr || dist[i] === 0 || sv.street[i] === 1 || this.road[i] === 0 || (b >= 0 && sv.blocks[b].ring > 0 && !sv.blocks[b].masked)
        || t === T.river || t === T.crag || f === F.lucus || f === F.ruins || f === F.fons
        || (t === T.rock && !rock) || (f === F.ore && !ore) ? 1 : 0;
    }
    return new PrefixSum(m);
  }

  /** True when a side tile of the footprint is on the network or within ROAD_MAX new tiles of it. */
  roadOk(x: number, y: number, w: number, h: number): boolean {
    return anySide(x, y, w, h, (i) => this.road[i] <= M.ROAD_MAX);
  }

  /** The footprint lies on the map, covers no blocked tile and a road can reach it. */
  fits(blocked: PrefixSum, x: number, y: number, w: number, h: number): boolean {
    return x >= 0 && y >= 0 && x + w <= GW && y + h <= GH && blocked.sum(x, y, w, h) === 0 && this.roadOk(x, y, w, h);
  }
}

/** DESIGN §3.3 step 8 on a finished map; sets map.startAger to the Ordo's best start field. Returns the failures. */
function checkGuarantees(map: WorldMap, reach: Uint8Array, aqSteps: Uint16Array, dist: Uint8Array, sites: Sites): string[] {
  const { terrain, feature, survey: sv } = map;
  const fails: string[] = [];
  const rect = sv.castrum;
  const flat = sites.blocked(TERR[0], false, false);
  const dig = sites.blocked(TERR[0], true, false);
  const fertile = new PrefixSum(maskOf((i) => isFertileT(terrain[i])));
  const hillsRock = new PrefixSum(maskOf((i) => isHillsRockT(terrain[i])));
  const wood = new PrefixSum(map.woodMax);

  // fields: count non-overlapping valid 3×3 sites; the best (Ordo score) becomes the start field
  const [fw, fh] = BUILDING_DEFS.ager.size;
  const taken = new Uint8Array(GN);
  const axisX = sv.ix + (sv.interior.w - 1) / 2, axisY = sv.iy + (sv.interior.h - 1) / 2;
  let farms = 0, best = -Infinity, bestTile = -1;
  for (let y = 0; y + fh <= GH; y++) {
    for (let x = 0; x + fw <= GW; x++) {
      if (!sites.fits(flat, x, y, fw, fh) || fertile.sum(x, y, fw, fh) < B.site.AGER_FERTILE) continue;
      const score = B.score.AGER.SITE * agerBase(terrain, x, y).mult + B.score.AGER.DIST * rectGap({ x, y, w: fw, h: fh }, rect);
      const onAxis = (x <= axisX && axisX < x + fw) || (y <= axisY && axisY < y + fh);   // keep the gates' ways open
      if (score > best && !onAxis) { best = score; bestTile = y * GW + x; }
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
      if (!quarry && sites.fits(dig, x, y, qw, qh) && hillsRock.sum(x - 1, y - 1, qw + 2, qh + 2) >= B.site.QUARRY_MIN) quarry = true;
      if (!lumber && sites.fits(flat, x, y, lw, lh)
        && wood.sum(x - r4, y - r4, lw + 2 * r4, lh + 2 * r4) - wood.sum(x, y, lw, lh) >= G.LUMBER_SITE_WOOD) lumber = true;
    }
  }
  if (!quarry) fails.push('quarry');
  if (!lumber) fails.push('lumber');

  // a kiln on a clay bank (Vicus), a mine on a vein (Oppidum) and a spring within an aqueduct's reach (Municipium)
  const [kw, kh] = BUILDING_DEFS.figlina.size;
  const [mw, mh] = BUILDING_DEFS.fodina.size;
  const kiln = sites.blocked(TERR[1], false, false);
  const mine = sites.blocked(TERR[2], true, true);
  const clay = new PrefixSum(maskOf((i) => feature[i] === F.clay));
  const ore = new PrefixSum(maskOf((i) => feature[i] === F.ore));
  let kilnOk = false, mineOk = false;
  for (let y = 0; y < GH && !(kilnOk && mineOk); y++) {
    for (let x = 0; x < GW; x++) {
      if (!kilnOk && clay.sum(x - 1, y - 1, kw + 2, kh + 2) > 0 && sites.fits(kiln, x, y, kw, kh)) kilnOk = true;
      if (!mineOk && ore.sum(x, y, mw, mh) > 0 && sites.fits(mine, x, y, mw, mh)) mineOk = true;
    }
  }
  if (!kilnOk) fails.push('clay');
  if (!mineOk) fails.push('ore');
  if (!map.fontes.some((i) => reach[i] === 1 && dist[i] <= TERR[3] && aqSteps[i] <= M.AQUEDUCT_MAX)) fails.push('fons');
  const last = sv.via[sv.via.length - 1];
  if (last === undefined || (last % GW !== 0 && last % GW !== GW - 1)) fails.push('via');
  return fails;
}

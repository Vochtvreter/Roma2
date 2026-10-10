// src/game/coverage.ts — road-BFS service coverage and desirability (ARCHITECTURE §8.2, DESIGN §7.4–7.5). Owner: WP-A.
// Coverage: per layer, every active service floods the built road network (N4, dirt and paved, the via included) from
// the road tiles beside its footprint; a road tile is covered within the service's effective radius in whole steps, and
// a house is covered when a road tile beside it is. The flood reruns only when the structure or a radius changes.
// Desirability: Σ v · (1 − d/(r + 1)) over every source within its range (Chebyshev d from the source's footprint).
import { B as B$ } from './balance';
import { BUILDINGS as BUILDINGS$, F as F$, LAYERS as LAYERS$, T as T$ } from './types';
import type { AddKey, Building, BuildingId, Coverage, CoverageLayerId, GameState, WorldMap } from './types';
import { getMap as getMap$ } from './map';
import { dayEpoch as dayEpoch$, dayStruct as dayStruct$, layoutEpoch as layoutEpoch$, memo as memo$ } from './memo';
import { blockOfTile as blockOfTile$, classAt as classAt$, derived as derived$, footprintOf as footprintOf$, sizeOf as sizeOf$ } from './derived';
import { peopleIndex } from './census';
import { fxAdd as fxAdd$ } from './fx';
import { getBuilding as getBuilding$ } from './lookup';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { TIER_DEFS as TIER_DEFS$ } from './data/housing';
import { RANK_DEFS as RANK_DEFS$ } from './data/ranks';
import { GH as GH$, GN as GN$, GW as GW$, sideTiles as sideTiles$ } from './world/grid';
import { autoRoad as autoRoad$, blockStreetTiles as blockStreetTiles$ } from './world/roads';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, BUILDINGS = BUILDINGS$, F = F$, LAYERS = LAYERS$, T = T$, getMap = getMap$, dayEpoch = dayEpoch$,
  dayStruct = dayStruct$, layoutEpoch = layoutEpoch$, memo = memo$, blockOfTile = blockOfTile$, classAt = classAt$,
  derived = derived$, footprintOf = footprintOf$, sizeOf = sizeOf$, fxAdd = fxAdd$, BUILDING_DEFS = BUILDING_DEFS$,
  TIER_DEFS = TIER_DEFS$, RANK_DEFS = RANK_DEFS$, GH = GH$, GN = GN$, GW = GW$, sideTiles = sideTiles$,
  autoRoad = autoRoad$, blockStreetTiles = blockStreetTiles$,
  getBuilding = getBuilding$;

/** Path radius bonus that applies to each layer (DESIGN §9.3). */
const RADIUS_BONUS: Partial<Record<CoverageLayerId, AddKey>> = {
  shrine: 'shrineRadius', temple: 'shrineRadius', market: 'marketRadius', macellum: 'marketRadius', baths: 'bathsRadius',
};

/** Effective radius of a building's service layer: DESIGN §5.2 activity rule, unpaid halving, path bonuses; 0 when inactive. */
export function effectiveRadius(s: GameState, b: Building, layer: CoverageLayerId): number {
  const bonus = RADIUS_BONUS[layer];
  return radiusWith(b, layer, peopleIndex(s).byWork, bonus ? fxAdd(s, bonus) : 0);
}

/** effectiveRadius with the workers by building and the layer's path bonus already looked up. */
function radiusWith(b: Building, layer: CoverageLayerId, byWork: ReadonlyMap<number, readonly unknown[]>, bonus: number): number {
  const def = BUILDING_DEFS[b.type];
  const svc = def.service?.find((x) => x.layer === layer);
  if (!svc || b.status !== 'done') return 0;
  let r = svc.radius;
  if (def.slots > 0) {
    if (!b.open) return 0;
    const n = byWork.get(b.id)?.length ?? 0;   // = census(s).staffed[b.id], without a census inside the coverage
    if (n <= 0) return 0;
    if (n < Math.ceil(def.slots * B.economy.SERVICE_FULL)) r = Math.floor(B.economy.SERVICE_PARTIAL * r);
  }
  if (b.unpaid) r = Math.floor(r * B.economy.UNPAID);
  if (RADIUS_BONUS[layer] && r > 0) r += bonus;
  return Math.max(0, r);
}

interface Source { id: number; layer: number; r: number }

/** The active services and their radii under a layout epoch (re-read once per day or on a structure/staffing change). */
function activeSources(s: GameState): { epoch: number; list: Source[] } {
  const epoch = layoutEpoch(s);
  return memo(s, 'covSources', dayEpoch(s), () => {
    const list: Source[] = [];
    const byWork = peopleIndex(s).byWork;
    const bonus: Partial<Record<AddKey, number>> = {};   // each path bonus looked up once per pass
    for (const b of serviceWorks(s)) {
      const svc = BUILDING_DEFS[b.type].service;
      if (!svc || b.status !== 'done') continue;
      for (const sv of svc) {
        const key = RADIUS_BONUS[sv.layer];
        const add = key ? bonus[key] ??= fxAdd(s, key) : 0;
        const r = radiusWith(b, sv.layer, byWork, add);
        if (r > 0) list.push({ id: b.id, layer: LAYERS.indexOf(sv.layer), r });
      }
    }
    return { epoch, list };
  });
}

/** Finished works with a service, in building order (memo on the layout epoch: completions and removals bump it). */
function serviceWorks(s: GameState): Building[] {
  return memo(s, 'covServiceWorks', layoutEpoch(s), () => s.buildings.filter((b) => BUILDING_DEFS[b.type].service && b.status === 'done'));
}

/** Coverage keys are built only when the sources change: the same structure epoch and the same (id, layer, radius) list
 *  make the same key, so the last coverage is reused without a string per check. */
const covBuilt = new WeakMap<GameState, { epoch: number; list: Source[]; cov: Coverage }>();

function sameSources(a: readonly Source[], b: readonly Source[]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k].id !== b[k].id || a[k].layer !== b[k].layer || a[k].r !== b[k].r) return false;
  return true;
}

/** Road tiles beside a w×h footprint at (x, y), on a given road layer. */
function roadSides(road: Uint8Array, x: number, y: number, w: number, h: number): number[] {
  return sideTiles(x, y, w, h).filter((i) => road[i] > 0);
}

// The grid size as module constants: the floods below run thousands of steps per rebuild, and an imported binding is
// re-read through the module record at every step under the test runner's transform.
const GW_ = GW, GN_ = GN;
// Scratch for flood (reused; every call resets the tiles it touched).
const floodRem = new Int16Array(GN).fill(-1);

/** Floods the road network from each source's tiles up to its radius (max-remaining BFS); marks covered tiles in `out`. */
function flood(road: Uint8Array, sources: { tiles: number[]; r: number }[], out: Uint8Array): void {
  const rem = floodRem;
  const touched: number[] = [];
  let maxR = 0;
  for (const src of sources) maxR = Math.max(maxR, src.r);
  const buckets: number[][] = Array.from({ length: maxR + 1 }, () => []);
  for (const src of sources) {
    for (const t of src.tiles) if (rem[t] < src.r) { if (rem[t] < 0) touched.push(t); rem[t] = src.r; buckets[src.r].push(t); }
  }
  for (let r = maxR; r >= 1; r--) {
    const cur = buckets[r], next = buckets[r - 1], nr = r - 1;
    for (let k = 0; k < cur.length; k++) {
      const t = cur[k];
      if (rem[t] !== r) continue;
      const x = t % GW_;
      let j = t - GW_;
      if (t >= GW_ && road[j] > 0 && rem[j] < nr) { if (rem[j] < 0) touched.push(j); rem[j] = nr; next.push(j); }
      j = t + 1;
      if (x < GW_ - 1 && road[j] > 0 && rem[j] < nr) { if (rem[j] < 0) touched.push(j); rem[j] = nr; next.push(j); }
      j = t + GW_;
      if (t < GN_ - GW_ && road[j] > 0 && rem[j] < nr) { if (rem[j] < 0) touched.push(j); rem[j] = nr; next.push(j); }
      j = t - 1;
      if (x > 0 && road[j] > 0 && rem[j] < nr) { if (rem[j] < 0) touched.push(j); rem[j] = nr; next.push(j); }
    }
  }
  for (const i of touched) { out[i] = 1; rem[i] = -1; }
}

// coverage(s) is a function of dayEpoch(s) (its key comes from activeSources, memoised on it): a one-entry fast path
// for the hot readers (houseHas per house per need) skips the two memo lookups.
const covLast = new WeakMap<GameState, { k: number; c: Coverage }>();

/** Coverage layers over built roads and the per-house layer mask (memo on the layout epoch + the effective radii). */
export function coverage(s: GameState): Coverage {
  const k = dayEpoch(s);
  const last = covLast.get(s);
  if (last && last.k === k) return last.c;
  const c = coverageOf(s);
  covLast.set(s, { k, c });
  return c;
}

function coverageOf(s: GameState): Coverage {
  const src = activeSources(s);
  const last = covBuilt.get(s);
  if (last && last.epoch === src.epoch && sameSources(last.list, src.list)) return last.cov;
  const key = `${src.epoch}|${src.list.map((x) => `${x.id}.${x.layer}.${x.r}`).join(',')}`;
  const cov = buildCoverage(s, src, key);
  covBuilt.set(s, { epoch: src.epoch, list: src.list, cov });
  return cov;
}

function buildCoverage(s: GameState, src: { list: Source[] }, key: string): Coverage {
  const d = derived(s);
  const layers = {} as Record<CoverageLayerId, Uint8Array>;
  LAYERS.forEach((l, k) => {
    const out = new Uint8Array(GN);
    const srcs: { tiles: number[]; r: number }[] = [];
    for (const x of src.list) {
      if (x.layer !== k) continue;
      const b = getBuilding(s, x.id);
      if (!b) continue;
      const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
      srcs.push({ tiles: roadSides(d.road, b.x, b.y, w, h), r: x.r });
    }
    if (srcs.length > 0) flood(d.road, srcs, out);
    layers[l] = out;
  });
  const houseMask = new Map<number, number>();
  const byIndex = LAYERS.map((l) => layers[l]);
  for (const id of d.houses) {
    const b = getBuilding(s, id);
    if (!b) continue;
    const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
    const sides = sideTiles(b.x, b.y, w, h);
    let mask = 0;
    for (let k = 0; k < byIndex.length; k++) {
      const layer = byIndex[k];
      for (const i of sides) if (layer[i] === 1) { mask |= 1 << k; break; }
    }
    houseMask.set(id, mask);
  }
  return { layers, houseMask, key };
}

/** True when the house is covered by the layer. */
export function houseHas(s: GameState, houseId: number, layer: CoverageLayerId): boolean {
  const mask = coverage(s).houseMask.get(houseId) ?? 0;
  return ((mask >> LAYERS.indexOf(layer)) & 1) === 1;
}

// Scratch buffers for the sparse previews (reused; every call resets what it touched).
const seen = new Int32Array(GN);
let seenGen = 0;
const extra = new Uint8Array(GN);

/** Road tiles within `r` steps of the sources over the roads plus the `extra` overlay (plain BFS, sparse result). */
function reachWithin(road: Uint8Array, sources: number[], r: number): number[] {
  const gen = ++seenGen;
  const out: number[] = [];
  const dist: number[] = [];
  for (const t of sources) if (seen[t] !== gen) { seen[t] = gen; out.push(t); dist.push(0); }
  for (let k = 0; k < out.length; k++) {
    const t = out[k];
    const nd = dist[k] + 1;
    if (nd > r) continue;
    const x = t % GW_;
    let j = t - GW_;
    if (t >= GW_ && seen[j] !== gen && (road[j] > 0 || extra[j] === 1)) { seen[j] = gen; out.push(j); dist.push(nd); }
    j = t + 1;
    if (x < GW_ - 1 && seen[j] !== gen && (road[j] > 0 || extra[j] === 1)) { seen[j] = gen; out.push(j); dist.push(nd); }
    j = t + GW_;
    if (t < GN_ - GW_ && seen[j] !== gen && (road[j] > 0 || extra[j] === 1)) { seen[j] = gen; out.push(j); dist.push(nd); }
    j = t - 1;
    if (x > 0 && seen[j] !== gen && (road[j] > 0 || extra[j] === 1)) { seen[j] = gen; out.push(j); dist.push(nd); }
  }
  return out;
}

/** One service layer of a would-be building: the covered road tiles and the houses they serve (sorted ids). */
export interface PreviewLayer { layer: CoverageLayerId; tiles: number[]; houses: number[] }

// The previews of one structure: everything previewCovered reads (roads, blocks, auto-roads, the houses beside each road
// tile, the rank's placement classes) moves only with the structure epoch, and the radius bonuses with the paths and
// modifiers, so a slot's preview is computed once per structure (the Ordo rescores its candidate slots every day).
interface PreviewCache { e: number; rank: number; shrine: number; market: number; baths: number; m: Map<number, readonly PreviewLayer[]> }
const previews = new WeakMap<GameState, PreviewCache>();
const TYPE_INDEX = new Map<BuildingId, number>(BUILDINGS.map((t, k) => [t, k]));

/** Sparse preview: per service layer of a would-be building at (x, y), the covered road tiles and the houses they serve.
 *  Memoised per layout epoch, rank and radius bonuses: the arrays are shared, callers only read them. */
export function previewCovered(s: GameState, type: BuildingId, x: number, y: number): readonly PreviewLayer[] {
  const svc = BUILDING_DEFS[type].service ?? [];
  if (svc.length === 0) return [];
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GW || y >= GH) return computePreview(s, type, x, y);
  const e = layoutEpoch(s);
  const shrine = fxAdd(s, 'shrineRadius'), market = fxAdd(s, 'marketRadius'), baths = fxAdd(s, 'bathsRadius');
  let c = previews.get(s);
  if (!c || c.e !== e || c.rank !== s.rank || c.shrine !== shrine || c.market !== market || c.baths !== baths) {
    c = { e, rank: s.rank, shrine, market, baths, m: new Map() };
    previews.set(s, c);
  }
  const k = (TYPE_INDEX.get(type) as number) * GN + y * GW + x;
  let out = c.m.get(k);
  if (!out) {
    out = computePreview(s, type, x, y);
    c.m.set(k, out);
  }
  return out;
}

function computePreview(s: GameState, type: BuildingId, x: number, y: number): PreviewLayer[] {
  const svc = BUILDING_DEFS[type].service ?? [];
  const d = derived(s);
  const cls = classAt(s, type, x, y);
  const [w, h] = sizeOf(type, cls);
  const blk = cls === 'rural' ? null : blockOfTile(s, y * GW + x);
  const lines = cls === 'rural' ? autoRoad(s, x, y, w, h) ?? [] : blk ? blockStreetTiles(s, blk.id) : [];
  for (const i of lines) extra[i] = 1;
  const sides = sideTiles(x, y, w, h).filter((i) => d.road[i] > 0 || extra[i] === 1);
  const houseSides = housesBySide(s);
  const out = svc.map((sv) => {
    const bonus = RADIUS_BONUS[sv.layer];
    const r = sv.radius + (bonus ? fxAdd(s, bonus) : 0);
    const tiles = sides.length > 0 ? reachWithin(d.road, sides, r) : [];
    const hs = new Set<number>();
    for (const i of tiles) for (const id of houseSides.get(i) ?? []) hs.add(id);
    return { layer: sv.layer, tiles, houses: [...hs].sort((a, c) => a - c) };
  });
  for (const i of lines) extra[i] = 0;
  return out;
}

/**
 * Coverage of a would-be building at (x, y) as if built and fully staffed (its streets or auto-road included):
 * per service layer, the covered road tiles and every house a covered road tile touches (sorted ids).
 */
export function previewCoverage(s: GameState, type: BuildingId, x: number, y: number): { layer: CoverageLayerId; tiles: Uint8Array; houses: number[] }[] {
  return previewCovered(s, type, x, y).map((p) => {
    const tiles = new Uint8Array(GN);
    for (const i of p.tiles) tiles[i] = 1;
    return { layer: p.layer, tiles, houses: p.houses };
  });
}

/** Road-side tile → the houses it serves (memo on the layout epoch). */
export function housesBySide(s: GameState): Map<number, number[]> {
  return memo(s, 'housesBySide', layoutEpoch(s), () => {
    const out = new Map<number, number[]>();
    for (const id of derived(s).houses) {
      const b = getBuilding(s, id);
      if (!b) continue;
      const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
      for (const i of sideTiles(b.x, b.y, w, h)) {
        const l = out.get(i);
        if (l) l.push(id); else out.set(i, [id]);
      }
    }
    return out;
  });
}

/** Adds a source's influence Σ v · (1 − d/(r + 1)) to every tile within r of its w×h footprint. */
function addInfluence(field: Float32Array, x: number, y: number, w: number, h: number, v: number, r: number): void {
  if (v === 0) return;
  for (let ty = Math.max(0, y - r); ty <= Math.min(GH - 1, y + h - 1 + r); ty++) {
    const dy = Math.max(y - ty, 0, ty - (y + h - 1));
    for (let tx = Math.max(0, x - r); tx <= Math.min(GW - 1, x + w - 1 + r); tx++) {
      const d = Math.max(dy, Math.max(x - tx, 0, tx - (x + w - 1)));
      field[ty * GW + tx] += v * (1 - d / (r + 1));
    }
  }
}

const natureCache = new WeakMap<WorldMap, Float32Array>();

/** The map's own desirability: the river (+1 r2 per river tile) and the sacred grove (+3 r3). */
function natureDesir(map: WorldMap): Float32Array {
  let f = natureCache.get(map);
  if (!f) {
    f = new Float32Array(GN);
    const [rv, rr] = B.map.RIVER_DESIR;
    const [lv, lr] = B.map.LUCUS_DESIR;
    for (let i = 0; i < GN; i++) {
      if (map.terrain[i] === T.river) addInfluence(f, i % GW, Math.floor(i / GW), 1, 1, rv, rr);
      if (map.feature[i] === F.lucus) addInfluence(f, i % GW, Math.floor(i / GW), 1, 1, lv, lr);
    }
    natureCache.set(map, f);
  }
  return f;
}

/** A building's own desirability [value, range]: houses by tier, the principia by forum stage, others by type. */
function desirOf(s: GameState, b: Building): readonly [number, number] {
  if (b.type === 'area') return b.house ? TIER_DEFS[b.house.tier].desir : [0, 0];
  if (b.type === 'principia') return RANK_DEFS[s.rank].forumStage >= B.forum.LATE_STAGE ? B.forum.DESIR_LATE : B.forum.DESIR;
  return BUILDING_DEFS[b.type].desir;
}

/** Desirability key: the layout plus the houses whose tier gives them desirability (insulae, domus), read once a day
 *  and again on a structure change (every tier change in the sim bumps the structure: invalidateTiers). */
function desirKey(s: GameState): string {
  const epoch = layoutEpoch(s);
  return memo(s, 'desirTiers', dayStruct(s), () => {
    const parts: string[] = [];
    for (const b of s.buildings) if (b.status === 'done' && b.house && TIER_DEFS[b.house.tier].desir[0] !== 0) parts.push(`${b.id}${b.house.tier}`);
    return `${epoch}|${parts.join(',')}`;
  });
}

// desirability(s) is a function of dayStruct(s) (its key comes from desirKey, memoised on it): a one-entry fast path for
// the hot readers (houseDesir per house per need) skips the two memo lookups.
const desirLast = new WeakMap<GameState, { k: number; f: Float32Array }>();

/** Desirability per tile, clamped to DESIR_CLAMP (memo on the layout epoch and the tiers of the insulae and domus). */
export function desirability(s: GameState): Float32Array {
  const k = dayStruct(s);
  const last = desirLast.get(s);
  if (last && last.k === k) return last.f;
  const f = desirabilityOf(s);
  desirLast.set(s, { k, f });
  return f;
}

function desirabilityOf(s: GameState): Float32Array {
  return memo(s, 'desirability', desirKey(s), () => {
    const map = getMap(s.seed);
    const field = natureDesir(map).slice();
    for (const b of s.buildings) {
      if (b.status !== 'done') continue;
      const [v, r] = desirOf(s, b);
      if (v === 0) continue;
      const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
      addInfluence(field, b.x, b.y, w, h, v, r);
    }
    const [pv, pr] = B.map.PAVED_DESIR;
    for (const i of s.paved) addInfluence(field, i % GW, Math.floor(i / GW), 1, 1, pv, pr);
    const [lo, hi] = B.housing.DESIR_CLAMP;
    for (let i = 0; i < GN; i++) field[i] = Math.min(hi, Math.max(lo, field[i]));
    return field;
  });
}

// Per desirability field, each house's average: a new field is computed whenever the structure (and with it any
// footprint) or a tier that gives desirability changes, so the field's identity keys the per-house values.
const houseDesirs = new WeakMap<Float32Array, Map<number, number>>();

/** A house's desirability: the average over its footprint tiles. */
export function houseDesir(s: GameState, houseId: number): number {
  const d = desirability(s);
  let m = houseDesirs.get(d);
  if (!m) { m = new Map(); houseDesirs.set(d, m); }
  let v = m.get(houseId);
  if (v === undefined) {
    v = 0;
    const b = getBuilding(s, houseId);
    const tiles = b ? footprintOf(b, s) : [];
    if (tiles.length > 0) {
      let sum = 0;
      for (const i of tiles) sum += d[i];
      v = sum / tiles.length;
    }
    m.set(houseId, v);
  }
  return v;
}

/** Desirability a would-be building at (x, y) would add, per affected tile (unclamped influence of the finished work). */
export function previewDesir(s: GameState, type: BuildingId, x: number, y: number): { tile: number; v: number }[] {
  const [v, r] = type === 'area' ? TIER_DEFS.tentoria.desir : BUILDING_DEFS[type].desir;
  if (v === 0) return [];
  const [w, h] = sizeOf(type, classAt(s, type, x, y));
  const field = new Float32Array(GN);
  addInfluence(field, x, y, w, h, v, r);
  const out: { tile: number; v: number }[] = [];
  for (let i = 0; i < GN; i++) if (field[i] !== 0) out.push({ tile: i, v: field[i] });
  return out;
}

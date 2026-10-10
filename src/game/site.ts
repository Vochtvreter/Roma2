// src/game/site.ts — site multipliers, Ordo site scoring and the best slot (ARCHITECTURE §8.2, DESIGN §5.1, §10.5). Owner: WP-A.
// Site notes carry one number each: a multiplier note (river, loam, fields, woods, rock, vein, quarryNear, mineNear,
// water) holds the percentage it adds or takes (+20, −40); `forum` holds road steps; `covers`/`unblocks` hold houses;
// `felling` holds timber; `clay`, `district` and `via` hold nothing.
import { B as B$ } from './balance';
import { BUILDINGS as BUILDINGS$, LAYERS as LAYERS$, T as T$ } from './types';
import type { Block, Building, BuildingId, CoverageLayerId, GameState, NeedId, Owner, ReasonCode, Rect, SiteNote, WorldMap } from './types';
import { getMap as getMap$, woodAt as woodAt$ } from './map';
import { blockOfTile as blockOfTile$, classAt as classAt$, derived as derived$, sizeOf as sizeOf$ } from './derived';
import { dayEpoch as dayEpoch$, layoutEpoch as layoutEpoch$, memo as memo$, structEpoch as structEpoch$ } from './memo';
import { fxAdd as fxAdd$ } from './fx';
import { coverage, desirability, previewCovered, previewDesir, type PreviewLayer } from './coverage';
import { needWant } from './housing';
import { routeAqueduct, validSlots } from './place';
import { getBuilding } from './state';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { GH as GH$, GW as GW$, PrefixSum, rectGap as rectGap$, rectTiles as rectTiles$, sideTiles as sideTiles$ } from './world/grid';
import { countRingT as countRingT$, countT as countT$, fertilityOf as fertilityOf$, isForestT as isForestT$, isHillsRockT as isHillsRockT$, isHillsScrubT as isHillsScrubT$, quarryFactor as quarryFactor$ } from './world/rules';
import { aroundSum as aroundSum$, woodAround as woodAround$, woodDependent as woodDependent$, woodSums as woodSums$ } from './world/siterules';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, BUILDINGS = BUILDINGS$, LAYERS = LAYERS$, T = T$, getMap = getMap$, woodAt = woodAt$,
  blockOfTile = blockOfTile$, classAt = classAt$, derived = derived$, sizeOf = sizeOf$, dayEpoch = dayEpoch$,
  layoutEpoch = layoutEpoch$, memo = memo$, structEpoch = structEpoch$, fxAdd = fxAdd$, BUILDING_DEFS = BUILDING_DEFS$, GH = GH$, GW = GW$, rectGap = rectGap$,
  rectTiles = rectTiles$, sideTiles = sideTiles$, countRingT = countRingT$, countT = countT$,
  fertilityOf = fertilityOf$, isForestT = isForestT$, isHillsRockT = isHillsRockT$, isHillsScrubT = isHillsScrubT$,
  quarryFactor = quarryFactor$, aroundSum = aroundSum$, woodAround = woodAround$, woodDependent = woodDependent$,
  woodSums = woodSums$;

const S = B.site;
const SC = B.score;
const CATCH_FULL = B.economy.WOOD.CATCH_TIMBER;   // standing timber within r4 for a ×1.0 lumber camp
const MAX_NOTES = 3;
const DROUGHT_SITE = B.score.WATER.DROUGHT;       // weight of a well's yield when it is raised for drink, not reach
/** Which unmet house need each coverage layer satisfies. */
const NEED_LAYERS: Partial<Record<NeedId, CoverageLayerId[]>> = {
  water: ['water', 'fountain'], religion: ['shrine', 'temple'], market: ['market', 'macellum'],
  temple: ['temple'], baths: ['baths'], macellum: ['macellum'],
};
const WATER_TYPES: readonly BuildingId[] = ['puteus', 'cisterna'];
const STORE_TYPES: readonly BuildingId[] = ['horreum', 'apotheca', 'mansio'];
const SERVICE_TYPES: readonly BuildingId[] = ['lararium', 'taberna', 'macellum', 'templum', 'balneum', 'thermae', 'theatrum'];
const RURAL_FOOD: readonly BuildingId[] = ['venatio', 'pabulatio', 'olivetum'];
const EXTRACT: readonly BuildingId[] = ['lignarius', 'lapicidina', 'fodina'];
const WORKSHOP: readonly BuildingId[] = ['figlina', 'caementarium', 'officina', 'fabrica'];
const LATERA: readonly BuildingId[] = ['templum', 'balneum', 'thermae', 'theatrum'];
const PRAETENTURA: readonly BuildingId[] = ['taberna', 'macellum'];

function pct(m: number): number {
  return Math.round((m - 1) * 100);
}

/** Footprint rect of a type at (x, y) in its class there. */
function rectOf(s: GameState, type: BuildingId, x: number, y: number): Rect {
  const [w, h] = sizeOf(type, classAt(s, type, x, y));
  return { x, y, w, h };
}

/** Ids of the buildings passing `pred` within `gap` tiles (Chebyshev) of a rect, outside it; scans the tiles around it. */
function nearIds(s: GameState, r: Rect, gap: number, pred: (b: Building) => boolean): number[] {
  const at = derived(s).buildingAt;
  const out: number[] = [];
  for (let ty = Math.max(0, r.y - gap); ty < Math.min(GH, r.y + r.h + gap); ty++) {
    for (let tx = Math.max(0, r.x - gap); tx < Math.min(GW, r.x + r.w + gap); tx++) {
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) continue;
      const id = at[ty * GW + tx];
      if (id === 0 || out.includes(id)) continue;
      const b = getBuilding(s, id);
      if (b && pred(b)) out.push(id);
    }
  }
  return out;
}

/** True when a building of the type stands (or is being raised) within `gap` tiles of the rect (prefix sums of the grown footprints, memo on the layout epoch). */
function near(s: GameState, r: Rect, type: BuildingId, gap: number): boolean {
  const ps = memo(s, `near:${type}:${gap}`, layoutEpoch(s), () => {
    const m = new Uint8Array(GW * GH);
    for (const b of s.buildings) {
      if (b.type !== type) continue;
      const f = rectOf(s, b.type, b.x, b.y);
      for (const i of rectTiles(f.x - gap, f.y - gap, f.w + 2 * gap, f.h + 2 * gap)) m[i] = 1;
    }
    return new PrefixSum(m);
  });
  return ps.sum(r.x, r.y, r.w, r.h) > 0;
}

/** Fields (ager) touching a w×h footprint at (x, y), corners included. */
function adjacentFields(s: GameState, x: number, y: number, w: number, h: number): number {
  return nearIds(s, { x, y, w, h }, 1, (b) => b.type === 'ager').length;
}

/** Houses within `gap` tiles of a rect. */
function housesNear(s: GameState, r: Rect, gap: number): number {
  return nearIds(s, r, gap, (b) => b.type === 'area' && b.house !== undefined && b.status === 'done').length;
}

const fieldSums = new WeakMap<WorldMap, { fert: PrefixSum; riverLoam: PrefixSum }>();

/** `agerBase` on a finished map in O(1): prefix sums of fertility and river/loam tiles, cached per map. */
function agerBaseOn(map: WorldMap, x: number, y: number): { mult: number; fert: number; riverBonus: number } {
  let ps = fieldSums.get(map);
  if (!ps) {
    const f = new Float64Array(GW * GH), r = new Uint8Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) {
      f[i] = fertilityOf(map.terrain[i]);
      r[i] = map.terrain[i] === T.river || map.terrain[i] === T.loam ? 1 : 0;
    }
    ps = { fert: new PrefixSum(f), riverLoam: new PrefixSum(r) };
    fieldSums.set(map, ps);
  }
  const [w, h] = BUILDING_DEFS.ager.size;
  const fert = ps.fert.sum(x, y, w, h) / (w * h);
  const ring = ps.riverLoam.sum(x - 1, y - 1, w + 2, h + 2) - ps.riverLoam.sum(x, y, w, h);
  const riverBonus = Math.min(S.AGER_RIVER[1], S.AGER_RIVER[0] * ring);
  return { mult: fert * (1 + riverBonus), fert, riverBonus };
}

/** Site multiplier and notes of a type at (x, y) (DESIGN §5.1 adjacency formulas). */
export function siteMultAt(s: GameState, type: BuildingId, x: number, y: number): { mult: number; notes: SiteNote[] } {
  return multAt(s, type, x, y, false);
}

/** siteMultAt; `one` reads the wood around a single site tile by tile instead of through the whole-map prefix sums. */
function multAt(s: GameState, type: BuildingId, x: number, y: number, one: boolean): { mult: number; notes: SiteNote[] } {
  const map = getMap(s.seed);
  const t = map.terrain;
  const r = rectOf(s, type, x, y);
  const { w, h } = r;
  const notes: SiteNote[] = [];
  let mult = 1;
  switch (type) {
    case 'ager': {
      const base = agerBaseOn(map, x, y);
      const fields = Math.min(S.AGER_FIELDS[1], S.AGER_FIELDS[0] * adjacentFields(s, x, y, w, h));
      mult = base.mult * (1 + fields);
      if (base.riverBonus > 0) notes.push({ code: 'river', value: Math.round(base.riverBonus * 100) });
      if (Math.abs(base.fert - 1) > 1e-9) notes.push({ code: 'loam', value: pct(base.fert) });
      if (fields > 0) notes.push({ code: 'fields', value: Math.round(fields * 100) });
      break;
    }
    case 'venatio': {
      const R = S.VENATIO_R;
      const all = (Math.min(GW, x + w + R) - Math.max(0, x - R)) * (Math.min(GH, y + h + R) - Math.max(0, y - R)) - w * h;
      const [lo, hi] = S.VENATIO_SITE;
      const wooded = one ? woodAround(s, x, y, w, h, R).wooded : aroundSum(woodSums(s).wooded, x, y, w, h, R);
      mult = lo + (hi - lo) * (all > 0 ? wooded / all : 0);
      notes.push({ code: 'woods', value: pct(mult) });
      break;
    }
    case 'pabulatio': {
      const n = countRingT(t, x, y, w, h, (v) => v === T.meadow || isForestT(v));
      mult = Math.min(S.PABULATIO[1], 1 + S.PABULATIO[0] * n);
      if (n > 0) notes.push({ code: 'woods', value: pct(mult) });
      break;
    }
    case 'olivetum':
      if (countT(t, x, y, w, h, isHillsScrubT) === w * h) { mult = S.OLIVE_ALL; notes.push({ code: 'rock', value: pct(mult) }); }
      break;
    case 'lignarius': {
      const wood = one ? woodAround(s, x, y, w, h, B.economy.WOOD.CATCHMENT).standing : aroundSum(woodSums(s).standing, x, y, w, h, B.economy.WOOD.CATCHMENT);
      const [lo, hi] = B.economy.WOOD.CATCH_FACTOR;
      mult = Math.min(hi, Math.max(lo, wood / CATCH_FULL));
      notes.push({ code: 'woods', value: pct(mult) });
      break;
    }
    case 'lapicidina':
      mult = quarryFactor(countT(t, x - 1, y - 1, w + 2, h + 2, isHillsRockT));
      notes.push({ code: 'rock', value: pct(mult) });
      break;
    case 'figlina':
      notes.push({ code: 'clay' });
      if (sideTiles(x, y, w, h).some((i) => t[i] === T.river)) { mult = S.FIGLINA_RIVER; notes.push({ code: 'river', value: pct(mult) }); }
      break;
    case 'caementarium':
      if (near(s, r, 'lapicidina', S.CAEMENT_NEAR[0])) { mult = S.CAEMENT_NEAR[1]; notes.push({ code: 'quarryNear', value: pct(mult) }); }
      break;
    case 'officina':
      if (near(s, r, 'fodina', S.OFFICINA_NEAR[0])) { mult = S.OFFICINA_NEAR[1]; notes.push({ code: 'mineNear', value: pct(mult) }); }
      break;
    case 'fodina': {
      let v = 0;
      for (const i of rectTiles(x, y, w, h)) v = Math.max(v, map.vein[i]);
      if (v > 0) { mult = v; notes.push({ code: 'vein', value: Math.round(v * 100) }); }
      break;
    }
    case 'puteus':
      if (!rectTiles(x, y, w, h).some((i) => map.waterTable[i] === 1)) { mult = B.economy.OFF_TABLE; notes.push({ code: 'water', value: pct(mult) }); }
      break;
    default:
      break;
  }
  return { mult, notes };
}

const multCache = new WeakMap<GameState, Map<number, { e: number; d: number; v: number }>>();

/** Site multiplier of a placed building (memo per building on the layout epoch; daily for sites that live on standing wood). */
export function siteMult(s: GameState, b: Building): number {
  // a numeric per-state cache: buildingRate reads this for every building several times a day, and a string slot and
  // key per call (memo) cost more than the lookup
  const day = woodDependent(b.type) ? s.day : -1;
  const e = layoutEpoch(s);
  let m = multCache.get(s);
  if (!m) { m = new Map(); multCache.set(s, m); }
  const hit = m.get(b.id);
  if (hit && hit.e === e && hit.d === day) return hit.v;
  const v = multAt(s, b.type, b.x, b.y, true).mult;
  m.set(b.id, { e, d: day, v });
  return v;
}

/** Per-call scoring context: house wants and current coverage, gathered once for many candidate slots. `wantMask` holds
 *  the coverage layers that answer the house's first want (0 when it wants none, or when the scored type reads no wants). */
interface ScoreCtx {
  houses: { id: number; rect: Rect; want: NeedId | null; wantMask: number; level: number; desir: number; mask: number }[];
  byId: Map<number, ScoreCtx['houses'][number]>;
}

const NO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };
const TIER_LEVEL: readonly string[] = ['tentoria', 'casa', 'tegulata', 'domusParva', 'insula', 'domus'];
const LAYER_BIT = new Map<CoverageLayerId, number>(LAYERS.map((l, k) => [l, 1 << k]));

/** Layer bits of a list of layers. */
function layerBits(ls: readonly CoverageLayerId[]): number {
  let m = 0;
  for (const l of ls) m |= LAYER_BIT.get(l) as number;
  return m;
}

/** The context for scoring `type` (every field when no type is given): only services read the houses' wants and only
 *  the hortus their desirability, so the other types skip those per-house reckonings. */
function scoreCtx(s: GameState, type?: BuildingId): ScoreCtx {
  const d = derived(s);
  const withWants = type === undefined || SERVICE_TYPES.includes(type);
  const withDesir = type === undefined || type === 'hortus';
  const desir = withDesir ? desirability(s) : null;
  const houses: ScoreCtx['houses'] = [];
  const masks = coverage(s).houseMask;
  for (const id of d.houses) {
    const b = getBuilding(s, id);
    if (!b || !b.house) continue;
    const rect = desir ? rectOf(s, b.type, b.x, b.y) : NO_RECT;   // only the hortus reads the houses' footprints
    let avg = 0;
    if (desir) {
      let sum = 0;
      const tiles = rectTiles(rect.x, rect.y, rect.w, rect.h);
      for (const i of tiles) sum += desir[i];
      avg = tiles.length ? sum / tiles.length : 0;
    }
    const want = withWants ? needWant(s, b) : null;
    houses.push({ id, rect, want, wantMask: want ? layerBits(NEED_LAYERS[want] ?? []) : 0, level: TIER_LEVEL.indexOf(b.house.tier), desir: avg, mask: masks.get(id) ?? 0 });
  }
  return { houses, byId: new Map(houses.map((hh) => [hh.id, hh])) };
}

/** A preview as (house, layer bits) pairs: every house a would-be work covers, with the layers it would bring there. */
interface CoverList { ids: number[]; bits: number[] }
const coverLists = new WeakMap<readonly PreviewLayer[], CoverList>();

function coverList(s: GameState, type: BuildingId, x: number, y: number): CoverList {
  const pv = previewCovered(s, type, x, y);
  let out = coverLists.get(pv);
  if (!out) {
    const at = new Map<number, number>();
    const ids: number[] = [], bits: number[] = [];
    for (const p of pv) {
      const bit = LAYER_BIT.get(p.layer) as number;
      for (const id of p.houses) {
        const k = at.get(id);
        if (k === undefined) { at.set(id, ids.length); ids.push(id); bits.push(bit); }
        else bits[k] |= bit;
      }
    }
    out = { ids, bits };
    coverLists.set(pv, out);
  }
  return out;
}

/** What a house plot's score reads of the other works: the blocks holding a house plot (built or not) and the footprints
 *  of the workshops and material works (memo on the layout epoch: one pass over the buildings, not one per candidate slot). */
function plotLayout(s: GameState): { houseBlocks: Set<number>; industry: Rect[] } {
  return memo(s, 'site.plotLayout', layoutEpoch(s), () => {
    const houseBlocks = new Set<number>();
    const industry: Rect[] = [];
    for (const b of s.buildings) {
      if (b.type === 'area') {
        const blk = blockOfTile(s, b.y * GW + b.x);
        if (blk) houseBlocks.add(blk.id);
      }
      const cat = BUILDING_DEFS[b.type].cat;
      if (cat === 'officinae' || cat === 'materia') industry.push(rectOf(s, b.type, b.x, b.y));
    }
    return { houseBlocks, industry };
  });
}

/** Road steps from the forum to a footprint: the nearest built road beside it, else the grid distance to the forum. */
function stepsToForum(s: GameState, r: Rect): number {
  const d = derived(s);
  let best = Infinity;
  for (const i of sideTiles(r.x, r.y, r.w, r.h)) if (d.stepsToForum[i] >= 0) best = Math.min(best, d.stepsToForum[i]);
  if (best < Infinity) return best;
  const f = getMap(s.seed).survey.forum;
  const dx = Math.max(f.x - (r.x + r.w - 1), 0, r.x - (f.x + f.w - 1));
  const dy = Math.max(f.y - (r.y + r.h - 1), 0, r.y - (f.y + f.h - 1));
  return dx + dy;
}

function score(s: GameState, ctx: ScoreCtx, type: BuildingId, x: number, y: number, purpose?: ReasonCode): { score: number; notes: SiteNote[] } {
  const sv = getMap(s.seed).survey;
  const r = rectOf(s, type, x, y);
  const blk: Block | null = classAt(s, type, x, y) === 'rural' ? null : blockOfTile(s, y * GW + x);
  const site = siteMultAt(s, type, x, y);
  const notes: SiteNote[] = [...site.notes];
  const fellTimber = rectTiles(r.x, r.y, r.w, r.h).reduce((a, i) => a + woodAt(s, i), 0);
  let sc = SC.FELL * fellTimber * B.economy.WOOD.FELL_WORK;
  if (fellTimber > 0) notes.push({ code: 'felling', value: Math.round(fellTimber) });
  const toFossa = rectGap(r, sv.castrum);
  const housesWithin = (gap: number): number => housesNear(s, r, gap);
  const cover = (): { unblock: number; newly: number; t4: number } => {
    let unblock = 0, newly = 0, t4 = 0;
    const { ids, bits } = coverList(s, type, x, y);
    for (let k = 0; k < ids.length; k++) {
      const hh = ctx.byId.get(ids[k]);
      if (!hh) continue;
      const ls = bits[k];
      if ((hh.wantMask & ls) !== 0) unblock++;                    // a layer that answers its first want
      if ((ls & ~hh.mask) !== 0) { newly++; if (hh.level >= 4) t4++; }   // a layer it lacks today
    }
    return { unblock, newly, t4 };
  };
  if (type === 'area') {
    const steps = stepsToForum(s, r);
    let desir = 0;
    const dz = desirability(s);
    for (const i of rectTiles(r.x, r.y, r.w, r.h)) desir += dz[i];
    desir /= r.w * r.h;
    const lay = plotLayout(s);
    const withHouses = blk !== null && lay.houseBlocks.has(blk.id);
    const industry = lay.industry.some((f) => rectGap(r, f) <= SC.HOUSE.INDUSTRY_R);
    sc += SC.HOUSE.STEPS * steps + SC.HOUSE.DESIR * desir + (withHouses ? SC.HOUSE.BLOCK_HOUSES : 0)
      + (blk?.district === 'retentura' ? SC.HOUSE.RETENTURA : 0) + (industry ? SC.HOUSE.INDUSTRY : 0);
    notes.push({ code: 'forum', value: steps });
    if (blk?.district === 'retentura') notes.push({ code: 'district' });
  } else if (SERVICE_TYPES.includes(type)) {
    const steps = stepsToForum(s, r);
    const c = cover();
    const fit = (LATERA.includes(type) && blk?.district === 'latera') || (PRAETENTURA.includes(type) && blk?.district === 'praetentura');
    sc += SC.SERVICE.UNBLOCK * c.unblock + SC.SERVICE.COVER * c.newly + SC.SERVICE.STEPS * steps + (fit ? SC.SERVICE.DISTRICT : 0)
      + (type === 'templum' && blk?.touchesForum ? SC.SERVICE.TEMPLE_FORUM : 0);
    if (c.unblock > 0) notes.push({ code: 'unblocks', value: c.unblock });
    if (c.newly > 0) notes.push({ code: 'covers', value: c.newly });
    if (fit) notes.push({ code: 'district' });
    notes.push({ code: 'forum', value: steps });
  } else if (STORE_TYPES.includes(type)) {
    const via = blk ? blk.touchesVia : sideTiles(r.x, r.y, r.w, r.h).some((i) => sv.via.includes(i));
    sc += (blk?.district === 'praetentura' ? SC.STORE.PRAETENTURA : 0) + (via ? SC.STORE.VIA : 0) + SC.STORE.HOUSE * housesWithin(SC.STORE.HOUSE_R);
    if (blk?.district === 'praetentura') notes.push({ code: 'district' });
    if (via) notes.push({ code: 'via' });
  } else if (WATER_TYPES.includes(type)) {
    const c = cover();
    const steps = stepsToForum(s, r);
    const drought = purpose === 'survivalWater' || purpose === 'aestasWater';
    sc += SC.WATER.ACCESS * c.newly + SC.WATER.STEPS * steps + (drought ? DROUGHT_SITE * (site.mult - 1) : 0);
    if (c.newly > 0) notes.push({ code: 'covers', value: c.newly });
    notes.push({ code: 'forum', value: steps });
  } else if (type === 'ager') {
    const houseNext = housesWithin(1) > 0;
    sc += SC.AGER.SITE * site.mult + SC.AGER.DIST * toFossa + SC.AGER.FIELDS * adjacentFields(s, r.x, r.y, r.w, r.h) + (houseNext ? SC.AGER.HOUSE : 0);
  } else if (RURAL_FOOD.includes(type)) {
    sc += SC.RURAL.SITE * site.mult + SC.RURAL.DIST * toFossa;
  } else if (EXTRACT.includes(type)) {
    sc += SC.EXTRACT.SITE * site.mult + SC.EXTRACT.DIST * toFossa;
  } else if (WORKSHOP.includes(type)) {
    sc += SC.WORKSHOP.BONUS * site.mult + SC.WORKSHOP.DIST * toFossa + SC.WORKSHOP.HOUSE * housesWithin(SC.WORKSHOP.HOUSE_R);
  } else if (type === 'castellum') {
    const reach = housesWithin(B.map.CASTELLUM_REACH);
    const len = routeAqueduct(s, x, y)?.tiles.length ?? 0;
    sc += SC.CASTELLUM.HOUSES * reach + SC.CASTELLUM.ROUTE * len;
    notes.push({ code: 'covers', value: reach });
  } else if (type === 'lacus') {
    const c = cover();
    sc += SC.LACUS.T4 * c.t4 + SC.LACUS.COVER * c.newly;
    if (c.newly > 0) notes.push({ code: 'covers', value: c.newly });
  } else if (type === 'hortus') {
    const gain = new Map<number, number>();
    for (const p of previewDesir(s, type, x, y)) gain.set(p.tile, p.v);
    let lift = 0;
    for (const hh of ctx.houses) {
      if (hh.level < 3 || hh.desir >= B.housing.DESIR_DOMUS) continue;
      let g = 0;
      for (const i of rectTiles(hh.rect.x, hh.rect.y, hh.rect.w, hh.rect.h)) g += gain.get(i) ?? 0;
      lift += Math.min(g / (hh.rect.w * hh.rect.h), B.housing.DESIR_DOMUS - hh.desir);
    }
    sc += lift + SC.SERVICE.STEPS * stepsToForum(s, r);
  } else {
    sc += SC.RURAL.DIST * toFossa;
  }
  return { score: sc, notes: notes.slice(0, MAX_NOTES) };
}

/** The Ordo's score for a type at (x, y) for a purpose (DESIGN §10.5); higher is better. */
export function siteScore(s: GameState, type: BuildingId, x: number, y: number, purpose?: ReasonCode): { score: number; notes: SiteNote[] } {
  return score(s, scoreCtx(s, type), type, x, y, purpose);
}

/** The best valid slot for a type (highest score, ties by lowest tile); null when there is none (memo on the epochs and day). */
export function bestSlot(s: GameState, type: BuildingId, opts?: { owner?: Owner; purpose?: ReasonCode }): { tile: number; x: number; y: number; score: number; notes: SiteNote[] } | null {
  const owner = opts?.owner ?? 'ordo';
  const purpose = opts?.purpose;
  const slot = `bestSlot:${type}:${owner}:${purpose ?? ''}`;
  return memo(s, slot, dayEpoch(s), () => {
    const slots = validSlots(s, type, owner);
    if (slots.size === 0) return null;
    const fast = FAST_TYPES.has(type);
    const sig = fast ? fastSig(s, type, slots) : null;
    if (sig) {
      const last = fastBest.get(s)?.get(slot);
      if (last && sameSig(last.sig, sig)) return last.best;
    }
    const ctx = scoreCtx(s, type);
    let best: { tile: number; x: number; y: number; score: number; notes: SiteNote[] } | null = null;
    for (const tile of [...slots.keys()].sort((a, b) => a - b)) {
      const x = tile % GW, y = Math.floor(tile / GW);
      if (fast) {
        const sc = fastScore(s, ctx, type, x, y, purpose);
        if (!best || sc > best.score + 1e-9) best = { tile, x, y, score: sc, notes: [] };
        continue;
      }
      const sc = score(s, ctx, type, x, y, purpose);
      if (!best || sc.score > best.score + 1e-9) best = { tile, x, y, score: sc.score, notes: sc.notes };
    }
    if (best && fast) best.notes = score(s, ctx, type, best.x, best.y, purpose).notes;   // the same sum, with its notes
    if (sig) {
      let m = fastBest.get(s);
      if (!m) { m = new Map(); fastBest.set(s, m); }
      m.set(slot, { sig, best });
    }
    return best;
  });
}

/** Everything a fast type's scores read besides its own slot parts: the structure (rank, footprints, the slot set),
 *  the coverage and desirability in force, the fed gate, the radius bonuses, each house's tier, renovation, preference
 *  and goods, and the timber standing on each candidate slot. While it holds, yesterday's best slot is today's. */
interface FastSig { struct: number; cov: unknown; desir: unknown; slots: unknown; fed: boolean; bonus: number[]; houses: number[]; fells: number[] }
const fastBest = new WeakMap<GameState, Map<string, { sig: FastSig; best: ReturnType<typeof bestSlot> }>>();
const PREF_BITS: Readonly<Record<string, number>> = { auto: 0, insula: 1, domus: 2 };

function fastSig(s: GameState, type: BuildingId, slots: Map<number, number>): FastSig {
  const SUP = B.housing.SUPPLIED;
  const houses: number[] = [];
  for (const id of derived(s).houses) {
    const h = getBuilding(s, id)?.house;
    if (!h) { houses.push(-1); continue; }
    houses.push((h.renovating ? 1 : 0) + 2 * (PREF_BITS[h.pref] ?? 3) + (h.oil >= SUP ? 8 : 0) + (h.wine >= SUP ? 16 : 0)
      + 32 * TIER_LEVEL.indexOf(h.tier));
  }
  const fells: number[] = [];
  for (const tile of slots.keys()) fells.push(fellOn(s, fixedOf(s, type, tile % GW, Math.floor(tile / GW))));
  return {
    struct: structEpoch(s), cov: coverage(s), desir: desirability(s), slots, fed: s.fed >= B.needs.FED_MIN,
    bonus: [fxAdd(s, 'shrineRadius'), fxAdd(s, 'marketRadius'), fxAdd(s, 'bathsRadius')], houses, fells,
  };
}

function sameSig(a: FastSig, b: FastSig): boolean {
  if (a.struct !== b.struct || a.cov !== b.cov || a.desir !== b.desir || a.slots !== b.slots || a.fed !== b.fed) return false;
  for (let k = 0; k < 3; k++) if (a.bonus[k] !== b.bonus[k]) return false;
  if (a.houses.length !== b.houses.length || a.fells.length !== b.fells.length) return false;
  for (let k = 0; k < a.houses.length; k++) if (a.houses[k] !== b.houses[k]) return false;
  for (let k = 0; k < a.fells.length; k++) if (a.fells[k] !== b.fells[k]) return false;
  return true;
}

/** Types the daily slot search scores with fastScore: services, wells, cisterns and fountains, whose score is a fixed
 *  part per structure (steps to the forum, district, the forum's temple, the water table) plus the houses they would
 *  reach today and the timber on the plot. */
const FAST_TYPES: ReadonlySet<BuildingId> = new Set<BuildingId>([...SERVICE_TYPES, ...WATER_TYPES, 'lacus']);

/** What `score` reads of a fast type's slot that only the layout moves (memo per layout epoch and rank): the
 *  footprint, the steps to the forum, the district and forum terms (services) and the site multiplier (wells). */
interface SlotFixed { x: number; y: number; w: number; h: number; steps: number; fit: number; forum: number; mult: number }
const slotFixed = new WeakMap<GameState, { e: number; rank: number; m: Map<number, SlotFixed> }>();
const TYPE_KEY = new Map<BuildingId, number>(BUILDINGS.map((t, k) => [t, k]));

function fixedOf(s: GameState, type: BuildingId, x: number, y: number): SlotFixed {
  const e = layoutEpoch(s);
  let c = slotFixed.get(s);
  if (!c || c.e !== e || c.rank !== s.rank) {
    c = { e, rank: s.rank, m: new Map() };
    slotFixed.set(s, c);
  }
  const k = (TYPE_KEY.get(type) as number) * GW * GH + y * GW + x;
  let f = c.m.get(k);
  if (!f) {
    const r = rectOf(s, type, x, y);
    const blk: Block | null = classAt(s, type, x, y) === 'rural' ? null : blockOfTile(s, y * GW + x);
    const fit = (LATERA.includes(type) && blk?.district === 'latera') || (PRAETENTURA.includes(type) && blk?.district === 'praetentura');
    f = {
      x: r.x, y: r.y, w: r.w, h: r.h, steps: type === 'lacus' ? 0 : stepsToForum(s, r),
      fit: fit ? SC.SERVICE.DISTRICT : 0, forum: type === 'templum' && blk?.touchesForum ? SC.SERVICE.TEMPLE_FORUM : 0,
      mult: siteMultAt(s, type, x, y).mult,
    };
    c.m.set(k, f);
  }
  return f;
}

/** `score(...).score` for a fast type, term for term in the same order (so the same float), without its notes. */
/** Standing timber on a slot's footprint (score's felling sum, tile by tile in its order). */
function fellOn(s: GameState, f: SlotFixed): number {
  let fell = 0;
  for (let ty = Math.max(0, f.y); ty < Math.min(GH, f.y + f.h); ty++) {
    for (let tx = Math.max(0, f.x); tx < Math.min(GW, f.x + f.w); tx++) fell += woodAt(s, ty * GW + tx);
  }
  return fell;
}

function fastScore(s: GameState, ctx: ScoreCtx, type: BuildingId, x: number, y: number, purpose?: ReasonCode): number {
  const f = fixedOf(s, type, x, y);
  const fell = fellOn(s, f);
  let sc = SC.FELL * fell * B.economy.WOOD.FELL_WORK;
  let unblock = 0, newly = 0, t4 = 0;
  const { ids, bits } = coverList(s, type, x, y);
  for (let k = 0; k < ids.length; k++) {
    const hh = ctx.byId.get(ids[k]);
    if (!hh) continue;
    const ls = bits[k];
    if ((hh.wantMask & ls) !== 0) unblock++;
    if ((ls & ~hh.mask) !== 0) { newly++; if (hh.level >= 4) t4++; }
  }
  if (SERVICE_TYPES.includes(type)) {
    sc += SC.SERVICE.UNBLOCK * unblock + SC.SERVICE.COVER * newly + SC.SERVICE.STEPS * f.steps + f.fit + f.forum;
  } else if (WATER_TYPES.includes(type)) {
    const drought = purpose === 'survivalWater' || purpose === 'aestasWater';
    sc += SC.WATER.ACCESS * newly + SC.WATER.STEPS * f.steps + (drought ? DROUGHT_SITE * (f.mult - 1) : 0);
  } else {
    sc += SC.LACUS.T4 * t4 + SC.LACUS.COVER * newly;
  }
  return sc;
}

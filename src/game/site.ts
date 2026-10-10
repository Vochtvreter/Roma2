// src/game/site.ts — site multipliers, Ordo site scoring and the best slot (ARCHITECTURE §8.2, DESIGN §5.1, §10.5). Owner: WP-A.
// Site notes carry one number each: a multiplier note (river, loam, fields, woods, rock, vein, quarryNear, mineNear,
// water) holds the percentage it adds or takes (+20, −40); `forum` holds road steps; `covers`/`unblocks` hold houses;
// `felling` holds timber; `clay`, `district` and `via` hold nothing.
import { B } from './balance';
import { LAYERS, T } from './types';
import type { Block, Building, BuildingId, CoverageLayerId, GameState, NeedId, Owner, ReasonCode, Rect, SiteNote } from './types';
import { getMap, isWooded, woodAt } from './map';
import { blockOfTile, classAt, derived, sizeOf } from './derived';
import { censusEpoch, memo, structEpoch } from './memo';
import { coverage, desirability, previewCovered, previewDesir } from './coverage';
import { firstWant } from './housing';
import { routeAqueduct, validSlots } from './place';
import { getBuilding } from './state';
import { BUILDING_DEFS } from './data/buildings';
import { GH, GW, rectGap, rectTiles, sideTiles } from './world/grid';
import { agerBase, countRingT, countT, isForestT, isHillsRockT, isHillsScrubT, quarryFactor } from './world/rules';
import { woodDependent } from './world/siterules';

const S = B.site;
const SC = B.score;
const CATCH_FULL = 2400;      // standing timber within r4 for a ×1.0 lumber camp (TODO(balance): move to B.economy.WOOD)
const MAX_NOTES = 3;
const DROUGHT_SITE = 10;      // weight of a well's yield when it is raised for drink, not reach (TODO(balance): move to B.score.WATER)
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

/** Buildings of the given types within `gap` tiles of a rect (any status). */
function near(s: GameState, r: Rect, types: readonly BuildingId[], gap: number, except = 0): Building[] {
  return s.buildings.filter((b) => b.id !== except && types.includes(b.type) && rectGap(r, rectOf(s, b.type, b.x, b.y)) <= gap);
}

/** Fields (ager) touching a w×h footprint at (x, y), corners included. */
function adjacentFields(s: GameState, x: number, y: number, w: number, h: number): number {
  const d = derived(s);
  const ids = new Set<number>();
  for (const i of rectTiles(x - 1, y - 1, w + 2, h + 2)) {
    const id = d.buildingAt[i];
    if (id !== 0 && getBuilding(s, id)?.type === 'ager' && !(i % GW >= x && i % GW < x + w && Math.floor(i / GW) >= y && Math.floor(i / GW) < y + h)) ids.add(id);
  }
  return ids.size;
}

/** Site multiplier and notes of a type at (x, y) (DESIGN §5.1 adjacency formulas). */
export function siteMultAt(s: GameState, type: BuildingId, x: number, y: number): { mult: number; notes: SiteNote[] } {
  const map = getMap(s.seed);
  const t = map.terrain;
  const r = rectOf(s, type, x, y);
  const { w, h } = r;
  const notes: SiteNote[] = [];
  let mult = 1;
  switch (type) {
    case 'ager': {
      const base = agerBase(t, x, y);
      const fields = Math.min(S.AGER_FIELDS[1], S.AGER_FIELDS[0] * adjacentFields(s, x, y, w, h));
      mult = base.mult * (1 + fields);
      if (base.riverBonus > 0) notes.push({ code: 'river', value: Math.round(base.riverBonus * 100) });
      if (Math.abs(base.fert - 1) > 1e-9) notes.push({ code: 'loam', value: pct(base.fert) });
      if (fields > 0) notes.push({ code: 'fields', value: Math.round(fields * 100) });
      break;
    }
    case 'venatio': {
      let wooded = 0, all = 0;
      const R = S.VENATIO_R;
      for (let ty = Math.max(0, y - R); ty < Math.min(GH, y + h + R); ty++) {
        for (let tx = Math.max(0, x - R); tx < Math.min(GW, x + w + R); tx++) {
          if (tx >= x && tx < x + w && ty >= y && ty < y + h) continue;
          all++;
          if (isWooded(s, ty * GW + tx)) wooded++;
        }
      }
      const [lo, hi] = S.VENATIO_SITE;
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
      const R = B.economy.WOOD.CATCHMENT;
      let wood = 0;
      for (const i of rectTiles(x - R, y - R, w + 2 * R, h + 2 * R)) if (!(i % GW >= x && i % GW < x + w && Math.floor(i / GW) >= y && Math.floor(i / GW) < y + h)) wood += woodAt(s, i);
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
      if (near(s, r, ['lapicidina'], S.CAEMENT_NEAR[0]).length > 0) { mult = S.CAEMENT_NEAR[1]; notes.push({ code: 'quarryNear', value: pct(mult) }); }
      break;
    case 'officina':
      if (near(s, r, ['fodina'], S.OFFICINA_NEAR[0]).length > 0) { mult = S.OFFICINA_NEAR[1]; notes.push({ code: 'mineNear', value: pct(mult) }); }
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

/** Site multiplier of a placed building (memo per building on structEpoch; daily for sites that live on standing wood). */
export function siteMult(s: GameState, b: Building): number {
  const key = woodDependent(b.type) ? `${structEpoch(s)}:${s.day}` : String(structEpoch(s));
  return memo(s, `siteMult:${b.id}`, key, () => siteMultAt(s, b.type, b.x, b.y).mult);
}

/** Per-call scoring context: house wants and current coverage, gathered once for many candidate slots. */
interface ScoreCtx {
  houses: { id: number; rect: Rect; want: NeedId | null; level: number; desir: number; mask: number }[];
  byId: Map<number, ScoreCtx['houses'][number]>;
}

function scoreCtx(s: GameState): ScoreCtx {
  const d = derived(s);
  const desir = desirability(s);
  const houses: ScoreCtx['houses'] = [];
  const masks = coverage(s).houseMask;
  for (const id of d.houses) {
    const b = getBuilding(s, id);
    if (!b || !b.house) continue;
    const rect = rectOf(s, b.type, b.x, b.y);
    let sum = 0;
    const tiles = rectTiles(rect.x, rect.y, rect.w, rect.h);
    for (const i of tiles) sum += desir[i];
    houses.push({ id, rect, want: firstWant(s, b), level: ['tentoria', 'casa', 'tegulata', 'domusParva', 'insula', 'domus'].indexOf(b.house.tier), desir: tiles.length ? sum / tiles.length : 0, mask: masks.get(id) ?? 0 });
  }
  return { houses, byId: new Map(houses.map((hh) => [hh.id, hh])) };
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
  const housesWithin = (gap: number): number => ctx.houses.filter((hh) => rectGap(r, hh.rect) <= gap).length;
  const cover = (): { unblock: number; newly: number; t4: number } => {
    let unblock = 0, newly = 0, t4 = 0;
    const covered = new Map<number, CoverageLayerId[]>();
    for (const p of previewCovered(s, type, x, y)) for (const id of p.houses) covered.set(id, [...(covered.get(id) ?? []), p.layer]);
    for (const [id, ls] of covered) {
      const hh = ctx.byId.get(id);
      if (!hh) continue;
      if (hh.want && (NEED_LAYERS[hh.want] ?? []).some((l) => ls.includes(l))) unblock++;
      if (ls.some((l) => ((hh.mask >> LAYERS.indexOf(l)) & 1) === 0)) { newly++; if (hh.level >= 4) t4++; }
    }
    return { unblock, newly, t4 };
  };
  if (type === 'area') {
    const steps = stepsToForum(s, r);
    let desir = 0;
    const dz = desirability(s);
    for (const i of rectTiles(r.x, r.y, r.w, r.h)) desir += dz[i];
    desir /= r.w * r.h;
    const withHouses = blk !== null && s.buildings.some((b) => b.type === 'area' && blockOfTile(s, b.y * GW + b.x)?.id === blk.id);
    const industry = s.buildings.some((b) => ['officinae', 'materia'].includes(BUILDING_DEFS[b.type].cat) && rectGap(r, rectOf(s, b.type, b.x, b.y)) <= SC.HOUSE.INDUSTRY_R);
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
  return score(s, scoreCtx(s), type, x, y, purpose);
}

/** The best valid slot for a type (highest score, ties by lowest tile); null when there is none (memo on the epochs and day). */
export function bestSlot(s: GameState, type: BuildingId, opts?: { owner?: Owner; purpose?: ReasonCode }): { tile: number; x: number; y: number; score: number; notes: SiteNote[] } | null {
  const owner = opts?.owner ?? 'ordo';
  const purpose = opts?.purpose;
  return memo(s, `bestSlot:${type}:${owner}:${purpose ?? ''}`, `${structEpoch(s)}:${censusEpoch(s)}:${s.day}`, () => {
    const slots = validSlots(s, type, owner);
    if (slots.size === 0) return null;
    const ctx = scoreCtx(s);
    let best: { tile: number; x: number; y: number; score: number; notes: SiteNote[] } | null = null;
    for (const tile of [...slots.keys()].sort((a, b) => a - b)) {
      const x = tile % GW, y = Math.floor(tile / GW);
      const sc = score(s, ctx, type, x, y, purpose);
      if (!best || sc.score > best.score + 1e-9) best = { tile, x, y, score: sc.score, notes: sc.notes };
    }
    return best;
  });
}

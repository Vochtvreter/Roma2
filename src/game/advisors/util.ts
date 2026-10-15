// src/game/advisors/util.ts — shared helpers of the advisor rules: severity ladders, the tick channel, the house-wants
// memo, and the words that name people, places, markets and fractions (DESIGN §11.1, §11.4–11.6). Owner: WP-E.
// Load order: only function bodies here touch other game modules, so any file may import this one.
import { B as B$ } from '../balance';
import { HOUSE_TIERS as HOUSE_TIERS$, HUBS as HUBS$ } from '../types';
import type {
  AdvisorRule, BuildingId, ContractSpec, CoverageLayerId, Essential, GameState, HouseTierId, HubId, LaborCat, NeedId, Person, Rates, Remedy, ResId, RuleId, Severity, SimView,
  SkillId, TradeRes,
} from '../types';
import { seasonOf as seasonOf$ } from '../calendar';
import { seasonMult } from '../economy';
import { distToRect as distToRect$, getMap as getMap$, tx as tx$, ty as ty$ } from '../map';
import { memo as memo$, structEpoch as structEpoch$ } from '../memo';
import { personName } from '../people';
import { getBuilding as getBuilding$, getPerson as getPerson$ } from '../lookup';
import { crowds, nextTier, shownWant, unmetNeeds } from '../housing';
import { hubOpen, price, tripDays } from '../trade';
import { validSlots } from '../place';
import { houseDesir, previewCovered, previewDesir } from '../coverage';
import { siteScore } from '../site';
import { classAt, derived, sizeOf } from '../derived';
import { isActiveBlock, isRazed } from '../survey';
import { peopleIndex } from '../census';
import { ruleFail } from '../world/siterules';
import { rectGap } from '../world/grid';
import { fxAdd } from '../fx';
import { homesEpoch, layoutEpoch } from '../memo';
import { BUILDING_DEFS as BUILDING_DEFS$ } from '../data/buildings';
import { NEED_META as NEED_META$, TIER_DEFS as TIER_DEFS$ } from '../data/housing';
import { RANK_DEFS as RANK_DEFS$ } from '../data/ranks';
import { RESOURCE_DEFS as RESOURCE_DEFS$ } from '../data/resources';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, HOUSE_TIERS = HOUSE_TIERS$, HUBS = HUBS$, seasonOf = seasonOf$, distToRect = distToRect$,
  getMap = getMap$, tx = tx$, ty = ty$, memo = memo$, structEpoch = structEpoch$, BUILDING_DEFS = BUILDING_DEFS$,
  NEED_META = NEED_META$, TIER_DEFS = TIER_DEFS$, RANK_DEFS = RANK_DEFS$, RESOURCE_DEFS = RESOURCE_DEFS$,
  getBuilding = getBuilding$, getPerson = getPerson$;

/** Hysteresis release factor: an advisory clears only past its threshold × CLEAR (DESIGN §11.4). */
export const CLEAR = B.advisors.CLEAR;
/** Per-rule thresholds (DESIGN §11.6). */
export const R = B.advisors.RULES;

/** Remedy steps of the DESIGN §11.6 catalogue (Builder share +5, Spare beds +4, Trade reserve −10 …) and the surplus rule. */
export const STEP = B.advisors.STEP;

/** A rule the engine evaluates only every `every` days (day % every == 0); on other days it is left exactly as it stands. */
export type CadencedRule = AdvisorRule & { every?: number };

// ───────────────────────────── ladders and hysteresis ─────────────────────────────

/** True while the rule's advisory is raised (its evaluate then holds it up to threshold × CLEAR). */
export function held(s: GameState, id: RuleId): boolean {
  return s.guidance.advisories[id]?.active === true;
}

/** Severity of a low-is-bad metric: P < t[0] · C < t[1] · M < t[2]; a held advisory stays up to t[2] × CLEAR. */
export function lowLadder(x: number, t: readonly number[], hold: boolean): Severity | null {
  if (x < t[0]) return 3;
  if (x < t[1]) return 2;
  if (x < t[2] * (hold ? CLEAR : 1)) return 1;
  return null;
}

/** Days until a stock runs out at a net rate (stock / −net when net < 0), else null. */
export function runway(stock: number, net: number): number | null {
  return net < 0 ? Math.max(0, stock) / -net : null;
}

// The day's ledger, lent to the rules by advisorsDay for the length of one evaluation pass (never saved).
let tickRates: Rates | null = null;
// States that have run offline ticks in this session: the mentor's `away` tip waits for them (UI only, never saved).
const away = new WeakSet<GameState>();

/** Notes that a state has just been advanced offline (advisorsDay with ctx.offline). */
export function markAway(s: GameState): void {
  away.add(s);
}

/** True once this state has run offline ticks in this session (the away report was written). */
export function wasAway(s: GameState): boolean {
  return away.has(s);
}

/** Sets (or clears) the ledger of the tick being evaluated; called only by advisorsDay. */
export function lendRates(r: Rates | null): void {
  tickRates = r;
}

/** Today's ledger amount of a source (consumption or production) while advisorsDay runs; null outside it. */
export function todayRate(side: 'prod' | 'cons', res: keyof Rates['prod'], src: string): number | null {
  if (!tickRates) return null;
  return (tickRates[side][res] as Record<string, number | undefined>)[src] ?? 0;
}

/** Today's net of a resource from the lent ledger (Σ production − Σ consumption); null outside advisorsDay. */
export function netToday(res: ResId): number | null {
  if (!tickRates) return null;
  let n = 0;
  for (const v of Object.values(tickRates.prod[res])) n += v ?? 0;
  for (const v of Object.values(tickRates.cons[res])) n -= v ?? 0;
  return n;
}

// ───────────────────────────── labour ─────────────────────────────

/** Open posts in a labour category. */
export function openPosts(v: SimView, cat: LaborCat): number {
  return Math.max(0, v.c.catSlots[cat] - v.c.catStaffed[cat]);
}

/** Best output per hand this season among a category's finished producers of an essential (0 if none). */
function perHand(s: GameState, cat: LaborCat, res: Essential): number {
  const season = seasonOf(s.day);
  let best = 0;
  for (const b of s.buildings) {
    const d = BUILDING_DEFS[b.type];
    if (b.status === 'done' && b.open && d.labor === cat && d.output?.res === res) best = Math.max(best, d.output.perWorker * seasonMult(s, b.type, season));
  }
  return best;
}

/** The labour remedy for a shortfall: the Ordo puts the category first, or (manual labour) k more hands by hand. */
export function labourRemedy(s: GameState, v: SimView, cat: LaborCat, res: Essential, deficit: number): Remedy {
  if (s.ordo.on.labour) return { kind: 'priority', cat, days: R.REMEDY_DAYS };
  const per = perHand(s, cat, res);
  const k = per > 0 ? Math.ceil(Math.max(0, deficit) / per) : 1;
  return { kind: 'assign', cat, n: Math.max(1, Math.min(Math.max(1, openPosts(v, cat)), k)) };
}

/** The grain producer that gives most per hand this season among those Rome allows us. */
export function bestFood(s: GameState): BuildingId {
  const season = seasonOf(s.day);
  let best: BuildingId = 'ager', top = -1;
  for (const t of ['ager', 'venatio', 'pabulatio'] as const) {
    const d = BUILDING_DEFS[t];
    const v = d.rank <= s.rank && d.output ? d.output.perWorker * seasonMult(s, t, season) : -1;
    if (v > top) { top = v; best = t; }
  }
  return best;
}

// ───────────────────────────── houses ─────────────────────────────

/** One house's view for the Aedilis and the Curator: its tier, the next tier and its unmet needs (in need order), decline. */
export interface HouseWant { id: number; tile: number; tier: HouseTierId; next: HouseTierId | null; unmet: NeedId[]; want: NeedId | null; declining: boolean; lapsed: NeedId[] }

const PREFS = ['auto', 'insula', 'domus'] as const;
const TIER_CODE = Object.fromEntries(HOUSE_TIERS.map((t, k) => [t, k])) as Record<HouseTierId, number>;
const PREF_CODE = Object.fromEntries(PREFS.map((p, k) => [p, k])) as Record<(typeof PREFS)[number], number>;

/** Everything a house's needs read besides the structure: the fed index, rank, and per house its tier, decline, goods,
 *  preference and coverage mask (the needs read coverage only through houseHas, that is the mask). Built on every call
 *  (one pass over the houses): tiers change on renovation and the goods EMAs cross SUPPLIED without bumping an epoch, so a
 *  signature cached per day and epochs went stale within the day; a coverage rebuilt with the same masks (a service's
 *  staffing moved its radius over no house) keeps the signature. */
function houseSig(s: GameState, v: SimView): string {
  const S = B.housing.SUPPLIED;
  const masks = v.cov.houseMask;
  const codes: number[] = [];
  for (const id of v.d.houses) {
    const h = getBuilding(s, id)?.house;
    if (!h) continue;
    const bits = (h.declining ? 4 : 0) + (h.oil >= S ? 2 : 0) + (h.wine >= S ? 1 : 0);
    codes.push(48 + (TIER_CODE[h.tier] * 8 + bits) * 3 + PREF_CODE[h.pref], 48 + (masks.get(id) ?? 0));
  }
  return `${structEpoch(s)}|${s.fed >= B.needs.FED_MIN ? 1 : 0}|${s.rank}|${String.fromCharCode(...codes)}`;
}

/** Every finished house with its wants. Pure, and memoised on everything the needs read (houseSig), so it is recomputed only when the structure, coverage, fed index or a house changes — not every day. */
export function houseWants(s: GameState, v: SimView): HouseWant[] {
  return memo(s, 'adv.houses', houseSig(s, v), () => {
    const out: HouseWant[] = [];
    const W = getMap(s.seed).W;
    for (const id of v.d.houses) {
      const b = getBuilding(s, id);
      const h = b?.house;
      if (!b || !h) continue;
      const next = nextTier(s, b);
      const unmet = next ? unmetNeeds(s, b, next) : [];
      out.push({ id, tile: b.y * W + b.x, tier: h.tier, next, unmet, want: shownWant(s, unmet), declining: h.declining, lapsed: h.declining ? unmetNeeds(s, b, h.tier) : [] });
    }
    return out;
  });
}

/** Houses whose next tier has waited on an unmet need for at least `days` days (finished that long ago, no OK days). */
export function blockedHouses(s: GameState, v: SimView, days: number): HouseWant[] {
  return houseWants(s, v).filter((w) => {
    const b = getBuilding(s, w.id);
    return w.want !== null && b !== undefined && s.day - (b.doneDay ?? b.placed) >= days && (b.house?.okDays ?? 0) === 0;
  });
}

/** The building that answers a house need, by what the colony can raise now (null: no building answers it). */
export function serviceFor(s: GameState, need: NeedId, castellumActive: boolean): BuildingId | null {
  const pick = (a: BuildingId, b: BuildingId): BuildingId => (BUILDING_DEFS[b].rank <= s.rank ? b : a);
  switch (need) {
    case 'water': return castellumActive ? 'lacus' : 'puteus';
    case 'fed': return 'ager';
    case 'religion': return 'lararium';
    case 'market': return 'taberna';
    case 'temple': return 'templum';
    case 'baths': return castellumActive ? pick('balneum', 'thermae') : 'balneum';
    case 'macellum': return 'macellum';
    case 'desirability': return 'hortus';
    case 'oil': return 'olivetum';
    default: return null;
  }
}

/** The one remedy that answers a house need: a building to place, wine by contract, or the petition for rank. */
export function needRemedy(s: GameState, v: SimView, need: NeedId): Remedy {
  const b = serviceFor(s, need, v.d.castellumActive);
  if (b) return { kind: 'place', building: b };
  if (need === 'wine') return importRemedy(s, 'wine', B.ordo.CARGO) ?? { kind: 'open', tab: 'trade' };
  if (need === 'rank') return { kind: 'open', tab: 'council', anchor: 'petition' };
  if (need === 'street') return { kind: 'open', tab: 'build', anchor: 'road' };
  return { kind: 'overlay', overlay: 'domus' };
}

/** The coverage layers that answer a house need (a temple answers religion too; a macellum the market). */
const ANSWERS: Partial<Record<NeedId, readonly CoverageLayerId[]>> = {
  water: ['water', 'fountain'], religion: ['shrine', 'temple'], market: ['market', 'macellum'], temple: ['temple'], baths: ['baths'], macellum: ['macellum'],
};
/** Path radius bonus per coverage layer (as coverage.ts applies it to previews). */
const BONUS: Partial<Record<CoverageLayerId, 'shrineRadius' | 'marketRadius' | 'bathsRadius'>> = {
  shrine: 'shrineRadius', temple: 'shrineRadius', market: 'marketRadius', macellum: 'marketRadius', baths: 'bathsRadius',
};

const NO_RISE: ReadonlyMap<number, number> = new Map();

/** The houses a work answering `need` that is still rising will reach once it stands (previewCovered from its site),
 *  each with that work (the first placed): they wait for it, not for another — a second temple, or a block cleared for
 *  one, would serve the same homes (DESIGN §11.6 row 17). The Capitolium, the colony's long last work, is not counted.
 *  Memo on the layout (a placement, a completion, a demolition), the rank and the radius bonuses. */
export function risingReach(s: GameState, need: NeedId): ReadonlyMap<number, number> {
  const layers = ANSWERS[need];
  if (!layers) return NO_RISE;
  const key = `${layoutEpoch(s)}|${s.rank}|${fxAdd(s, 'shrineRadius')},${fxAdd(s, 'marketRadius')},${fxAdd(s, 'bathsRadius')}`;
  return memo(s, `adv.rising.${need}`, key, () => {
    const out = new Map<number, number>();
    for (const b of s.buildings) {
      const def = BUILDING_DEFS[b.type];
      if (b.status === 'done' || def.place.includes('fixed') || !def.service?.some((x) => layers.includes(x.layer))) continue;
      for (const p of previewCovered(s, b.type, b.x, b.y)) if (layers.includes(p.layer)) for (const h of p.houses) if (!out.has(h)) out.set(h, b.id);
    }
    return out;
  });
}

/** A set of tiles as a memo key part (kept per set: the Ordo hands the same set all day). */
function skipKey(skip: ReadonlySet<number> | undefined): string {
  if (!skip) return '';
  let k = skipKeys.get(skip);
  if (k === undefined) { k = [...skip].sort((a, b) => a - b).join(','); skipKeys.set(skip, k); }
  return k;
}
const skipKeys = new WeakMap<ReadonlySet<number>, string>();

/** The slot of `type` that brings the most of the houses `ids` the coverage they wait for (`need`): the valid slots of
 *  `owner` (none on a `skip` tile), the most of them served, ties by the Ordo's site score, then the lowest tile; null
 *  when no valid slot reaches any of them — a service raised elsewhere would leave them waiting (DESIGN §10.5 row 6:
 *  "the slot unblocking the most houses"). A slot farther than its reach + 2 (Chebyshev) from every waiting house cannot
 *  serve one (coverage runs along the roads from its sides), so only nearer slots are previewed. Memo on the layout, the
 *  rank, the radius bonuses and the arguments. */
export function serveSlot(s: GameState, type: BuildingId, owner: 'ordo' | 'player', need: NeedId, ids: readonly number[], skip?: ReadonlySet<number>): { tile: number; k: number } | null {
  const layers = ANSWERS[need] ?? [];
  const svc = (BUILDING_DEFS[type].service ?? []).filter((x) => layers.includes(x.layer));
  if (svc.length === 0 || ids.length === 0) return null;
  const bonus = svc.map((x) => (BONUS[x.layer] ? fxAdd(s, BONUS[x.layer] as 'shrineRadius') : 0));
  const key = `${layoutEpoch(s)}|${s.rank}|${bonus.join(',')}|${ids.join(',')}|${skipKey(skip)}`;
  return memo(s, `adv.serve.${type}.${owner}.${need}`, key, () => {
    const want = new Set(ids);
    const waiting: { x: number; y: number; w: number; h: number }[] = [];
    for (const id of ids) {
      const b = getBuilding(s, id);
      if (!b) continue;
      const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
      waiting.push({ x: b.x, y: b.y, w, h });
    }
    const reach = Math.max(...svc.map((x, k) => x.radius + bonus[k])) + 2;
    let best: { tile: number; k: number; score: number } | null = null;
    for (const tile of [...validSlots(s, type, owner).keys()].sort((a, b) => a - b)) {
      if (skip?.has(tile)) continue;
      const x = tx(tile), y = ty(tile);
      const [w, h] = sizeOf(type, classAt(s, type, x, y));
      const r = { x, y, w, h };
      if (!waiting.some((hr) => rectGap(r, hr) <= reach)) continue;
      const served = new Set<number>();
      for (const p of previewCovered(s, type, x, y)) if (layers.includes(p.layer)) for (const hid of p.houses) if (want.has(hid)) served.add(hid);
      const k = served.size;
      if (k === 0 || (best && k < best.k)) continue;
      const score = siteScore(s, type, x, y, 'evolve').score;
      if (!best || k > best.k || score > best.score + 1e-9) best = { tile, k, score };
    }
    return best ? { tile: best.tile, k: best.k } : null;
  });
}

/** The garden slot (for `owner`, none on a `skip` tile) that best lifts the houses `ids`, whose next tier waits on a
 *  finer street: the most of them brought to their tier's desirability, then the most lift toward it (capped at what
 *  each still lacks), then the lowest tile; null when no valid slot lifts any of them — a garden raised elsewhere would
 *  leave them waiting. Only slots within a garden's reach of a waiting house are previewed (memo as serveSlot). */
export function liftSlot(s: GameState, owner: 'ordo' | 'player', ids: readonly number[], skip?: ReadonlySet<number>): { tile: number; k: number; lift: number } | null {
  if (ids.length === 0) return null;
  const key = `${layoutEpoch(s)}|${s.rank}|${ids.join(',')}|${skipKey(skip)}`;
  return memo(s, `adv.lift.${owner}`, key, () => {
    // one entry per street to lift: the waiting house's own, or each neighbour its rise would crowd (`of`: the house)
    const houses: { of: number; rect: { x: number; y: number; w: number; h: number }; short: number }[] = [];
    for (const id of ids) {
      const b = getBuilding(s, id);
      const next = b ? nextTier(s, b) : null;
      const min = next ? TIER_DEFS[next].desirMin : null;
      if (!b || min === null) continue;
      const short = min - houseDesir(s, id);
      const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
      if (short > 0) houses.push({ of: id, rect: { x: b.x, y: b.y, w, h }, short });
      else {
        // its own street suffices, but the rise would crowd a neighbour below its tier (housing.crowds): lift theirs
        for (const c of crowds(s, b, next!)) {
          const nb = getBuilding(s, c.id);
          if (!nb) continue;
          const [nw, nh] = sizeOf(nb.type, classAt(s, nb.type, nb.x, nb.y));
          houses.push({ of: id, rect: { x: nb.x, y: nb.y, w: nw, h: nh }, short: c.short });
        }
      }
    }
    const reach = BUILDING_DEFS.hortus.desir[1];
    let best: { tile: number; k: number; lift: number } | null = null;
    for (const tile of [...validSlots(s, 'hortus', owner).keys()].sort((a, b) => a - b)) {
      if (skip?.has(tile)) continue;
      const x = tx(tile), y = ty(tile);
      const [w, h] = sizeOf('hortus', classAt(s, 'hortus', x, y));
      const r = { x, y, w, h };
      const near = houses.filter((hh) => rectGap(r, hh.rect) <= reach);
      if (near.length === 0) continue;
      const delta = new Map<number, number>();
      for (const d of previewDesir(s, 'hortus', x, y)) delta.set(d.tile, d.v);
      let lift = 0;
      const short = new Set<number>();   // houses with a street this garden leaves short
      for (const hh of houses) {
        let avg = 0;
        if (rectGap(r, hh.rect) <= reach) {
          let sum = 0;
          for (let yy = hh.rect.y; yy < hh.rect.y + hh.rect.h; yy++) for (let xx = hh.rect.x; xx < hh.rect.x + hh.rect.w; xx++) sum += delta.get(yy * getMap(s.seed).W + xx) ?? 0;
          avg = sum / (hh.rect.w * hh.rect.h);
        }
        if (avg < hh.short) short.add(hh.of);
        lift += Math.min(avg, hh.short);
      }
      let k = 0;
      for (const hh of near) if (!short.has(hh.of)) { k++; short.add(hh.of); }   // each house lifted clear counts once
      if (lift <= 1e-9) continue;
      if (!best || k > best.k || (k === best.k && lift > best.lift + 1e-9)) best = { tile, k, lift };
    }
    return best;
  });
}

// ───────────────────────────── a block to clear ─────────────────────────────

/** A block the player could clear for a block service that no free block can bring to the houses waiting for it (DESIGN
 *  §11.6 row 17): its origin tile, the works on it to pull down (`ids`, sorted), the waiting houses the service would
 *  reach from it (`k`, none of them on the block), and the homes pulled down with the souls who live in them. */
export interface ClearSite { tile: number; k: number; ids: number[]; homes: number; souls: number }
/** Why no block is offered: each block within reach holds a work the advice never pulls down or is one the player keeps
 *  free (`works`), would let too few of them rise for what it pulls down (`gain`), or no block reaches them (`far`). */
export type ClearWhy = 'far' | 'works' | 'gain';
const WHY_RANK: Record<ClearWhy, number> = { far: 0, works: 1, gain: 2 };

/** The works on the block whose origin is `tile` that the advice may pull down for a block service, sorted: homes and
 *  plot works (a garden, a well, a shrine, a shop row, a smithy, a cistern, a fountain), finished or rising. Null when
 *  anything else stands on it (a granary, a warehouse, a road station, a civic work, the castellum, a rural work) or a
 *  tile is reserved (an aqueduct's route); [] for a free block. */
export function blockWorks(s: GameState, tile: number): number[] | null {
  const d = derived(s);
  const BLOCK = B.map.BLOCK, W = getMap(s.seed).W;
  const x0 = tx(tile), y0 = ty(tile);
  const out = new Set<number>();
  for (let y = y0; y < y0 + BLOCK; y++) for (let x = x0; x < x0 + BLOCK; x++) {
    const i = y * W + x;
    if (d.reservedTile[i]) return null;
    const id = d.buildingAt[i];
    if (!id || out.has(id)) continue;
    const b = getBuilding(s, id);
    if (!b || b.type === 'castellum' || classAt(s, b.type, b.x, b.y) !== 'plot') return null;
    out.add(id);
  }
  return [...out].sort((a, b) => a - b);
}

/** The block to clear for `type`, a block service, that best serves the houses `ids` waiting for it (`need`) when no
 *  free block can (DESIGN §11.6 row 17): an active block, not one the player keeps free, holding only what blockWorks
 *  may pull down and not the only works that bring one of those houses another need of its next tier (its shrine, its
 *  shop row, its well: it would decline instead of rising), where the site rule allows `type`; the most of the waiting
 *  houses served less the homes pulled down (at least CLEAR_GAIN), then the fewest souls moved, then the fewest works
 *  pulled down, then the lowest tile. With none, `why` names what kept the blocks within reach (gain over works over
 *  far). Only blocks within the service's reach + 2 of a waiting house are previewed (as serveSlot). Memo on the
 *  structure, the homes, the rank, the kept blocks, the radius bonuses and the arguments. */
export function clearSite(s: GameState, type: BuildingId, need: NeedId, ids: readonly number[]): { site: ClearSite | null; why: ClearWhy } {
  const def = BUILDING_DEFS[type];
  const layers = ANSWERS[need] ?? [];
  const svc = (def.service ?? []).filter((x) => layers.includes(x.layer));
  if (svc.length === 0 || ids.length === 0 || !def.place.includes('block') || def.rank > s.rank) return { site: null, why: 'far' };
  const bonus = svc.map((x) => (BONUS[x.layer] ? fxAdd(s, BONUS[x.layer] as 'shrineRadius') : 0));
  const key = `${structEpoch(s)}|${homesEpoch(s)}|${s.rank}|${s.ordo.reserved.join(',')}|${bonus.join(',')}|${ids.join(',')}`;
  return memo(s, `adv.clear.${type}.${need}`, key, () => {
    const sv = getMap(s.seed).survey, razed = isRazed(s), byHome = peopleIndex(s).byHome, BLOCK = B.map.BLOCK;
    const want = new Set(ids);
    const waiting: { x: number; y: number; w: number; h: number }[] = [];
    for (const id of ids) {
      const b = getBuilding(s, id);
      if (!b) continue;
      const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
      waiting.push({ x: b.x, y: b.y, w, h });
    }
    const reach = Math.max(...svc.map((x, k) => x.radius + bonus[k])) + 2;
    // the works whose service reaches each waiting house, per layer, and the needs of its next tier they answer
    const covers = new Map<string, number[]>();
    for (const b of s.buildings) {
      if (b.status !== 'done' || !BUILDING_DEFS[b.type].service) continue;
      for (const p of previewCovered(s, b.type, b.x, b.y)) for (const h of p.houses) {
        if (!want.has(h)) continue;
        const l = covers.get(`${p.layer}:${h}`);
        if (l) l.push(b.id); else covers.set(`${p.layer}:${h}`, [b.id]);
      }
    }
    const others = new Map<number, NeedId[]>();
    for (const id of ids) {
      const b = getBuilding(s, id);
      const next = b ? nextTier(s, b) : null;
      others.set(id, next ? TIER_DEFS[next].needs.filter((n) => n !== need && ANSWERS[n]) : []);
    }
    let best: (ClearSite & { gain: number }) | null = null;
    let why: ClearWhy = 'far';
    const note = (w: ClearWhy): void => { if (WHY_RANK[w] > WHY_RANK[why]) why = w; };
    for (const blk of sv.blocks) {
      if (!isActiveBlock(sv, blk, s.rank, razed)) continue;
      const r = { x: blk.x, y: blk.y, w: BLOCK, h: BLOCK };
      if (!waiting.some((hr) => rectGap(r, hr) <= reach) || ruleFail(s, type, blk.x, blk.y, BLOCK, BLOCK)) continue;
      const tile = blk.y * getMap(s.seed).W + blk.x;
      const pull = s.ordo.reserved.includes(blk.id) ? null : blockWorks(s, tile);
      if (pull?.length === 0) continue;                 // a free block: serveSlot's to weigh
      const gone = new Set(pull ?? []);
      const served = new Set<number>(), brings = new Map<number, Set<string>>();   // what the work brings them from here
      for (const p of previewCovered(s, type, blk.x, blk.y)) for (const h of p.houses) {
        if (!want.has(h) || gone.has(h)) continue;
        if (layers.includes(p.layer)) served.add(h);
        const got = brings.get(h);
        if (got) got.add(p.layer); else brings.set(h, new Set([p.layer]));
      }
      const k = served.size;
      if (k === 0) continue;
      // a waiting house would lose a need when every work bringing it stands on the block and the new work does not
      const takes = (): boolean => ids.some((h) => !gone.has(h) && (others.get(h) ?? []).some((n) => {
        const ls = ANSWERS[n] ?? [];
        const by = ls.flatMap((l) => covers.get(`${l}:${h}`) ?? []);
        return by.length > 0 && by.every((id) => gone.has(id)) && !ls.some((l) => brings.get(h)?.has(l));
      }));
      if (!pull || takes()) { note('works'); continue; }
      let homes = 0, souls = 0;
      for (const id of pull) if (getBuilding(s, id)?.house) { homes++; souls += byHome.get(id)?.length ?? 0; }
      const gain = k - homes;
      if (gain < R.CLEAR_GAIN) { note('gain'); continue; }
      if (!best || gain > best.gain || (gain === best.gain && (souls < best.souls || (souls === best.souls && pull.length < best.ids.length)))) {
        best = { tile, k, ids: pull, homes, souls, gain };   // blocks run in tile order: the lowest tile wins a tie
      }
    }
    return best ? { site: { tile: best.tile, k: best.k, ids: best.ids, homes: best.homes, souls: best.souls }, why } : { site: null, why };
  });
}

const HOUSE_ONE: Record<HouseTierId, string> = {
  tentoria: 'a tent plot', casa: 'a hut', tegulata: 'a tiled cottage', domusParva: 'a stone house', insula: 'an insula', domus: 'an atrium house',
};

/** What stands on a block to clear, in words ("2 gardens and a well", "a hut, a shop row and a building site"). */
export function worksWord(s: GameState, ids: readonly number[]): string {
  const counts = new Map<string, { many: string; n: number }>();
  for (const id of ids) {
    const b = getBuilding(s, id);
    if (!b) continue;
    const name = bName(b.type);
    const [one, many] = b.status !== 'done' ? ['a building site', 'building sites']
      : b.house ? [HOUSE_ONE[b.house.tier], TIER_PLURAL[b.house.tier]]
      : [aName(b.type), /y$/.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`];
    const c = counts.get(one);
    if (c) c.n++; else counts.set(one, { many, n: 1 });
  }
  return listJoin([...counts].map(([one, c]) => (c.n === 1 ? one : `${c.n} ${c.many}`)));
}

/** A house need as a noun phrase ("a shrine", "water"). */
export function needWord(need: NeedId): string {
  if (need === 'desirability') return 'a finer street';
  if (need === 'fed') return 'full bellies';
  if (need === 'rank') return 'a charter from Rome';
  return NEED_META[need].label.replace(/^[A-Z]/, (c) => c.toLowerCase());
}

const TIER_PLURAL: Record<HouseTierId, string> = {
  tentoria: 'tent plots', casa: 'huts', tegulata: 'tiled cottages', domusParva: 'stone houses', insula: 'insulae', domus: 'atrium houses',
};

/** A tier as a plural noun ("tiled cottages"), or singular for one. */
export function tierWord(t: HouseTierId, n = 2): string {
  return n === 1 ? TIER_DEFS[t].name.toLowerCase() : TIER_PLURAL[t];
}

// ───────────────────────────── words ─────────────────────────────

const SINGULAR: Partial<Record<BuildingId, string>> = {
  ager: 'a field', olivetum: 'an olive grove', castellum: 'an aqueduct', thermae: 'great baths', caementarium: 'concrete works',
  area: 'a house plot', principia: 'the forum', capitolium: 'the Capitolium',
};

/** A building with its article ("a granary", "an olive grove"). */
export function aName(t: BuildingId): string {
  const s = SINGULAR[t];
  if (s) return s;
  const n = BUILDING_DEFS[t].name.toLowerCase();
  return `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`;
}

/** A building's bare lowercase name ("granary", "field"). */
export function bName(t: BuildingId): string {
  return aName(t).replace(/^(a|an|the) /, '');
}

/** Mends the seams of generated copy: a date's abbreviation point before a full stop ("Kal. Oct.."). */
export function tidy(text: string): string {
  return text.replace(/\.\./g, '.');
}

/** "a, b and c" (with a serial comma when an item has its own "and"). */
export function listJoin(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  const serial = xs.length > 2 && xs.some((x) => x.includes(' and ')) ? ',' : '';
  return `${xs.slice(0, -1).join(', ')}${serial} and ${xs[xs.length - 1]}`;
}

/** Whole number with thousands separators (display only). */
export function int(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? '−' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** One decimal under 10 (dropped when whole), else a whole number. */
export function num(n: number): string {
  if (Math.abs(n) >= 10) return int(n);
  const r = Math.round(Math.abs(n) * 10) / 10;
  return (n < 0 && r > 0 ? '−' : '') + (Number.isInteger(r) ? String(r) : r.toFixed(1));
}

/** "1 day" / "12 days" (floors; never negative). */
export function days(n: number): string {
  const d = Math.max(0, Math.floor(n));
  return d === 1 ? '1 day' : `${d} days`;
}

/** "in 12 days", or "today" under a day. */
export function inDays(n: number): string {
  return n < 1 ? 'today' : `in ${days(n)}`;
}

const FRACTIONS: [number, string][] = [
  [0.2, 'a fifth'], [0.25, 'a quarter'], [1 / 3, 'a third'], [0.4, 'two-fifths'], [0.5, 'half'], [0.6, 'three-fifths'],
  [2 / 3, 'two-thirds'], [0.75, 'three-quarters'], [0.8, 'four-fifths'],
];

/** A factor in words ("a third", "four-fifths"), or a percentage when no common fraction is close. */
export function fractionWord(x: number): string {
  for (const [f, w] of FRACTIONS) if (Math.abs(x - f) <= 0.04) return w;
  return `${Math.round(x * 100)}%`;
}

/** A resource's lowercase name. */
export function resName(r: keyof typeof RESOURCE_DEFS): string {
  return RESOURCE_DEFS[r].name.toLowerCase();
}

/** "Oppidum" with its article ("an Oppidum"). */
export function rankWord(rank: number): string {
  const n = RANK_DEFS[rank]?.name ?? 'Colonia';
  return `${/^[AEIOU]/.test(n) ? 'an' : 'a'} ${n}`;
}

// ───────────────────────────── people ─────────────────────────────

/** Idle able people, best at a skill first (then lowest id). */
export function idleBySkill(s: GameState, v: SimView, skill: SkillId | null): Person[] {
  const out: Person[] = [];
  for (const id of v.c.idle) { const p = getPerson(s, id); if (p) out.push(p); }
  return out.sort((a, b) => (skill ? (b.skills[skill] ?? 0) - (a.skills[skill] ?? 0) : 0) || a.id - b.id);
}

/** "Quintus Flavius", "Quintus Flavius and Gaia Antonia", "Quintus Flavius and 4 others". */
export function namesOf(ps: readonly Person[], max = 2): string {
  if (ps.length === 0) return '';
  if (ps.length <= max) return listJoin(ps.map(personName));
  const rest = ps.length - (max - 1);
  return `${ps.slice(0, max - 1).map(personName).join(', ')} and ${rest} others`;
}

// ───────────────────────────── places ─────────────────────────────

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'] as const;

/** Compass direction from (x0, y0) to (x1, y1) (map y grows southward). */
export function compass(x0: number, y0: number, x1: number, y1: number): string {
  if (x0 === x1 && y0 === y1) return 'here';
  const a = Math.atan2(y1 - y0, x1 - x0);
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

const GATE_WORD = { praetoria: 'the Porta Praetoria', decumana: 'the Porta Decumana', principalisN: 'the north gate', principalisS: 'the south gate' } as const;

/** A place in words, generated from the survey: "by the north gate", "in the Praetentura", "12 paces east of the walls". */
export function placeName(s: GameState, tile: number): string {
  const sv = getMap(s.seed).survey;
  const x = tx(tile), y = ty(tile);
  for (const g of sv.gates) if (Math.max(Math.abs(tx(g.tile) - x), Math.abs(ty(g.tile) - y)) <= 4) return `by ${GATE_WORD[g.id]}`;
  if (distToRect(tile, sv.forum) === 0) return 'in the forum';
  const fx = sv.forum.x + (sv.forum.w - 1) / 2, fy = sv.forum.y + (sv.forum.h - 1) / 2;
  if (distToRect(tile, sv.interior) === 0) {
    const bid = sv.blockAt[tile];
    const blk = bid >= 0 ? sv.blocks[bid] : null;
    if (!blk || blk.district === 'latera') return `${compass(fx, fy, x, y)} of the forum`;
    return blk.district === 'praetentura' ? 'in the Praetentura' : 'in the Retentura';
  }
  const dir = compass(fx, fy, x, y);
  const bid = sv.blockAt[tile];
  const razed = s.urbs.razed !== null;
  if (bid >= 0 && sv.blocks[bid].ring === 3) return `on the old wall line to the ${dir}`;
  if (bid >= 0 && sv.blocks[bid].ring > 0) return `${razed ? 'in the outer city' : 'in the canabae'} to the ${dir}`;
  return `${int(distToRect(tile, sv.castrum))} paces ${dir} of ${razed ? 'the old camp' : 'the walls'}`;
}

/** The place of a building's top-left tile. */
export function buildingPlace(s: GameState, id: number): string {
  const b = getBuilding(s, id);
  return b ? placeName(s, b.y * getMap(s.seed).W + b.x) : 'beyond the walls';
}

// ───────────────────────────── markets ─────────────────────────────

/** The cheapest open market for a good on one side (buy = they sell to us), ties by trip days then hub order. */
export function bestHub(s: GameState, res: TradeRes, side: 'buy' | 'sell', qty: number): { hub: HubId; unit: number; days: number } | null {
  let best: { hub: HubId; unit: number; days: number } | null = null;
  for (const hub of HUBS) {
    if (!hubOpen(s, hub)) continue;
    const p = price(s, hub, res, side);
    if (p === null) continue;
    const d = tripDays(s, hub, qty);
    const better = !best || (side === 'buy' ? p < best.unit : p > best.unit) || (p === best.unit && d < best.days);
    if (better) best = { hub, unit: p, days: d };
  }
  return best;
}

/** A pre-filled import contract from the cheapest open market (null when no market sells it to us). */
export function importRemedy(s: GameState, res: TradeRes, qty: number): Remedy | null {
  const q = Math.max(1, Math.min(B.ordo.CARGO, Math.ceil(qty)));
  const h = bestHub(s, res, 'buy', q);
  if (!h) return null;
  const spec: ContractSpec = { hub: h.hub, mode: 'import', res, qty: q, repeat: false };
  return { kind: 'contract', spec };
}

/** A pre-filled export contract to the best-paying open market (null when nobody buys it). */
export function exportRemedy(s: GameState, res: TradeRes, qty: number): Remedy | null {
  const q = Math.max(1, Math.min(B.ordo.CARGO, Math.floor(qty)));
  const h = bestHub(s, res, 'sell', q);
  if (!h) return null;
  return { kind: 'contract', spec: { hub: h.hub, mode: 'export', res, qty: q, repeat: false } };
}

/** Keeps the first 1–3 remedies, dropping nulls (every rule offers at least one). */
export function three(...rs: (Remedy | null | false | undefined)[]): Remedy[] {
  const out: Remedy[] = [];
  for (const r of rs) if (r && out.length < 3) out.push(r);
  return out;
}

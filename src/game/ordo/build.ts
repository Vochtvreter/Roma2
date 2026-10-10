// src/game/ordo/build.ts — the Ordo's wish list, agenda, stakes and requests (ARCHITECTURE §8.4, DESIGN §10.3, §10.5). Owner: WP-C.
// The wish table is walked in order (Hearthlands take/ready/pending): the first unaffordable wish becomes *pending* — what
// the Ordo saves for — and a later wish goes ahead only if it can be paid from the stock above the saving target. Two kinds
// of wish may dip into that reserve so saving never deadlocks: a store the target cannot fit into, and the first producer
// of a good the target lacks. Survival wishes ignore the reserve, the treasury floor, the stake and the site limit.
// Never: demolish, move, convert, build in reserved blocks or blocks holding unfinished player works, place on future-ring
// blocks (canPlace for owner 'ordo'), raise a hortus or pave except under Urbs (or on request).
import { B as B$ } from '../balance';
import { NEEDS as NEEDS$, RESOURCES as RESOURCES$ } from '../types';
import type { BuildingId, Cost, CoverageLayerId, GameState, NeedId, Reason, ReasonCode, Rect, ResId, SimView, TickContext, WishView } from '../types';
import { dateOf as dateOf$, seasonLength as seasonLength$, seasonOf as seasonOf$ } from '../calendar';
import { addCost, canAfford, log, missing } from '../state';
import { getBuilding as getBuilding$ } from '../lookup';
import { memo as memo$, structEpoch as structEpoch$, dayEpoch as dayEpoch$, dayStruct as dayStruct$ } from '../memo';
import { settingValue } from '../decisions';
import { bestSlot } from '../site';
import { canPlace, pave, placeBuilding, placementCost, validSlots } from '../place';
import { desirability, houseDesir, previewCovered } from '../coverage';
import { buildingRateOf, maxPotential, seasonMult } from '../economy';
import { fxAdd as fxAdd$ } from '../fx';
import { idx as idx$, tx as tx$, ty as ty$ } from '../map';
import { BUILDING_DEFS as BUILDING_DEFS$ } from '../data/buildings';
import { TIER_DEFS as TIER_DEFS$ } from '../data/housing';
import { FOCUS_DEFS as FOCUS_DEFS$ } from '../data/decisions';
import { canSpend, capitoliumAhead, etaDays, floorOk, outputRates, partsCost, savingParts, treasuryFloor, type SavingPart } from './saving';
import { chronicle } from './chronicle';
import { houseWants as eachHouseWant } from '../advisors/util';
import { peopleIndex } from '../census';
import { classAt as classAt$, sizeOf as sizeOf$ } from '../derived';
import { rectGap as rectGap$ } from '../world/grid';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, NEEDS = NEEDS$, RESOURCES = RESOURCES$, dateOf = dateOf$, seasonLength = seasonLength$,
  seasonOf = seasonOf$, memo = memo$, structEpoch = structEpoch$, dayEpoch = dayEpoch$, dayStruct = dayStruct$,
  fxAdd = fxAdd$, idx = idx$, tx = tx$, ty = ty$, BUILDING_DEFS = BUILDING_DEFS$, TIER_DEFS = TIER_DEFS$,
  FOCUS_DEFS = FOCUS_DEFS$, classAt = classAt$, sizeOf = sizeOf$, rectGap = rectGap$,
  getBuilding = getBuilding$;

const LIST_MAX = 6;          // wishes the walk evaluates past the first ready one (Agenda + "would" ghost)
const COMING = B.ordo.COMING;                   // days ahead that "the coming season" means for survival food
const STREET_TILES = B.ordo.STREET_TILES;       // road tiles in one "busy street" paved under Urbs
const STORES_PER_RANK = B.ordo.STORES_PER_RANK; // horrea/apothecae for full stores ≤ 1 + rank × this
const FOOD: BuildingId[] = ['ager', 'venatio', 'pabulatio'];
const MATERIALS: ResId[] = ['timber', 'stone', 'tiles', 'concrete', 'ore', 'iron', 'tools', 'oil'];
const PRODUCER: Partial<Record<ResId, BuildingId>> = {
  timber: 'lignarius', stone: 'lapicidina', tiles: 'figlina', concrete: 'caementarium', ore: 'fodina', iron: 'officina', tools: 'fabrica', oil: 'olivetum',
};
/** The service the Ordo raises for a house need (DESIGN §10.5 row 6), and back. */
const SERVICE_FOR: Partial<Record<NeedId, BuildingId>> = { religion: 'lararium', market: 'taberna', temple: 'templum', macellum: 'macellum', baths: 'balneum' };
const NEED_OF: Partial<Record<BuildingId, NeedId>> = { lararium: 'religion', taberna: 'market', templum: 'temple', macellum: 'macellum', balneum: 'baths', puteus: 'water', lacus: 'water' };
/** Works each petition names outright (DESIGN §9.1), by the rank it grants. */
const PETITION_WORKS: BuildingId[][] = [[], ['horreum'], [], ['templum', 'macellum', 'balneum'], ['castellum', 'thermae', 'theatrum']];

/** A wish: a type at the Ordo's slot, what it costs, why, and how it may spend. */
export interface Wish { type: BuildingId; tile: number; cost: Cost; reason: Reason; survival: boolean; unblock: boolean }
/** The walked wish list: entries with states, the first ready wish (`take`) and the one being saved for (`pending`). */
export interface Walk { list: { wish: Wish; state: 'saving' | 'waiting' | 'proposed'; lacking?: Cost }[]; take: Wish | null; pending: Wish | null }
/** What the houses want: first unmet needs by count and by house, renovation materials of houses ready to rise, T3 houses short of a domus, T4 residents. */
export interface HouseWants { want: Partial<Record<NeedId, number>>; first: Record<number, NeedId>; renov: Cost; t3Low: number; t4Res: number; domusRes: number }

/** The houses' wants (memo on day + epochs + the fed gate). Each house's next tier and unmet needs come from the
 *  advisors' list, which is memoised on everything those read (advisors/util houseWants), not recomputed daily. */
export function houseWants(s: GameState, v: SimView): HouseWants {
  return memo(s, 'ordo.houses', dayEpoch(s) * 2 + (s.fed >= B.needs.FED_MIN ? 1 : 0), () => {
    // the same as the last reckoning while the advisors' list, the homes, the desirability and every listed house's
    // renovation stand (the list itself is kept on everything else these read: tiers, preferences, coverage, fed, rank)
    const list = eachHouseWant(s, v);
    const byHome = peopleIndex(s).byHome;
    const desir = desirability(s);
    const last = houseWantsLast.get(s);
    if (last && last.list === list && last.byHome === byHome && last.desir === desir && sameRenovating(s, list, last.renovating)) return last.value;
    const value = reckonHouseWants(s, list, byHome);
    houseWantsLast.set(s, { list, byHome, desir, renovating: list.map((w) => !!getBuilding(s, w.id)?.house?.renovating), value });
    return value;
  });
}

const houseWantsLast = new WeakMap<GameState, { list: unknown; byHome: unknown; desir: unknown; renovating: boolean[]; value: HouseWants }>();

function sameRenovating(s: GameState, list: readonly { id: number }[], was: readonly boolean[]): boolean {
  for (let k = 0; k < list.length; k++) if (!!getBuilding(s, list[k].id)?.house?.renovating !== was[k]) return false;
  return true;
}

function reckonHouseWants(s: GameState, list: ReturnType<typeof eachHouseWant>, byHome: ReturnType<typeof peopleIndex>['byHome']): HouseWants {
  {
    const out: HouseWants = { want: {}, first: {}, renov: {}, t3Low: 0, t4Res: 0, domusRes: 0 };
    for (const w of list) {
      const b = getBuilding(s, w.id);
      if (!b?.house || !w.next) continue;
      if (w.unmet.length > 0) { out.want[w.unmet[0]] = (out.want[w.unmet[0]] ?? 0) + 1; out.first[w.id] = w.unmet[0]; }
      else if (!b.house.renovating) out.renov = addCost(out.renov, TIER_DEFS[w.next].renovation);
      if (b.house.tier === 'domusParva' && b.house.pref !== 'insula' && houseDesir(s, w.id) < B.housing.DESIR_DOMUS) out.t3Low++;
    }
    for (const [home, residents] of byHome) {   // residents per home (census index) rather than a lookup per person
      const tier = getBuilding(s, home)?.house?.tier;
      if (tier === 'insula' || tier === 'domus') out.t4Res += residents.length;
      if (tier === 'domus') out.domusRes += residents.length;
    }
    return out;
  }
}

/** The Ordo's slot for a type: A's best slot (validSlots for owner 'ordo' already keeps off reserved blocks and blocks
 *  holding a player plan or unfinished player site). Chosen once a day per structure: the wish walk runs again after
 *  every change of jobs or people, and a full scoring pass each time cost more than the whole rest of the Ordo. */
export function ordoSlot(s: GameState, type: BuildingId, purpose: ReasonCode): number | null {
  return memo(s, `ordo.slot.${type}.${purpose}`, dayStruct(s), () =>
    bestSlot(s, type, { owner: 'ordo', purpose })?.tile ?? null);
}

/** The lowest valid Ordo slot of a type (memo on structure and day, like A's validSlots). The walk asks only whether a
 *  wish has a slot and what it costs (tile-independent except a castellum's route); the best slot — a full scoring
 *  pass of every valid slot — is searched only when the wish is placed or shown (lazyTile). */
function anyOpenSlot(s: GameState, type: BuildingId): number | null {
  const slots = validSlots(s, type, 'ordo');
  let pick = lowestSlot.get(slots);   // the lowest key of a slot map, kept per map (validSlots keeps its map per layout)
  if (pick === undefined) {
    pick = null;
    for (const tile of slots.keys()) if (pick === null || tile < pick) pick = tile;
    lowestSlot.set(slots, pick);
  }
  return pick;
}
const lowestSlot = new WeakMap<Map<number, number>, number | null>();

/** Defines `tile` on an object as a getter resolved (and kept) on first read. */
function lazyTile<T extends object>(o: T, resolve: () => number): T & { tile: number } {
  let tile: number | undefined;
  return Object.defineProperty(o, 'tile', { get: () => (tile ??= resolve()), enumerable: true, configurable: true }) as T & { tile: number };
}

/** What the saving target, a pending wish, waiting renovations and the Capitolium's next month still lack, and for whom. */
export function needsFor(s: GameState, v: SimView, pending: Wish | null): { lack: Cost; forOf: Partial<Record<ResId, string>> } {
  const sources: [string, Cost][] = savingParts(s, v).map((p): [string, Cost] => [p.type ?? p.kind, p.cost]);
  if (pending) sources.push([pending.type, pending.cost]);
  sources.push(['capitolium', capitoliumAhead(s)], ['renovation', houseWants(s, v).renov]);
  let total: Cost = {};
  const forOf: Partial<Record<ResId, string>> = {};
  for (const [who, cost] of sources) {
    total = addCost(total, cost);
    for (const r of RESOURCES) if ((cost[r] ?? 0) > 0 && forOf[r] === undefined) forOf[r] = who;
  }
  return { lack: missing(s, total), forOf };
}

/** The current material needs (with today's pending wish). */
export function materialNeeds(s: GameState, v: SimView): { lack: Cost; forOf: Partial<Record<ResId, string>> } {
  return needsFor(s, v, walkWishes(s, v).pending);
}

const unfinished = (v: SimView, t: BuildingId): boolean => (v.d.all[t] ?? 0) > (v.d.counts[t] ?? 0);

/** The DESIGN §10.5 wish table in order, lazily (each row checks rank, max count, one site of a kind, and a slot). */
function* rows(s: GameState, v: SimView, walk: { pending: Wish | null }): Generator<Wish> {
  const { c, d, f } = v;
  const seen = new Set<BuildingId>();
  const make = (type: BuildingId, code: ReasonCode, params: Reason['params'] = {}, o: { survival?: boolean; unblock?: boolean; again?: boolean; store?: boolean; serves?: NeedId } = {}): Wish | null => {
    const def = BUILDING_DEFS[type];
    if (seen.has(type) || def.rank > s.rank) return null;
    if (type === 'hortus' && s.decisions.focus !== 'urbs') return null;
    if (def.maxCount !== undefined && (d.all[type] ?? 0) >= def.maxCount) return null;
    if (!o.again && unfinished(v, type)) return null;
    // a service's reach and a castellum's route cost are measured at the best slot; any other row only needs a slot.
    // A service no valid slot brings to a single waiting house reaches none from the best slot either: the row is
    // dropped before the slot search (unless its cost overflows a store, which asks for the store first).
    if (o.serves !== undefined && !overCap(s, c.caps, type) && !anyReach(s, v, type, o.serves)) return null;
    const exact = o.serves !== undefined || type === 'castellum';
    const tile = exact ? ordoSlot(s, type, code) : anyOpenSlot(s, type);
    const chk = tile === null ? null : canPlace(s, type, tile, { owner: 'ordo', ignoreCost: true });
    if (tile === null || !chk?.ok) return null;
    const over = RESOURCES.find((r) => (chk.cost[r] ?? 0) > c.caps[r]);
    if (over && !o.store) return store(over, type);
    const reach = o.serves ? reaches(s, v, type, tile, o.serves) : 0;
    if (o.serves && reach === 0) return null;
    seen.add(type);
    const p = o.serves ? { type, ...params, reach } : { type, ...params };
    const wish = { type, cost: chk.cost, reason: { code, params: p }, survival: !!o.survival, unblock: !!o.unblock };
    return exact ? { ...wish, tile } : lazyTile(wish, () => ordoSlot(s, type, code) ?? tile);
  };
  const store = (r: ResId, forWhat?: string): Wish | null => {
    const t: BuildingId = r === 'grain' ? 'horreum' : r === 'water' ? 'cisterna' : 'apotheca';
    const params: Reason['params'] = { res: r, pct: Math.round((100 * s.res[r]) / Math.max(1, c.caps[r])) };
    if (forWhat) params.for = forWhat;
    return make(t, 'storageFull', params, { unblock: forWhat !== undefined, store: true });
  };
  const yieldOf = function* (w: Wish | null): Generator<Wish> { if (w) yield w; };
  // 0 · the saving target must fit our stores
  const parts = savingParts(s, v);
  const target = partsCost(parts);
  for (const r of RESOURCES) if (r !== 'denarii' && (target[r] ?? 0) > c.caps[r]) yield* yieldOf(store(r, parts[0].type ?? parts[0].kind));
  // 1 · survival: even every hand cannot refill the stores
  const coming = seasonOf(s.day + COMING);
  if (f.grain.structural && f.grain.doh < B.ordo.SURVIVAL_DOH && !FOOD.some((t) => unfinished(v, t)) && foodSlotsShort(s, v)) {
    const best = FOOD.slice().sort((a, b) => perWorker(s, b, coming) - perWorker(s, a, coming));
    for (const t of best) { const w = make(t, 'survivalFood', { doh: Math.floor(f.grain.doh) }, { survival: true }); if (w) { yield w; break; } }
  }
  if (f.water.structural && f.water.doh < B.ordo.SURVIVAL_DOH) {
    const p = { doh: Math.floor(f.water.doh) };
    yield* yieldOf(make('puteus', 'survivalWater', p, { survival: true }) ?? make('cisterna', 'survivalWater', p, { survival: true }));
  }
  // 2 · Aestas: the summer forecast falls below the water reserve
  const wr = settingValue(s, 'waterReserve');
  const wc = f.water.crunch;
  if (wc && wc.startsIn <= B.advisors.RULES.AESTAS_LEAD && wc.lowestDoh < wr && !unfinished(v, 'cisterna') && !unfinished(v, 'puteus')) {
    const deficit = f.water.cons - maxPotential(s, 'water', 1);
    const helps = deficit <= 0 || deficit * seasonLength(s.day + wc.startsIn) <= f.water.cap + (BUILDING_DEFS.cisterna.storage?.water ?? 0);
    yield* yieldOf(make(helps ? 'cisterna' : 'puteus', 'aestasWater', { days: wc.startsIn, low: Math.floor(wc.lowestDoh), keep: wr }));
  }
  // 3 · Hiems store, then stores that are full
  const gr = settingValue(s, 'grainReserve');
  const gc = f.grain.crunch;
  if (gc && gc.startsIn <= B.advisors.RULES.HIEMS_LEAD && (gc.lowestDoh < 1 || gc.needInStore > f.grain.cap)) {
    yield* yieldOf(make('horreum', 'hiemsStore', { days: gc.startsIn, hold: Math.floor(f.grain.cap / Math.max(1e-6, f.grain.need)), keep: gr }));
  }
  for (const r of ['grain', ...MATERIALS, 'wine'] as ResId[]) {
    const t = r === 'grain' ? 'horreum' : 'apotheca';
    if (s.res[r] >= B.ordo.STORE_FULL * c.caps[r] && (d.all[t] ?? 0) < 1 + s.rank * STORES_PER_RANK) yield* yieldOf(store(r));
  }
  // 4 · beds for newcomers while Rome's roll allows
  const planned = ((d.all.area ?? 0) - (d.counts.area ?? 0)) * (TIER_DEFS.tentoria.beds + fxAdd(s, 'lowCap'));
  const keep = settingValue(s, 'spareBeds') + (s.decisions.focus === 'copia' ? B.ordo.FOCUS.COPIA_BEDS : 0);
  if (c.freeBeds + planned < keep && c.pop < c.roll) yield* yieldOf(make('area', 'beds', { free: c.freeBeds + planned, keep }, { again: true }));
  // 5 · water within reach of the homes that lack it
  const hw = houseWants(s, v);
  const dry = hw.want.water ?? 0;
  if (dry >= B.ordo.EVOLVE_MIN) yield* yieldOf(make(d.castellumActive && BUILDING_DEFS.lacus.rank <= s.rank ? 'lacus' : 'puteus', 'waterAccess', { n: dry }, { serves: 'water' }));
  // 6 · the service most homes wait for (baths beyond the first are left to the player)
  const wants = (Object.keys(SERVICE_FOR) as NeedId[]).filter((n) => (hw.want[n] ?? 0) > 0)
    .sort((a, b) => (hw.want[b] ?? 0) - (hw.want[a] ?? 0) || NEEDS.indexOf(a) - NEEDS.indexOf(b));
  for (const n of wants) {
    const t = SERVICE_FOR[n] as BuildingId;
    const min = BUILDING_DEFS[t].place.includes('block') ? B.ordo.EVOLVE_MIN_BLOCK : B.ordo.EVOLVE_MIN;
    if ((hw.want[n] ?? 0) < min || (n === 'baths' && (d.all.balneum ?? 0) + (d.all.thermae ?? 0) > 0)) continue;
    yield* yieldOf(make(t, 'evolve', { n: hw.want[n] ?? 0, want: n }, { serves: n }));
  }
  // 7 · works the next petition names (the Vicus petition only once the Lex coloniae is proclaimed)
  if (s.rank > 0 || s.decisions.paths.charter !== undefined) {
    for (const t of PETITION_WORKS[s.rank + 1] ?? []) if (!d.all[t]) yield* yieldOf(make(t, 'rank', { rank: s.rank + 1 }));
  }
  // 8 · producers of what the saving target, the pending wish, renovations or the Capitolium lack (ETA > 30 days),
  //     then of whatever those producers themselves lack (a quarry short of timber calls for a lumber camp)
  const { lack, forOf } = needsFor(s, v, walk.pending);
  const queue: { r: ResId; q: number; for: string }[] = MATERIALS.filter((r) => (lack[r] ?? 0) > 0).map((r) => ({ r, q: lack[r] ?? 0, for: forOf[r] ?? 'wish' }));
  const full = queue.length > 0 ? outputRates(s, 'full') : {};   // the producers' full rates matter only when something is lacking
  const asked = new Set<ResId>();
  for (let k = 0; k < queue.length; k++) {
    const { r, q } = queue[k];
    const eta = (full[r] ?? 0) > 0 ? q / (full[r] as number) : Infinity;
    if (asked.has(r) || eta <= B.ordo.MATERIALS_ETA) continue;
    asked.add(r);
    const own = PRODUCER[r] as BuildingId;
    const feed = RESOURCES.find((r2) => (BUILDING_DEFS[own].inputs?.[r2] ?? 0) > 0 && !((full[r2] ?? 0) > 0) && PRODUCER[r2]);
    const params: Reason['params'] = { res: r, qty: Math.ceil(q), for: queue[k].for };
    if (Number.isFinite(eta)) params.eta = Math.ceil(eta);
    const w = make(feed ? PRODUCER[feed] as BuildingId : own, queue[k].for === 'capitolium' ? 'capitolium' : 'materials', params, { unblock: !d.all[own] });
    if (!w) continue;
    yield w;
    const short = missing(s, w.cost);
    for (const r2 of MATERIALS) if ((short[r2] ?? 0) > 0) queue.push({ r: r2, q: short[r2] ?? 0, for: w.type });
  }
  // 9 · oil for the great houses
  if (BUILDING_DEFS.olivetum.rank <= s.rank && hw.t4Res * B.housing.GOODS.oil > olivePotential(s)) yield* yieldOf(make('olivetum', 'luxury', { res: 'oil' }));
  // 10 · the council focus's build plan; 11 · beauty under Urbs
  const focus = s.decisions.focus;
  for (const [t, n] of FOCUS_DEFS[focus].plan) if ((d.all[t] ?? 0) < n) yield* yieldOf(make(t, 'focusPlan', { focus }));
  if (focus === 'urbs' && hw.t3Low > 0) yield* yieldOf(make('hortus', 'beauty', { n: hw.t3Low }));
}

/** A work's cost (any slot but a castellum's) exceeds a store cap. */
function overCap(s: GameState, caps: Record<ResId, number>, type: BuildingId): boolean {
  const cost = placementCost(s, type, 0);
  return RESOURCES.some((r) => (cost[r] ?? 0) > caps[r]);
}

/** Some valid Ordo slot of `type` would cover a house whose first want is `need` (the cached coverage previews). A slot
 *  covers road tiles within its radius in steps of its sides, and a house only through a road tile beside it, so a slot
 *  farther than radius + 2 (Chebyshev) from every waiting house cannot reach one: its preview is not needed. */
function anyReach(s: GameState, v: SimView, type: BuildingId, need: NeedId): boolean {
  const first = houseWants(s, v).first;
  const waiting: Rect[] = [];
  for (const id of v.d.houses) {
    if (first[id] !== need) continue;
    const b = getBuilding(s, id);
    if (!b) continue;
    const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
    waiting.push({ x: b.x, y: b.y, w, h });
  }
  if (waiting.length === 0) return false;
  let reach = 0;
  for (const sv of BUILDING_DEFS[type].service ?? []) {
    const bonus = RADIUS_BONUS[sv.layer];
    reach = Math.max(reach, sv.radius + (bonus ? fxAdd(s, bonus) : 0));
  }
  reach += 2;
  for (const tile of validSlots(s, type, 'ordo').keys()) {
    const x = tx(tile), y = ty(tile);
    const [w, h] = sizeOf(type, classAt(s, type, x, y));
    const r: Rect = { x, y, w, h };
    if (!waiting.some((hr) => rectGap(r, hr) <= reach)) continue;
    for (const layer of previewCovered(s, type, x, y)) for (const hid of layer.houses) if (first[hid] === need) return true;
  }
  return false;
}
/** Path radius bonus per coverage layer (as coverage.ts applies it to previews). */
const RADIUS_BONUS: Partial<Record<CoverageLayerId, 'shrineRadius' | 'marketRadius' | 'bathsRadius'>> = {
  shrine: 'shrineRadius', temple: 'shrineRadius', market: 'marketRadius', macellum: 'marketRadius', baths: 'bathsRadius',
};

/** Houses waiting for `need` that a work of `type` at `tile` would cover (A's coverage preview, fully staffed). */
function reaches(s: GameState, v: SimView, type: BuildingId, tile: number, need: NeedId): number {
  const first = houseWants(s, v).first;
  const covered = new Set<number>();
  for (const layer of previewCovered(s, type, tx(tile), ty(tile))) for (const h of layer.houses) if (first[h] === need) covered.add(h);
  return covered.size;
}

function perWorker(s: GameState, t: BuildingId, season: ReturnType<typeof seasonOf>): number {
  return (BUILDING_DEFS[t].output?.perWorker ?? 0) * seasonMult(s, t, season);
}

/** Grain-producing slots are what binds: fewer than the hungry food cap of the workforce. */
function foodSlotsShort(s: GameState, v: SimView): boolean {
  let slots = 0;
  for (const b of s.buildings) if (b.status === 'done' && b.open && BUILDING_DEFS[b.type].output?.res === 'grain') slots += BUILDING_DEFS[b.type].slots;
  return slots < Math.floor(v.c.workforce * B.ordo.FOOD_CAP_HUNGRY);
}

/** Oil the groves press per day with every slot filled, averaged over the year. */
function olivePotential(s: GameState): number {
  let oil = 0;
  for (const b of s.buildings) if (b.type === 'olivetum' && b.status === 'done') for (let k = 0; k < 4; k++) oil += buildingRateOf(s, b, k as 0, 'full', 'oil') / 4;
  return oil;
}

/** A wish's cost with the treasury floor added to its denarii (what must be in the aerarium before it may be paid). */
function withFloor(s: GameState, w: Wish): Cost {
  const den = w.cost.denarii ?? 0;
  return den > 0 && !w.survival ? { ...w.cost, denarii: den + treasuryFloor(s) } : w.cost;
}

/** Walks the wish table: the council's session (DESIGN §10.5). The walk is made once a day, at the council's sitting
 *  (runOrdo's labour plan reads it first), and made again only when the works change (a placement, a completion) or
 *  the player's orders do; the stock and the people of that hour decide it for the rest of the day, so the saving
 *  target the renovations, the trade and the Capitolium respect is the one the council set (memo on day, structure
 *  epoch and the player's orders and settings). */
export function walkWishes(s: GameState, v: SimView): Walk {
  const key = [s.day, structEpoch(s), s.ordo.pin,
    JSON.stringify(s.ordo.requests), s.decisions.focus, JSON.stringify(s.decisions.settings), JSON.stringify(s.decisions.paths)].join('|');
  return memo(s, 'ordo.walk', key, () => {
    const base = addCost(partsCost(savingParts(s, v)), capitoliumAhead(s));
    const out: Walk = { list: [], take: null, pending: null };
    for (const w of rows(s, v, out)) {
      const held = out.pending ? addCost(base, out.pending.cost) : base;
      const ok = w.survival ? canAfford(s, w.cost) : w.unblock ? canAfford(s, w.cost) && floorOk(s, w.cost) : canAfford(s, w.cost, held) && floorOk(s, w.cost);
      if (ok) {
        out.list.push({ wish: w, state: 'proposed' });
        out.take ??= w;
      } else if (!out.pending && !out.take) {
        out.pending = w;
        out.list.push({ wish: w, state: 'saving', lacking: missing(s, withFloor(s, w), w.survival || w.unblock ? undefined : base) });
      } else {
        out.list.push({ wish: w, state: 'waiting', lacking: missing(s, withFloor(s, w), held) });
      }
      if (out.take && out.list.length >= LIST_MAX) break;
    }
    return out;
  });
}

/** Unfinished Ordo sites (the Capitolium is extra). */
export function ordoSites(s: GameState): number {
  return s.buildings.filter((b) => b.owner === 'ordo' && b.status !== 'done' && b.type !== 'capitolium').length;
}

/** Concurrent Ordo sites allowed: 1 + workforce / SITES_PER, at most SITES_MAX. */
export function maxSites(v: SimView): number {
  return Math.min(B.ordo.SITES_MAX, 1 + Math.floor(v.c.workforce / B.ordo.SITES_PER));
}

/** Every 2nd day: places the first ready wish (staked 5 days unless survival) within the site limit; Urbs paves on the month's first build day. */
export function ordoBuild(s: GameState, ctx: TickContext, v: SimView): void {
  const decided = ctx.offline && !s.ordo.on.build;
  if (s.decisions.focus === 'urbs' && dateOf(s.day).day <= B.ordo.BUILD_EVERY) paveBusyStreets(s, v, decided);
  const walk = walkWishes(s, v);
  const full = ordoSites(s) >= maxSites(v);
  const w = full ? walk.list.find((e) => e.state === 'proposed' && e.wish.survival)?.wish : walk.take;
  if (!w) return;
  const r = placeBuilding(s, w.type, w.tile, { owner: 'ordo', reason: w.reason, noStake: w.survival });
  if (!r.ok) return;
  if (r.id !== undefined) ctx.fx.push({ kind: 'ordoPlaced', id: r.id });
  chronicle(s, 'ordo', w.reason, { ref: r.id, decided });
}

/** Urbs: paves the busiest dirt streets nearest the forum, URBS_PAVE streets a month, from unreserved stone. */
function paveBusyStreets(s: GameState, v: SimView, decided: boolean): void {
  const { d } = v;
  const tiles = s.roads.filter((i) => d.road[i] === 1 && d.pomerium[i] === 1 && d.stepsToForum[i] >= 0)
    .sort((a, b) => d.stepsToForum[a] - d.stepsToForum[b] || a - b).slice(0, B.ordo.FOCUS.URBS_PAVE * STREET_TILES);
  if (tiles.length === 0 || !canSpend(s, { stone: tiles.length * B.map.PAVE_STONE }, v)) return;
  if (pave(s, tiles).ok) log(s, 'ordo', `For the city beautiful the Ordo paves ${tiles.length} paces of our busiest streets.`, decided ? ['decided'] : undefined);
}

/** Places the pin, then the requests, as player sites (no stake, fx ordoPlaced), each from stock above the orders ahead of it. */
export function processRequests(s: GameState, ctx: TickContext, v: SimView): void {
  let above: Cost = {};
  const done: SavingPart[] = [];
  for (const part of savingParts(s, v)) {
    if ((part.kind === 'pin' || part.kind === 'request') && raise(s, ctx, v, part, above)) done.push(part);
    else above = addCost(above, part.cost);
  }
  if (done.some((p) => p.kind === 'pin')) s.ordo.pin = null;
  const reqs = done.map((p) => p.req);
  if (reqs.some((r) => r !== undefined)) s.ordo.requests = s.ordo.requests.filter((r) => !reqs.includes(r));
}

/** Raises one ordered work if a slot and the stock allow; true when the order is settled (placed, or impossible: max count). */
function raise(s: GameState, ctx: TickContext, v: SimView, part: SavingPart, above: Cost): boolean {
  const type = part.type as BuildingId;
  const def = BUILDING_DEFS[type];
  if (def.maxCount !== undefined && (v.d.all[type] ?? 0) >= def.maxCount) {
    log(s, 'ordo', `The Ordo cannot raise another ${def.name.toLowerCase()}: only ${def.maxCount} may stand.`);
    return true;
  }
  const code: ReasonCode = part.kind === 'pin' ? 'pin' : 'request';
  // the cost is the same on any slot (but a castellum's route), so the best slot is searched only once it is affordable
  const any = def.rank > s.rank ? null : type === 'castellum' ? ordoSlot(s, type, code) : anyOpenSlot(s, type);
  const pre = any === null ? null : canPlace(s, type, any, { owner: 'ordo', ignoreCost: true });
  if (any === null || !pre?.ok || !canAfford(s, pre.cost, above) || !floorOk(s, pre.cost)) return false;
  const tile = type === 'castellum' ? any : ordoSlot(s, type, code);
  const chk = tile === null ? null : canPlace(s, type, tile, { owner: 'ordo', ignoreCost: true });
  if (tile === null || !chk?.ok) return false;
  const need = NEED_OF[type];
  const n = need ? houseWants(s, v).want[need] ?? 0 : 0;
  const reason: Reason = { code, params: need && n > 0 ? { type, n, want: need } : { type } };
  const r = placeBuilding(s, type, tile, { owner: 'player', noStake: true, reason });
  if (!r.ok) return false;
  if (r.id !== undefined) ctx.fx.push({ kind: 'ordoPlaced', id: r.id });
  chronicle(s, 'ordo', reason, { ref: r.id });
  return true;
}

/** The next `n` wishes not yet placed, with states (concurrency full → ready wishes wait), lacking goods and ETA. */
export function newWishes(s: GameState, v: SimView, n: number): WishView[] {
  const full = ordoSites(s) >= maxSites(v);
  const out: WishView[] = [];
  for (const e of walkWishes(s, v).list) {
    if (out.length >= n) break;
    const wish = e.wish;
    const w: WishView = lazyTile({ type: wish.type, state: e.state === 'proposed' && full && !wish.survival ? 'waiting' : e.state, reason: wish.reason }, () => wish.tile);
    if (e.lacking && RESOURCES.some((r) => (e.lacking?.[r] ?? 0) > 0)) {
      w.lacking = e.lacking;
      const eta = etaDays(s, v, e.lacking);
      if (eta !== null) w.eta = eta;
    }
    out.push(w);
  }
  return out;
}

/** The first `n` wishes with state and reason (pure): works in hand first (staked, building), then the wish list. */
export function wishList(s: GameState, v: SimView, n: number): WishView[] {
  const out: WishView[] = [];
  const builders = Math.max(1, v.c.catStaffed.builders);
  for (const id of v.d.sites) {
    const b = getBuilding(s, id);
    if (out.length >= n) return out;
    if (!b || b.type === 'capitolium' || b.status === 'plan') continue;
    if (b.owner !== 'ordo' && b.reason?.code !== 'request' && b.reason?.code !== 'pin') continue;
    const staked = b.status === 'staked';
    out.push({
      type: b.type, state: staked ? 'staked' : 'building', siteId: b.id, tile: idx(b.x, b.y),
      reason: b.reason ?? { code: 'focusPlan', params: { type: b.type, focus: s.decisions.focus } },
      eta: staked ? Math.max(0, B.construction.STAKE_DAYS - (s.day - b.placed)) : Math.ceil((b.work * (1 - b.progress)) / builders),
    });
  }
  return out.concat(newWishes(s, v, n - out.length));
}


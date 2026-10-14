// src/game/ordo/build.ts — the Ordo's wish list, agenda, stakes and requests (ARCHITECTURE §8.4, DESIGN §10.3, §10.5). Owner: WP-C.
// The wish table is walked in order (Hearthlands take/ready/pending): the first unaffordable wish becomes *pending* — what
// the Ordo saves for — and a later wish goes ahead only if it can be paid from the stock above the saving target. Two kinds
// of wish may dip into that reserve so saving never deadlocks: a store the target cannot fit into, and the first producer
// of a good the target lacks. Survival wishes ignore the reserve, the treasury floor, the stake and the site limit.
// Never: demolish, move or convert the player's works, build in reserved blocks or blocks holding unfinished player works,
// place on future-ring blocks (canPlace for owner 'ordo'), raise a hortus or pave except under Urbs (or on request). Its
// one renewal here: a block-sized service no free block can bring to the homes waiting for it goes where a block of its
// own homes is bought out, every family rehoused (urbs.ts, DESIGN §3.9).
import { B as B$ } from '../balance';
import { NEEDS as NEEDS$, RESOURCES as RESOURCES$ } from '../types';
import type { BuildingId, Cost, GameState, NeedId, Reason, ReasonCode, Rect, ResId, SimView, TickContext, WishView } from '../types';
import { dateOf as dateOf$, seasonOf as seasonOf$ } from '../calendar';
import { NEVER, addCost, canAfford, log, missing } from '../state';
import { getBuilding as getBuilding$ } from '../lookup';
import { memo as memo$, structEpoch as structEpoch$, dayEpoch as dayEpoch$, dayStruct as dayStruct$, layoutEpoch as layoutEpoch$ } from '../memo';
import { settingValue } from '../decisions';
import { sectionRevealed } from '../reveal';
import { bestSlot, siteScore } from '../site';
import { canPlace, pave, placeBuilding, placementCost, validSlots } from '../place';
import { desirability, houseDesir, houseHas, previewCovered } from '../coverage';
import { buildingRateOf, seasonMult } from '../economy';
import { fxAdd as fxAdd$ } from '../fx';
import { idx as idx$, tx as tx$, ty as ty$ } from '../map';
import { BUILDING_DEFS as BUILDING_DEFS$ } from '../data/buildings';
import { TIER_DEFS as TIER_DEFS$ } from '../data/housing';
import { FOCUS_DEFS as FOCUS_DEFS$ } from '../data/decisions';
import { canSpend, capitoliumAhead, etaDays, floorOk, fullRate, ordersOf, outputRates, partsCost, savingParts, treasuryFloor, type SavingPart } from './saving';
import { chronicle } from './chronicle';
import { aestasWork } from './water';
import { houseWants as eachHouseWant, liftSlot, serveSlot } from '../advisors/util';
import { goodsPlan } from './goods';
import { maskAllows, walkMask } from './duties';
import { busiestDirt, buyOut, cottageBlock, renewalReason } from '../urbs';
import { view } from '../sim';
import { classAt as classAt$, derived, sizeOf as sizeOf$ } from '../derived';
import { getMap } from '../map';
import { isActiveBlock, isRazed } from '../survey';
import { rectGap as rectGap$ } from '../world/grid';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, NEEDS = NEEDS$, RESOURCES = RESOURCES$, dateOf = dateOf$,
  seasonOf = seasonOf$, memo = memo$, structEpoch = structEpoch$, dayEpoch = dayEpoch$, dayStruct = dayStruct$,
  layoutEpoch = layoutEpoch$,
  fxAdd = fxAdd$, idx = idx$, tx = tx$, ty = ty$, BUILDING_DEFS = BUILDING_DEFS$, TIER_DEFS = TIER_DEFS$,
  FOCUS_DEFS = FOCUS_DEFS$, classAt = classAt$, sizeOf = sizeOf$, rectGap = rectGap$,
  getBuilding = getBuilding$;

const LIST_MAX = 6;          // wishes the walk evaluates past the first ready one (Agenda + "would" ghost)
const COMING = B.ordo.COMING;                   // days ahead that "the coming season" means for survival food
const STREET_TILES = B.ordo.STREET_TILES;       // road tiles in one "busy street" paved under Urbs
const STORES_PER_RANK = B.ordo.STORES_PER_RANK; // horrea/apothecae for full stores ≤ 1 + rank × this
const STORE_RESERVE = B.ordo.STORE_RESERVE;     // …and horrea beyond it while grain capacity < this × the grain reserve
const FOOD: BuildingId[] = ['ager', 'venatio', 'pabulatio'];
const MATERIALS: ResId[] = ['timber', 'stone', 'tiles', 'concrete', 'ore', 'iron', 'tools', 'oil'];
const PRODUCER: Partial<Record<ResId, BuildingId>> = {
  timber: 'lignarius', stone: 'lapicidina', tiles: 'figlina', concrete: 'caementarium', ore: 'fodina', iron: 'officina', tools: 'fabrica', oil: 'olivetum',
};
/** The service the Ordo raises for a house need (DESIGN §10.5 row 6), and back. */
const SERVICE_FOR: Partial<Record<NeedId, BuildingId>> = { religion: 'lararium', market: 'taberna', temple: 'templum', macellum: 'macellum', baths: 'balneum' };
const NEED_OF: Partial<Record<BuildingId, NeedId>> = { lararium: 'religion', taberna: 'market', templum: 'temple', macellum: 'macellum', balneum: 'baths', thermae: 'baths', puteus: 'water', lacus: 'water' };
/** Works each petition names outright (DESIGN §9.1), by the rank it grants. */
const PETITION_WORKS: BuildingId[][] = [[], ['horreum'], [], ['templum', 'macellum', 'balneum'], ['castellum', 'thermae', 'theatrum']];

/** A wish: a type at the Ordo's slot, what it costs, why, and how it may spend. */
export interface Wish {
  type: BuildingId; tile: number; cost: Cost; reason: Reason; survival: boolean; unblock: boolean; renew?: number[];
  revive?: ResId;   // a producer of a good whose own producers have run dry (a lumber camp whose woods are felled)
}
/** The walked wish list: entries with states, the first ready wish (`take`) and the one being saved for (`pending`). */
export interface Walk { list: { wish: Wish; state: 'saving' | 'waiting' | 'proposed'; lacking?: Cost }[]; take: Wish | null; pending: Wish | null }
/** What the houses want: first unmet needs by count and by house, renovation materials of houses ready to rise, T3 houses short of a domus. */
export interface HouseWants { want: Partial<Record<NeedId, number>>; first: Map<number, NeedId>; renov: Cost; t3Low: number }

/** The houses' wants (memo on day + epochs + the fed gate). Each house's next tier and unmet needs come from the
 *  advisors' list, which is memoised on everything those read (advisors/util houseWants), not recomputed daily. */
export function houseWants(s: GameState, v: SimView): HouseWants {
  return memo(s, 'ordo.houses', dayEpoch(s) * 2 + (s.fed >= B.needs.FED_MIN ? 1 : 0), () => {
    // the same as the last reckoning while the advisors' list, the homes, the desirability and every listed house's
    // renovation stand (the list itself is kept on everything else these read: tiers, preferences, coverage, fed, rank)
    const list = eachHouseWant(s, v);
    const desir = desirability(s);
    const last = houseWantsLast.get(s);
    if (last && last.list === list && last.desir === desir && sameRenovating(s, list, last.renovating)) return last.value;
    const value = reckonHouseWants(s, list);
    houseWantsLast.set(s, { list, desir, renovating: list.map((w) => !!getBuilding(s, w.id)?.house?.renovating), value });
    return value;
  });
}

const houseWantsLast = new WeakMap<GameState, { list: unknown; desir: unknown; renovating: boolean[]; value: HouseWants }>();

function sameRenovating(s: GameState, list: readonly { id: number }[], was: readonly boolean[]): boolean {
  for (let k = 0; k < list.length; k++) if (!!getBuilding(s, list[k].id)?.house?.renovating !== was[k]) return false;
  return true;
}

function reckonHouseWants(s: GameState, list: ReturnType<typeof eachHouseWant>): HouseWants {
  {
    const out: HouseWants = { want: {}, first: new Map(), renov: {}, t3Low: 0 };
    for (const w of list) {
      const b = getBuilding(s, w.id);
      if (!b?.house || !w.next) continue;
      if (w.unmet.length > 0) { out.want[w.unmet[0]] = (out.want[w.unmet[0]] ?? 0) + 1; out.first.set(w.id, w.unmet[0]); }
      else if (!b.house.renovating) out.renov = addCost(out.renov, TIER_DEFS[w.next].renovation);
      if (b.house.tier === 'domusParva' && b.house.pref !== 'insula' && houseDesir(s, w.id) < B.housing.DESIR_DOMUS) out.t3Low++;
    }
    return out;
  }
}

/** The Ordo's slot for a type: A's best slot (validSlots for owner 'ordo' already keeps off reserved blocks and blocks
 *  holding a player plan or unfinished player site), off the blocks it keeps for other works (keptBlocks); a castellum
 *  goes only where a free block for the thermae lies within its reach (castellumSlot). Chosen once a day per structure:
 *  the wish walk runs again after every change of jobs or people, and a full scoring pass each time cost more than the
 *  whole rest of the Ordo. */
export function ordoSlot(s: GameState, type: BuildingId, purpose: ReasonCode): number | null {
  return memo(s, `ordo.slot.${type}.${purpose}`, dayStruct(s), () => {
    if (type === 'castellum') return castellumSlot(s, purpose);
    const best = bestSlot(s, type, { owner: 'ordo', purpose })?.tile ?? null;
    if (best === null || !overlapsKept(s, type, best)) return best;
    return bestScored(s, type, purpose, (tile) => !overlapsKept(s, type, tile));
  });
}

/** The highest-scoring valid Ordo slot of a type that passes `ok` (ties by the lowest tile), or null. */
function bestScored(s: GameState, type: BuildingId, purpose: ReasonCode, ok: (tile: number) => boolean): number | null {
  let best: number | null = null, top = -Infinity;
  for (const tile of [...validSlots(s, type, 'ordo').keys()].sort((a, b) => a - b)) {
    if (!ok(tile)) continue;
    const sc = siteScore(s, type, tx(tile), ty(tile), purpose).score;
    if (sc > top + 1e-9) { top = sc; best = tile; }
  }
  return best;
}

/** The lowest valid Ordo slot of a type off the kept blocks (memo on structure and day, like A's validSlots). The walk
 *  asks only whether a wish has a slot and what it costs (tile-independent except a castellum's route); the best slot —
 *  a full scoring pass of every valid slot — is searched only when the wish is placed or shown (lazyTile). */
function anyOpenSlot(s: GameState, type: BuildingId): number | null {
  const slots = validSlots(s, type, 'ordo');
  const kept = keptBlocks(s);
  if (kept.length > 0) {
    const hit = lowestOff.get(slots);
    if (hit && hit.kept === kept) return hit.pick;
    let pick: number | null = null;
    for (const tile of slots.keys()) if ((pick === null || tile < pick) && !overlapsKept(s, type, tile, kept)) pick = tile;
    lowestOff.set(slots, { kept, pick });
    return pick;
  }
  let pick = lowestSlot.get(slots);   // the lowest key of a slot map, kept per map (validSlots keeps its map per layout)
  if (pick === undefined) {
    pick = null;
    for (const tile of slots.keys()) if (pick === null || tile < pick) pick = tile;
    lowestSlot.set(slots, pick);
  }
  return pick;
}
const lowestSlot = new WeakMap<Map<number, number>, number | null>();
const lowestOff = new WeakMap<Map<number, number>, { kept: object; pick: number | null }>();   // …off the kept blocks

// ── the charter's blocks (DESIGN §10.5 row 7): from Municipium the Colonia petition names the great baths and the theatre,
//    each a whole block, and the thermae must stand within CASTELLUM_REACH of an active castellum. A castellum raised
//    among the houses could find every block in its reach taken by the time its arches were finished, and plots and
//    gardens could take the last free blocks before the theatre was raised: the city then never became a Colonia. So the
//    castellum goes only where a free block lies in its reach, and until each is raised the Ordo keeps a block free for
//    the thermae (the best within the castellum's reach, from its staking on) and one for the theatrum (the best other).

/** Whole blocks a thermae or a theatre could take but for the castellum rule: active, not reserved by the player nor
 *  holding a work of his in hand, every tile free (memo on the layout, the rank and the player's reservations). */
function freeBlocks(s: GameState): Rect[] {
  return memo(s, 'ordo.freeBlocks', blockKey(s), () => {
    const sv = getMap(s.seed).survey;
    const d = derived(s);
    const keep = new Set<number>(s.ordo.reserved);
    for (const b of s.buildings) {
      if (b.owner !== 'player' || b.status === 'done') continue;
      const blk = sv.blockAt[idx(b.x, b.y)];
      if (blk >= 0) keep.add(blk);
    }
    const out: Rect[] = [];
    for (const blk of sv.blocks) {
      if (!isActiveBlock(sv, blk, s.rank, isRazed(s)) || keep.has(blk.id)) continue;
      let free = true;
      for (let y = blk.y; free && y < blk.y + 4; y++) for (let x = blk.x; x < blk.x + 4; x++) {
        const i = idx(x, y);
        if (d.buildingAt[i] !== 0 || d.reservedTile[i] === 1) { free = false; break; }
      }
      if (free) out.push({ x: blk.x, y: blk.y, w: 4, h: 4 });
    }
    return out;
  });
}
const blockKey = (s: GameState): string => `${layoutEpoch(s)}|${s.rank}|${isRazed(s) ? 1 : 0}|${s.ordo.reserved.join(',')}`;

/** The free blocks within a castellum's reach of a castellum footprint at (x, y), but `not`. */
function blocksInReach(s: GameState, x: number, y: number, not: Rect | null = null): Rect[] {
  const [w, h] = sizeOf('castellum', 'plot');
  const r: Rect = { x, y, w, h };
  return freeBlocks(s).filter((b) => b !== not && rectGap(b, r) <= B.map.CASTELLUM_REACH);
}

/** Whether a charter work is still to be raised (granted to our rank, none standing or in hand). */
function ahead(s: GameState, type: BuildingId): boolean {
  return BUILDING_DEFS[type].rank <= s.rank && !s.buildings.some((b) => b.type === type);
}

/** The best-scoring of `blocks` for a work of `type` (ties by the lowest tile), or null. */
function bestBlock(s: GameState, type: BuildingId, blocks: readonly Rect[]): Rect | null {
  let best: Rect | null = null, top = -Infinity;
  for (const b of blocks) {
    const sc = siteScore(s, type, b.x, b.y, 'rank').score;
    if (sc > top + 1e-9 || (Math.abs(sc - top) <= 1e-9 && best && idx(b.x, b.y) < idx(best.x, best.y))) { top = sc; best = b; }
  }
  return best;
}

/** Block works that alone answer a house need, kept for the houses that will want them (the next tier needs it). */
const BLOCK_SERVICE: readonly [NeedId, BuildingId][] = [['temple', 'templum'], ['baths', 'balneum'], ['macellum', 'macellum']];

/** The blocks the Ordo keeps free, each for its work (DESIGN §10.5 rows 6–7): the thermae's (once a castellum stands or
 *  rises) and the theatrum's while the Colonia petition is ahead; and from a rank before Rome grants it, a temple's, a
 *  bathhouse's and a market hall's — the free block where one would serve the most houses whose next tier will need it,
 *  if that is at least EVOLVE_MIN_BLOCK of them — so the last block near the cottages is not taken by a cistern or a
 *  house plot the season before the temple may rise (memo on the layout, the rank, the reservations and the houses). */
export function keptBlocks(s: GameState): readonly { rect: Rect; for: BuildingId }[] {
  return memo(s, 'ordo.kept', `${dayStruct(s)}|${s.ordo.reserved.join(',')}`, () => reckonKept(s));   // once a day per structure
}

function reckonKept(s: GameState): readonly { rect: Rect; for: BuildingId }[] {
  const v = view(s);
  const wants = eachHouseWant(s, v);
  const waiting: [BuildingId, number[]][] = [];
  for (const [need, type] of BLOCK_SERVICE) {
    if (BUILDING_DEFS[type].rank > s.rank + 1) continue;
    const ids = wants.filter((w) => w.unmet.includes(need)).map((w) => w.id);
    if (ids.length >= B.ordo.EVOLVE_MIN_BLOCK) waiting.push([type, ids]);
  }
  if (!ahead(s, 'thermae') && !ahead(s, 'theatrum') && waiting.length === 0) return NONE;
  const key = `${blockKey(s)}|${waiting.map(([t, ids]) => `${t}:${ids.join(',')}`).join('|')}`;
  return memo(s, 'ordo.keptBlocks', key, () => {
    const out: { rect: Rect; for: BuildingId }[] = [];
    const taken = (b: Rect): boolean => out.some((k) => k.rect === b);
    const cas = s.buildings.find((b) => b.type === 'castellum');
    const thermae = ahead(s, 'thermae') && cas ? bestBlock(s, 'thermae', blocksInReach(s, cas.x, cas.y)) : null;
    if (thermae) out.push({ rect: thermae, for: 'thermae' });
    const theatrum = ahead(s, 'theatrum') ? bestBlock(s, 'theatrum', freeBlocks(s).filter((b) => !taken(b))) : null;
    if (theatrum) out.push({ rect: theatrum, for: 'theatrum' });
    for (const [type, ids] of waiting) {
      const need = NEED_OF[type] as NeedId;
      const want = new Set(ids);
      let best: Rect | null = null, top = B.ordo.EVOLVE_MIN_BLOCK - 1;
      for (const b of freeBlocks(s)) {
        if (taken(b)) continue;
        let k = 0;
        for (const p of previewCovered(s, type, b.x, b.y)) if (ANSWER[need]?.includes(p.layer)) for (const h of p.houses) if (want.has(h)) k++;
        if (k > top) { top = k; best = b; }
      }
      if (best) out.push({ rect: best, for: type });
    }
    return out;
  });
}
const NONE: readonly { rect: Rect; for: BuildingId }[] = [];
/** The coverage layer each kept block's need is answered by. */
const ANSWER: Partial<Record<NeedId, readonly string[]>> = { temple: ['temple'], baths: ['baths'], macellum: ['macellum'] };

/** The castellum's slot: the best slot when a free block for the thermae lies within its reach (or the thermae is no
 *  longer ahead), else the best-scoring slot that has one (the theatre's block aside); the best slot when none has (the
 *  Curator says so). Memo on the layout: the route of every candidate is reckoned again only when the works change. */
function castellumSlot(s: GameState, purpose: ReasonCode): number | null {
  const best = bestSlot(s, 'castellum', { owner: 'ordo', purpose })?.tile ?? null;
  if (best === null || !ahead(s, 'thermae')) return best;
  const theatre = keptBlocks(s).find((k) => k.for === 'theatrum')?.rect ?? null;
  const ok = (tile: number): boolean => blocksInReach(s, tx(tile), ty(tile), theatre).length > 0;
  if (ok(best)) return best;
  return memo(s, `ordo.castellumSlot.${purpose}`, blockKey(s), () => bestScored(s, 'castellum', purpose, ok) ?? best);
}

/** A work of `type` at `tile` would take part of a block kept for another work. */
function overlapsKept(s: GameState, type: BuildingId, tile: number, kept = keptBlocks(s)): boolean {
  if (kept.length === 0) return false;
  const x = tx(tile), y = ty(tile);
  const [w, h] = sizeOf(type, classAt(s, type, x, y));
  return kept.some((k) => k.for !== type && x < k.rect.x + k.rect.w && k.rect.x < x + w && y < k.rect.y + k.rect.h && k.rect.y < y + h);
}

/** The valid Ordo slots of a type on a block kept for another work, for serveSlot to pass over (memo on the kept blocks
 *  and the slot map). */
function keptSlots(s: GameState, type: BuildingId): Set<number> | undefined {
  const kept = keptBlocks(s);
  if (kept.length === 0) return undefined;
  const slots = validSlots(s, type, 'ordo');
  let m = keptSlotMemo.get(kept);
  if (!m) { m = new Map(); keptSlotMemo.set(kept, m); }
  const hit = m.get(type);
  if (hit && hit.slots === slots) return hit.out;
  const set = new Set<number>();
  for (const tile of slots.keys()) if (overlapsKept(s, type, tile, kept)) set.add(tile);
  const out = set.size > 0 ? set : undefined;
  m.set(type, { slots, out });
  return out;
}
const keptSlotMemo = new WeakMap<object, Map<BuildingId, { slots: Map<number, number>; out: Set<number> | undefined }>>();

/** Houses whose first want (the Ordo's reckoning) is `need`, in id order. */
function waitingFor(s: GameState, v: SimView, need: NeedId): number[] {
  const first = houseWants(s, v).first;
  const out: number[] = [];
  for (const id of v.d.houses) if (first.get(id) === need) out.push(id);
  return out;
}

/** The Ordo's slot for a service raised for the houses waiting on `need`: the slot that serves the most of them, off
 *  the blocks kept for other works (advisors/util serveSlot); null when no valid slot reaches one. */
function ordoServeSlot(s: GameState, v: SimView, type: BuildingId, need: NeedId): { tile: number; k: number } | null {
  return serveSlot(s, type, 'ordo', need, waitingFor(s, v, need), keptSlots(s, type));
}

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
function* rows(s: GameState, v: SimView, walk: { pending: Wish | null }, mask: string): Generator<Wish> {
  const { c, d, f } = v;
  const seen = new Set<BuildingId>();
  const make = (type: BuildingId, code: ReasonCode, params: Reason['params'] = {}, o: { survival?: boolean; unblock?: boolean; revive?: ResId; again?: boolean; store?: boolean; serves?: NeedId; ids?: number[]; reach?: number } = {}): Wish | null => {
    const def = BUILDING_DEFS[type];
    if (seen.has(type) || def.rank > s.rank) return null;
    if (!maskAllows(mask, { code, params }, !!o.survival)) return null;   // a duty the Ordo does not hold (duties.ts)
    if (type === 'hortus' && s.decisions.focus !== 'urbs') return null;
    if (def.maxCount !== undefined && (d.all[type] ?? 0) >= def.maxCount) return null;
    if (!o.again && unfinished(v, type)) return null;
    // a service goes to the slot that serves the most of the houses waiting for it (none: the row is dropped, unless
    // its cost overflows a store, which asks for the store first); a castellum's route cost is measured at its slot;
    // any other row only needs a slot
    const at = o.serves === undefined ? null : o.ids ? serveSlot(s, type, 'ordo', o.serves, o.ids, keptSlots(s, type)) : ordoServeSlot(s, v, type, o.serves);
    if (o.serves !== undefined && !at && !overCap(s, c.caps, type)) return null;
    const exact = o.serves !== undefined || type === 'castellum';
    const tile = at ? at.tile : type === 'castellum' ? ordoSlot(s, type, code) : anyOpenSlot(s, type);
    const chk = tile === null ? null : canPlace(s, type, tile, { owner: 'ordo', ignoreCost: true });
    if (tile === null || !chk?.ok) return null;
    const over = RESOURCES.find((r) => (chk.cost[r] ?? 0) > c.caps[r]);
    if (over && !o.store) return store(over, type);
    const reach = at?.k ?? 0;
    if (o.serves && reach < (o.reach ?? 1)) return null;
    seen.add(type);
    const p = o.serves ? { type, ...params, reach } : { type, ...params };
    const wish: Omit<Wish, 'tile'> = { type, cost: chk.cost, reason: { code, params: p }, survival: !!o.survival, unblock: !!o.unblock || !!o.revive };
    if (o.revive) wish.revive = o.revive;
    return exact ? { ...wish, tile } : lazyTile(wish, () => ordoSlot(s, type, code) ?? tile);
  };
  const store = (r: ResId, forWhat?: string): Wish | null => {
    const t: BuildingId = r === 'grain' ? 'horreum' : r === 'water' ? 'cisterna' : 'apotheca';
    const params: Reason['params'] = { res: r, pct: Math.round((100 * s.res[r]) / Math.max(1, c.caps[r])) };
    if (forWhat) params.for = forWhat;
    return make(t, 'storageFull', params, { unblock: forWhat !== undefined, store: true });
  };
  const yieldOf = function* (w: Wish | null): Generator<Wish> { if (w) yield w; };
  // a block service no free block brings to the homes waiting for it: a block of cottages bought out, its families
  // rehoused, and the work raised there (urbs.ts, DESIGN §3.9)
  const renewal = (type: BuildingId, need: NeedId, n: number): Wish | null => {
    const def = BUILDING_DEFS[type];
    if (seen.has(type) || def.rank > s.rank || unfinished(v, type) || (def.maxCount !== undefined && (d.all[type] ?? 0) >= def.maxCount)) return null;
    if (!maskAllows(mask, renewalReason(type, need, n, 0, 0), false) || overCap(s, c.caps, type)) return null;
    const blk = cottageBlock(s, type, need, waitingFor(s, v, need));
    if (!blk) return null;
    seen.add(type);
    return { type, tile: blk.tile, cost: placementCost(s, type, 0), reason: renewalReason(type, need, n, blk.houses.length, blk.reach), survival: false, unblock: false, renew: blk.houses };
  };
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
    // a well; a cistern only when no well can be raised (not while one already rises: its rain is little and slow)
    const p = { doh: Math.floor(f.water.doh) };
    yield* yieldOf(make('puteus', 'survivalWater', p, { survival: true }) ?? (unfinished(v, 'puteus') ? null : make('cisterna', 'survivalWater', p, { survival: true })));
  }
  // 2 · Aestas: the summer forecast falls below the water reserve (aestasWork: a cistern while room is what is short)
  const wr = settingValue(s, 'waterReserve');
  const wc = f.water.crunch;
  if (wc && wc.startsIn <= B.advisors.RULES.AESTAS_LEAD && wc.lowestDoh < wr && !unfinished(v, 'cisterna') && !unfinished(v, 'puteus')) {
    const t = aestasWork(s, v, f.water, wc, wr);
    if (t) yield* yieldOf(make(t, 'aestasWater', { ...(wc.startsIn > 0 ? { days: wc.startsIn } : {}), low: Math.floor(wc.lowestDoh), keep: wr }));
  }
  // 3 · Hiems store, then stores that are full. A horreum only when the Hiems need exceeds what our stores can hold: a
  //     shortfall the stores could already hold is the fields' and the hunters' to fix (a horreum every build day while
  //     the forecast ran dry once raised 17 granaries before one Hiems)
  const gr = settingValue(s, 'grainReserve');
  const gc = f.grain.crunch;
  if (gc && gc.startsIn <= B.advisors.RULES.HIEMS_LEAD && gc.needInStore > f.grain.cap) {
    yield* yieldOf(make('horreum', 'hiemsStore', { days: gc.startsIn, hold: Math.floor(f.grain.cap / Math.max(1e-6, f.grain.need)), keep: gr }));
  }
  // (horrea beyond the rank's count while the granaries hold less than STORE_RESERVE × the grain reserve: a grown city
  //  must keep its Hiems store, and its summer harvest should not spill)
  const short = c.caps.grain < STORE_RESERVE * gr * f.grain.need;
  for (const r of ['grain', ...MATERIALS, 'wine'] as ResId[]) {
    const t = r === 'grain' ? 'horreum' : 'apotheca';
    if (s.res[r] >= B.ordo.STORE_FULL * c.caps[r] && ((d.all[t] ?? 0) < 1 + s.rank * STORES_PER_RANK || (r === 'grain' && short))) yield* yieldOf(store(r));
  }
  // 4 · beds for newcomers while Rome's roll allows
  const planned = ((d.all.area ?? 0) - (d.counts.area ?? 0)) * (TIER_DEFS.tentoria.beds + fxAdd(s, 'lowCap'));
  const keep = settingValue(s, 'spareBeds') + (s.decisions.focus === 'copia' ? B.ordo.FOCUS.COPIA_BEDS : 0);
  if (c.freeBeds + planned < keep && c.pop < c.roll) yield* yieldOf(make('area', 'beds', { free: c.freeBeds + planned, keep }, { again: true }));
  // 5 · water within reach of the homes that lack it
  const hw = houseWants(s, v);
  const dry = hw.want.water ?? 0;
  if (dry >= B.ordo.EVOLVE_MIN) {
    // a fountain once the aqueduct flows; a well where no fountain can reach them (a lacus must stand near the castellum)
    const fountain = d.castellumActive && BUILDING_DEFS.lacus.rank <= s.rank;
    const w = fountain ? make('lacus', 'waterAccess', { n: dry }, { serves: 'water' }) : null;
    yield* yieldOf(w ?? (fountain && unfinished(v, 'lacus') ? null : make('puteus', 'waterAccess', { n: dry }, { serves: 'water' })));
  }
  // 5b · running water for the great houses (DESIGN §3.9): once the aqueduct flows, a fountain within reach gives an
  //      insula or a domus beds and rent (the aquae variant), so the aqueduct's water goes where it matters
  if (d.castellumActive && BUILDING_DEFS.lacus.rank <= s.rank) {
    const great = d.houses.filter((id) => { const h = getBuilding(s, id)?.house; return !!h && TIER_DEFS[h.tier].level === 4 && !houseHas(s, id, 'fountain'); });
    if (great.length >= B.urbs.AQUAE_REACH) yield* yieldOf(make('lacus', 'aquae', { n: great.length }, { serves: 'water', ids: great, reach: B.urbs.AQUAE_REACH }));
  }
  // 6 · the service most homes wait for (baths too: one balneum cannot reach every insula of a grown city)
  const wants = (Object.keys(SERVICE_FOR) as NeedId[]).filter((n) => (hw.want[n] ?? 0) > 0)
    .sort((a, b) => (hw.want[b] ?? 0) - (hw.want[a] ?? 0) || NEEDS.indexOf(a) - NEEDS.indexOf(b));
  for (const n of wants) {
    const t = SERVICE_FOR[n] as BuildingId;
    const min = BUILDING_DEFS[t].place.includes('block') ? B.ordo.EVOLVE_MIN_BLOCK : B.ordo.EVOLVE_MIN;
    if ((hw.want[n] ?? 0) < min) continue;
    yield* yieldOf(make(t, 'evolve', { n: hw.want[n] ?? 0, want: n }, { serves: n }) ?? (min === B.ordo.EVOLVE_MIN_BLOCK ? renewal(t, n, hw.want[n] ?? 0) : null));
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
    // its producers stand but yield nothing (the woods of every lumber camp felled): the new one comes first (walkWishes)
    const dry = !feed && (d.all[own] ?? 0) > 0 && !s.buildings.some((b) => b.type === own && b.status === 'done' && (fullRate(s, b)[r] ?? 0) > 0);
    const w = make(feed ? PRODUCER[feed] as BuildingId : own, queue[k].for === 'capitolium' ? 'capitolium' : 'materials', params, { unblock: !d.all[own], revive: dry ? r : undefined });
    if (!w) continue;
    yield w;
    const short = missing(s, w.cost);
    for (const r2 of MATERIALS) if ((short[r2] ?? 0) > 0) queue.push({ r: r2, q: short[r2] ?? 0, for: w.type });
  }
  // 9 · oil and wine for the great houses, planned as the grain is for Hiems (ordo/goods.ts): groves for the year's draw
  //     × LUXURY, then room to carry the lean season — an apotheca while what the draw takes from Kal. Mart. to Kal. Sept.
  //     beyond the presses' yield (wine: LUXURY_RUNWAY days), and the floor, exceed what the stores hold
  const oil = goodsPlan(s, v, 'oil');
  if (BUILDING_DEFS.olivetum.rank <= s.rank && oil.demand * B.ordo.LUXURY > olivePotential(s)) yield* yieldOf(make('olivetum', 'luxury', { res: 'oil' }));
  for (const g of [oil, goodsPlan(s, v, 'wine')]) {
    if (g.demand <= 0 || g.reserve + g.floor <= c.caps[g.res]) continue;
    const hold = Math.floor(c.caps[g.res] / g.demand), need = Math.ceil((g.reserve + g.floor) / g.demand);
    yield* yieldOf(make('apotheca', 'luxury', { res: g.res, store: 1, hold, need }));
  }
  // 10 · the council focus's build plan (named only once the player can see the focus); 11 · beauty under Urbs
  const focus = s.decisions.focus;
  const plan = focusParams(s);
  for (const [t, n] of FOCUS_DEFS[focus].plan) if ((d.all[t] ?? 0) < n) yield* yieldOf(make(t, 'focusPlan', plan));
  if (focus === 'urbs' && hw.t3Low > 0) yield* yieldOf(make('hortus', 'beauty', { n: hw.t3Low }));
}

/** The focus a focusPlan reason names: none before the council's focus is revealed (it is the Ordo's default then, and
 *  "the Concordia plan" would cite a choice the player has never seen). */
function focusParams(s: GameState): Reason['params'] {
  return sectionRevealed(s, 'focus') ? { focus: s.decisions.focus } : {};
}

/** A materials or Capitolium reason as it stands now (DESIGN §10.6): the lacking quantity from `lack` (today's needs
 *  unless given), its ETA scaled to it; or the "covered" case once the stores hold what was lacking — a lumber camp's
 *  own felling often fills the timber store the day it is staked, and "we lack 24 timber" beside "the stores are full"
 *  read as a contradiction. Other reasons are returned as they are. */
export function currentReason(s: GameState, v: SimView, r: Reason, lack?: Cost): Reason {
  if (r.code !== 'materials' && r.code !== 'capitolium') return r;
  const res = r.params.res;
  if (typeof res !== 'string' || !(RESOURCES as readonly string[]).includes(res)) return r;
  const now = lack ? null : materialNeeds(s, v);
  const q = Math.ceil((lack ?? now?.lack ?? {})[res as ResId] ?? 0);
  const was = typeof r.params.qty === 'number' ? r.params.qty : 0;
  const forNow = q > 0 && r.code === 'materials' ? now?.forOf[res as ResId] : undefined;   // whom the good is lacking for today
  if (q > 0 && q === was && r.params.covered === undefined && (forNow === undefined || forNow === r.params.for)) return r;
  const p: Reason['params'] = { ...r.params };
  delete p.covered;
  delete p.eta;
  if (q > 0) {
    p.qty = q;
    if (forNow !== undefined) p.for = forNow;
    if (typeof r.params.eta === 'number' && was > 0) p.eta = Math.max(1, Math.ceil((r.params.eta * q) / was));
  } else p.covered = 1;
  return { code: r.code, params: p };
}

/** A work's cost (any slot but a castellum's) exceeds a store cap. */
function overCap(s: GameState, caps: Record<ResId, number>, type: BuildingId): boolean {
  const cost = placementCost(s, type, 0);
  return RESOURCES.some((r) => (cost[r] ?? 0) > caps[r]);
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
 *  epoch, the player's orders and settings, and the duties the Ordo holds). Only the wishes of those duties are walked:
 *  the Ordo neither raises nor saves for a work that is the player's to raise; `full` walks every wish (what the Ordo
 *  would raise if it held every duty). */
export function walkWishes(s: GameState, v: SimView, full = false): Walk {
  const mask = full ? 'all' : walkMask(s);
  const key = `${s.day}|${structEpoch(s)}|${ordersOf(s).walk}|${mask}`;
  return memo(s, mask === 'all' ? 'ordo.walk' : 'ordo.walkHeld', key, () => {
    const base = addCost(partsCost(savingParts(s, v)), capitoliumAhead(s));
    const out: Walk = { list: [], take: null, pending: null };
    for (const w of rows(s, v, out, mask)) {
      const held = out.pending ? addCost(base, out.pending.cost) : base;
      const ok = w.survival ? canAfford(s, w.cost) : w.unblock ? canAfford(s, w.cost) && floorOk(s, w.cost) : canAfford(s, w.cost, held) && floorOk(s, w.cost);
      if (ok) {
        out.list.push({ wish: w, state: 'proposed' });
        out.take ??= w;
      } else if (!out.pending && !out.take) {
        out.pending = w;
        out.list.push({ wish: w, state: 'saving', lacking: missing(s, withFloor(s, w), w.survival || w.unblock ? undefined : base) });
      } else if (w.revive && out.pending && !out.take && !out.pending.survival && (missing(s, out.pending.cost)[w.revive] ?? 0) > 0) {
        // the wish saved for lacks a good whose producers have run dry: no saving brings it, so their replacement is
        // saved (and traded) for first, and the other waits
        const prev = out.list.find((e) => e.wish === out.pending);
        if (prev) { prev.state = 'waiting'; prev.lacking = missing(s, withFloor(s, out.pending), held); }
        out.pending = w;
        out.list.push({ wish: w, state: 'saving', lacking: missing(s, withFloor(s, w)) });
      } else {
        out.list.push({ wish: w, state: 'waiting', lacking: missing(s, withFloor(s, w), held) });
      }
      if (out.take && out.list.length >= LIST_MAX) break;
    }
    return out;
  });
}

/** The wishes that grow the colony rather than keep it (DESIGN §10.3): beds, water within reach, the services homes
 *  wait for, the petition's works, materials, luxuries, the focus plan and beauty. The Ordo raises one of them only every
 *  GROWTH_EVERY days, so a colony left to it grows slowly but never starves (survival, the Aestas cistern and the
 *  stores keep the full cadence); a Praefectus who raises them by hand, as the advisors and the Agenda name them,
 *  outpaces it. */
const GROWTH: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['beds', 'waterAccess', 'evolve', 'rank', 'materials', 'luxury', 'focusPlan', 'beauty', 'capitolium', 'aquae', 'renewal']);

/** Whether a wish grows the colony (paced) rather than keeps it. */
export function isGrowth(w: { reason: Reason }): boolean {
  return GROWTH.has(w.reason.code);
}

/** Days until the Ordo may raise its next growth work (0: it may now). */
export function growthWait(s: GameState): number {
  let last = NEVER;
  for (const b of s.buildings) if (b.owner === 'ordo' && b.reason && GROWTH.has(b.reason.code) && b.placed > last) last = b.placed;
  return Math.max(0, last + B.ordo.GROWTH_EVERY - s.day);
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
  if (s.decisions.focus === 'urbs' && dateOf(s.day).day <= B.ordo.BUILD_EVERY && maskAllows(walkMask(s), { code: 'beauty', params: {} }, false)) paveBusyStreets(s, v, decided);
  const walk = walkWishes(s, v);
  const full = ordoSites(s) >= maxSites(v);
  const paced = growthWait(s) > 0;
  // sites full: only survival; a growth work raised lately: only what keeps the colony (survival, Aestas, stores)
  const w = full ? walk.list.find((e) => e.state === 'proposed' && e.wish.survival)?.wish
    : paced ? walk.list.find((e) => e.state === 'proposed' && !isGrowth(e.wish))?.wish : walk.take;
  if (!w) return;
  const res = w.reason.params.res;
  const had = typeof res === 'string' && (RESOURCES as readonly string[]).includes(res) ? s.res[res as ResId] : 0;
  if (w.renew && !buyOut(s, w.renew, w.type, (e) => ctx.fx.push(e))) return;   // the cottages first, their families rehoused
  const r = placeBuilding(s, w.type, w.tile, { owner: 'ordo', reason: w.reason, noStake: w.survival });
  if (!r.ok) return;
  if (r.id !== undefined) ctx.fx.push({ kind: 'ordoPlaced', id: r.id });
  // the timber felled on the site enters the stores: a lack it made up is told as covered, here and on the site
  let reason = w.reason;
  if ((reason.code === 'materials' || reason.code === 'capitolium') && typeof res === 'string' && typeof reason.params.qty === 'number') {
    const got = s.res[res as ResId] - had;
    if (got > 0) reason = currentReason(s, v, reason, { [res]: Math.max(0, reason.params.qty - got) });
    const b = r.id !== undefined ? getBuilding(s, r.id) : undefined;
    if (b && reason !== w.reason) b.reason = reason;
  }
  chronicle(s, 'ordo', reason, { ref: r.id, decided });
}

/** Urbs: paves the dirt streets the most feet tread (the footfall census, urbs.ts; nearer the forum on a tie),
 *  URBS_PAVE streets a month, from unreserved stone. */
function paveBusyStreets(s: GameState, v: SimView, decided: boolean): void {
  const tiles = busiestDirt(s, B.ordo.FOCUS.URBS_PAVE * STREET_TILES);
  if (tiles.length === 0 || !canSpend(s, { stone: tiles.length * B.map.PAVE_STONE }, v)) return;
  if (pave(s, tiles).ok) log(s, 'ordo', `For the city beautiful the Ordo paves ${tiles.length} paces of our busiest streets.`, decided ? ['decided'] : undefined);
}

/** Places the pin, then the requests, as player sites (no stake, fx ordoPlaced), each from stock above the orders ahead of
 *  it and the goods kept for a producer replacing those run dry (Wish.revive). */
export function processRequests(s: GameState, ctx: TickContext, v: SimView): void {
  // the goods of a producer replacing those run dry are kept for it: the orders wait on what it brings
  const revive = walkWishes(s, v).list.find((e) => e.wish.revive && (e.state === 'proposed' || e.state === 'saving'))?.wish;
  let above: Cost = revive?.revive ? { [revive.revive]: revive.cost[revive.revive] ?? 0 } : {};
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
  // a service asked for goes where it serves the most of the houses waiting for it (the Aedilis's advice was for them),
  // anything else (or a service no slot brings to a waiting house) to the Ordo's best slot
  const need = type === 'hortus' ? 'desirability' : NEED_OF[type];
  const at = type === 'hortus' ? liftSlot(s, 'ordo', waitingFor(s, v, 'desirability'), keptSlots(s, 'hortus')) : need ? ordoServeSlot(s, v, type, need) : null;
  const tile = type === 'castellum' ? any : at ? at.tile : ordoSlot(s, type, code);
  const chk = tile === null ? null : canPlace(s, type, tile, { owner: 'ordo', ignoreCost: true });
  if (tile === null || !chk?.ok) return false;
  const n = at?.k ?? 0;
  const reason: Reason = { code, params: need && n > 0 ? { type, n, want: need } : { type } };
  const r = placeBuilding(s, type, tile, { owner: 'player', noStake: true, reason });
  if (!r.ok) return false;
  if (r.id !== undefined) ctx.fx.push({ kind: 'ordoPlaced', id: r.id });
  chronicle(s, 'ordo', reason, { ref: r.id });
  return true;
}

/** The next `n` wishes not yet placed, with states (concurrency full → ready wishes wait), lacking goods and ETA; with
 *  `held`, only the wishes of the full walk the Ordo does not hold the duty for (what it would raise). */
export function newWishes(s: GameState, v: SimView, n: number, held?: string): WishView[] {
  const full = ordoSites(s) >= maxSites(v);
  const wait = growthWait(s);
  const out: WishView[] = [];
  for (const e of walkWishes(s, v, held !== undefined).list) {
    if (out.length >= n) break;
    const wish = e.wish;
    if (held !== undefined && maskAllows(held, wish.reason, wish.survival)) continue;
    const state: WishView['state'] = e.state !== 'proposed' ? e.state : full && !wish.survival ? 'waiting' : wait > 0 && isGrowth(wish) ? 'paced' : 'proposed';
    const w: WishView = lazyTile({ type: wish.type, state, reason: wish.reason }, () => wish.tile);
    if (state === 'paced') w.eta = wait;
    if (e.lacking && RESOURCES.some((r) => (e.lacking?.[r] ?? 0) > 0)) {
      w.lacking = e.lacking;
      const eta = etaDays(s, v, e.lacking);
      if (eta !== null) w.eta = eta;
    }
    out.push(w);
  }
  return out;
}

/** The first wish the Ordo would raise if it held every duty, among those it does not hold (null: it holds them all, or
 *  none of their wishes stands). What the Agenda, Edicta and Apply once offer the player to raise by hand. */
export function wouldRaise(s: GameState, v: SimView): WishView | null {
  const mask = walkMask(s);
  if (mask === 'all') return null;
  return newWishes(s, v, 1, mask)[0] ?? null;
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
      reason: b.reason ? currentReason(s, v, b.reason) : { code: 'focusPlan', params: { type: b.type, ...focusParams(s) } },
      eta: staked ? Math.max(0, B.construction.STAKE_DAYS - (s.day - b.placed)) : Math.ceil((b.work * (1 - b.progress)) / builders),
    });
  }
  return out.concat(newWishes(s, v, n - out.length));
}


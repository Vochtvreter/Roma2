// src/game/census.ts — the census memo: stages, workforce, beds, needs, caps, staffing (ARCHITECTURE §8.3). Owner: WP-B.
// Also the people index (by home, job and family), memoised on the census epoch, so no daily step loops over people twice.
import { B as B$ } from './balance';
import { BUILDER as BUILDER$, HOUSE_TIERS as HOUSE_TIERS$, LABOR_CATS as LABOR_CATS$ } from './types';
import type { Building, Census, GameState, HouseTierId, LaborCat, Person, Quad, StageIndex } from './types';
import { censusEpoch as censusEpoch$, memo as memo$, peopleEpoch as peopleEpoch$, structEpoch as structEpoch$ } from './memo';
import { derived as derived$ } from './derived';
import { caps, horreaCap, portion } from './economy';
import { fx as fx$, fxAdd as fxAdd$ } from './fx';
import { getBuilding } from './state';
import { isAquae } from './housing';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { TIER_DEFS as TIER_DEFS$ } from './data/housing';
import { RANK_DEFS as RANK_DEFS$ } from './data/ranks';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, BUILDER = BUILDER$, HOUSE_TIERS = HOUSE_TIERS$, LABOR_CATS = LABOR_CATS$, censusEpoch = censusEpoch$,
  memo = memo$, peopleEpoch = peopleEpoch$, structEpoch = structEpoch$, derived = derived$, fx = fx$, fxAdd = fxAdd$,
  BUILDING_DEFS = BUILDING_DEFS$, TIER_DEFS = TIER_DEFS$, RANK_DEFS = RANK_DEFS$;

const YEAR = B.time.YEAR_DAYS;
const PORTION_VALUES: readonly number[] = Object.values(B.economy.PORTIONS);
const DAY_SPAN = 1e6;   // census memo key = (epoch × DAY_SPAN + day) × portions + portion index (exact in float64)

/** People grouped by home, workplace and family (lists in id order). */
export interface PeopleIndex {
  byHome: Map<number, Person[]>;
  byWork: Map<number, Person[]>;
  byFamily: Map<number, Person[]>;
  builders: Person[];
  homeless: Person[];
}

// census → houseBeds → isAquae → coverage → effectiveRadius → census would recurse while the census memo is being
// filled. The nested census (coverage only reads its staffing) skips the aquae beds; the outer one stores the full value.
let depth = 0;

/** The census of a state (memo on day + censusEpoch + grain portion; invalidate() bumps the census epoch too). */
export function census(s: GameState): Census {
  // fast path: the same state, census epoch, day and the two inputs of the grain portion as the last read
  const f = censusLast;
  if (f.s === s && f.epoch === censusEpoch(s) && f.day === s.day && f.edict === s.decisions.edicts.rationes && f.em === s.ordo.emergency.rations && f.c) return f.c;
  const c = censusOf(s);
  censusLast = { s, epoch: censusEpoch(s), day: s.day, edict: s.decisions.edicts.rationes, em: s.ordo.emergency.rations, c };
  return c;
}
let censusLast: { s: GameState | null; epoch: number; day: number; edict: string | undefined; em: string; c: Census | null } = { s: null, epoch: 0, day: 0, edict: undefined, em: '', c: null };

function censusOf(s: GameState): Census {
  const pk = Math.max(0, PORTION_VALUES.indexOf(portion(s)));
  const key = (censusEpoch(s) * DAY_SPAN + s.day) * PORTION_VALUES.length + pk;
  return memo(s, 'census', key, () => {
    depth++;
    try {
      return computeCensus(s);
    } finally {
      depth--;
    }
  });
}

function push(m: Map<number, Person[]>, k: number, p: Person): void {
  const list = m.get(k);
  if (list) list.push(p);
  else m.set(k, [p]);
}

/** People indexed by home, work and family (memo on the census epoch; the home and family lists on the people epoch, so
 *  a reassignment of jobs rebuilds only the work lists). */
export function peopleIndex(s: GameState): PeopleIndex {
  return memo(s, 'peopleIndex', censusEpoch(s), () => {
    const homes = memo(s, 'peopleIndex.homes', peopleEpoch(s), () => {
      const byHome = new Map<number, Person[]>();
      const byFamily = new Map<number, Person[]>();
      const homeless: Person[] = [];
      for (const p of s.people) {
        if (p.home === null) homeless.push(p);
        else push(byHome, p.home, p);
        push(byFamily, p.family, p);
      }
      return { byHome, byFamily, homeless };
    });
    const byWork = new Map<number, Person[]>();
    const builders: Person[] = [];
    for (const p of s.people) {
      if (p.work === BUILDER) builders.push(p);
      else if (p.work !== null) push(byWork, p.work, p);
    }
    return { byHome: homes.byHome, byWork, byFamily: homes.byFamily, builders, homeless: homes.homeless };
  });
}

/** The census's pass over people: life stages, the able workers in id order and the patricii (memo on the people epoch
 *  and the day: ages and sickness move with the day, homes and tiers bump the people epoch, jobs do not enter). */
function peopleCounts(s: GameState, domusOf: () => Set<number>): { byStage: Quad; workforce: number; patricii: number; able: Person[] } {
  return memo(s, 'census.people', peopleEpoch(s) * DAY_SPAN + s.day, () => {
    const day = s.day;
    const domus = domusOf();
    const byStage: Quad = [0, 0, 0, 0];
    const able: Person[] = [];
    const P = B.people;
    let patricii = 0;
    for (const p of s.people) {
      const age = Math.floor((day - p.born) / YEAR);
      byStage[age < P.YOUTH ? 0 : age < P.ADULT ? 1 : age < P.ELDER ? 2 : 3]++;
      const patrician = p.home !== null && domus.has(p.home);
      if (patrician) patricii++;
      if (age >= P.ADULT && age < P.RETIRE && !patrician && !(p.sickUntil !== undefined && p.sickUntil > day)) able.push(p);
    }
    return { byStage, workforce: able.length, patricii, able };
  });
}

/** Age in whole years on a day. */
export function ageOf(p: Person, day: number): number {
  return Math.floor((day - p.born) / YEAR);
}

/** Life stage on a day: child < YOUTH ≤ youth < ADULT ≤ adult < ELDER ≤ elder. */
export function stageOf(p: Person, day: number): StageIndex {
  const a = ageOf(p, day);
  if (a < B.people.YOUTH) return 0;
  if (a < B.people.ADULT) return 1;
  if (a < B.people.ELDER) return 2;
  return 3;
}

/** Able to work: adult, or elder under RETIRE; not patrician; not sick. */
export function canWork(s: GameState, p: Person): boolean {
  const a = ageOf(p, s.day);
  if (a < B.people.ADULT || a >= B.people.RETIRE) return false;
  if (p.sickUntil !== undefined && p.sickUntil > s.day) return false;
  return !isPatrician(s, p);
}

/** Lives in a domus (patricii never take jobs). */
export function isPatrician(s: GameState, p: Person): boolean {
  if (p.home === null) return false;
  return getBuilding(s, p.home)?.house?.tier === 'domus';
}

/** Beds of a house: tier beds + lowCap (T0–T2) / insulaCap and aquae (insula); halved while damaged. */
export function houseBeds(s: GameState, b: Building): number {
  return bedsOf(s, b, fxAdd(s, 'lowCap'), fxAdd(s, 'insulaCap'));
}

function bedsOf(s: GameState, b: Building, lowCap: number, insulaCap: number): number {
  const h = b.house;
  if (!h || b.status !== 'done') return 0;
  const t = TIER_DEFS[h.tier];
  let beds = t.beds;
  if (t.level <= 2) beds += lowCap;
  if (h.tier === 'insula') {
    beds += insulaCap;
    if (depth <= 1 && isAquae(s, b)) beds += B.housing.AQUAE_BEDS;
  }
  if (b.damagedUntil !== undefined && b.damagedUntil > s.day) beds = Math.floor(beds / 2);
  return Math.max(0, beds);
}

/** Living people whose home is the house (id order). */
export function residents(s: GameState, houseId: number): Person[] {
  return peopleIndex(s).byHome.get(houseId) ?? [];
}

/** Free beds of one house (never negative). */
export function freeBedsOf(s: GameState, b: Building): number {
  return Math.max(0, houseBeds(s, b) - residents(s, b.id).length);
}

/** The census's pass over the houses: beds, free beds (before the colony-wide clamp), tiers and decline. Kept while the
 *  people epoch (homes, tiers and decline bump it), the day (damage ends), the path bonuses to beds and the aquae state
 *  of every insula (its fountain beds, asked of isAquae as the pass would) stay; the nested census of the coverage
 *  (depth > 1, no aquae beds) never stores it. */
interface HouseCounts { beds: number; freeBeds: number; byTier: Record<HouseTierId, number>; declining: number }
const houseCounts = new WeakMap<GameState, { pe: number; day: number; low: number; ins: number; insulae: Building[]; aquae: boolean[]; v: HouseCounts }>();

function countHouses(s: GameState, houses: readonly number[], byHome: ReadonlyMap<number, Person[]>): HouseCounts {
  const lowCap = fxAdd(s, 'lowCap'), insulaCap = fxAdd(s, 'insulaCap');
  const pe = peopleEpoch(s);
  const c = houseCounts.get(s);
  if (depth <= 1 && c && c.pe === pe && c.day === s.day && c.low === lowCap && c.ins === insulaCap && c.insulae.every((b, k) => isAquae(s, b) === c.aquae[k])) return c.v;
  let beds = 0, freeBeds = 0, declining = 0;
  const byTier = {} as Record<HouseTierId, number>;
  for (const t of HOUSE_TIERS) byTier[t] = 0;
  const insulae: Building[] = [];
  for (const id of houses) {
    const b = getBuilding(s, id);
    if (!b?.house) continue;
    const n = bedsOf(s, b, lowCap, insulaCap);
    beds += n;
    freeBeds += Math.max(0, n - (byHome.get(id)?.length ?? 0));
    byTier[b.house.tier]++;
    if (b.house.declining) declining++;
    if (b.house.tier === 'insula' && b.status === 'done') insulae.push(b);
  }
  const v = { beds, freeBeds, byTier, declining };
  if (depth <= 1) houseCounts.set(s, { pe, day: s.day, low: lowCap, ins: insulaCap, insulae, aquae: insulae.map((b) => isAquae(s, b)), v });
  return v;
}

/** Slots per building and per labour category (builders aside) and each building's category, in building order (memo
 *  on the structure epoch: completions, closures and reopenings bump it). */
interface SlotCounts { slots: Record<number, number>; catSlots: Record<LaborCat, number>; staffable: { id: number; labor: LaborCat | null }[] }

function slotCounts(s: GameState): SlotCounts {
  return memo(s, 'census.slots', structEpoch(s), () => {
    const slots: Record<number, number> = {};
    const catSlots = {} as Record<LaborCat, number>;
    for (const c of LABOR_CATS) catSlots[c] = 0;
    const staffable: SlotCounts['staffable'] = [];
    for (const b of s.buildings) {
      const def = BUILDING_DEFS[b.type];
      if (def.slots <= 0) continue;
      const n = b.status === 'done' && b.open ? def.slots : 0;
      slots[b.id] = n;
      if (def.labor) catSlots[def.labor] += n;
      staffable.push({ id: b.id, labor: def.labor ?? null });
    }
    return { slots, catSlots, staffable };
  });
}

/** The census's pass over people for today (memo on the people epoch and the day). */
function todaysPeople(s: GameState): ReturnType<typeof peopleCounts> {
  return peopleCounts(s, () => {
    const domus = new Set<number>();
    for (const id of derived(s).houses) if (getBuilding(s, id)?.house?.tier === 'domus') domus.add(id);
    return domus;
  });
}

/** Everyone who canWork today, in id order (the census's pass: adults and elders under RETIRE, not sick, not patrician). */
export function ablePeople(s: GameState): readonly Person[] {
  return todaysPeople(s).able;
}

function computeCensus(s: GameState): Census {
  const day = s.day;
  const d = derived(s);
  const ix = peopleIndex(s);
  const staffed: Record<number, number> = {};
  const pc = todaysPeople(s);
  const byStage: Quad = [pc.byStage[0], pc.byStage[1], pc.byStage[2], pc.byStage[3]];
  const { workforce, patricii } = pc;
  const idle: number[] = [];
  for (const p of pc.able) if (p.work === null) idle.push(p.id);
  for (const b of s.buildings) {
    const n = ix.byWork.get(b.id)?.length ?? 0;
    if (n > 0) staffed[b.id] = n;
  }

  const hc = countHouses(s, d.houses, ix.byHome);
  const { beds, declining } = hc;
  const byTier = { ...hc.byTier };
  // A child is born into its parents' home even when that home is full; such a house's crowd fills beds elsewhere in
  // the reckoning, so the colony's free beds never exceed its beds less its housed souls.
  const freeBeds = Math.max(0, Math.min(hc.freeBeds, beds - (s.people.length - ix.homeless.length)));

  const sc = slotCounts(s);
  const catSlots = { ...sc.catSlots };
  const catStaffed = {} as Record<LaborCat, number>;
  for (const c of LABOR_CATS) catStaffed[c] = 0;
  for (const { id, labor } of sc.staffable) if (labor) catStaffed[labor] += staffed[id] ?? 0;
  catStaffed.builders = ix.builders.length;
  catSlots.builders = ix.builders.length;   // builders have no slot cap (CONTRACT_NOTES, game stubs 5)

  const NEED = B.people.NEED;
  const pg = portion(s) * fx(s, 'grainUse');
  const pw = fx(s, 'waterUse');
  const grain: Quad = [0, 0, 0, 0];
  const water: Quad = [0, 0, 0, 0];
  for (let g = 0; g < 4; g++) {
    grain[g] = byStage[g] * NEED[g] * pg;
    water[g] = byStage[g] * NEED[g] * pw;
  }
  const sum = (q: Quad): number => q[0] + q[1] + q[2] + q[3];

  return {
    day, pop: s.people.length, byStage, adults: byStage[2], workforce, idle,
    beds, freeBeds, homeless: ix.homeless.length, roll: RANK_DEFS[s.rank].ceiling,
    need: { grain: sum(grain), water: sum(water) }, groupNeed: { grain, water },
    caps: caps(s), horreaCap: horreaCap(s),
    slots: sc.slots, staffed, catSlots, catStaffed,
    houses: d.houses.length, byTier, declining, patricii,
  };
}

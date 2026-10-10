// src/game/census.ts — the census memo: stages, workforce, beds, needs, caps, staffing (ARCHITECTURE §8.3). Owner: WP-B.
// Also the people index (by home, job and family), memoised on the census epoch, so no daily step loops over people twice.
import { B } from './balance';
import { BUILDER, HOUSE_TIERS, LABOR_CATS } from './types';
import type { Building, Census, GameState, HouseTierId, LaborCat, Person, Quad, StageIndex } from './types';
import { censusEpoch, memo } from './memo';
import { derived } from './derived';
import { caps, horreaCap, portion } from './economy';
import { fx, fxAdd } from './fx';
import { getBuilding } from './state';
import { isAquae } from './housing';
import { BUILDING_DEFS } from './data/buildings';
import { TIER_DEFS } from './data/housing';
import { RANK_DEFS } from './data/ranks';

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

/** People indexed by home, work and family (memo on the census epoch). */
export function peopleIndex(s: GameState): PeopleIndex {
  return memo(s, 'peopleIndex', censusEpoch(s), () => {
    const byHome = new Map<number, Person[]>();
    const byWork = new Map<number, Person[]>();
    const byFamily = new Map<number, Person[]>();
    const builders: Person[] = [];
    const homeless: Person[] = [];
    const push = (m: Map<number, Person[]>, k: number, p: Person): void => {
      const list = m.get(k);
      if (list) list.push(p);
      else m.set(k, [p]);
    };
    for (const p of s.people) {
      if (p.home === null) homeless.push(p);
      else push(byHome, p.home, p);
      if (p.work === BUILDER) builders.push(p);
      else if (p.work !== null) push(byWork, p.work, p);
      push(byFamily, p.family, p);
    }
    return { byHome, byWork, byFamily, builders, homeless };
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

function computeCensus(s: GameState): Census {
  const day = s.day;
  const d = derived(s);
  const ix = peopleIndex(s);
  const byStage: Quad = [0, 0, 0, 0];
  const idle: number[] = [];
  const staffed: Record<number, number> = {};
  const domus = new Set<number>();
  for (const id of d.houses) if (getBuilding(s, id)?.house?.tier === 'domus') domus.add(id);
  const P = B.people;
  let workforce = 0, patricii = 0;
  for (const p of s.people) {
    const age = Math.floor((day - p.born) / YEAR);
    byStage[age < P.YOUTH ? 0 : age < P.ADULT ? 1 : age < P.ELDER ? 2 : 3]++;
    const patrician = p.home !== null && domus.has(p.home);
    if (patrician) patricii++;
    if (age >= P.ADULT && age < P.RETIRE && !patrician && !(p.sickUntil !== undefined && p.sickUntil > day)) {
      workforce++;
      if (p.work === null) idle.push(p.id);
    }
  }
  for (const b of s.buildings) {
    const n = ix.byWork.get(b.id)?.length ?? 0;
    if (n > 0) staffed[b.id] = n;
  }

  let beds = 0, freeBeds = 0, declining = 0;
  const byTier = {} as Record<HouseTierId, number>;
  for (const t of HOUSE_TIERS) byTier[t] = 0;
  const lowCap = fxAdd(s, 'lowCap'), insulaCap = fxAdd(s, 'insulaCap');
  for (const id of d.houses) {
    const b = getBuilding(s, id);
    if (!b?.house) continue;
    const n = bedsOf(s, b, lowCap, insulaCap);
    beds += n;
    freeBeds += Math.max(0, n - (ix.byHome.get(id)?.length ?? 0));
    byTier[b.house.tier]++;
    if (b.house.declining) declining++;
  }
  // A child is born into its parents' home even when that home is full; such a house's crowd fills beds elsewhere in
  // the reckoning, so the colony's free beds never exceed its beds less its housed souls.
  freeBeds = Math.max(0, Math.min(freeBeds, beds - (s.people.length - ix.homeless.length)));

  const slots: Record<number, number> = {};
  const catSlots = {} as Record<LaborCat, number>;
  const catStaffed = {} as Record<LaborCat, number>;
  for (const c of LABOR_CATS) { catSlots[c] = 0; catStaffed[c] = 0; }
  for (const b of s.buildings) {
    const def = BUILDING_DEFS[b.type];
    if (def.slots <= 0) continue;
    const n = b.status === 'done' && b.open ? def.slots : 0;
    slots[b.id] = n;
    if (def.labor) {
      catSlots[def.labor] += n;
      catStaffed[def.labor] += staffed[b.id] ?? 0;
    }
  }
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
    slots, staffed, catSlots, catStaffed,
    houses: d.houses.length, byTier, declining, patricii,
  };
}

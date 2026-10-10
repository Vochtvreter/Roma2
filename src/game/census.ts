// src/game/census.ts — the census memo: stages, workforce, beds, needs, caps, staffing (ARCHITECTURE §8.3). Owner: WP-B.
// SCAFFOLD: complete counts; need = Σ stage NEED × portion × fx; builders have no slot cap (catSlots.builders = staffed).
import { B } from './balance';
import { BUILDER, HOUSE_TIERS, LABOR_CATS } from './types';
import type { Building, Census, GameState, HouseTierId, LaborCat, Person, Quad, StageIndex } from './types';
import { censusEpoch, memo, structEpoch } from './memo';
import { derived } from './derived';
import { caps, horreaCap, portion } from './economy';
import { fx, fxAdd } from './fx';
import { getBuilding } from './state';
import { BUILDING_DEFS } from './data/buildings';
import { TIER_DEFS } from './data/housing';
import { RANK_DEFS } from './data/ranks';

/** The census of a state (memo on day + censusEpoch + structEpoch). */
export function census(s: GameState): Census {
  return memo(s, 'census', `${s.day}|${censusEpoch(s)}|${structEpoch(s)}`, () => computeCensus(s));
}

/** Age in whole years on a day. */
export function ageOf(p: Person, day: number): number {
  return Math.floor((day - p.born) / B.time.YEAR_DAYS);
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
  if (stageOf(p, s.day) < 2) return false;
  if (ageOf(p, s.day) >= B.people.RETIRE) return false;
  if (p.sickUntil !== undefined && p.sickUntil > s.day) return false;
  return !isPatrician(s, p);
}

/** Lives in a domus (patricii never take jobs). */
export function isPatrician(s: GameState, p: Person): boolean {
  if (p.home === null) return false;
  return getBuilding(s, p.home)?.house?.tier === 'domus';
}

/** Beds of a house: tier beds + lowCap (T0–T2) / insulaCap (insula); halved while damaged. */
export function houseBeds(s: GameState, b: Building): number {
  const h = b.house;
  if (!h || b.status !== 'done') return 0;
  const t = TIER_DEFS[h.tier];
  let beds = t.beds;
  if (t.level <= 2) beds += fxAdd(s, 'lowCap');
  if (h.tier === 'insula') beds += fxAdd(s, 'insulaCap');
  // STUB(WP-B): aquae insula +AQUAE_BEDS.
  if (b.damagedUntil !== undefined && b.damagedUntil > s.day) beds = Math.floor(beds / 2);
  return beds;
}

/** Living people whose home is the house (id order). */
export function residents(s: GameState, houseId: number): Person[] {
  return s.people.filter((p) => p.home === houseId);
}

function computeCensus(s: GameState): Census {
  const day = s.day;
  const d = derived(s);
  const byStage: Quad = [0, 0, 0, 0];
  const idle: number[] = [];
  const staffed: Record<number, number> = {};
  const living: Record<number, number> = {};
  let workforce = 0, homeless = 0, builders = 0, patricii = 0;
  for (const p of s.people) {
    byStage[stageOf(p, day)]++;
    if (p.home === null) homeless++;
    else living[p.home] = (living[p.home] ?? 0) + 1;
    if (isPatrician(s, p)) patricii++;
    if (canWork(s, p)) {
      workforce++;
      if (p.work === null) idle.push(p.id);
    }
    if (p.work === BUILDER) builders++;
    else if (p.work !== null) staffed[p.work] = (staffed[p.work] ?? 0) + 1;
  }

  let beds = 0, freeBeds = 0, declining = 0;
  const byTier = {} as Record<HouseTierId, number>;
  for (const t of HOUSE_TIERS) byTier[t] = 0;
  for (const id of d.houses) {
    const b = getBuilding(s, id);
    if (!b?.house) continue;
    const n = houseBeds(s, b);
    beds += n;
    freeBeds += Math.max(0, n - (living[id] ?? 0));
    byTier[b.house.tier]++;
    if (b.house.declining) declining++;
  }

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
  catStaffed.builders = builders;
  catSlots.builders = builders;   // STUB(WP-B): builder capacity (workable sites, Capitolium crew cap)

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
    beds, freeBeds, homeless, roll: RANK_DEFS[s.rank].ceiling,
    need: { grain: sum(grain), water: sum(water) }, groupNeed: { grain, water },
    caps: caps(s), horreaCap: horreaCap(s),
    slots, staffed, catSlots, catStaffed,
    houses: d.houses.length, byTier, declining, patricii,
  };
}

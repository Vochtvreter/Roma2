// src/game/people.ts — names, job assignment, life events, immigration, families (ARCHITECTURE §8.3, DESIGN §6). Owner: WP-B.
// SCAFFOLD: assignJobs fills plan.perBuilding in id order (sticky, best skill first) and the builders; makeFamily and
// settleFamily work; peopleDay, immigrationDay and rehouse are no-ops.
import { B } from './balance';
import { BUILDER, SKILLS } from './types';
import type { Family, GameState, LabourPlan, Person, SkillId, TickContext } from './types';
import type { Rng } from './rng';
import { canWork, houseBeds } from './census';
import { derived } from './derived';
import { toRoman } from './calendar';
import { touchPeople } from './memo';
import { getBuilding, log, nextId } from './state';
import { BUILDING_DEFS } from './data/buildings';
import { DAUGHTER_COG, PRAENOMINA, feminine } from './data/names';

/** Display name: 'Marcus II Valerius', 'Valeria Secunda', 'Valeria Prisca'. */
export function personName(p: Person): string {
  if (p.female) return [feminine(p.gens), p.cog ?? ''].filter((x) => x !== '').join(' ');
  return [p.prae, p.ord ? toRoman(p.ord) : '', p.gens, p.cog ?? ''].filter((x) => x !== '').join(' ');
}

/** Applies a labour plan: releases surplus and ineligible workers, fills slots in building-id order with the best-skilled idle, sets builders. */
export function assignJobs(s: GameState, plan: LabourPlan): void {
  let changed = false;
  const at: Record<number, Person[]> = {};
  const builders: Person[] = [];
  for (const p of s.people) {
    if (p.work === null) continue;
    if (!canWork(s, p)) { p.work = null; changed = true; continue; }
    if (p.work === BUILDER) { builders.push(p); continue; }
    const b = getBuilding(s, p.work);
    if (!b || b.status !== 'done' || !b.open) { p.work = null; changed = true; continue; }
    (at[p.work] ??= []).push(p);
  }
  const target = (id: number, slots: number): number => Math.max(0, Math.min(slots, plan.perBuilding[id] ?? 0));
  // release surplus (highest ids first)
  for (const b of s.buildings) {
    const list = at[b.id];
    if (!list) continue;
    const t = target(b.id, BUILDING_DEFS[b.type].slots);
    while (list.length > t) { (list.pop() as Person).work = null; changed = true; }
  }
  while (builders.length > Math.max(0, plan.builders)) { (builders.pop() as Person).work = null; changed = true; }
  // fill: building-id order, best skill first, then lowest id  (STUB(WP-B): High priority first, marginal output)
  const pool = s.people.filter((p) => p.work === null && canWork(s, p));
  const taken = new Set<number>();
  for (const b of s.buildings) {
    if (b.status !== 'done' || !b.open) continue;
    const def = BUILDING_DEFS[b.type];
    let need = target(b.id, def.slots) - (at[b.id]?.length ?? 0);
    if (need <= 0) continue;
    const skill = def.skill;
    const cands = pool.filter((p) => !taken.has(p.id))
      .sort((a, c) => (skill ? (c.skills[skill] ?? 0) - (a.skills[skill] ?? 0) : 0) || a.id - c.id);
    for (const p of cands) {
      if (need <= 0) break;
      p.work = b.id;
      taken.add(p.id);
      need--;
      changed = true;
    }
  }
  let nb = Math.max(0, plan.builders) - builders.length;
  for (const p of pool) {
    if (nb <= 0) break;
    if (taken.has(p.id)) continue;
    p.work = BUILDER;
    taken.add(p.id);
    nb--;
    changed = true;
  }
  if (changed) touchPeople(s);
}

/** Daily life: stage logs, deaths, widowing, marriages, births, homeless timers, emigration, the mentor's death. */
export function peopleDay(s: GameState, ctx: TickContext, rng: Rng): void {
  // STUB(WP-B): DESIGN §6.3–6.5 (draws rng in person-id order).
  void s; void ctx; void rng;
}

/** Rome's roll: one Bernoulli roll for a new household, respecting the ceiling and free beds. */
export function immigrationDay(s: GameState, ctx: TickContext, rng: Rng): void {
  // STUB(WP-B): DESIGN §6.6.
  void s; void ctx; void rng;
}

function randomAge(rng: Rng, range: readonly number[]): number {
  return rng.int(range[0], range[1]);
}

/** Creates (but does not settle) a household of a kind, drawing names from `gentes`. */
export function makeFamily(s: GameState, rng: Rng, kind: 'couple' | 'craftsman' | 'widow' | 'veteran', gentes: readonly string[]): { family: Family; people: Person[] } {
  // STUB(WP-B): ages and household mix per DESIGN §6.6 (the ranges below are placeholders).
  const AGE_HEAD = [22, 45] as const, AGE_WIFE = [18, 40] as const, AGE_VET = [38, 50] as const, GIRL_P = 0.5;
  const gens = gentes.length > 0 ? rng.pick(gentes) : 'Valerius';
  const famId = nextId(s);
  const people: Person[] = [];
  const born = (age: number): number => s.day - age * B.time.YEAR_DAYS - rng.int(0, B.time.YEAR_DAYS - 1);
  const person = (female: boolean, age: number, g: string): Person => ({
    id: nextId(s), prae: female ? '' : rng.pick(PRAENOMINA), gens: g, female, born: born(age),
    family: famId, spouse: null, mother: null, father: null, home: null, work: null, skills: {},
  });
  const head = kind === 'widow'
    ? person(true, randomAge(rng, AGE_HEAD), gentes.length > 0 ? rng.pick(gentes) : gens)
    : person(false, randomAge(rng, kind === 'veteran' ? AGE_VET : AGE_HEAD), gens);
  if (kind === 'veteran') head.vet = true;
  if (kind === 'craftsman') head.skills[rng.pick(SKILLS)] = randomAge(rng, B.people.CRAFT_SKILL);
  people.push(head);
  let mother: Person | null = kind === 'widow' ? head : null;
  if (kind === 'couple' || kind === 'veteran') {
    const wife = person(true, randomAge(rng, AGE_WIFE), gentes.length > 0 ? rng.pick(gentes) : gens);
    wife.spouse = head.id;
    head.spouse = wife.id;
    people.push(wife);
    mother = wife;
  }
  const kids = kind === 'couple' ? randomAge(rng, B.people.COUPLE_KIDS) : kind === 'widow' ? randomAge(rng, B.people.WIDOW_KIDS) : 0;
  let daughters = 0;
  for (let k = 0; k < kids; k++) {
    const female = rng.chance(GIRL_P);
    const kid = person(female, randomAge(rng, B.people.KID_AGE), gens);
    kid.mother = mother ? mother.id : null;
    kid.father = head.female ? null : head.id;
    if (female) {
      const cog = DAUGHTER_COG[Math.min(daughters, DAUGHTER_COG.length - 1)];
      if (cog) kid.cog = cog;
      daughters++;
    }
    people.push(kid);
  }
  return { family: { id: famId, gens, head: head.id, home: null }, people };
}

function insertById<T extends { id: number }>(arr: T[], item: T): void {
  let k = arr.length;
  while (k > 0 && arr[k - 1].id > item.id) k--;
  arr.splice(k, 0, item);
}

/** Houses a household in the house with the most free beds (STUB: ties by lowest id); false when no house has room. */
export function settleFamily(s: GameState, ctx: TickContext, fam: { family: Family; people: Person[] }): boolean {
  const n = fam.people.length;
  const living: Record<number, number> = {};
  for (const p of s.people) if (p.home !== null) living[p.home] = (living[p.home] ?? 0) + 1;
  let best = -1, bestFree = 0;
  for (const id of derived(s).houses) {
    const b = getBuilding(s, id);
    if (!b) continue;
    const free = houseBeds(s, b) - (living[id] ?? 0);
    if (free > bestFree) { best = id; bestFree = free; }   // STUB(WP-B): nearest the forum on ties
  }
  if (best < 0 || bestFree < n) return false;
  fam.family.home = best;
  insertById(s.families, fam.family);
  for (const p of fam.people) {
    p.home = best;
    p.arrived = s.day;
    insertById(s.people, p);
  }
  s.stats.immigrants += n;
  ctx.fx.push({ kind: 'arrive', family: fam.family.id, n, home: best });
  log(s, 'good', `The ${fam.family.gens.replace(/us$/, 'i')} arrive: ${n} souls settle in.`, undefined, best);
  touchPeople(s);
  return true;
}

/** Moves homeless people into free beds. */
export function rehouse(s: GameState): void {
  // STUB(WP-B): keep families together; nearest the forum first.
  void s;
}

/** Adds skill experience, respecting SKILL_MAX per skill and the SKILL_LIFETIME budget. */
export function gainSkill(p: Person, skill: SkillId, amount: number): void {
  if (amount <= 0) return;
  const cur = p.skills[skill] ?? 0;
  let total = 0;
  for (const k of SKILLS) total += p.skills[k] ?? 0;
  const add = Math.min(amount, B.people.SKILL_MAX - cur, B.people.SKILL_LIFETIME - total);
  if (add > 0) p.skills[skill] = cur + add;
}

// src/game/people.ts — names, job assignment, life events, immigration, families (ARCHITECTURE §8.3, DESIGN §6). Owner: WP-B.
// Every loop over people is O(n): indexes come from census.peopleIndex, and randomness is drawn in person-id order.
import { B as B$ } from './balance';
import { BUILDER as BUILDER$, SKILLS as SKILLS$ } from './types';
import type { Building, DeathCause, Family, GameState, LabourPlan, Person, SkillId, TickContext } from './types';
import type { Rng } from './rng';
import { ablePeople, ageOf, census, houseBeds, peopleIndex } from './census';
import { derived as derived$, roadNeighbors as roadNeighbors$ } from './derived';
import { toRoman as toRoman$ } from './calendar';
import { fx as fx$ } from './fx';
import { layoutEpoch as layoutEpoch$, memo as memo$, touchJobs as touchJobs$, touchPeople as touchPeople$ } from './memo';
import { careShare } from './civic';
import { log, nextId } from './state';
import { getBuilding as getBuilding$, getPerson as getPerson$ } from './lookup';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { TIER_DEFS as TIER_DEFS$ } from './data/housing';
import { RANK_DEFS as RANK_DEFS$ } from './data/ranks';
import { DAUGHTER_COG as DAUGHTER_COG$, GENTES_IMMIGRANT as GENTES_IMMIGRANT$, PRAENOMINA as PRAENOMINA$, feminine as feminine$ } from './data/names';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, BUILDER = BUILDER$, SKILLS = SKILLS$, derived = derived$, roadNeighbors = roadNeighbors$,
  toRoman = toRoman$, fx = fx$, layoutEpoch = layoutEpoch$, memo = memo$, touchJobs = touchJobs$,
  touchPeople = touchPeople$, BUILDING_DEFS = BUILDING_DEFS$, TIER_DEFS = TIER_DEFS$, RANK_DEFS = RANK_DEFS$,
  DAUGHTER_COG = DAUGHTER_COG$, GENTES_IMMIGRANT = GENTES_IMMIGRANT$, PRAENOMINA = PRAENOMINA$, feminine = feminine$,
  getBuilding = getBuilding$, getPerson = getPerson$;

const P = B.people;
const YEAR = B.time.YEAR_DAYS;
const AGES = P.AGES;             // household shapes (DESIGN §6.6, §12.2 veterans)
const VET_SKILLS: readonly SkillId[] = ['agri', 'fabri', 'silva', 'lapis'];
const FEVER = B.events.PEST;     // DESIGN §12.2 pestilentia: deaths spread over the sickness
/** Modifier id that halves fever deaths (the Vow to Apollo Medicus; set by events.ts). */
export const FEVER_VOW = 'pestilentia.vow';
const FAR = 1 << 14;             // "unreachable" road steps when ranking houses

// ───────────────────────────── names ─────────────────────────────

/** Display name: 'Marcus II Valerius', 'Valeria Secunda', 'Valeria Prisca'. */
export function personName(p: Person): string {
  if (p.female) return [feminine(p.gens), p.cog ?? ''].filter((x) => x !== '').join(' ');
  return [p.prae, p.ord ? toRoman(p.ord) : '', p.gens, p.cog ?? ''].filter((x) => x !== '').join(' ');
}

/** Plural of a gens for log lines: Valerius → the Valerii. */
function gentilic(gens: string): string {
  return gens.endsWith('us') ? `${gens.slice(0, -2)}i` : gens;
}

// ───────────────────────────── jobs ─────────────────────────────

function skillOf(p: Person, skill: SkillId | null): number {
  return skill ? p.skills[skill] ?? 0 : 0;
}

/** A person's best level in any skill other than `skill`. */
function otherSkill(p: Person, skill: SkillId | null): number {
  let best = 0;
  for (const k of SKILLS) if (k !== skill) best = Math.max(best, p.skills[k] ?? 0);
  return best;
}

/** Applies a labour plan (sticky): releases surplus and ineligible workers (least skilled first), fills open slots
 *  High priority first, then id, each with the best-skilled idle worker; builders = plan.builders (fabri first). */
export function assignJobs(s: GameState, plan: LabourPlan): void {
  let changed = false;
  const at = new Map<number, Person[]>();
  const builders: Person[] = [];
  const release = (p: Person): void => { p.work = null; changed = true; };
  const ableList = ablePeople(s);   // canWork today for everyone, from the census's pass over people
  const able = new Set(ableList);
  for (const p of s.people) {
    if (p.work === null) continue;
    if (!able.has(p)) { release(p); continue; }
    if (p.work === BUILDER) { builders.push(p); continue; }
    const b = getBuilding(s, p.work);
    if (!b || b.status !== 'done' || !b.open) { release(p); continue; }
    const list = at.get(b.id);
    if (list) list.push(p);
    else at.set(b.id, [p]);
  }
  const target = (b: Building): number => {
    if (b.status !== 'done' || !b.open) return 0;
    return Math.max(0, Math.min(BUILDING_DEFS[b.type].slots, Math.floor(plan.perBuilding[b.id] ?? 0)));
  };
  const leastFirst = (skill: SkillId | null) => (a: Person, c: Person): number => skillOf(a, skill) - skillOf(c, skill) || c.id - a.id;
  for (const [id, list] of at) {
    const b = getBuilding(s, id) as Building;
    const t = target(b);
    if (list.length > t) list.sort(leastFirst(BUILDING_DEFS[b.type].skill)).slice(0, list.length - t).forEach(release);
  }
  const nb = Math.max(0, Math.floor(plan.builders));
  if (builders.length > nb) builders.sort(leastFirst('fabri')).slice(0, builders.length - nb).forEach(release);

  // idle pool: each pick takes the best untaken worker in the skill, then the least gifted elsewhere (specialists stay
  // free for their own trade), then the lowest id. A day moves a handful of hands, so each pick scans the pool for the
  // first in that order instead of sorting the whole pool per skill (keys computed once per skill and person).
  const pool = ableList.filter((p) => p.work === null);
  const keyed = new Map<string, { k: number[]; o: number[] }>();
  const pick = (skill: SkillId | null): Person | null => {
    const key = skill ?? '';
    let e = keyed.get(key);
    if (!e) {
      e = { k: pool.map((p) => skillOf(p, skill)), o: pool.map((p) => otherSkill(p, skill)) };
      keyed.set(key, e);
    }
    const { k, o } = e;
    let best = -1;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].work !== null) continue;
      if (best < 0 || k[i] > k[best] || (k[i] === k[best] && (o[i] < o[best] || (o[i] === o[best] && pool[i].id < pool[best].id)))) best = i;
    }
    return best < 0 ? null : pool[best];
  };
  const fill = (n: number, skill: SkillId | null, work: number): void => {
    for (; n > 0; n--) {
      const p = pick(skill);
      if (!p) return;
      p.work = work;
      changed = true;
    }
  };
  const order = s.buildings.filter((b) => target(b) > (at.get(b.id)?.length ?? 0)).sort((a, b) => b.prio - a.prio || a.id - b.id);
  for (const b of order) fill(target(b) - (at.get(b.id)?.length ?? 0), BUILDING_DEFS[b.type].skill, b.id);
  fill(nb - Math.min(builders.length, nb), 'fabri', BUILDER);
  if (changed) touchJobs(s);   // only `work` moved: the people-only parts of the census are kept
}

// ───────────────────────────── housing people ─────────────────────────────

/** Road steps from a house to the forum (min over its road neighbours; FAR when unreachable), memo on the layout epoch. */
export function forumSteps(s: GameState, b: Building): number {
  const m = memo(s, 'forumSteps', layoutEpoch(s), () => new Map<number, number>());
  let v = m.get(b.id);
  if (v === undefined) {
    const steps = derived(s).stepsToForum;
    v = FAR;
    for (const i of roadNeighbors(s, b)) if (steps[i] >= 0 && steps[i] < v) v = steps[i];
    m.set(b.id, v);
  }
  return v;
}

/** Houses with free beds, best first: most free beds, then nearest the forum, then lowest id. */
function houseRanking(s: GameState): { b: Building; free: number }[] {
  const ix = peopleIndex(s);
  const out: { b: Building; free: number }[] = [];
  for (const id of derived(s).houses) {
    const b = getBuilding(s, id);
    if (!b) continue;
    const free = houseBeds(s, b) - (ix.byHome.get(id)?.length ?? 0);
    if (free > 0) out.push({ b, free });
  }
  return out.sort((a, c) => c.free - a.free || forumSteps(s, a.b) - forumSteps(s, c.b) || a.b.id - c.b.id);
}

/** Houses a group together (in `prefer` if it holds them all, else the best house that does), else splits it across
 *  the best houses. Returns the house holding the most of the group, or null when the colony lacks the beds. */
function houseGroup(s: GameState, group: Person[], prefer: number | null = null): number | null {
  const ranking = houseRanking(s);
  let total = 0;
  for (const h of ranking) total += h.free;
  if (group.length === 0 || total < group.length) return null;
  const whole = ranking.find((h) => h.b.id === prefer && h.free >= group.length) ?? ranking.find((h) => h.free >= group.length);
  let main = -1, mainN = 0, k = 0;
  for (const h of whole ? [whole] : ranking) {
    let n = 0;
    while (n < h.free && k < group.length) {
      const p = group[k++];
      p.home = h.b.id;
      delete p.homelessSince;
      n++;
    }
    if (n > mainN) { main = h.b.id; mainN = n; }
    if (k >= group.length) break;
  }
  touchPeople(s);
  return main;
}

function insertById<T extends { id: number }>(arr: T[], item: T): void {
  let k = arr.length;
  while (k > 0 && arr[k - 1].id > item.id) k--;
  arr.splice(k, 0, item);
}

/** Houses a new household in the house with the most free beds nearest the forum (split only if no house holds it all);
 *  false when the colony lacks the beds. Logs the arrival and raises fx arrive. */
export function settleFamily(s: GameState, ctx: TickContext, fam: { family: Family; people: Person[] }): boolean {
  const n = fam.people.length;
  const home = houseGroup(s, fam.people.slice());
  if (home === null) return false;
  fam.family.home = home;
  insertById(s.families, fam.family);
  for (const p of fam.people) {
    p.arrived = s.day;
    insertById(s.people, p);
  }
  s.stats.immigrants += n;
  ctx.fx.push({ kind: 'arrive', family: fam.family.id, n, home });
  const tier = getBuilding(s, home)?.house?.tier;
  const where = tier ? ` in a ${TIER_DEFS[tier].name.toLowerCase()}` : '';
  log(s, 'good', `The ${gentilic(fam.family.gens)} arrive along the via: ${n} ${n === 1 ? 'soul settles' : 'souls settle'}${where}.`, undefined, home);
  touchPeople(s);
  return true;
}

/** Moves homeless people into free beds, family by family (together where one house holds them). */
export function rehouse(s: GameState): void {
  const homeless = peopleIndex(s).homeless;
  if (homeless.length === 0) return;
  const byFamily = new Map<number, Person[]>();
  for (const p of homeless) {
    const g = byFamily.get(p.family);
    if (g) g.push(p);
    else byFamily.set(p.family, [p]);
  }
  for (const fid of [...byFamily.keys()].sort((a, c) => a - c)) {
    const f = s.families.find((x) => x.id === fid);
    const home = houseGroup(s, byFamily.get(fid) as Person[], f?.home ?? null);
    if (f && home !== null && f.home === null) f.home = home;
  }
}

/** Evicts residents above a house's beds (newest family first, then newest members); they become homeless today. */
export function evictOverflow(s: GameState, houseId: number): number {
  const b = getBuilding(s, houseId);
  if (!b) return 0;
  const beds = houseBeds(s, b);
  const res = peopleIndex(s).byHome.get(houseId) ?? [];
  let over = res.length - beds;
  if (over <= 0) return 0;
  const order = res.slice().sort((a, c) => c.family - a.family || c.id - a.id);
  let n = 0;
  for (const p of order) {
    if (over <= 0) break;
    p.home = null;
    p.homelessSince = s.day;
    over--;
    n++;
  }
  for (const f of s.families) if (f.home === houseId && !res.some((p) => p.family === f.id && p.home === houseId)) f.home = null;
  touchPeople(s);
  return n;
}

// ───────────────────────────── deaths ─────────────────────────────

function isMentor(s: GameState, p: Person): boolean {
  return s.counters.mentorDiedDay === null && p.prae === 'Decimus' && p.gens === 'Cassius' && p.arrived === undefined
    && p.born < B.time.START_DAY - P.ADULT * YEAR;
}

const DEATH_TEXT: Record<DeathCause, string> = {
  age: 'dies full of years', hunger: 'starves', thirst: 'dies of thirst', fever: 'dies of the fever',
  fire: 'dies in the fire', other: 'dies of a sickness',
};

/** Bookkeeping for people who died or left: spouses widowed, family heads passed on, empty families dropped. */
function afterRemoval(s: GameState, gone: Set<number>, died: boolean): void {
  if (gone.size === 0) return;
  s.people = s.people.filter((p) => !gone.has(p.id));
  for (const p of s.people) {
    if (p.spouse !== null && gone.has(p.spouse)) {
      p.spouse = null;
      if (died) p.widowedDay = s.day;
    }
  }
  touchPeople(s);
  const byFamily = peopleIndex(s).byFamily;
  s.families = s.families.filter((f) => byFamily.has(f.id));
  for (const f of s.families) {
    if (!gone.has(f.head)) continue;
    const members = byFamily.get(f.id) as Person[];
    const heir = members.reduce((a, c) => (c.born < a.born ? c : a));
    f.head = heir.id;
    f.home = heir.home;
  }
}

function recordDeath(s: GameState, ctx: TickContext, p: Person, cause: DeathCause): void {
  s.stats.deaths++;
  s.stats.deathsBy[cause]++;
  ctx.fx.push({ kind: 'death', home: p.home });
  const age = ageOf(p, s.day);
  const isAge = cause === 'age';
  log(s, 'death', `${personName(p)} ${DEATH_TEXT[cause]}, aged ${age}.`, isAge ? undefined : ['highlight'], p.home ?? undefined);
  if (isMentor(s, p)) {
    s.counters.mentorDiedDay = s.day;
    log(s, 'info', 'Decimus Cassius, primus pilus emeritus, is laid to rest. His notes stay with the Ordo.', ['highlight']);
  }
}

/** Kills one person now (events: fire, fever): logs, stats, fx, widowing, family heads. */
export function killPerson(s: GameState, ctx: TickContext, p: Person, cause: DeathCause): void {
  recordDeath(s, ctx, p, cause);
  afterRemoval(s, new Set([p.id]), true);
}

function deaths(s: GameState, ctx: TickContext, rng: Rng): void {
  const day = s.day;
  const hz = P.HAZARD;
  const care = careShare(s);
  const careF = 1 - hz.care * care;
  const off = ctx.offline ? P.OFFLINE_STARVE : 1;
  const vow = s.modifiers.some((m) => m.id === FEVER_VOW && m.until > day);
  const fever = 1 - Math.pow(1 - FEVER.DEATH * (1 - FEVER.CARE * care) * (vow ? FEVER.VOW_DEATHS : 1), 1 / FEVER.DAYS);
  const { hunger, thirst } = s.needs;
  const gone = new Set<number>();
  for (const p of s.people) {
    const a = (day - p.born) / YEAR;
    const g = a < P.YOUTH ? 0 : a < P.ADULT ? 1 : a < P.ELDER ? 2 : 3;
    const pH = hunger[g] > P.DEATH_AT ? P.STARVE_P * off : 0;
    const pT = thirst[g] > P.DEATH_AT ? P.THIRST_P * off : 0;
    const pF = p.sickUntil !== undefined && p.sickUntil > day ? fever : 0;
    const h = (a < 1 ? hz.infant : a < P.YOUTH ? hz.child : hz.adult) + hz.a * Math.exp((a - hz.mid) / hz.scale);
    const pA = (h * careF) / YEAR;
    const u = rng.next();
    let cause: DeathCause | null = null;
    if (u < pH) cause = 'hunger';
    else if (u < pH + pT) cause = 'thirst';
    else if (u < pH + pT + pF) cause = 'fever';
    else if (u < pH + pT + pF + pA) cause = a >= hz.mid ? 'age' : 'other';
    if (!cause) continue;
    recordDeath(s, ctx, p, cause);
    gone.add(p.id);
  }
  afterRemoval(s, gone, true);
}

// ───────────────────────────── marriages and births ─────────────────────────────

function between(age: number, range: readonly number[]): boolean {
  return age >= range[0] && age <= range[1];
}

function mayMarry(s: GameState, p: Person, range: readonly number[]): boolean {
  if (p.spouse !== null || !between(ageOf(p, s.day), range)) return false;
  return p.widowedDay === undefined || s.day - p.widowedDay >= P.REMARRY_DAYS;
}

function parentsOf(p: Person): number[] {
  return [p.father, p.mother].filter((x): x is number => x !== null);
}

/** Kinship bar: no parent, child, sibling, or shared parent/grandparent. */
function kin(s: GameState, a: Person, b: Person): boolean {
  const pa = parentsOf(a), pb = parentsOf(b);
  if (pa.includes(b.id) || pb.includes(a.id)) return true;
  if (pa.some((x) => pb.includes(x))) return true;
  const grand = (ids: number[]): number[] => ids.flatMap((id) => { const q = getPerson(s, id); return q ? parentsOf(q) : []; });
  const ga = grand(pa);
  if (ga.length === 0) return false;
  const gb = grand(pb);
  return ga.some((x) => gb.includes(x)) || ga.some((x) => pb.includes(x)) || gb.some((x) => pa.includes(x));
}

function marry(s: GameState, m: Person, w: Person): void {
  m.spouse = w.id;
  w.spouse = m.id;
  delete m.widowedDay;
  delete w.widowedDay;
  const oldFam = w.family;
  const movers = s.people.filter((p) => p.id === w.id || (p.family === oldFam && p.mother === w.id && ageOf(p, s.day) < P.ADULT));
  for (const p of movers) p.family = m.family;
  const home = m.home !== null ? getBuilding(s, m.home) : undefined;
  if (home && houseBeds(s, home) - (peopleIndex(s).byHome.get(home.id)?.length ?? 0) >= movers.filter((p) => p.home !== home.id).length) {
    for (const p of movers) { p.home = home.id; delete p.homelessSince; }
  }
  touchPeople(s);
  const fam = s.families.find((f) => f.id === oldFam);
  if (fam && fam.head === w.id) {
    const rest = peopleIndex(s).byFamily.get(oldFam) ?? [];
    if (rest.length > 0) { fam.head = rest.reduce((a, c) => (c.born < a.born ? c : a)).id; }
  }
  if (!peopleIndex(s).byFamily.has(oldFam)) s.families = s.families.filter((f) => f.id !== oldFam);
  log(s, 'good', `${personName(m)} weds ${personName(w)}.`, undefined, m.home ?? undefined);
}

function marriages(s: GameState, rng: Rng): void {
  let women: Person[] | null = null;
  let done = 0;
  for (const m of s.people) {
    if (done >= P.MARRY_MAX) break;
    if (m.female || !mayMarry(s, m, P.MARRY_M)) continue;
    if (!rng.chance(P.MARRY_P)) continue;
    women ??= s.people.filter((w) => w.female && mayMarry(s, w, P.MARRY_F));
    const w = women.find((x) => x.spouse === null && x.gens !== m.gens && !kin(s, m, x));
    if (!w) continue;
    marry(s, m, w);
    done++;
  }
}

/** Days-on-hand factor of an essential from a [threshold, factor] table (first threshold met wins). */
function dohFactor(s: GameState, res: 'grain' | 'water', table: readonly (readonly number[])[]): number {
  const need = census(s).need[res];
  const doh = need > 0 ? s.res[res] / need : Infinity;
  return (table.find(([at]) => doh >= at) ?? table[table.length - 1])[1];
}

/** Food factor for births and immigration: grain DoH ≥ 20 → 1, ≥ 10 → 0.5, else 0.1. */
export function foodFactor(s: GameState): number {
  return dohFactor(s, 'grain', P.FOOD_F);
}

function bedsFactor(free: number): number {
  for (const [at, f] of P.BIRTH_BEDS) if (free >= at) return f;
  return 0;
}

function nameChild(s: GameState, father: Person | null, mother: Person, female: boolean, rng: Rng): Pick<Person, 'prae' | 'ord' | 'cog'> {
  const family = peopleIndex(s).byFamily.get((father ?? mother).family) ?? [];
  if (female) {
    const sisters = s.people.filter((p) => p.female && (father ? p.father === father.id : p.mother === mother.id)).length;
    const cog = DAUGHTER_COG[Math.min(sisters, DAUGHTER_COG.length - 1)];
    return cog ? { prae: '', cog } : { prae: '' };
  }
  const prae = rng.pick(PRAENOMINA);
  const same = family.filter((p) => !p.female && p.prae === prae);
  if (same.length === 0) return { prae };
  return { prae, ord: Math.max(...same.map((p) => p.ord ?? 1)) + 1 };
}

function births(s: GameState, ctx: TickContext, rng: Rng): void {
  const c = census(s);
  const moraleF = Math.min(P.BIRTH_MORALE[2], Math.max(P.BIRTH_MORALE[1], s.morale / P.BIRTH_MORALE[0]));
  const base = (P.BIRTH_RATE * foodFactor(s) * moraleF * fx(s, 'births')) / YEAR;
  let free = c.freeBeds;
  const mothers = s.people.filter((w) => w.female && w.spouse !== null && between(ageOf(w, s.day), P.FERTILE));
  for (const w of mothers) {
    const u = rng.next();
    if (u >= base) continue;
    if (u >= base * bedsFactor(free)) { s.counters.lastBirthBlocked = s.day; continue; }
    const father = w.spouse !== null ? getPerson(s, w.spouse) ?? null : null;
    const female = rng.chance(P.GIRL_P);
    const name = nameChild(s, father, w, female, rng);
    const kid: Person = {
      id: nextId(s), prae: name.prae, gens: father?.gens ?? w.gens, female, born: s.day,
      family: father?.family ?? w.family, spouse: null, mother: w.id, father: father?.id ?? null,
      home: father?.home ?? w.home, work: null, skills: {},
    };
    if (name.ord) kid.ord = name.ord;
    if (name.cog) kid.cog = name.cog;
    insertById(s.people, kid);
    touchPeople(s);
    free--;
    s.stats.births++;
    ctx.fx.push({ kind: 'birth', home: kid.home });
    const parents = father ? `${personName(father)} and ${personName(w)}` : personName(w);
    log(s, 'birth', `${female ? 'A daughter' : 'A son'}, ${personName(kid)}, is born to ${parents}.`, undefined, kid.home ?? undefined);
  }
}

// ───────────────────────────── the daily round ─────────────────────────────

function comingOfAge(s: GameState): void {
  for (const p of s.people) {
    const d = s.day - p.born;
    if (d <= 0 || d % YEAR !== 0) continue;
    const age = d / YEAR;
    if (age === P.ADULT) log(s, 'info', `${personName(p)} comes of age and may take up work.`, undefined, p.home ?? undefined);
    else if (age === P.RETIRE) log(s, 'info', `${personName(p)} lays down the tools of a lifetime.`, undefined, p.home ?? undefined);
  }
}

function leave(s: GameState, ctx: TickContext, ids: Set<number>, text: string): void {
  if (ids.size === 0) return;
  s.stats.emigrants += ids.size;
  ctx.fx.push({ kind: 'leave', n: ids.size });
  log(s, 'bad', text, ['highlight']);
  afterRemoval(s, ids, false);
}

function homelessLeave(s: GameState, ctx: TickContext): void {
  const gone = new Set<number>();
  for (const p of peopleIndex(s).homeless) {
    if (p.homelessSince === undefined) p.homelessSince = s.day;
    else if (s.day - p.homelessSince >= P.HOMELESS_LEAVE) gone.add(p.id);
  }
  const n = gone.size;
  leave(s, ctx, gone, `${n} homeless ${n === 1 ? 'soul gives' : 'souls give'} up waiting for a bed and ${n === 1 ? 'leaves' : 'leave'} the colony.`);
}

function emigration(s: GameState, ctx: TickContext, rng: Rng): void {
  if (s.morale >= P.EMIGRATE_MORALE || s.families.length === 0) return;
  if (!rng.chance(P.EMIGRATE_P)) return;
  const fam = rng.pick(s.families);
  const members = peopleIndex(s).byFamily.get(fam.id) ?? [];
  const n = members.length;
  leave(s, ctx, new Set(members.map((p) => p.id)), `Despondent, the ${gentilic(fam.gens)} pack their cart and leave the colony (${n} ${n === 1 ? 'soul' : 'souls'}).`);
}

/** Daily life: coming of age, deaths (hazard, starvation, thirst, fever) and widowing, marriages, births, re-housing,
 *  homeless departures, emigration, the mentor's death. Draws randomness in person-id order. */
export function peopleDay(s: GameState, ctx: TickContext, rng: Rng): void {
  comingOfAge(s);
  deaths(s, ctx, rng);
  marriages(s, rng);
  births(s, ctx, rng);
  rehouse(s);
  homelessLeave(s, ctx);
  emigration(s, ctx, rng);
}

// ───────────────────────────── immigration (DESIGN §6.6) ─────────────────────────────

/** Today's chance of a new household: IMM_RATE[rank] × attract (morale, food, water, fx immigration). */
export function immigrationChance(s: GameState): number {
  const A = P.ATTRACT;
  const moraleF = Math.min(A.MAX, Math.max(0, (s.morale - A.MORALE) / A.SPAN));
  return RANK_DEFS[s.rank].immRate * moraleF * foodFactor(s) * dohFactor(s, 'water', P.WATER_F) * fx(s, 'immigration');
}

/** Gentes of a pool not yet present in the colony (the whole pool when every one is). */
export function freshGentes(s: GameState, pool: readonly string[]): string[] {
  const present = new Set<string>();
  for (const p of s.people) present.add(p.gens);
  const fresh = pool.filter((g) => !present.has(g));
  return fresh.length > 0 ? fresh : pool.slice();
}

/** Rome's roll: one Bernoulli roll for a new household; it arrives only within the roll and with the beds for it. */
export function immigrationDay(s: GameState, ctx: TickContext, rng: Rng): void {
  if (!rng.chance(immigrationChance(s))) return;
  const c = census(s);
  const roll = RANK_DEFS[s.rank].ceiling;
  if (c.pop >= roll || s.people.length >= P.POP_CAP) return;
  if (c.freeBeds <= 0) { s.counters.lastArrivalBlocked = s.day; return; }
  const mix = P.HOUSEHOLD_MIX;
  const u = rng.next();
  const kind = u < mix[0] ? 'couple' : u < mix[0] + mix[1] ? 'craftsman' : 'widow';
  const fam = makeFamily(s, rng, kind, freshGentes(s, GENTES_IMMIGRANT));
  const n = fam.people.length;
  if (c.pop + n > roll) return;
  if (c.freeBeds < n || !settleFamily(s, ctx, fam)) s.counters.lastArrivalBlocked = s.day;
}

// ───────────────────────────── households ─────────────────────────────

/** Creates (but does not settle) a household of a kind, drawing its nomen from `gentes` (DESIGN §6.6, §12.2). */
export function makeFamily(s: GameState, rng: Rng, kind: 'couple' | 'craftsman' | 'widow' | 'veteran', gentes: readonly string[]): { family: Family; people: Person[] } {
  const pool = gentes.length > 0 ? gentes : GENTES_IMMIGRANT;
  const gens = rng.pick(pool);
  const otherGens = (): string => {
    const others = pool.filter((g) => g !== gens);
    return others.length > 0 ? rng.pick(others) : rng.pick(GENTES_IMMIGRANT.filter((g) => g !== gens));
  };
  const famId = nextId(s);
  const people: Person[] = [];
  const person = (female: boolean, age: number, g: string): Person => ({
    id: nextId(s), prae: female ? '' : rng.pick(PRAENOMINA), gens: g, female,
    born: s.day - age * YEAR - rng.int(0, YEAR - 1),
    family: famId, spouse: null, mother: null, father: null, home: null, work: null, skills: {},
  });
  const age = (r: readonly number[]): number => rng.int(r[0], r[1]);
  let head: Person;
  let mother: Person | null = null;
  if (kind === 'widow') {
    head = person(true, age(AGES.widow), otherGens());
    mother = head;
  } else {
    head = person(false, age(kind === 'veteran' ? AGES.vetHead : kind === 'craftsman' ? AGES.craftsman : AGES.coupleHead), gens);
  }
  people.push(head);
  if (kind === 'craftsman') head.skills[rng.pick(SKILLS)] = age(P.CRAFT_SKILL);
  if (kind === 'veteran') {
    head.vet = true;
    const bonus = s.decisions.paths.charter === 'veterani' ? 1 : 0;
    const primary = rng.pick(VET_SKILLS);
    head.skills[primary] = Math.min(P.SKILL_MAX, age(P.VET_SKILL) + bonus);
    if (rng.chance(P.VET_SECOND_P)) {
      const second = rng.pick(VET_SKILLS.filter((k) => k !== primary));
      head.skills[second] = age(P.VET_SECOND);
    }
  }
  if (kind === 'couple' || kind === 'veteran') {
    const wife = person(true, age(kind === 'veteran' ? AGES.vetWife : AGES.coupleWife), otherGens());
    wife.spouse = head.id;
    head.spouse = wife.id;
    people.push(wife);
    mother = wife;
  }
  const kids = kind === 'couple' ? age(P.COUPLE_KIDS) : kind === 'widow' ? age(P.WIDOW_KIDS) : kind === 'veteran' ? age(AGES.vetKids) : 0;
  const kidAges = kind === 'veteran' ? AGES.vetKidAge : P.KID_AGE;
  const motherAge = mother ? ageOf(mother, s.day) : 0;
  let daughters = 0;
  for (let k = 0; k < kids; k++) {
    const maxAge = Math.min(kidAges[1], motherAge - P.MOTHER_GAP);
    if (maxAge < kidAges[0]) break;
    const female = rng.chance(P.GIRL_P);
    const kid = person(female, rng.int(kidAges[0], maxAge), gens);
    kid.mother = mother ? mother.id : null;
    kid.father = head.female ? null : head.id;
    if (female) {
      kid.prae = '';
      const cog = DAUGHTER_COG[Math.min(daughters, DAUGHTER_COG.length - 1)];
      if (cog) kid.cog = cog;
      daughters++;
    } else {
      const same = people.filter((p) => !p.female && p.prae === kid.prae);
      if (same.length > 0) kid.ord = Math.max(...same.map((p) => p.ord ?? 1)) + 1;
    }
    people.push(kid);
  }
  return { family: { id: famId, gens, head: head.id, home: null }, people };
}

/** Adds skill experience, respecting SKILL_MAX per skill and the SKILL_LIFETIME budget. */
export function gainSkill(p: Person, skill: SkillId, amount: number): void {
  if (amount <= 0) return;
  const cur = p.skills[skill] ?? 0;
  let total = 0;
  for (const k of SKILLS) total += p.skills[k] ?? 0;
  const add = Math.min(amount, P.SKILL_MAX - cur, P.SKILL_LIFETIME - total);
  if (add > 0) p.skills[skill] = cur + add;
}

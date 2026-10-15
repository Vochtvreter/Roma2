// src/game/state.ts — the new game, the founding roster, the log and cost helpers (ARCHITECTURE §8.1, DESIGN §6.2, §18.1).
import { B as B$ } from './balance';
import { ADVISORS as ADVISORS$, EDICTS as EDICTS$, LABOR_CATS as LABOR_CATS$, RESOURCES as RESOURCES$, SETTINGS as SETTINGS$, SWITCHES as SWITCHES$, TRADE_RES as TRADE_RES$, DUTIES, WORK_DUTIES } from './types';
import type {
  AdvisorId, Block, Building, BuildingId, Cost, DecisionState, EdictId, Family, GameState, HouseState, LaborCat,
  LogKind, LogTag, OrdoState, Person, Res, SettingId, SkillId, SwitchId, TradeRes,
} from './types';
import { GAME_SEED_XOR as GAME_SEED_XOR$ } from './rng';
import { getMap as getMap$ } from './map';
import { plotOrigin as plotOrigin$ } from './survey';
import { footprintOf as footprintOf$ } from './derived';
import { roadPathFor } from './place';
import { bestSlot } from './site';
import { invalidate as invalidate$ } from './memo';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { EDICT_DEFS as EDICT_DEFS$, SETTING_DEFS as SETTING_DEFS$, SWITCH_DEFS as SWITCH_DEFS$ } from './data/decisions';
import { COLONY_NAMES as COLONY_NAMES$ } from './data/names';
import { SAVE_VERSION } from './save';
import { getBuilding, getPerson } from './lookup';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, ADVISORS = ADVISORS$, EDICTS = EDICTS$, LABOR_CATS = LABOR_CATS$, RESOURCES = RESOURCES$,
  SETTINGS = SETTINGS$, SWITCHES = SWITCHES$, TRADE_RES = TRADE_RES$, GAME_SEED_XOR = GAME_SEED_XOR$, getMap = getMap$,
  plotOrigin = plotOrigin$, footprintOf = footprintOf$, invalidate = invalidate$,
  BUILDING_DEFS = BUILDING_DEFS$, EDICT_DEFS = EDICT_DEFS$, SETTING_DEFS = SETTING_DEFS$, SWITCH_DEFS = SWITCH_DEFS$,
  COLONY_NAMES = COLONY_NAMES$;

/** "Never happened" day for cooldown counters (far in the past; plain JSON, unlike −Infinity). */
export const NEVER = -1_000_000;
/** The first colony's name. */
export const DEFAULT_NAME = 'Castra Valeria';
/** Advisors appointed at the founding (DESIGN §11.3). */
export const START_ADVISORS: readonly AdvisorId[] = ADVISORS.slice(0, 3);   // annonae, aquarum, fabrum

const EPS = 1e-9;

// ───────────────────────────── founding roster (DESIGN §6.2, rome's 24 souls) ─────────────────────────────
interface RosterKid { prae: string; age: number; female: boolean }
interface RosterRow {
  gens: string;
  head: { prae: string; age: number; skills: Partial<Record<SkillId, number>>; job?: BuildingId };
  wife: { gens: string; age: number; cog?: string };
  kids: RosterKid[];
}
const ROSTER: readonly RosterRow[] = [
  { gens: 'Valerius', head: { prae: 'Marcus', age: 38, skills: { agri: 2 }, job: 'ager' }, wife: { gens: 'Livius', age: 34 },
    kids: [{ prae: 'Gaius', age: 14, female: false }, { prae: '', age: 8, female: true }] },
  { gens: 'Antonius', head: { prae: 'Lucius', age: 42, skills: { aqua: 1 }, job: 'puteus' }, wife: { gens: 'Aelius', age: 36 },
    kids: [{ prae: 'Publius', age: 10, female: false }, { prae: '', age: 5, female: true }] },
  { gens: 'Flavius', head: { prae: 'Titus', age: 35, skills: { aqua: 1 }, job: 'puteus' }, wife: { gens: 'Valerius', age: 32, cog: 'Prisca' },
    kids: [{ prae: 'Quintus', age: 16, female: false }, { prae: '', age: 12, female: true }] },
  { gens: 'Cassius', head: { prae: 'Decimus', age: 41, skills: { fabri: 2 } }, wife: { gens: 'Iunius', age: 33 },
    kids: [{ prae: '', age: 9, female: true }, { prae: 'Aulus', age: 4, female: false }] },
  { gens: 'Aemilius', head: { prae: 'Gnaeus', age: 39, skills: { aqua: 1 }, job: 'lignarius' }, wife: { gens: 'Caecilius', age: 35 },
    kids: [{ prae: 'Sextus', age: 11, female: false }, { prae: '', age: 6, female: true }] },
  { gens: 'Iulius', head: { prae: 'Publius', age: 40, skills: { lapis: 1 } }, wife: { gens: 'Claudius', age: 37 },
    kids: [{ prae: 'Lucius', age: 15, female: false }, { prae: '', age: 7, female: true }] },
];
// Birthdays are spread deterministically so nobody changes age on the same day (or in the first ~100 days).
const BIRTHDAY_BASE = 20;
const BIRTHDAY_STEP = 41;
const BIRTHDAY_SPAN = 240;

/** The 24 founding souls in 6 families (homes and jobs are set by newGame). */
export function foundingRoster(day: number, nextId: () => number): { people: Person[]; families: Family[] } {
  const people: Person[] = [];
  const families: Family[] = [];
  let n = 0;
  const born = (age: number): number => {
    const off = BIRTHDAY_BASE + ((n++ * BIRTHDAY_STEP) % BIRTHDAY_SPAN);
    return day - age * B.time.YEAR_DAYS - off;
  };
  for (const row of ROSTER) {
    const famId = nextId();
    const headId = nextId();
    const wifeId = nextId();
    const head: Person = {
      id: headId, prae: row.head.prae, gens: row.gens, female: false, born: born(row.head.age),
      family: famId, spouse: wifeId, mother: null, father: null, home: null, work: null, skills: { ...row.head.skills },
    };
    const wife: Person = {
      id: wifeId, prae: '', gens: row.wife.gens, female: true, born: born(row.wife.age),
      family: famId, spouse: headId, mother: null, father: null, home: null, work: null, skills: {},
    };
    if (row.wife.cog) wife.cog = row.wife.cog;
    people.push(head, wife);
    for (const k of row.kids) {
      people.push({
        id: nextId(), prae: k.prae, gens: row.gens, female: k.female, born: born(k.age),
        family: famId, spouse: null, mother: wifeId, father: headId, home: null, work: null, skills: {},
      });
    }
    families.push({ id: famId, gens: row.gens, head: headId, home: null });
  }
  return { people, families };
}

// ───────────────────────────── new game (DESIGN §18.1) ─────────────────────────────

/** A fresh resource record (all zero). */
export function emptyRes(): Res {
  const r = {} as Res;
  for (const k of RESOURCES) r[k] = 0;
  return r;
}

function newHouse(): HouseState {
  return { tier: 'tentoria', pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 };
}

function startBuilding(id: number, type: BuildingId, x: number, y: number, day: number): Building {
  return {
    id, type, x, y, owner: 'start', status: 'done', placed: day, progress: 1, work: BUILDING_DEFS[type].work,
    paid: true, order: id, open: true, prio: 1, doneDay: day,
  };
}

function defaultDecisions(): DecisionState {
  const edicts = {} as Record<EdictId, string>;
  for (const e of EDICTS) edicts[e] = EDICT_DEFS[e].initial;
  const settings = {} as Record<SettingId, number>;
  for (const k of SETTINGS) settings[k] = SETTING_DEFS[k].initial;
  const switches = {} as Record<SwitchId, boolean>;
  for (const k of SWITCHES) switches[k] = SWITCH_DEFS[k].initial;
  return { focus: 'concordia', edicts, edictLock: {}, paths: {}, pathDays: {}, settings, switches };
}

function defaultOrdo(): OrdoState {
  const manual = {} as Record<LaborCat, number>;
  for (const c of LABOR_CATS) manual[c] = 0;
  return {
    on: { labour: true, build: true, trade: true }, manual, requests: [], pin: null, reserved: [], priorities: [],
    emergency: { rations: 'none', waterPause: false, lastImport: NEVER, lastRelief: NEVER, freeReliefYear: -1, hands: false },
    works: { water: true, food: true, homes: true, services: true, materials: true, plan: true },
    learned: DUTIES.slice(), answered: [],
  };
}

/** The start plots: the forum-side block of row 1 away from the Porta Praetoria, and the block below it. */
function startBlocks(blocks: Block[], viaDir: 'E' | 'W'): { upper: Block; lower: Block } {
  const fb = B.map.FORUM_BLOCKS;
  const bx = viaDir === 'W' ? fb.bx[1] + 1 : fb.bx[0] - 1;
  const find = (by: number): Block => {
    const b = blocks.find((k) => k.ring === 0 && k.bx === bx && k.by === by);
    if (!b) throw new Error(`survey has no interior block (${bx}, ${by})`);
    return b;
  };
  return { upper: find(fb.by[0]), lower: find(fb.by[1]) };
}

/** A new colony on `seed` at Kal. Apr. AUC DCCC (DESIGN §18.1); `now` is the wall clock in ms. */
export function newGame(opts: { seed: number; legacy?: number; legacyBonus?: number; name?: string; now: number; intro?: boolean }): GameState {
  const seed = opts.seed;
  const day = B.time.START_DAY;
  const map = getMap(seed);
  const sv = map.survey;
  const legacy = opts.legacy ?? 0;
  const later = COLONY_NAMES.filter((n) => n !== DEFAULT_NAME);              // names for the 2nd, 3rd … colony
  const name = opts.name ?? (legacy > 0 && later.length > 0 ? later[(legacy - 1) % later.length] : DEFAULT_NAME);

  const res = emptyRes();
  const startRes: Cost = B.start.RES;
  for (const k of RESOURCES) res[k] = startRes[k] ?? 0;
  const market = {} as Record<TradeRes, number>;
  for (const r of TRADE_RES) market[r] = B.start.MARKET;

  const s: GameState = {
    version: SAVE_VERSION, seed, rng: (seed ^ GAME_SEED_XOR) | 0, nextId: 1,
    name, day, legacy, legacyBonus: opts.legacyBonus ?? 0,
    rank: 0, victory: false, defeat: false,
    res, taxAccrued: 0,
    people: [], families: [], buildings: [], roads: [], paved: [], wood: {},
    urbs: { traffic: {}, moenia: null, razed: null, renewed: NEVER },
    needs: { hunger: [0, 0, 0, 0], thirst: [0, 0, 0, 0] },
    fed: B.start.FED, morale: B.morale.START,
    decisions: defaultDecisions(), ordo: defaultOrdo(),
    trade: { market, contracts: [], caravans: [], merchant: null, lastMerchant: NEVER, hubsTraded: [], debt: 0 },
    choice: null, gate: null, eventDays: {}, modifiers: [],
    guidance: { advisories: {}, muted: [], appointed: START_ADVISORS.slice(), tips: [], tipDay: NEVER, tipAt: 0, objective: 0, milestoneDays: {},
      intro: { lesson: -1, done: false, at: 0, practice: [] } },
    counters: {
      fedStreak: 0, stabStreak: 0, ironMade: 0, tilesMade: 0, caravansReturned: 0,
      festivalsKept: {}, robigaliaYear: -1, lastArrivalBlocked: NEVER, lastBirthBlocked: NEVER, immCall: 0,
      renovWindow: { start: day, count: 0 }, lastChoiceDay: NEVER, lastHarmfulDay: NEVER, lastFireDay: NEVER,
      coinEma: 0, mentorDiedDay: null,
    },
    stats: {
      births: 0, deaths: 0, deathsBy: { age: 0, hunger: 0, thirst: 0, fever: 0, fire: 0, other: 0 },
      immigrants: 0, emigrants: 0, peakPop: 0, built: 0, builtBy: {}, evolved: 0, evolvedBy: {}, devolved: 0,
      denariiTaxed: 0, playMs: 0, startedAt: opts.now, victoryDay: null,
    },
    log: [], lastSave: opts.now,
  };

  // buildings: principia, six tentoria plots, the well, the field (direct insertion, owner 'start', done); a colony
  // run by hand's lumber camp follows once the roads are laid
  const add = (type: BuildingId, x: number, y: number): Building => {
    const b = startBuilding(nextId(s), type, x, y, day);
    s.buildings.push(b);
    return b;
  };
  add('principia', sv.forum.x, sv.forum.y);
  const { upper, lower } = startBlocks(sv.blocks, sv.viaDir);
  const forumSide: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3] = sv.viaDir === 'W' ? [0, 2] : [1, 3];
  const wellPlot: 0 | 1 | 2 | 3 = sv.viaDir === 'W' ? 1 : 0;            // the top far-side plot, on the decumanus
  const homePlots: { b: Block; p: 0 | 1 | 2 | 3 }[] = [
    { b: upper, p: 0 }, { b: upper, p: 1 }, { b: upper, p: 2 }, { b: upper, p: 3 },
    { b: lower, p: forumSide[0] }, { b: lower, p: forumSide[1] },
  ];
  const houses: Building[] = [];
  for (const hp of homePlots) {
    const o = plotOrigin(hp.b, hp.p);
    const h = add('area', o.x, o.y);
    h.house = newHouse();
    houses.push(h);
  }
  const wo = plotOrigin(lower, wellPlot);
  const well = add('puteus', wo.x, wo.y);
  const field = add('ager', map.startAger.x, map.startAger.y);
  const jobSite: Partial<Record<BuildingId, number>> = { puteus: well.id, ager: field.id };

  // roster: one family per tent, heads at their jobs
  const roster = foundingRoster(day, () => nextId(s));
  s.people = roster.people;
  s.families = roster.families;
  ROSTER.forEach((row, k) => {
    const fam = s.families[k];
    const home = houses[k % houses.length].id;
    fam.home = home;
    for (const p of s.people) if (p.family === fam.id) p.home = home;
    const job = row.head.job;
    const head = getPerson(s, fam.head);
    if (job && head && jobSite[job] !== undefined) head.work = jobSite[job] as number;
  });
  s.stats.peakPop = s.people.length;

  // roads: castrum interior streets + gates + the via (sorted, unique)
  const mark = new Uint8Array(map.W * map.H);
  for (let i = 0; i < mark.length; i++) if (sv.street[i] === 1 && sv.streetRing[i] === 0) mark[i] = 1;
  for (const g of sv.gates) mark[g.tile] = 1;
  for (const i of sv.via) mark[i] = 1;
  for (let i = 0; i < mark.length; i++) if (mark[i]) s.roads.push(i);
  invalidate(s);
  // the start field's track to the network, as placement lays one for every rural work (cleared, not felled for timber)
  const track = roadPathFor(s, footprintOf(field, s)) ?? [];
  for (const i of track) if (map.woodMax[i] > 0) s.wood[i] = 0;
  if (track.length > 0) s.roads = [...new Set([...s.roads, ...track])].sort((a, c) => a - c);
  invalidate(s);

  // a colony run by hand (below) gets a lumber camp on the Ordo's best wooded site, with one woodcutter: a trickle of
  // timber, so a colony that has spent its timber can always build again in time (every work costs timber, the camp
  // too; the lessons offer the camp late and trade opens at Vicus), but too little to grow on alone. The Ordo raises
  // its own.
  const site = opts.intro ? bestSlot(s, 'lignarius', { owner: 'ordo' }) : null;
  if (site) {
    const camp = add('lignarius', site.x, site.y);
    const fp = footprintOf(camp, s);
    const path = roadPathFor(s, fp) ?? [];
    for (const i of [...fp, ...path]) if (map.woodMax[i] > 0) s.wood[i] = 0;
    if (path.length > 0) s.roads = [...new Set([...s.roads, ...path])].sort((a, c) => a - c);
    ROSTER.forEach((row, k) => {
      const head = getPerson(s, s.families[k].head);
      if (row.head.job === 'lignarius' && head) head.work = camp.id;
    });
    invalidate(s);
  }

  // a new colony with the opening lessons (intro.ts, DESIGN §11.13) is run by hand: every duty is the player's until
  // they have done it themselves, then theirs to hand to the Ordo (ordo/duties.ts, DESIGN §10.2). The hands stay where
  // the founders stand, and two build.
  if (opts.intro) {
    s.guidance.intro = { lesson: 0, done: false, at: 0, practice: [] };
    s.guidance.tips.push('welcome');   // the welcome lesson greets instead; the urgent tips, which follow it, may speak
    const o = s.ordo;
    o.on = { labour: false, build: false, trade: false };
    for (const d of WORK_DUTIES) o.works[d] = false;
    o.learned = [];
    for (const c of LABOR_CATS) o.manual[c] = 0;
    for (const p of s.people) {
      const b = p.work !== null ? s.buildings.find((x) => x.id === p.work) : undefined;
      const cat = b ? BUILDING_DEFS[b.type].labor : undefined;
      if (cat) o.manual[cat]++;
    }
    o.manual.builders = B.duties.START_BUILDERS;
  }
  log(s, 'info', `${s.people.length} souls of ${s.families.length} families pitch their tents at ${name}.`, ['highlight']);
  return s;
}

// ───────────────────────────── ids, log, lookups ─────────────────────────────

/** Allocates the next entity id (buildings, people, families, contracts, caravans, offers share one counter). */
export function nextId(s: GameState): number {
  return s.nextId++;
}

/** Appends an Annales line for today; the log is trimmed to B.LOG_CAP (oldest dropped). */
export function log(s: GameState, kind: LogKind, text: string, tags?: LogTag[], ref?: number): void {
  // a sentence ending on an abbreviated date ("Kal. Sept.") takes no second full stop
  const e: GameState['log'][number] = { day: s.day, kind, text: text.replace(/(?<!\.)\.\.(?=\s|$)/g, '.') };
  if (tags && tags.length > 0) e.tags = tags;
  if (ref !== undefined) e.ref = ref;
  s.log.push(e);
  if (s.log.length > B.LOG_CAP) s.log.splice(0, s.log.length - B.LOG_CAP);
}

export { getBuilding, getPerson };   // the id lookups live in a leaf module (lookup.ts) so hot loops can copy them

// ───────────────────────────── costs ─────────────────────────────

/** True when stock minus `reserved` covers every positive entry of `cost`. */
export function canAfford(s: GameState, cost: Cost, reserved?: Cost): boolean {
  for (const k of RESOURCES) {
    const c = cost[k];
    if (c === undefined || c <= 0) continue;
    if (s.res[k] - (reserved?.[k] ?? 0) < c - EPS) return false;
  }
  return true;
}

/** Subtracts a cost from the stock (never below 0). */
export function pay(s: GameState, cost: Cost): void {
  for (const k of RESOURCES) {
    const c = cost[k];
    if (c === undefined || c === 0) continue;
    s.res[k] = Math.max(0, s.res[k] - c);
  }
}

/** Returns `frac` of a cost to the stock (caps apply on the next storage step). */
export function refund(s: GameState, cost: Cost, frac: number): void {
  for (const k of RESOURCES) {
    const c = cost[k];
    if (c === undefined || c <= 0) continue;
    s.res[k] += c * frac;
  }
}

/** Sum of two costs (non-zero entries only, RESOURCES order). */
export function addCost(a: Cost, b: Cost): Cost {
  const out: Cost = {};
  for (const k of RESOURCES) {
    const v = (a[k] ?? 0) + (b[k] ?? 0);
    if (v !== 0) out[k] = v;
  }
  return out;
}

/** A cost multiplied by k (non-zero entries only). */
export function scaleCost(c: Cost, k: number): Cost {
  const out: Cost = {};
  for (const r of RESOURCES) {
    const v = (c[r] ?? 0) * k;
    if (v !== 0) out[r] = v;
  }
  return out;
}

/** What is short: per resource, cost − (stock − reserved) where positive. */
export function missing(s: GameState, cost: Cost, reserved?: Cost): Cost {
  const out: Cost = {};
  for (const k of RESOURCES) {
    const c = cost[k];
    if (c === undefined || c <= 0) continue;
    const short = c - (s.res[k] - (reserved?.[k] ?? 0));
    if (short > EPS) out[k] = short;
  }
  return out;
}

// src/game/shapes.ts — loaded people and buildings take the object shapes the simulation gives the ones it creates.
// Owner: perf. A leaf module (types only).
//
// The engine gives an object made by a literal `{ id, prae, … }` a different hidden class from the same object parsed
// out of JSON (a parsed object holds every key in-object, a literal only the ones it was written with), so after a
// load every property read in the daily loops over people and buildings meets classes it has never seen: those reads go
// megamorphic and the first weeks of ticks run slow. A loaded object whose keys begin with exactly the keys (in the
// order) of the literal that creates its kind is rebuilt through that literal and its later keys are added after it,
// in their saved order — the class the live object has, and the same keys in the same order, so it serialises to the
// same bytes. An object that does not begin that way is kept as parsed.
import type { AdvisoryMemo, Building, GameState, LogEntry, Person } from './types';

type Obj = Record<string, unknown>;

/** The keys every person is created with, in the order births, arrivals and the founding roster write them. */
const PERSON_KEYS = ['id', 'prae', 'gens', 'female', 'born', 'family', 'spouse', 'mother', 'father', 'home', 'work', 'skills'] as const;
/** The keys of a work placed on the map (placeBuilding). */
const PLACED_KEYS = ['id', 'type', 'x', 'y', 'owner', 'status', 'placed', 'progress', 'work', 'paid', 'order', 'open', 'prio'] as const;
/** The keys of a founding work (newGame) and of the Capitolium site: the placed keys and one more. */
const START_KEYS = [...PLACED_KEYS, 'doneDay'] as const;
const CAPITOLIUM_KEYS = [...PLACED_KEYS, 'matUsed'] as const;

function person(p: Person): Person {
  return {
    id: p.id, prae: p.prae, gens: p.gens, female: p.female, born: p.born,
    family: p.family, spouse: p.spouse, mother: p.mother, father: p.father, home: p.home, work: p.work, skills: p.skills,
  };
}

function placed(b: Building): Building {
  return {
    id: b.id, type: b.type, x: b.x, y: b.y, owner: b.owner, status: b.status, placed: b.placed, progress: b.progress,
    work: b.work, paid: b.paid, order: b.order, open: b.open, prio: b.prio,
  };
}

function started(b: Building): Building {
  return {
    id: b.id, type: b.type, x: b.x, y: b.y, owner: b.owner, status: b.status, placed: b.placed, progress: b.progress,
    work: b.work, paid: b.paid, order: b.order, open: b.open, prio: b.prio, doneDay: b.doneDay,
  };
}

function capitolium(b: Building): Building {
  return {
    id: b.id, type: b.type, x: b.x, y: b.y, owner: b.owner, status: b.status, placed: b.placed, progress: b.progress,
    work: b.work, paid: b.paid, order: b.order, open: b.open, prio: b.prio, matUsed: b.matUsed,
  };
}

/** `make(raw)` with raw's remaining keys added in order, when raw's keys begin with `keys`; else raw itself. */
function reshape<T extends object>(raw: T, keys: readonly string[], make: (o: T) => T): T {
  const ks = Object.keys(raw);
  if (ks.length < keys.length) return raw;
  for (let i = 0; i < keys.length; i++) if (ks[i] !== keys[i]) return raw;
  const o = make(raw) as Obj;
  const r = raw as Obj;
  for (let i = keys.length; i < ks.length; i++) o[ks[i]] = r[ks[i]];
  return o as T;
}

/** A record the simulation fills key by key from an empty object (resources, edicts, counts by type …): rebuilt the
 *  same way, in its saved key order, so it takes the same chain of hidden classes. Integer-keyed or odd ones are kept. */
function filled<T extends object>(raw: T): T {
  const ks = Object.keys(raw);
  const o: Obj = {};
  for (const k of ks) {
    const c = k.charCodeAt(0);
    if (c >= 48 && c <= 57) return raw;   // integer-like keys live in elements, not in the hidden class
    o[k] = (raw as Obj)[k];
  }
  return o as T;
}

/** A loaded person in the shape of a created one (same keys, same order); its skills filled as the simulation fills them. */
export function personShape(p: Person): Person {
  const o = reshape(p, PERSON_KEYS, person);
  if (o !== p) o.skills = filled(o.skills);
  return o;
}

/** A loaded building in the shape of a created one (same keys, same order): a placed work, a founding work or the
 *  Capitolium site, told apart by the keys they were created with. */
export function buildingShape(b: Building): Building {
  const ks = Object.keys(b);
  const extra = ks[PLACED_KEYS.length];
  if (extra === 'doneDay' && b.owner === 'start') return reshape(b, START_KEYS, started);
  if (extra === 'matUsed' && b.type === 'capitolium') return reshape(b, CAPITOLIUM_KEYS, capitolium);
  return reshape(b, PLACED_KEYS, placed);
}

// ───────────────────────────── the state itself ─────────────────────────────
// newGame writes the state, and these parts of it, as literals (state.ts); the records inside are filled key by key.

const STATE_KEYS = ['version', 'seed', 'rng', 'nextId', 'name', 'day', 'legacy', 'legacyBonus', 'rank', 'victory', 'defeat', 'res',
  'taxAccrued', 'people', 'families', 'buildings', 'roads', 'paved', 'wood', 'needs', 'fed', 'morale', 'decisions', 'ordo', 'trade',
  'choice', 'gate', 'eventDays', 'modifiers', 'guidance', 'counters', 'stats', 'log', 'lastSave'] as const;
const NEEDS_KEYS = ['hunger', 'thirst'] as const;
const DECISIONS_KEYS = ['focus', 'edicts', 'edictLock', 'paths', 'pathDays', 'settings', 'switches'] as const;
const ORDO_KEYS = ['on', 'manual', 'requests', 'pin', 'reserved', 'priorities', 'emergency', 'works', 'learned', 'answered'] as const;
const ON_KEYS = ['labour', 'build', 'trade'] as const;
const EMERGENCY_KEYS = ['rations', 'waterPause', 'lastImport', 'lastRelief', 'freeReliefYear', 'hands'] as const;
const WORKS_KEYS = ['water', 'food', 'homes', 'services', 'materials', 'plan'] as const;
const TRADE_KEYS = ['market', 'contracts', 'caravans', 'merchant', 'lastMerchant', 'hubsTraded', 'debt'] as const;
const GUIDANCE_KEYS = ['advisories', 'muted', 'appointed', 'tips', 'tipDay', 'tipAt', 'objective', 'milestoneDays', 'intro'] as const;
const INTRO_KEYS = ['lesson', 'done', 'at', 'practice'] as const;
const COUNTERS_KEYS = ['fedStreak', 'stabStreak', 'ironMade', 'tilesMade', 'caravansReturned', 'festivalsKept', 'robigaliaYear',
  'lastArrivalBlocked', 'lastBirthBlocked', 'immCall', 'renovWindow', 'lastChoiceDay', 'lastHarmfulDay', 'lastFireDay', 'coinEma', 'mentorDiedDay'] as const;
const WINDOW_KEYS = ['start', 'count'] as const;
const STATS_KEYS = ['births', 'deaths', 'deathsBy', 'immigrants', 'emigrants', 'peakPop', 'built', 'builtBy', 'evolved', 'evolvedBy',
  'devolved', 'denariiTaxed', 'playMs', 'startedAt', 'victoryDay'] as const;
const DEATHS_KEYS = ['age', 'hunger', 'thirst', 'fever', 'fire', 'other'] as const;
/** An Annales line as log() writes it (state.ts); tags and ref follow when given. */
const LOG_KEYS = ['day', 'kind', 'text'] as const;
/** An advisory's memo as the engine raises it (advisors/engine.ts); metric and snooze follow. */
const ADVISORY_KEYS = ['rule', 'active', 'sev', 'since', 'lowerSince', 'params', 'flips'] as const;

function logShape(e: LogEntry): LogEntry {
  return reshape(e, LOG_KEYS, (v) => ({ day: v.day, kind: v.kind, text: v.text }));
}

/** The advisories record filled key by key, each memo through the engine's literal. */
function advisoriesShape(a: GameState['guidance']['advisories']): GameState['guidance']['advisories'] {
  const out: Obj = {};
  for (const k of Object.keys(a)) {
    const m = (a as Record<string, AdvisoryMemo>)[k];
    out[k] = reshape(m, ADVISORY_KEYS, (v) => ({
      rule: v.rule, active: v.active, sev: v.sev, since: v.since, lowerSince: v.lowerSince, params: v.params, flips: v.flips,
    }));
  }
  return out as GameState['guidance']['advisories'];
}

type S = GameState;

/** A loaded state in the shapes newGame and the simulation give a live one (same keys in the same order throughout, so it
 *  serialises to the same bytes); every part whose keys do not begin as newGame writes them is kept as parsed. */
export function stateShape(x: S): S {
  const d = x.decisions, o = x.ordo, tr = x.trade, g = x.guidance, c = x.counters, st = x.stats;
  const needs = reshape(x.needs, NEEDS_KEYS, (n) => ({ hunger: n.hunger, thirst: n.thirst }));
  const decisions = reshape(d, DECISIONS_KEYS, (v) => ({
    focus: v.focus, edicts: filled(v.edicts), edictLock: filled(v.edictLock), paths: filled(v.paths), pathDays: filled(v.pathDays),
    settings: filled(v.settings), switches: filled(v.switches),
  }));
  const ordo = reshape(o, ORDO_KEYS, (v) => ({
    on: reshape(v.on, ON_KEYS, (w) => ({ labour: w.labour, build: w.build, trade: w.trade })),
    manual: filled(v.manual), requests: v.requests, pin: v.pin, reserved: v.reserved, priorities: v.priorities,
    emergency: reshape(v.emergency, EMERGENCY_KEYS, (e) => ({
      rations: e.rations, waterPause: e.waterPause, lastImport: e.lastImport, lastRelief: e.lastRelief, freeReliefYear: e.freeReliefYear,
      hands: e.hands,
    })),
    works: reshape(v.works, WORKS_KEYS, (w) => ({ water: w.water, food: w.food, homes: w.homes, services: w.services, materials: w.materials, plan: w.plan })),
    learned: v.learned, answered: v.answered,
  }));
  const trade = reshape(tr, TRADE_KEYS, (v) => ({
    market: filled(v.market), contracts: v.contracts, caravans: v.caravans, merchant: v.merchant, lastMerchant: v.lastMerchant,
    hubsTraded: v.hubsTraded, debt: v.debt,
  }));
  const guidance = reshape(g, GUIDANCE_KEYS, (v) => ({
    advisories: advisoriesShape(v.advisories), muted: v.muted, appointed: v.appointed, tips: v.tips, tipDay: v.tipDay, tipAt: v.tipAt, objective: v.objective,
    milestoneDays: filled(v.milestoneDays),
    intro: reshape(v.intro, INTRO_KEYS, (i) => ({ lesson: i.lesson, done: i.done, at: i.at, practice: i.practice })),
  }));
  const counters = reshape(c, COUNTERS_KEYS, (v) => ({
    fedStreak: v.fedStreak, stabStreak: v.stabStreak, ironMade: v.ironMade, tilesMade: v.tilesMade, caravansReturned: v.caravansReturned,
    festivalsKept: filled(v.festivalsKept), robigaliaYear: v.robigaliaYear, lastArrivalBlocked: v.lastArrivalBlocked,
    lastBirthBlocked: v.lastBirthBlocked, immCall: v.immCall, renovWindow: reshape(v.renovWindow, WINDOW_KEYS, (w) => ({ start: w.start, count: w.count })),
    lastChoiceDay: v.lastChoiceDay, lastHarmfulDay: v.lastHarmfulDay, lastFireDay: v.lastFireDay, coinEma: v.coinEma,
    mentorDiedDay: v.mentorDiedDay,
  }));
  const stats = reshape(st, STATS_KEYS, (v) => ({
    births: v.births, deaths: v.deaths, deathsBy: reshape(v.deathsBy, DEATHS_KEYS, (w) => ({
      age: w.age, hunger: w.hunger, thirst: w.thirst, fever: w.fever, fire: w.fire, other: w.other,
    })), immigrants: v.immigrants, emigrants: v.emigrants, peakPop: v.peakPop, built: v.built, builtBy: filled(v.builtBy),
    evolved: v.evolved, evolvedBy: filled(v.evolvedBy), devolved: v.devolved, denariiTaxed: v.denariiTaxed, playMs: v.playMs,
    startedAt: v.startedAt, victoryDay: v.victoryDay,
  }));
  return reshape(x, STATE_KEYS, (v) => ({
    version: v.version, seed: v.seed, rng: v.rng, nextId: v.nextId, name: v.name, day: v.day, legacy: v.legacy,
    legacyBonus: v.legacyBonus, rank: v.rank, victory: v.victory, defeat: v.defeat, res: filled(v.res), taxAccrued: v.taxAccrued,
    people: v.people, families: v.families, buildings: v.buildings, roads: v.roads, paved: v.paved, wood: v.wood, needs, fed: v.fed,
    morale: v.morale, decisions, ordo, trade, choice: v.choice, gate: v.gate, eventDays: filled(v.eventDays), modifiers: v.modifiers,
    guidance, counters, stats, log: v.log.map(logShape), lastSave: v.lastSave,
  }));
}

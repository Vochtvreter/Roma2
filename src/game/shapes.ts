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
import type { Building, Person } from './types';

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

/** A loaded person in the shape of a created one (same keys, same order). */
export function personShape(p: Person): Person {
  return reshape(p, PERSON_KEYS, person);
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

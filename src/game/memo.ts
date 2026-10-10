// src/game/memo.ts — epoch counters, per-state memo slots and the action fx queue (ARCHITECTURE §8.1).
// Everything here lives in WeakMaps keyed by the GameState object: never saved, and a reloaded (or cloned)
// state starts fresh. Epoch values come from one global counter, so they are unique across states and a
// module-level cache keyed on an epoch can never confuse two states.
import type { FxEvent, GameState } from './types';

/** struct: the structure; census: people, homes or jobs (every structure change too); people: the census epoch as of the
 *  last change other than jobs alone (touchJobs leaves it), so the people-only parts of the census outlive a reassignment;
 *  layout: the struct epoch as of the last change other than house tiers alone (invalidateTiers leaves it), so what
 *  only the map's works, roads and rank decide (derived, roads, coverage floods, slots) outlives a renovation;
 *  homes: bumped only by touchPeople (who lives, where, in which family — what the people index's home lists read);
 *  jobs: bumped by touchPeople and touchJobs (people or jobs — what its work lists read). Every write to a person's home,
 *  work, family or the list of people calls touchPeople or touchJobs (ARCHITECTURE §9), so these outlive structure
 *  changes: a placement, a completion or a renovation moves nobody. */
interface Epochs { struct: number; census: number; people: number; layout: number; homes: number; jobs: number }

let counter = 0;
const epochs = new WeakMap<GameState, Epochs>();
const slots = new WeakMap<GameState, Map<string, { key: string | number; value: unknown }>>();
let actionFx: FxEvent[] = [];

// The last state asked about and its records: a tick asks thousands of times about one state, and a pointer compare is
// cheaper than a WeakMap lookup (the WeakMaps stay the truth; this only remembers the last answer).
let lastState: GameState | null = null;
let lastEpochs: Epochs | null = null;
let lastSlots: Map<string, { key: string | number; value: unknown }> | null = null;

function epochsOf(s: GameState): Epochs {
  if (s === lastState && lastEpochs) return lastEpochs;
  let e = epochs.get(s);
  if (!e) {
    const struct = ++counter, census = ++counter;
    e = { struct, census, people: census, layout: struct, homes: census, jobs: census };
    epochs.set(s, e);
  }
  if (s !== lastState) { lastState = s; lastSlots = null; }
  lastEpochs = e;
  return e;
}

/** Structure changed (buildings, roads, rank, reserved blocks, staffing open/closed): bumps struct and census epochs.
 *  The homes and jobs epochs stay: a change that also moves people (a demolition, a closed work) calls touchPeople. */
export function invalidate(s: GameState): void {
  const e = epochsOf(s);
  e.struct = ++counter;
  e.census = ++counter;
  e.people = e.census;
  e.layout = e.struct;
}

/** Only house tiers changed (a renovation finished, a house fell back): bumps struct and census epochs like invalidate,
 *  but the layout, homes and jobs epochs stay (no work, road, footprint or rank moved; nobody moved home or job). */
export function invalidateTiers(s: GameState): void {
  const e = epochsOf(s);
  e.struct = ++counter;
  e.census = ++counter;
  e.people = e.census;
}

/** The structure epoch as of the last change to anything but house tiers (see invalidateTiers). */
export function layoutEpoch(s: GameState): number {
  return epochsOf(s).layout;
}

/** (day, layout) as one number, for layout memos that also follow the standing timber. */
export function dayLayout(s: GameState): number {
  return layoutEpoch(s) * DAY_SPAN + s.day;
}

/** People, homes or jobs changed: bumps the census epoch. */
export function touchPeople(s: GameState): void {
  const e = epochsOf(s);
  e.census = ++counter;
  e.people = e.census;
  e.homes = e.census;
  e.jobs = e.census;
}

/** Only jobs (`work`) changed: bumps the census epoch like touchPeople, but the people epoch stays (ages, homes,
 *  families and membership are as they were). */
export function touchJobs(s: GameState): void {
  const e = epochsOf(s);
  e.census = ++counter;
  e.jobs = e.census;
}

/** The census epoch as of the last change to anything but jobs (see touchJobs). */
export function peopleEpoch(s: GameState): number {
  return epochsOf(s).people;
}

/** The epoch of who lives where (touchPeople). */
export function homesEpoch(s: GameState): number {
  return epochsOf(s).homes;
}

/** The epoch of who works where (touchPeople, touchJobs). */
export function jobsEpoch(s: GameState): number {
  return epochsOf(s).jobs;
}

/** Current structure epoch of a state. */
export function structEpoch(s: GameState): number {
  return epochsOf(s).struct;
}

/** Current census epoch of a state. */
export function censusEpoch(s: GameState): number {
  return epochsOf(s).census;
}

const DAY_SPAN = 1e6;   // > any game day; epoch × DAY_SPAN + day stays exact in float64

/** One number for (day, structure, census): every structure change bumps the census epoch too (invalidate), and an
 *  epoch value is handed out once, so the census epoch stands for both. A cheap numeric memo key for the hot memos. */
export function dayEpoch(s: GameState): number {
  return censusEpoch(s) * DAY_SPAN + s.day;
}

/** (day, structure) as one number, for memos that ignore people and jobs. */
export function dayStruct(s: GameState): number {
  return structEpoch(s) * DAY_SPAN + s.day;
}

/** One cached value per (state, slot): recomputed whenever `key` differs from the cached key. */
export function memo<T>(s: GameState, slot: string, key: string | number, compute: () => T): T {
  let m = s === lastState ? lastSlots : null;
  if (!m) {
    m = slots.get(s) ?? null;
    if (!m) {
      m = new Map();
      slots.set(s, m);
    }
    if (s !== lastState) { lastState = s; lastEpochs = null; }
    lastSlots = m;
  }
  const hit = m.get(slot);
  if (hit && hit.key === key) return hit.value as T;
  const value = compute();
  m.set(slot, { key, value });
  return value;
}

/** Queues a visual event raised by a player action between ticks (drained by main.ts each frame). */
export function pushActionFx(e: FxEvent): void {
  actionFx.push(e);
}

/** Returns and clears the queued action fx. */
export function drainActionFx(): FxEvent[] {
  const out = actionFx;
  actionFx = [];
  return out;
}

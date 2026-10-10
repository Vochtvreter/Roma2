// src/game/memo.ts — epoch counters, per-state memo slots and the action fx queue (ARCHITECTURE §8.1).
// Everything here lives in WeakMaps keyed by the GameState object: never saved, and a reloaded (or cloned)
// state starts fresh. Epoch values come from one global counter, so they are unique across states and a
// module-level cache keyed on an epoch can never confuse two states.
import type { FxEvent, GameState } from './types';

interface Epochs { struct: number; census: number }

let counter = 0;
const epochs = new WeakMap<GameState, Epochs>();
const slots = new WeakMap<GameState, Map<string, { key: string | number; value: unknown }>>();
let actionFx: FxEvent[] = [];

function epochsOf(s: GameState): Epochs {
  let e = epochs.get(s);
  if (!e) {
    e = { struct: ++counter, census: ++counter };
    epochs.set(s, e);
  }
  return e;
}

/** Structure changed (buildings, roads, rank, reserved blocks, staffing open/closed): bumps struct and census epochs. */
export function invalidate(s: GameState): void {
  const e = epochsOf(s);
  e.struct = ++counter;
  e.census = ++counter;
}

/** People, homes or jobs changed: bumps the census epoch. */
export function touchPeople(s: GameState): void {
  epochsOf(s).census = ++counter;
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
  let m = slots.get(s);
  if (!m) {
    m = new Map();
    slots.set(s, m);
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

// src/game/lookup.ts — id lookups on the id-sorted entity lists (state.ts re-exports them). Owner: perf.
// A leaf module (types only), so the hot loops elsewhere can keep module-level copies of these functions.
// Each list has its own copy of the binary search: one shared generic search sees buildings and people at the same
// property load, and that site goes megamorphic (a slow lookup per probe, eight or more probes per call).
import type { Building, GameState, Person } from './types';

/** Building by id (binary search on the id-sorted list). */
export function getBuilding(s: GameState, id: number): Building | undefined {
  const arr = s.buildings;
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = arr[mid], v = b.id;
    if (v === id) return b;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** Living person by id (binary search on the id-sorted list). */
export function getPerson(s: GameState, id: number): Person | undefined {
  const arr = s.people;
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = arr[mid], v = p.id;
    if (v === id) return p;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

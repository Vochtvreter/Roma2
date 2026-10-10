// src/game/lookup.ts — id lookups on the id-sorted entity lists (state.ts re-exports them). Owner: perf.
// A leaf module (types only), so the hot loops elsewhere can keep module-level copies of these functions.
import type { Building, GameState, Person } from './types';

function bsearch<T extends { id: number }>(arr: T[], id: number): T | undefined {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = arr[mid].id;
    if (v === id) return arr[mid];
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** Building by id (binary search on the id-sorted list). */
export function getBuilding(s: GameState, id: number): Building | undefined {
  return bsearch(s.buildings, id);
}

/** Living person by id (binary search on the id-sorted list). */
export function getPerson(s: GameState, id: number): Person | undefined {
  return bsearch(s.people, id);
}

// src/game/ordo/actions.ts — player actions that steer the Ordo (ARCHITECTURE §8.4, §8.7). Owner: WP-C.
// SCAFFOLD: every action answers { ok: false, code: 'notReady' } until WP-C lands.
import type { ActionResult, BuildingId, GameState, LaborCat, OrdoArea } from '../types';

function notReady(): ActionResult {
  return { ok: false, code: 'notReady', reason: 'The Ordo has not yet convened.' };
}

/** Asks the Ordo to build a type next (max REQUESTS_MAX; needs Ordo construction on). */
export function askOrdo(s: GameState, type: BuildingId): ActionResult {
  // STUB(WP-C)
  void s; void type;
  return notReady();
}

/** Pins a type as the Ordo's next build (null clears the pin). */
export function pinBuild(s: GameState, type: BuildingId | null): ActionResult {
  // STUB(WP-C)
  void s; void type;
  return notReady();
}

/** Turns an Ordo area (labour, build, trade) on or off. */
export function setOrdo(s: GameState, area: OrdoArea, on: boolean): ActionResult {
  // STUB(WP-C)
  void s; void area; void on;
  return notReady();
}

/** Sets a manual labour target for a category (manual labour only). */
export function setManualTarget(s: GameState, cat: LaborCat, n: number): ActionResult {
  // STUB(WP-C)
  void s; void cat; void n;
  return notReady();
}

/** Applies the Ordo's current proposal once (labour targets, wish #1 as a player site, or the would-be contract). */
export function applyOnce(s: GameState, area: OrdoArea): ActionResult {
  // STUB(WP-C)
  void s; void area;
  return notReady();
}

/** Puts a labour category first for `days` days (the priority remedy). */
export function setLabourPriority(s: GameState, cat: LaborCat, days: number): ActionResult {
  // STUB(WP-C)
  void s; void cat; void days;
  return notReady();
}

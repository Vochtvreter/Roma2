// src/game/ordo/build.ts — the Ordo's wish list, agenda, stakes and requests (ARCHITECTURE §8.4, DESIGN §10.5). Owner: WP-C.
// SCAFFOLD: the Ordo builds nothing and wishes for nothing yet.
import type { GameState, SimView, TickContext, WishView } from '../types';

/** Every 2nd day: walks the wish list, stakes what it can afford, saves for the first unaffordable wish (DESIGN §10.5). */
export function ordoBuild(s: GameState, ctx: TickContext, v: SimView): void {
  // STUB(WP-C): cadence, concurrency 1 + workforce/40 ≤ 4, 5-day stakes, take/ready/pending, savingFor.
  void s; void ctx; void v;
}

/** Places the player's requests and the pin as player sites (no stake, fx ordoPlaced). */
export function processRequests(s: GameState, ctx: TickContext, v: SimView): void {
  // STUB(WP-C): s.ordo.requests and s.ordo.pin.
  void s; void ctx; void v;
}

/** The first `n` wishes with state and reason (pure; the Agenda and the "would" ghost). */
export function wishList(s: GameState, v: SimView, n: number): WishView[] {
  // STUB(WP-C): DESIGN §10.5 wish table.
  void s; void v; void n;
  return [];
}

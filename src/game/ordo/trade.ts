// src/game/ordo/trade.ts — trade automation every 10 days (ARCHITECTURE §8.4, DESIGN §10.7). Owner: WP-C.
// SCAFFOLD: the Ordo neither trades nor proposes trades yet.
import type { GameState, Reason, SimView, TickContext } from '../types';

/** Creates, adjusts or cancels Ordo contracts; takes clearly good merchant offers (DESIGN §10.7). */
export function ordoTrade(s: GameState, ctx: TickContext, v: SimView): void {
  // STUB(WP-C): deficit/luxury/wish imports, surplus exports, merchant deals.
  void s; void ctx; void v;
}

/** What the Ordo would do in trade now (manual mode's "would" line), or null. */
export function ordoTradeWould(s: GameState, v: SimView): Reason | null {
  // STUB(WP-C)
  void s; void v;
  return null;
}

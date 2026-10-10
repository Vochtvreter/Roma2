// src/game/ordo/saving.ts — the saving target, reservations and the spending rule (ARCHITECTURE §8.4, DESIGN §10.5). Owner: WP-C.
// SCAFFOLD: nothing is saved for or reserved; canSpend applies the treasury floor.
import type { Cost, GameState, SimView } from '../types';
import { canAfford } from '../state';
import { settingValue } from '../decisions';

/** What the Ordo is saving for (petition, plan, pin, request or wish), or null. */
export function savingFor(s: GameState, v: SimView): { cost: Cost; for: 'petition' | 'plan' | 'pin' | 'request' | 'wish' } | null {
  // STUB(WP-C): petition fee, player plans, pin, requests, the pending wish.
  void s; void v;
  return null;
}

/** Stock held back from ordinary spending: the saving target + the next 30 days of Capitolium materials. */
export function reserved(s: GameState, v: SimView): Cost {
  // STUB(WP-C)
  void s; void v;
  return {};
}

/** stock − reserved covers the cost and denarii stay ≥ the treasury floor (survival spending ignores both). */
export function canSpend(s: GameState, cost: Cost, v: SimView, opts?: { survival?: boolean }): boolean {
  if (opts?.survival) return canAfford(s, cost);
  if (!canAfford(s, cost, reserved(s, v))) return false;
  const den = cost.denarii ?? 0;
  return den <= 0 || s.res.denarii - den >= settingValue(s, 'treasuryFloor');
}

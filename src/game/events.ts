// src/game/events.ts — events, festivals, choice cards, the gate party and relief (ARCHITECTURE §8.5, DESIGN §12). Owner: WP-D.
// SCAFFOLD: no events or festivals fire; an expired gate party leaves, an expired choice takes its default.
import type { ActionResult, Caravan, EventId, GameState, SimView, TickContext } from './types';
import type { Rng } from './rng';
import { RESOURCES } from './types';
import { canAfford, log, pay } from './state';

/** Daily: festivals, gate-party expiry, choice expiry (default option), the random roll with its pacing rules. */
export function eventsDay(s: GameState, ctx: TickContext, rng: Rng, v: SimView): void {
  // STUB(WP-D): festivals, the random roll (B.events), offline rules.
  void ctx; void rng; void v;
  if (s.gate && s.day >= s.gate.until) s.gate = null;
  if (s.choice && s.day >= s.choice.expires) {
    const r = chooseOption(s, s.choice.defaultIndex);
    if (!r.ok && s.choice) s.choice = null;
  }
}

/** The player answers the pending choice card with option `index`. */
export function chooseOption(s: GameState, index: number): ActionResult {
  const c = s.choice;
  if (!c) return { ok: false, code: 'noChoice', reason: 'Nothing awaits an answer.' };
  const opt = c.options[index];
  if (!opt) return { ok: false, code: 'invalid', reason: 'No such answer.' };
  if (opt.cost && !canAfford(s, opt.cost)) return { ok: false, code: 'unaffordable', reason: 'We cannot afford that answer.' };
  // STUB(WP-D): per-event resolution by opt.key.
  if (opt.cost) pay(s, opt.cost);
  if (opt.gain) for (const r of RESOURCES) s.res[r] += opt.gain[r] ?? 0;
  s.choice = null;
  log(s, 'event', `${c.title}: ${opt.label}.`, ['decided']);
  return { ok: true };
}

/** Starts one event now if its conditions hold (used by eventsDay and tests); true when it started. */
export function fireEvent(s: GameState, ctx: TickContext, rng: Rng, v: SimView, id: EventId): boolean {
  // STUB(WP-D): DESIGN §12.2 catalogue.
  void s; void ctx; void rng; void v; void id;
  return false;
}

/** The Legate's relief card (offline: auto-accepted). */
export function triggerRelief(s: GameState, ctx: TickContext, v: SimView): void {
  // STUB(WP-D): DESIGN §8.12 step 4.
  void s; void ctx; void v;
}

/** Bandits on the road: may rob a returning caravan. */
export function banditCheck(s: GameState, ctx: TickContext, rng: Rng, caravan: Caravan): void {
  // STUB(WP-D): B.events.BANDIT_P / BANDIT_LOSS.
  void s; void ctx; void rng; void caravan;
}

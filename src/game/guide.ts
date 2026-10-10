// src/game/guide.ts — the mentor's tips (Decimus Cassius) (ARCHITECTURE §8.6, DESIGN §11.7). Owner: WP-E.
// SCAFFOLD: only the 'welcome' tip; the engine (after/until/when, pruning, dismissal) is real.
import { TIPS } from './types';
import type { ActionResult, GameState, GuideStep, TipId } from './types';
import { MENTOR } from './data/advisors';

/** The mentor's tips in priority order (DESIGN §11.7). */
export const GUIDE: GuideStep[] = [
  {
    id: 'welcome', title: 'Salve, Praefecte',
    text: () => 'I am Decimus Cassius, once primus pilus. The Ordo runs the camp day by day, even while you sleep. '
      + 'You set its course, and you may build whatever you like yourself. I will speak when something new matters.',
    when: () => true,
  },
  // STUB(WP-E): the other 19 tips of DESIGN §11.7.
];

function seen(s: GameState, id: TipId): boolean {
  return s.guidance.tips.includes(id);
}

/** Marks unseen tips whose `until` already holds as seen, so they never show late. */
export function pruneGuide(s: GameState): void {
  for (const g of GUIDE) if (!seen(s, g.id) && g.until?.(s)) s.guidance.tips.push(g.id);
}

/** The highest-priority unseen tip whose `after` is seen, whose `when` holds and whose `until` does not; or null. */
export function nextTip(s: GameState): GuideStep | null {
  for (const g of GUIDE) {
    if (seen(s, g.id)) continue;
    if (g.after && !seen(s, g.after)) continue;
    if (g.until?.(s)) continue;
    if (g.when(s)) return g;
  }
  return null;
}

/** Marks a tip as seen ("Understood"). */
export function dismissTip(s: GameState, id: TipId): ActionResult {
  if (!TIPS.includes(id)) return { ok: false, code: 'invalid', reason: 'No such counsel.' };
  if (!seen(s, id)) s.guidance.tips.push(id);
  return { ok: true };
}

/** The tip card's kicker: 'DECIMVS CASSIVS ADVISES', or 'FROM THE NOTES OF DECIMVS CASSIVS' once he has died. */
export function mentorKicker(s: GameState): string {
  const name = MENTOR.name.toUpperCase().replace(/U/g, 'V');
  return s.counters.mentorDiedDay !== null ? `FROM THE NOTES OF ${name}` : `${name} ADVISES`;
}

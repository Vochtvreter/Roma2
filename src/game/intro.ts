// src/game/intro.ts — the paced introduction (DESIGN §11.13): which parts of the interface the mentor has brought in.
// A new colony opens on the map, the two vital tablets, the date and the clock. Every other part arrives with the tip
// that explains it (guide.ts), one at a time: it shows once its tip is on the card or has been read. By B.intro.END
// elapsed days everything shows whether or not its tip was read, so a player who never presses "Understood" (or an
// older save) is never left without a panel. This module only says what the player is shown: what the colony may do
// stays with reveal.ts, and the UI asks both (a tab shows when reveal.ts reveals it and the introduction has brought it).
import { B } from './balance';
import type { ActionResult, GameState, TabId, TipId } from './types';
import { elapsed } from './calendar';
import { memo } from './memo';
import { nextTip } from './guide';

/** A part of the interface the introduction brings in: a HUD chip, a widget, or a side-panel tab. */
export type IntroPart = 'ticker' | 'portraits' | 'souls' | 'coin' | 'materials' | 'goals' | 'dignitas' | 'overlays' | TabId;

/** The tips that bring each part in (any one of them on the card or read). Trade is not part of the introduction. */
const PARTS: Record<IntroPart, readonly TipId[]> = {
  ticker: ['ordo'],
  portraits: ['counsel'], advisors: ['counsel'],
  souls: ['people'], people: ['people'],
  coin: ['build'], materials: ['build'], build: ['build'],
  goals: ['goals'], annals: ['goals', 'away'],
  council: ['charter', 'petition', 'edicts', 'reins'],
  dignitas: ['dignitas', 'petition'],
  overlays: ['overlays', 'wants'],
  trade: [],
};

/** The tips of the introduction itself, read at once when the player skips it. */
export const INTRO_TIPS: readonly TipId[] = ['welcome', 'vitals', 'ordo', 'counsel', 'speed', 'people', 'build', 'goals', 'charter', 'dignitas', 'overlays'];

/** The tip on the card now (memoised on the day and the tips read: the UI asks for every part several times a second). */
function due(s: GameState): TipId | null {
  const g = s.guidance;
  return memo(s, 'introDue', `${s.day}|${g.tips.length}|${g.tipDay}`, () => nextTip(s)?.id ?? null);
}

/** Whether the introduction has brought `part` in. */
export function introduced(s: GameState, part: IntroPart): boolean {
  const tips = PARTS[part];
  if (tips.length === 0 || elapsed(s) >= B.intro.END) return true;
  if (tips.some((t) => s.guidance.tips.includes(t))) return true;
  const now = due(s);
  return now !== null && tips.includes(now);
}

/** Skips the introduction: its tips count as read, so every part shows now (Hide tips, or "Skip the introduction"). */
export function skipIntro(s: GameState): ActionResult {
  for (const t of INTRO_TIPS) if (!s.guidance.tips.includes(t)) s.guidance.tips.push(t);
  return { ok: true };
}

// src/ui/intro.ts — the opening lessons on screen (DESIGN §11.13): what a lesson has brought (game/intro.ts) is shown,
// the rest stays hidden. A part that appears during play glows once, so the eye finds what the mentor speaks of; a part
// already there when a colony is entered or loaded just shows.
import type { GameState, TabId } from '../game/types';
import type { Game } from './types';
import { introBrings, introduced, introRunning } from '../game/intro';
import type { IntroPart } from '../game/intro';
import { tabRevealed } from '../game/reveal';

const GLOW_MS = 2600;
/** The colony each element was last shown or hidden for: a change within the same colony is an arrival in play. */
const lastFor = new WeakMap<HTMLElement, GameState>();

/** Whether a lesson has brought `part` (always, once the lessons are over). */
export function shows(g: Game, part: IntroPart): boolean {
  return introduced(g.state, part);
}

/** Whether a side-panel tab is on the bar: while the lessons run, a tab a lesson brings shows from that lesson on; any
 *  other tab, and every tab afterwards, shows when reveal.ts reveals it. */
export function tabShown(s: GameState, tab: TabId): boolean {
  if (introRunning(s) && introBrings(tab)) return introduced(s, tab);
  return tabRevealed(s, tab);
}

/** Shows or hides a part; one that appears in play fades in with a glow. */
export function present(g: Game, el: HTMLElement, on: boolean): void {
  const inPlay = lastFor.get(el) === g.state;
  lastFor.set(el, g.state);
  if (el.hidden === !on) return;
  el.hidden = !on;
  if (!on || !inPlay) return;
  el.classList.remove('intro-in');
  void el.offsetWidth;
  el.classList.add('intro-in');
  window.setTimeout(() => el.classList.remove('intro-in'), GLOW_MS);
}

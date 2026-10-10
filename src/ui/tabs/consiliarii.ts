// src/ui/tabs/consiliarii.ts — Consiliarii / Advisors: portraits as filters, every advisory card by severity (DESIGN §15.3). Owner: WP-I.
// SCAFFOLD: the appointed advisors and the active advisories as a plain list.
import type { Game, Panel } from '../types';
import { h, img } from '../dom';
import { activeAdvisories, advisorMood } from '../../game/advisors/engine';
import { ADVISOR_DEFS } from '../../game/data/advisors';
import { portrait } from '../../render/art/index';

/** The Advisors tab. */
export const panel: Panel = {
  id: 'advisors', label: 'Consiliarii', sub: 'Advisors', icon: 'i_tab_advisors', hotkey: 'V',
  signature(g: Game): string {
    const s = g.state;
    return `${s.guidance.appointed.join(',')}|${activeAdvisories(s).map((a) => `${a.rule}:${a.memo.sev}`).join(',')}`;
  },
  build(g: Game, body: HTMLElement): void {
    const s = g.state;
    const adv = activeAdvisories(s);
    body.append(
      h('div', { class: 'adv-portraits' }, s.guidance.appointed.map((a) =>
        h('div', { class: 'adv-pt' }, img(portrait(a, advisorMood(s, a)), 2), h('div', { class: 'muted' }, ADVISOR_DEFS[a].office)))),
      adv.length
        ? h('ul', { class: 'tab-list' }, adv.map((a) => h('li', { class: `sev-${a.memo.sev}` }, `${ADVISOR_DEFS[a.advisor].office}: ${a.rule}`)))
        : h('p', { class: 'muted' }, 'Quiet. No advisor has anything to say.'),
    );
  },
  badge(g: Game) {
    const n = activeAdvisories(g.state).filter((a) => a.memo.sev >= 2).length;
    return n ? { text: String(n), kind: 'warn' } : null;
  },
};

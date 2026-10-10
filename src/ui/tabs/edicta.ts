// src/ui/tabs/edicta.ts — Edicta / Decisions: Crossroads card, story, focus, edicts, settings, switches, Ordo toggles (DESIGN §15.3). Owner: WP-I.
// SCAFFOLD: a placeholder listing the current focus, edicts and Ordo toggles (read-only).
import { EDICTS, ORDO_AREAS } from '../../game/types';
import type { Game, Panel } from '../types';
import { h } from '../dom';
import { FOCUS_DEFS, EDICT_DEFS } from '../../game/data/decisions';

/** The Decisions tab. */
export const panel: Panel = {
  id: 'council', label: 'Edicta', sub: 'Decisions', icon: 'i_tab_council', hotkey: 'E',
  signature(g: Game): string {
    const s = g.state;
    return `${s.decisions.focus}|${EDICTS.map((e) => s.decisions.edicts[e]).join(',')}|${ORDO_AREAS.map((a) => (s.ordo.on[a] ? 1 : 0)).join('')}`;
  },
  build(g: Game, body: HTMLElement): void {
    const s = g.state;
    body.append(
      h('div', { class: 'kicker' }, 'PROPOSITVM'),
      h('p', null, `Focus: ${FOCUS_DEFS[s.decisions.focus].name}`),
      h('div', { class: 'kicker' }, 'EDICTA'),
      h('ul', { class: 'tab-list' }, EDICTS.map((e) => {
        const opt = EDICT_DEFS[e].options.find((o) => o.id === s.decisions.edicts[e]);
        return h('li', null, `${EDICT_DEFS[e].name}: ${opt?.name ?? s.decisions.edicts[e]}`);
      })),
      h('div', { class: 'kicker' }, 'ORDO DECVRIONVM'),
      h('p', { class: 'muted' }, ORDO_AREAS.map((a) => `${a} ${s.ordo.on[a] ? 'on' : 'off'}`).join(' · ')),
      h('p', { class: 'muted' }, 'The Crossroads card, edicts and settings arrive with the decisions panel.'),
    );
  },
};

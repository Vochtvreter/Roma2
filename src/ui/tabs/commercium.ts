// src/ui/tabs/commercium.ts — Commercium / Trade: caravans, contracts, hubs, merchant, new-contract form (DESIGN §15.3). Owner: WP-I.
// SCAFFOLD: contracts and caravans as plain lists; prefill() stores a spec for the (future) new-contract form.
import type { ContractSpec } from '../../game/types';
import type { Game, Panel } from '../types';
import { h } from '../dom';
import { HUB_DEFS } from '../../game/data/hubs';
import { formatRoman } from '../../game/calendar';

let draft: ContractSpec | null = null;

/** Pre-fills the new-contract form (Game.prefillContract → then openTab('trade')). */
export function prefill(spec: ContractSpec): void {
  draft = { ...spec };
}

/** The Trade tab. */
export const panel: Panel = {
  id: 'trade', label: 'Commercium', sub: 'Trade', icon: 'i_tab_trade', hotkey: 'T',
  signature(g: Game): string {
    const t = g.state.trade;
    return `${t.contracts.map((c) => `${c.id}:${c.status}`).join(',')}|${t.caravans.map((c) => c.id).join(',')}|${t.merchant ? 1 : 0}|${draft ? JSON.stringify(draft) : ''}`;
  },
  build(g: Game, body: HTMLElement): void {
    const t = g.state.trade;
    body.appendChild(h('div', null,
      h('div', { class: 'kicker' }, 'CARAVANS'),
      t.caravans.length
        ? h('ul', { class: 'tab-list' }, t.caravans.map((c) => h('li', null, `${c.mode} ${c.qty} ${c.res} · ${HUB_DEFS[c.hub].name} · back ${formatRoman(c.arrive)}`)))
        : h('p', { class: 'muted' }, 'No caravans on the road.'),
      h('div', { class: 'kicker' }, 'CONTRACTS'),
      t.contracts.length
        ? h('ul', { class: 'tab-list' }, t.contracts.map((c) => h('li', null, `${c.mode} ${c.qty} ${c.res} · ${HUB_DEFS[c.hub].name} · ${c.status}`)))
        : h('p', { class: 'muted' }, 'No contracts.'),
      draft ? h('p', { class: 'muted' }, `Draft: ${draft.mode} ${draft.qty} ${draft.res} with ${HUB_DEFS[draft.hub].name}.`) : null,
    ));
  },
};

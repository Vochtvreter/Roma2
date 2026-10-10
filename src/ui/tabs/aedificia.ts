// src/ui/tabs/aedificia.ts — Aedificia / Build: Agenda, works queue, tool row, category chips, building cards (DESIGN §15.3). Owner: WP-I.
// SCAFFOLD: the tool row and a plain list of visible buildings with cost and a Place button; the Agenda and the works
// queue are WP-I's.
import { BUILDINGS } from '../../game/types';
import type { ToolId } from '../../game/types';
import type { Game, Panel, Updater } from '../types';
import { costEl, h } from '../dom';
import { BUILDING_DEFS } from '../../game/data/buildings';
import { RANK_DEFS } from '../../game/data/ranks';
import { buildingVisible, toolRevealed } from '../../game/reveal';

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'road', label: 'Road' }, { id: 'pave', label: 'Pave' }, { id: 'reserve', label: 'Reserve block' }, { id: 'demolish', label: 'Demolish' },
];

/** The Build tab. */
export const panel: Panel = {
  id: 'build', label: 'Aedificia', sub: 'Build', icon: 'i_tab_build', hotkey: 'B',
  signature(g: Game): string {
    const s = g.state;
    return `${s.rank}|${BUILDINGS.filter((b) => buildingVisible(s, b)).length}|${TOOLS.filter((t) => toolRevealed(s, t.id)).length}`;
  },
  build(g: Game, body: HTMLElement, up: Updater[]): void {
    const s = g.state;
    body.append(h('div', { class: 'bld-tools' }, TOOLS.filter((t) => toolRevealed(s, t.id)).map((t) =>
      h('button', { class: 'btn small', onclick: () => g.startPlacing(t.id === 'road' ? { kind: 'road' } : t.id === 'pave' ? { kind: 'pave' } : t.id === 'reserve' ? { kind: 'reserve' } : { kind: 'demolish' }) }, t.label))));
    for (const type of BUILDINGS) {
      const def = BUILDING_DEFS[type];
      if (type === 'principia' || type === 'capitolium' || !buildingVisible(s, type)) continue;
      const locked = def.rank > s.rank;
      const cost = h('span');
      const refresh = (): void => { cost.replaceChildren(costEl(g.state, def.cost)); };
      refresh();
      up.push(refresh);
      body.appendChild(h('div', { class: 'bld-card' },
        h('div', { class: 'bld-name' }, `${def.name} · ${def.latin}`),
        h('div', { class: 'muted' }, def.benefit),
        cost,
        locked
          ? h('div', { class: 'muted' }, `Requires ${RANK_DEFS[def.rank].name}`)
          : h('button', { class: 'btn small primary', onclick: () => g.startPlacing({ kind: 'building', type }) }, 'Place')));
    }
  },
  scrollTo(anchor: string, body: HTMLElement): void {
    body.querySelector(`[data-anchor="${anchor}"]`)?.scrollIntoView({ block: 'start' });
  },
};

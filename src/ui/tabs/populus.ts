// src/ui/tabs/populus.ts — Populus / People: stats, housing tiers, labour lines, Watch list, Gentes, roster (DESIGN §15.3). Owner: WP-I.
// SCAFFOLD: the census numbers and labour by category.
import { HOUSE_TIERS, LABOR_CATS } from '../../game/types';
import type { Game, Panel, Updater } from '../types';
import { h } from '../dom';
import { census } from '../../game/census';
import { TIER_DEFS } from '../../game/data/housing';

/** The People tab. */
export const panel: Panel = {
  id: 'people', label: 'Populus', sub: 'People', icon: 'i_tab_people', hotkey: 'P',
  signature(g: Game): string {
    const c = census(g.state);
    return `${c.houses}|${HOUSE_TIERS.map((t) => c.byTier[t]).join(',')}`;
  },
  build(g: Game, body: HTMLElement, up: Updater[]): void {
    const stats = h('p');
    const labour = h('ul', { class: 'tab-list' });
    const refresh = (): void => {
      const c = census(g.state);
      stats.textContent = `${c.pop} souls · ${c.beds} beds · ${c.workforce} able · ${c.idle.length} idle · children ${c.byStage[0] + c.byStage[1]} · elders ${c.byStage[3]}`;
      labour.replaceChildren(...LABOR_CATS.map((k) => h('li', null, `${k}: ${c.catStaffed[k]} / ${c.catSlots[k]}`)));
    };
    refresh();
    up.push(refresh);
    const c = census(g.state);
    body.append(
      h('div', { class: 'kicker' }, 'CENSVS'), stats,
      h('div', { class: 'kicker' }, 'DOMVS'),
      h('ul', { class: 'tab-list' }, HOUSE_TIERS.filter((t) => c.byTier[t] > 0).map((t) => h('li', null, `${TIER_DEFS[t].name}: ${c.byTier[t]}`))),
      h('div', { class: 'kicker' }, 'OPERA'), labour,
    );
  },
};

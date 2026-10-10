// src/ui/tabs/annales.ts — Annales / Chronicle: filters, log, Fasti, stats, Commentarii (DESIGN §15.3). Owner: WP-I.
// SCAFFOLD: the newest 60 log lines with short Roman dates.
import type { Game, Panel } from '../types';
import { h } from '../dom';
import { formatRoman } from '../../game/calendar';

const SHOWN = 60;

/** The Chronicle tab. */
export const panel: Panel = {
  id: 'annals', label: 'Annales', sub: 'Chronicle', icon: 'i_tab_annals', hotkey: 'L',
  signature(g: Game): string {
    const log = g.state.log;
    const last = log[log.length - 1];
    return `${log.length}|${last ? `${last.day}:${last.text}` : ''}`;
  },
  build(g: Game, body: HTMLElement): void {
    const log = g.state.log;
    body.appendChild(h('ul', { class: 'tab-list ann-log' }, log.slice(-SHOWN).reverse().map((e) =>
      h('li', { class: `ann-${e.kind}` }, h('span', { class: 'muted' }, formatRoman(e.day)), ' ', e.text))));
  },
};

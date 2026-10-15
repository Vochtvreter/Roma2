// src/ui/tabs/annales.ts — Annales / Chronicle: filter chips, the log by year with short Roman dates, the Fasti (one line
// per Parilia; after the dedication, the Victory dispatch to read again) and the Fasti coloniarum, the colony's record,
// and the Commentarii of seen tips (DESIGN §15.3). Owner: WP-I.
import type { DeathCause, GameState, LogEntry, LogKind } from '../../game/types';
import type { Game, Updater } from '../types';
import { fmt, h, img } from '../dom';
import { aucYear, dateOf, elapsed, formatAuc, formatRoman } from '../../game/calendar';
import { getBuilding } from '../../game/state';
import { idx } from '../../game/map';
import { GUIDE } from '../../game/guide';
import { loadFasti } from '../../game/save';
import { B } from '../../game/balance';
import { openDispatch } from '../dispatch';
import { btn, kv, section } from './common';
import type { TabPanel } from './common';

type Filter = 'all' | 'ordo' | 'works' | 'people' | 'trade' | 'events' | 'advisors';
const FILTERS: readonly [Filter, string][] = [['all', 'All'], ['ordo', 'Ordo'], ['works', 'Works'], ['people', 'People'], ['trade', 'Trade'], ['events', 'Events'], ['advisors', 'Advisors']];
const KINDS: Record<Exclude<Filter, 'all'>, readonly LogKind[]> = {
  ordo: ['ordo', 'emergency', 'ledger'], works: ['build'], people: ['birth', 'death', 'good', 'bad'], trade: ['trade'],
  events: ['event', 'fasti', 'rank', 'milestone'], advisors: ['advisor'],
};
const CAUSE: Record<DeathCause, string> = { age: 'of age', hunger: 'of hunger', thirst: 'of thirst', fever: 'of fever', fire: 'in fires', other: 'otherwise' };
const SHOWN = 150;
const MS_PER_MIN = 60_000;

let filter: Filter = 'all';

function shownLog(s: GameState): LogEntry[] {
  const kinds = filter === 'all' ? null : KINDS[filter];
  const out: LogEntry[] = [];
  for (let i = s.log.length - 1; i >= 0 && out.length < SHOWN; i--) if (!kinds || kinds.includes(s.log[i].kind)) out.push(s.log[i]);
  return out;
}

function entry(g: Game, e: LogEntry): HTMLElement {
  const s = g.state;
  const b = e.ref !== undefined ? getBuilding(s, e.ref) : undefined;
  const li = h('li', { class: `ann-e ann-${e.kind}${e.tags?.includes('highlight') ? ' hi' : ''}`, 'data-key': `e-${e.day}-${e.text}` },
    h('span', { class: 'ann-date num' }, formatRoman(e.day)),
    h('span', { class: 'ann-text' }, e.tags?.includes('decided') ? img('i_seal', 1, 'ann-seal') : null, e.text));
  if (b) {
    li.classList.add('click');
    li.addEventListener('click', () => { g.select(b.id); g.focusTile(idx(b.x, b.y)); });
  }
  return li;
}

function log(g: Game): HTMLElement {
  const s = g.state;
  const list = h('div', { class: 'ann-log' });
  let year = -1;
  let ul: HTMLElement | null = null;
  for (const e of shownLog(s)) {
    const y = dateOf(e.day).year;
    if (y !== year || !ul) {
      year = y;
      ul = h('ul', { class: 'ann-year' });
      list.append(h('div', { class: 'ann-year-head num', 'data-key': `y-${y}` }, formatAuc(y)), ul);
    }
    ul.append(entry(g, e));
  }
  if (!list.childElementCount) list.append(h('div', { class: 'tab-quiet' }, 'Nothing of that kind is written yet.'));
  return list;
}

function record(g: Game, up: Updater[]): HTMLElement {
  const grid = h('div', { class: 'ann-stats' });
  const refresh = (): void => {
    const s = g.state;
    const st = s.stats;
    const deaths = (Object.entries(st.deathsBy) as [DeathCause, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${CAUSE[k] ?? k}`).join(', ');
    grid.replaceChildren(
      kv('Years since the founding', fmt(elapsed(s) / B.time.YEAR_DAYS)),
      kv('Peak population', fmt(st.peakPop)),
      kv('Births · deaths', `${st.births} · ${st.deaths}${deaths ? ` (${deaths})` : ''}`),
      kv('Arrivals · departures', `${st.immigrants} · ${st.emigrants}`),
      kv('Works raised', fmt(st.built)),
      kv('Homes improved · fallen back', `${st.evolved} · ${st.devolved}`),
      kv('Taxes gathered', `${fmt(st.denariiTaxed)} den`),
      kv('Time governed', `${Math.round(st.playMs / MS_PER_MIN)} min`));
  };
  refresh();
  up.push(refresh);
  return grid;
}

function fasti(g: Game): HTMLElement | null {
  const s = g.state;
  const lines = s.log.filter((e) => e.kind === 'fasti').reverse();
  const colonies = loadFasti();
  if (!lines.length && !colonies.length && !s.victory) return null;
  const sec = section('Fasti', 'One line for each year, at the Parilia', { anchor: 'fasti' });
  // the Victory dispatch opens once, at the dedication: here it can be read again (the figures of that day), to read
  // only: no Found a new colony at a click (dispatch.ts victoryAnswers)
  if (s.victory) {
    sec.append(h('div', { class: 'ann-victory' }, h('span', null, `The Capitolium was dedicated on ${formatRoman(s.stats.victoryDay ?? s.day, { year: true })}`),
      btn(g, 'Read the dispatch again', () => { g.sfx('click'); openDispatch(g, 'victory', undefined, true); })));
  }
  if (lines.length) sec.append(h('ul', { class: 'ann-fasti' }, lines.map((e) => h('li', null, h('span', { class: 'ann-date num' }, formatAuc(aucYear(e.day))), e.text))));
  if (colonies.length) {
    sec.append(h('div', { class: 'tab-note' }, 'Fasti coloniarum: the colonies you have dedicated.'),
      h('ul', { class: 'ann-fasti' }, colonies.map((f) => h('li', null, h('b', null, f.name), ` · ${fmt(f.peakPop)} souls${f.dedicated !== null ? ` · dedicated ${formatAuc(aucYear(f.dedicated))}` : ''}`))));
  }
  return sec;
}

function commentarii(s: GameState): HTMLElement | null {
  // urgent tips speak of the moment ("grain lasts 191 days"): read again later they would contradict the HUD
  const seen = GUIDE.filter((t) => !t.urgent && s.guidance.tips.includes(t.id));
  if (!seen.length) return null;
  const sec = section('Commentarii', 'The mentor\'s notes, to read again', { anchor: 'commentarii' });
  for (const t of seen) sec.append(h('details', { class: 'ann-tip' }, h('summary', null, t.title), h('p', null, t.text(s))));
  return sec;
}

/** The Chronicle tab. */
export const panel: TabPanel = {
  id: 'annals', label: 'Annales', sub: 'Chronicle', icon: 'i_tab_annals', hotkey: 'L',
  signature(g: Game): string {
    const s = g.state;
    const last = s.log[s.log.length - 1];
    return `${filter}|${s.log.length}|${last ? `${last.day}:${last.text}` : ''}|${s.guidance.tips.length}|${+s.victory}`;
  },
  build(g: Game, body: HTMLElement, up: Updater[]): void {
    const s = g.state;
    body.append(h('div', { class: 'bld-cats ann-filters', role: 'toolbar', 'aria-label': 'Filter' }, FILTERS.map(([id, label]) => {
      const b = btn(g, label, () => { filter = id; g.changed(); }, { cls: `bld-cat${filter === id ? ' on' : ''}`, sfx: false });
      b.setAttribute('aria-pressed', String(filter === id));
      return b;
    })));
    const chron = section('Annales', `The chronicle of ${s.name}, newest first`, { anchor: 'log' });
    chron.append(log(g));
    body.append(chron);
    const f = fasti(g);
    if (f) body.append(f);
    const rec = section('Res publica', 'The colony\'s record', { anchor: 'record' });
    rec.append(record(g, up));
    body.append(rec);
    const c = commentarii(s);
    if (c) body.append(c);
  },
  focus(anchor: string): void {
    const f = FILTERS.find(([id]) => id === anchor);
    if (f) filter = f[0];
  },
};

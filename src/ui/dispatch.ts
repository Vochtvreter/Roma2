// src/ui/dispatch.ts — the parchment letters: Founding Dispatch, Litterae Ordinis (away report), Victory (DESIGN §14, §15.5). Owner: WP-H.
// SCAFFOLD: plain parchment modals with the essential lines; the full report layout is WP-H's.
import type { AwayReport } from '../game/types';
import type { Game } from './types';
import { h, fmt, fmtDays, plural } from './dom';
import { openModal } from './modals';
import { formatRoman } from '../game/calendar';
import { RANK_DEFS } from '../game/data/ranks';
import { BUILDING_DEFS } from '../game/data/buildings';
import { BUILDINGS } from '../game/types';

const FOUNDING_TEXT = 'To the Praefectus castrorum at Castra Valeria. Twenty-four souls of six families. Grain for 24 days, '
  + 'one well, one field. Hiems comes on the Kalends of December, 244 days hence: have the horrea full. Aestas comes sooner, and it is thirsty.';

function awayTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  const hr = Math.floor(s / 3600);
  return `${hr} h ${Math.floor((s % 3600) / 60)} min`;
}

function line(label: string, ...text: (string | Node)[]): HTMLElement {
  return h('div', { class: 'disp-line' }, h('span', { class: 'kicker disp-label' }, label), h('span', { class: 'disp-text' }, ...text));
}

function awayBody(r: AwayReport, done: () => void): HTMLElement {
  const b = r.before, a = r.after;
  const works = BUILDINGS.filter((t) => ((a.builtBy[t] ?? 0) - (b.builtBy[t] ?? 0)) > 0)
    .map((t) => `${BUILDING_DEFS[t].name}${(a.builtBy[t] ?? 0) - (b.builtBy[t] ?? 0) > 1 ? ` ×${(a.builtBy[t] ?? 0) - (b.builtBy[t] ?? 0)}` : ''}`);
  const coin = a.res.denarii - b.res.denarii;
  return h('div', { class: 'disp-body' },
    h('div', { class: 'disp-head' }, `from ${formatRoman(b.day)} to ${formatRoman(a.day, { year: true })} · ${plural(r.days, 'day', 'days')} · you were away ${awayTime(r.awayMs)}`),
    line('THE CITY', `Souls ${fmt(b.pop)} → ${fmt(a.pop)} (+${a.births - b.births} births, +${a.immigrants - b.immigrants} arrivals, −${a.deaths - b.deaths} deaths, −${a.emigrants - b.emigrants} departed) · Rank ${RANK_DEFS[a.rank].name} · Spirits ${Math.round(b.morale)} → ${Math.round(a.morale)}`),
    line('STORES', `Grain ${fmtDays(b.grainDoh)} → ${fmtDays(a.grainDoh)} · Water ${fmtDays(b.waterDoh)} → ${fmtDays(a.waterDoh)} · Coin ${fmt(b.res.denarii)} → ${fmt(a.res.denarii)} (${coin >= 0 ? '+' : ''}${fmt(coin)})`),
    line('WORKS RAISED', works.length ? works.join(' · ') : 'None'),
    r.decided.length ? line('DECIDED IN YOUR NAME', h('ul', null, r.decided.map((d) => h('li', null, d)))) : null,
    line('LOWEST POINT', `Grain fell to ${fmtDays(r.lowest.grain.doh)} on ${formatRoman(r.lowest.grain.day)} · water to ${fmtDays(r.lowest.water.doh)} on ${formatRoman(r.lowest.water.day)}`),
    r.awaiting.petition !== null ? line('AWAITING YOU', `Rome would hear our petition for ${RANK_DEFS[r.awaiting.petition].name}.`) : null,
    h('p', { class: 'muted' }, 'Time away passes at half speed, up to five years.'),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: () => done() }, 'Return to the city')),
  );
}

/** Opens one of the three parchment letters; closing it resumes the game as the letter says. */
export function openDispatch(g: Game, kind: 'founding' | 'away' | 'victory', report?: AwayReport): void {
  let closeCurrent: () => void = () => undefined;
  if (kind === 'founding') {
    const body = h('div', { class: 'disp-body' },
      h('p', { class: 'disp-letter' }, FOUNDING_TEXT),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: () => { closeCurrent(); g.setSpeed(1); } }, 'Raise the standard')));
    closeCurrent = openModal(body, { kicker: 'LITTERAE · ROMA', title: g.state.name, parchment: true, closable: false });
    return;
  }
  if (kind === 'away' && report) {
    closeCurrent = openModal(awayBody(report, () => closeCurrent()), {
      kicker: 'LITTERAE ORDINIS', title: g.state.name, parchment: true, wide: true, onClose: () => g.setSpeed(g.prefs.speed),
    });
    return;
  }
  const s = g.state;
  const body = h('div', { class: 'disp-body' },
    h('p', { class: 'disp-letter' }, `On ${formatRoman(s.day, { year: true })} the Capitolium of ${s.name} was dedicated to Jupiter, Juno and Minerva. `
      + `${plural(s.people.length, 'soul', 'souls')} stood in the forum. Rome will remember the colony in the Fasti.`),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => closeCurrent() }, 'Remain in the city'),
      h('button', { class: 'btn primary', onclick: () => { closeCurrent(); g.newGame({ afterVictory: true }); } }, 'Found a new colony')));
  closeCurrent = openModal(body, { kicker: 'VICTORIA', title: 'The Capitolium is dedicated', parchment: true });
}

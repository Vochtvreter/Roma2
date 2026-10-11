// src/ui/dispatch.ts — the parchment letters (DESIGN §14, §15.5, §9.5): the Founding Dispatch, the Litterae Ordinis away
// report and the Victory dispatch. Light parchment, ink, a code-drawn meander frame and a red wax seal. Owner: WP-H.
import { BUILDINGS, HOUSE_TIERS, PATH_DECISIONS } from '../game/types';
import type { AwayReport, GameState, Snapshot } from '../game/types';
import type { Game } from './types';
import { fmt, fmtDays, h, img } from './dom';
import type { Kid } from './dom';
import { waxSeal } from './tipkit';
import { exportDue, openExportImport, openModal } from './modals';
import { activeAdvisories, renderAdvisory } from '../game/advisors/engine';
import { forecast } from '../game/forecast';
import { view } from '../game/sim';
import { aucYear, formatRoman, nextSeasonStart, toRoman } from '../game/calendar';
import { BUILDING_DEFS } from '../game/data/buildings';
import { TIER_DEFS } from '../game/data/housing';
import { PATH_DEFS } from '../game/data/decisions';
import { RANK_DEFS } from '../game/data/ranks';
import { B } from '../game/balance';
import { sentence, wonWhileAway } from '../game/offline';
import { skipIntro } from '../game/actions';
import { typeSprite } from './tabs/common';

const ONES = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const HIGHLIGHTS = 6;

/** 24 → 'twenty-four' (numerals from 100 on). */
function words(n: number): string {
  const k = Math.max(0, Math.round(n));
  if (k < 20) return ONES[k];
  if (k < 100) return TENS[Math.floor(k / 10)] + (k % 10 ? `-${ONES[k % 10]}` : '');
  return fmt(k);
}
const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** '7 min 22 s', '3 h 5 min'. */
export function awayTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

function line(label: string, ...kids: Kid[]): HTMLElement {
  return h('div', { class: 'disp-line' }, h('div', { class: 'disp-label' }, label), h('div', { class: 'disp-text' }, ...kids));
}

/** "41 → 88" with a coloured arrow. */
function delta(a: number, b: number, fmtFn: (n: number) => string = fmt): HTMLElement {
  const cls = b > a + 0.5 ? 'up' : b < a - 0.5 ? 'down' : '';
  return h('span', { class: `disp-delta ${cls}` }, fmtFn(a), h('span', { class: 'disp-arrow' }, ' → '), h('b', null, fmtFn(b)));
}

const doh = (n: number): string => fmtDays(Number.isFinite(n) ? n : null);

function works(b: Snapshot, a: Snapshot): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const t of BUILDINGS) {
    const n = (a.builtBy[t] ?? 0) - (b.builtBy[t] ?? 0);
    if (n <= 0) continue;
    const name = t === 'area' ? (n === 1 ? 'a house plot' : 'house plots') : BUILDING_DEFS[t].name;
    const label = t === 'area' ? (n > 1 ? `${n} ${name}` : name) : n > 1 ? `${name} ×${n}` : name;
    out.push(h('span', { class: 'disp-work' }, img(typeSprite(t), 1, 'disp-work-ico'), label));
  }
  return out;
}

const TIER_PLURAL: Record<string, string> = { tentoria: 'tentoria', casa: 'casae', tegulata: 'casae tegulatae', domusParva: 'domus parvae', insula: 'insulae', domus: 'domus' };

function homes(b: Snapshot, a: Snapshot): string {
  const parts: string[] = [];
  for (const t of HOUSE_TIERS) {
    const n = (a.evolvedBy[t] ?? 0) - (b.evolvedBy[t] ?? 0);
    if (n > 0) parts.push(n === 1 ? `1 home became a ${TIER_DEFS[t].latin.toLowerCase()}` : `${n} homes became ${TIER_PLURAL[t]}`);
  }
  return parts.join(' · ');
}

function lowest(r: AwayReport): string {
  const parts: string[] = [];
  if (Number.isFinite(r.lowest.grain.doh)) parts.push(`Grain fell to ${doh(r.lowest.grain.doh)} on ${formatRoman(r.lowest.grain.day)}`);
  if (Number.isFinite(r.lowest.water.doh)) parts.push(`water to ${doh(r.lowest.water.doh)} on ${formatRoman(r.lowest.water.day)}`);
  return parts.length ? sentence(parts.join('; ')) : 'The stores never ran thin.';
}

function awaiting(g: Game, r: AwayReport, close: () => void): HTMLElement | null {
  const s = g.state;
  const items: HTMLElement[] = [];
  if (r.awaiting.petition !== null) {
    items.push(h('div', { class: 'disp-await gold' }, h('span', { class: 'disp-mark' }, '▲'), h('span', { class: 'disp-await-text' }, `Rome would hear our petition for ${RANK_DEFS[r.awaiting.petition].name}.`),
      h('button', { class: 'btn small legate', onclick: () => { close(); g.openTab('council', 'petition'); } }, 'Petition Rome')));
  }
  for (const rule of r.awaiting.advisories) {
    const a = activeAdvisories(s).find((x) => x.rule === rule);
    if (!a) continue;
    const ra = renderAdvisory(s, view(s), a);
    const first = ra.remedies.find((x) => x.check.ok);
    items.push(h('div', { class: `disp-await s${a.memo.sev}` }, h('span', { class: 'disp-mark' }, '●'), h('span', { class: 'disp-await-text' }, ra.title),
      first ? h('button', { class: 'btn small', onclick: () => { close(); g.applyRemedy(first.remedy); } }, first.label) : null));
  }
  return items.length ? line('AWAITING YOU', ...items) : null;
}

function awayBody(g: Game, r: AwayReport, close: () => void): HTMLElement {
  const b = r.before, a = r.after;
  const coin = a.res.denarii - b.res.denarii;
  const moves = [[a.births - b.births, '+', 'births'], [a.immigrants - b.immigrants, '+', 'arrivals'], [a.deaths - b.deaths, '−', 'deaths'],
    [a.emigrants - b.emigrants, '−', 'departed']].filter(([n]) => (n as number) > 0).map(([n, sg, w]) => `${sg}${n} ${w}`);
  const city = h('span', null, 'Souls ', delta(b.pop, a.pop), moves.length ? ` (${moves.join(', ')})` : '',
    ` · Rank ${RANK_DEFS[a.rank].name} · Spirits `, delta(b.morale, a.morale, (n) => String(Math.round(n))));
  const stores = h('span', null, 'Grain ', delta(b.grainDoh, a.grainDoh, doh), ' · Water ', delta(b.waterDoh, a.waterDoh, doh),
    ' · Coin ', delta(b.res.denarii, a.res.denarii), ` (${coin >= 0 ? '+' : '−'}${fmt(Math.abs(coin))})`);
  const w = works(b, a);
  const hm = homes(b, a);
  const hl = r.highlights.slice(-HIGHLIGHTS).reverse();
  return h('div', { class: 'disp-body' },
    h('div', { class: 'disp-head' }, `from ${formatRoman(b.day)} to ${formatRoman(a.day, { year: true })}`,
      h('span', { class: 'disp-dim' }, ` · ${fmt(r.days)} days · you were away ${awayTime(r.awayMs)}`),
      wonWhileAway(g.state, r) ? h('span', { class: 'disp-dim' }, ' · the Capitolium was dedicated and the clock stopped') : null),
    line('THE CITY', city),
    line('STORES', stores),
    line('WORKS RAISED', w.length ? h('span', { class: 'disp-works' }, w) : 'None this time.'),
    hm ? line('HOMES', hm) : null,
    r.decided.length ? line('DECIDED IN YOUR NAME', h('ul', { class: 'disp-list' }, r.decided.map((d) => h('li', null, d)))) : null,
    hl.length ? line('IN THE ANNALES', h('ul', { class: 'disp-list' }, hl.map((e) => h('li', null, h('span', { class: 'disp-date' }, formatRoman(e.day)), ' ', e.text)))) : null,
    line('LOWEST POINT', lowest(r)),
    awaiting(g, r, close),
    exportDue(g.state) ? line('KEEP A COPY', h('div', { class: 'disp-await' }, h('span', { class: 'disp-mark' }, '◆'),
      h('span', { class: 'disp-await-text' }, 'The colony lives only in this browser, and Safari forgets sites left unvisited for a week.'),
      h('button', { class: 'btn small', onclick: () => openExportImport(g) }, 'Export a copy'))) : null,
    h('div', { class: 'disp-foot' },
      h('span', { class: 'disp-note' }, 'Time away passes at half speed, up to five years.'),
      h('span', { class: 'disp-sign' }, '— Ordo Decurionum'),
      h('button', { class: 'btn primary', 'data-autofocus': '', onclick: () => close() }, 'Return to the city')));
}

function foundingBody(g: Game, start: () => void): HTMLElement {
  const s = g.state;
  const f = forecast(s);
  const hiems = nextSeasonStart(s.day, 3) - s.day;
  const wells = s.buildings.filter((b) => b.type === 'puteus').length;
  const fields = s.buildings.filter((b) => b.type === 'ager').length;
  const text = `${cap1(words(s.people.length))} souls of ${words(s.families.length)} families. Grain for ${Math.floor(f.grain.doh)} days, `
    + `${words(wells)} ${wells === 1 ? 'well' : 'wells'}, ${words(fields)} ${fields === 1 ? 'field' : 'fields'}. Hiems comes on the Kalends of December, `
    + `${hiems} days hence: have the horrea full. Aestas comes sooner, and it is thirsty.`;
  return h('div', { class: 'disp-body letter' },
    h('p', { class: 'disp-salute' }, `To the Praefectus castrorum at ${s.name}.`),
    h('p', { class: 'disp-letter' }, text),
    h('p', { class: 'disp-letter' }, 'The camp is yours to run by hand: who works where, and what is raised. Each chore you have shown the Ordo Decurionum, it will take up in your name if you bid it, every day and even while you sleep. Keep the people fed.'),
    h('div', { class: 'disp-facts' },
      h('span', { class: 'disp-fact' }, img('i_souls', 2), `${s.people.length} souls`),
      h('span', { class: 'disp-fact' }, img('i_grain', 2), `${Math.floor(f.grain.doh)} days of grain`),
      h('span', { class: 'disp-fact' }, img('i_water', 2), `${Math.floor(f.water.doh)} days of water`),
      h('span', { class: 'disp-fact' }, img('i_season_3', 2), `Hiems in ${hiems} days`)),
    h('div', { class: 'disp-foot' },
      h('span', { class: 'disp-sign' }, `Datum ${formatRoman(s.day, { year: true })} · Legatus Augusti`),
      h('div', { class: 'disp-start' },
        h('button', { class: 'btn primary big', 'data-autofocus': '', onclick: start }, 'Raise the standard'),
        // a returning Praefectus needs no introduction: every panel from the first day (the mentor still speaks later)
        h('button', { class: 'disp-skip', onclick: () => { g.act(skipIntro(g.state)); start(); } }, 'I know the camp: skip the introduction'))));
}

function victoryBody(g: Game, close: () => void): HTMLElement {
  const s: GameState = g.state;
  const st = s.stats;
  const founded = aucYear(B.time.START_DAY);
  const years = Math.max(0, aucYear(st.victoryDay ?? s.day) - founded);
  const paths = PATH_DECISIONS.map((d) => ({ d, o: s.decisions.paths[d] })).filter((x) => x.o)
    .map((x) => PATH_DEFS[x.d].options.find((o) => o.id === x.o)?.name ?? '');
  const stat = (k: string, v: string): HTMLElement => h('div', { class: 'disp-stat' }, h('b', null, v), h('span', null, k));
  const hours = st.playMs / 3_600_000;
  return h('div', { class: 'disp-body letter' },
    h('div', { class: 'disp-hero' }, img('f_aquila', 2)),
    h('p', { class: 'disp-letter' }, `On ${formatRoman(st.victoryDay ?? s.day, { year: true })} the Capitolium of ${s.name} was dedicated to Jupiter, Juno and Minerva. `
      + `${cap1(words(s.people.length))} souls stood in the forum. Rome will remember the colony in the Fasti.`),
    h('div', { class: 'disp-stats' },
      stat('years from camp to colonia', String(years)), stat('peak souls', fmt(st.peakPop)), stat('born', fmt(st.births)),
      stat('arrived', fmt(st.immigrants)), stat('works raised', fmt(st.built)), stat('homes improved', fmt(st.evolved)),
      stat('hours governed', hours < 1 ? `${Math.round(hours * 60)} min` : hours.toFixed(1)), stat('legacy', `${s.legacy}`)),
    paths.length ? h('p', { class: 'disp-story' }, 'Your story: ', paths.join(' · ')) : null,
    h('div', { class: 'disp-foot' },
      h('span', { class: 'disp-sign' }, `Senatus Populusque Romanus · AUC ${toRoman(aucYear(s.day))}`),
      h('button', { class: 'btn', 'data-autofocus': '', onclick: () => close() }, 'Keep governing'),
      h('button', { class: 'btn primary disp-two', onclick: () => { close(); g.newGame({ afterVictory: true }); } },
        h('span', null, 'Found a new colony'), h('small', null, `Legacy ${s.legacy + 1}: +10% output, +2 morale`))));
}

/** Opens one of the three parchment letters; closing it resumes the game as the letter says. */
export function openDispatch(g: Game, kind: 'founding' | 'away' | 'victory', report?: AwayReport): void {
  let close: () => void = () => undefined;
  const sealed = (body: HTMLElement): HTMLElement => h('div', { class: 'disp' }, waxSeal(), body);
  if (kind === 'founding') {
    close = openModal(sealed(foundingBody(g, () => { close(); g.setSpeed(1); })),
      { kicker: 'LITTERAE · LEGATVS AVGVSTI', title: `${g.state.name}`, parchment: true, closable: false, wide: true });
    return;
  }
  if (kind === 'away' && report) {
    close = openModal(sealed(awayBody(g, report, () => close())), {
      kicker: 'LITTERAE ORDINIS', title: `${g.state.name}: the Ordo reports`, parchment: true, wide: true, onClose: () => g.setSpeed(g.prefs.speed),
    });
    return;
  }
  close = openModal(sealed(victoryBody(g, () => close())), { kicker: 'VICTORIA · CAPITOLIVM DEDICATVM', title: 'The Capitolium is dedicated', parchment: true, wide: true });
}

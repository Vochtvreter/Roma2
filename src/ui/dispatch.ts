// src/ui/dispatch.ts — the parchment letters (DESIGN §14, §15.5, §9.5): the Founding Dispatch, the Litterae Ordinis away
// report and the Victory dispatch (read again from the Annales' Fasti). Light parchment, ink, a code-drawn meander frame
// and a red wax seal. A letter opens with the focus on itself, not on a button (modals.ts restingFocus). Owner: WP-H.
import { BUILDINGS, HOUSE_TIERS, PATH_DECISIONS } from '../game/types';
import type { AwayReport, GameState, Prefs, Remedy, Snapshot, Speed, VictoryStats } from '../game/types';
import type { Game } from './types';
import { fmt, fmtDays, h, img } from './dom';
import type { Kid } from './dom';
import { waxSeal } from './tipkit';
import { exportDue, openExportImport, openModal } from './modals';
import { keepCopyWhy, platform } from './platform';
import { activeAdvisories, renderAdvisory } from '../game/advisors/engine';
import { forecast } from '../game/forecast';
import { view } from '../game/sim';
import { aucYear, formatRoman, nextSeasonStart, toRoman } from '../game/calendar';
import { BUILDING_DEFS } from '../game/data/buildings';
import { TIER_DEFS } from '../game/data/housing';
import { PATH_DEFS } from '../game/data/decisions';
import { RANK_DEFS } from '../game/data/ranks';
import { B } from '../game/balance';
import { AWAY_CAP_MS, AWAY_CAP_YEARS, capLine, pct, readyLine, sentence, stalledLine, wonWhileAway } from '../game/offline';
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

/** The next rank's checklist and the Capitolium, before → after (null when neither is left to rise). */
function progress(b: Snapshot, a: Snapshot): HTMLElement | null {
  const parts: Kid[] = [];
  const p = a.petition;
  if (p) parts.push(`${RANK_DEFS[p.rank].name} petition: `, delta(b.petition?.rank === p.rank ? b.petition.met : p.met, p.met), ` of ${p.of} met`);
  if (a.capitolium !== null && b.capitolium !== 1) {
    parts.push(parts.length ? ' · Capitolium ' : 'Capitolium ', delta((b.capitolium ?? 0) * 100, a.capitolium * 100, (n) => pct(n / 100)));
  }
  return parts.length ? h('span', null, ...parts) : null;
}

function awaiting(g: Game, r: AwayReport, done: (held: boolean) => void): HTMLElement | null {
  const close = (held = true): void => done(held);   // a button here leads on to a panel: the colony waits there (DESIGN §14)
  const s = g.state;
  const items: HTMLElement[] = [];
  // nothing moved: what holds the next rank leads (DESIGN §14), its checklist a click away
  const stall = stalledLine(r);
  if (stall) {
    items.push(h('div', { class: 'disp-await s2' }, h('span', { class: 'disp-mark' }, '○'),
      h('span', { class: 'disp-await-text' }, h('b', null, 'Stalled:'), stall.replace(/^Stalled:/, '')),
      r.awaiting.stalled?.rank != null ? h('button', { class: 'btn small', onclick: () => { close(); g.openTab('council', 'petition'); } }, 'See the petition') : null));
  }
  const ready = readyLine(r);
  if (ready) {
    items.push(h('div', { class: 'disp-await gold' }, h('span', { class: 'disp-mark' }, '▲'), h('span', { class: 'disp-await-text' }, ready),
      h('button', { class: 'btn small legate', onclick: () => { close(); g.openTab('council', 'petition'); } }, 'Petition Rome')));
  }
  for (const rule of r.awaiting.advisories) {
    const a = activeAdvisories(s).find((x) => x.rule === rule);
    if (!a) continue;
    const ra = renderAdvisory(s, view(s), a);
    const first = ra.remedies.find((x) => x.check.ok);
    items.push(h('div', { class: `disp-await s${a.memo.sev}` }, h('span', { class: 'disp-mark' }, '●'), h('span', { class: 'disp-await-text' }, ra.title),
      first ? h('button', { class: 'btn small', onclick: () => { close(opensPanel(first.remedy)); g.applyRemedy(first.remedy); } }, first.label) : null));
  }
  return items.length ? line('AWAITING YOU', ...items) : null;
}

function awayBody(g: Game, r: AwayReport, close: (held?: boolean) => void): HTMLElement {
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
  const pg = progress(b, a);
  const cap = capLine(r, awayTime);
  const hl = r.highlights.slice(-HIGHLIGHTS).reverse();
  // what waits on the Praefectus comes first, before the account of what was done: on a phone the letter is several
  // screens long, and its Return to the city stays pinned at the foot (modals.css)
  return h('div', { class: 'disp-body' },
    h('div', { class: 'disp-head' }, `from ${formatRoman(b.day)} to ${formatRoman(a.day, { year: true })}`,
      h('span', { class: 'disp-dim' }, ` · ${fmt(r.days)} days · you were away ${awayTime(r.awayMs)}`),
      wonWhileAway(g.state, r) ? h('span', { class: 'disp-dim' }, ' · the Capitolium was dedicated and the clock stopped') : null),
    cap ? h('p', { class: 'disp-cap' }, cap) : null,
    awaiting(g, r, close),
    line('THE CITY', city),
    pg ? line('PROGRESS', pg) : null,
    line('STORES', stores),
    line('WORKS RAISED', w.length ? h('span', { class: 'disp-works' }, w) : 'None this time.'),
    hm ? line('HOMES', hm) : null,
    r.decided.length ? line('DECIDED IN YOUR NAME', h('ul', { class: 'disp-list' }, r.decided.map((d) => h('li', null, d)))) : null,
    hl.length ? line('IN THE ANNALES', h('ul', { class: 'disp-list' }, hl.map((e) => h('li', null, h('span', { class: 'disp-date' }, formatRoman(e.day)), ' ', e.text)))) : null,
    line('LOWEST POINT', lowest(r)),
    exportDue(g.state) ? line('KEEP A COPY', h('div', { class: 'disp-await' }, h('span', { class: 'disp-mark' }, '◆'),
      h('span', { class: 'disp-await-text' }, keepCopyWhy(platform())),   // Safari's week only in a Safari tab
      h('button', { class: 'btn small', onclick: () => openExportImport(g) }, 'Export a copy'))) : null,
    h('div', { class: 'disp-foot' },
      h('span', { class: 'disp-note' }, `Time away passes at half speed, up to ${words(AWAY_CAP_YEARS)} years (${Math.round(AWAY_CAP_MS / 60_000)} minutes away).`),
      h('span', { class: 'disp-sign' }, '— Ordo Decurionum'),
      h('button', { class: 'btn primary', onclick: () => close() }, 'Return to the city')));
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
        h('button', { class: 'btn primary big', onclick: start }, 'Raise the standard'),
        // a returning Praefectus needs no introduction: every panel from the first day (the mentor still speaks later)
        h('button', { class: 'disp-skip', onclick: () => { g.act(skipIntro(g.state)); start(); } }, 'I know the camp: skip the introduction'))));
}

/** The Victory dispatch's day and figures (pure; tests/letters.test.ts): those kept on the dedication day
 *  (stats.atVictory), so the letter reads the same when the Annales open it again; a colony dedicated before they were
 *  kept reads its figures to date. */
export function victoryFigures(s: GameState): VictoryStats & { day: number; years: number } {
  const st = s.stats;
  const day = st.victoryDay ?? s.day;
  const at: VictoryStats = st.atVictory
    ?? { pop: s.people.length, peakPop: st.peakPop, births: st.births, immigrants: st.immigrants, built: st.built, evolved: st.evolved, playMs: st.playMs };
  return { ...at, day, years: Math.max(0, aucYear(day) - aucYear(B.time.START_DAY)) };
}

/** The Victory dispatch's answers (pure; tests/letters.test.ts). On the dedication day: Keep governing, or Found a new
 *  colony at once (Legacy N+1). Read again from the Annales (`again`) the letter is for reading: Keep governing alone.
 *  A new colony replaces this one, and every other way to that asks first (the Menu's Abandon, the title's dialog that
 *  names it), so a letter opened hours later only to be read never founds one at a click. */
export function victoryAnswers(again: boolean): readonly ('keep' | 'found')[] {
  return again ? ['keep'] : ['keep', 'found'];
}

function victoryBody(g: Game, close: () => void, again: boolean): HTMLElement {
  const s: GameState = g.state;
  const answers = victoryAnswers(again);
  const fig = victoryFigures(s);
  const paths = PATH_DECISIONS.map((d) => ({ d, o: s.decisions.paths[d] })).filter((x) => x.o)
    .map((x) => PATH_DEFS[x.d].options.find((o) => o.id === x.o)?.name ?? '');
  const stat = (k: string, v: string): HTMLElement => h('div', { class: 'disp-stat' }, h('b', null, v), h('span', null, k));
  const hours = fig.playMs / 3_600_000;
  return h('div', { class: 'disp-body letter' },
    h('div', { class: 'disp-hero' }, img('f_aquila', 2)),
    h('p', { class: 'disp-letter' }, `On ${formatRoman(fig.day, { year: true })} the Capitolium of ${s.name} was dedicated to Jupiter, Juno and Minerva. `
      + `${cap1(words(fig.pop))} souls stood in the forum. Rome will remember the colony in the Fasti.`),
    h('div', { class: 'disp-stats' },
      stat('years from camp to colonia', String(fig.years)), stat('peak souls', fmt(fig.peakPop)), stat('born', fmt(fig.births)),
      stat('arrived', fmt(fig.immigrants)), stat('works raised', fmt(fig.built)), stat('homes improved', fmt(fig.evolved)),
      stat('hours governed', hours < 1 ? `${Math.round(hours * 60)} min` : hours.toFixed(1)), stat('legacy', `${s.legacy}`)),
    paths.length ? h('p', { class: 'disp-story' }, 'Your story: ', paths.join(' · ')) : null,
    h('div', { class: 'disp-foot' },
      h('span', { class: 'disp-sign' }, `Senatus Populusque Romanus · AUC ${toRoman(aucYear(fig.day))}`),
      h('button', { class: answers.includes('found') ? 'btn' : 'btn primary', onclick: () => close() }, 'Keep governing'),
      answers.includes('found') ? h('button', { class: 'btn primary disp-two', onclick: () => { close(); g.newGame({ afterVictory: true }); } },
        h('span', null, 'Found a new colony'), h('small', null, `Legacy ${s.legacy + 1}: +10% output, +2 morale`)) : null));
}

/** How a colony goes on after Continue or the away letter (DESIGN §2.1): as the player left it, held if they had paused
 *  it (❚❚, Space, Pause on Periculum: prefs.paused), else at their last speed. `held`: the letter closed on a button
 *  that opens a panel (the petition, a remedy that opens a tab or the contract form), so the days wait while they read
 *  it. null: the colony stays paused. */
export function resumeAs(p: Pick<Prefs, 'speed' | 'paused'>, held = false): Speed | null {
  return held || p.paused ? null : p.speed;
}

/** A remedy that opens a panel (a tab, the contract form): from the away letter it leaves the colony paused. */
export const opensPanel = (r: Remedy): boolean => r.kind === 'open' || r.kind === 'contract';

/** Sets the colony going by resumeAs: at that speed, or paused (setPaused keeps it in prefs, so a reload keeps it too). */
export function resume(g: Game, held = false): void {
  const sp = resumeAs(g.prefs, held);
  if (sp === null) g.setPaused(true);
  else g.setSpeed(sp);
}

/** Opens one of the three parchment letters; closing it resumes the game as the letter says. `again`: the Victory
 *  dispatch read again from the Annales, with no Found a new colony (victoryAnswers). */
export function openDispatch(g: Game, kind: 'founding' | 'away' | 'victory', report?: AwayReport, again = false): void {
  let close: () => void = () => undefined;
  const sealed = (body: HTMLElement): HTMLElement => h('div', { class: 'disp' }, waxSeal(), body);
  if (kind === 'founding') {
    close = openModal(sealed(foundingBody(g, () => { close(); g.setSpeed(1); })),
      { kicker: 'LITTERAE · LEGATVS AVGVSTI', title: `${g.state.name}`, parchment: true, closable: false, wide: true });
    return;
  }
  if (kind === 'away' && report) {
    let held = false;   // closed by a button that opens a panel: the colony waits while the player reads it
    close = openModal(sealed(awayBody(g, report, (hold = false) => { held = hold; close(); })), {
      kicker: 'LITTERAE ORDINIS', title: `${g.state.name}: the Ordo reports`, parchment: true, wide: true, onClose: () => resume(g, held),
    });
    return;
  }
  close = openModal(sealed(victoryBody(g, () => close(), again)), { kicker: 'VICTORIA · CAPITOLIVM DEDICATVM', title: 'The Capitolium is dedicated', parchment: true, wide: true });
}

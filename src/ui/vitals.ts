// src/ui/vitals.ts — the Grain and Water tablets with the 12-month forecast strip (DESIGN §11.11), the signature widget.
// Owner: WP-H. Big days-on-hand number, trend with net/day, a red run-out line, 12 month cells coloured by the lowest
// projected days on hand (B.forecast.BANDS), season labels beneath; hover draws the year's stock line with cap and seasons.
// A tap or click opens the Breviarium at the essential (tray.ts), which draws the same strip, seasons, run-out line and
// card from the helpers exported here; the hover card stays quiet while the tray lies beneath it.
import type { Essential, EssentialForecast, MonthCell, RuleId } from '../game/types';
import type { Game } from './types';
import { fmt, fmtDays, fmtRate, fmtRunway, h, img, sentence, tip } from './dom';
import { tipCard, tipHead, tipNote, tipRow, tipSep } from './tipkit';
import { fxTags, ledger, moreSection, netRate, outlookLine } from './hud-tips';
import { forecast } from '../game/forecast';
import { activeAdvisories } from '../game/advisors/engine';
import { MONTH_ABBR, formatRoman } from '../game/calendar';
import { B } from '../game/balance';
import { resIcon } from '../render/art/index';

const LABEL: Record<Essential, string> = { grain: 'GRAIN', water: 'AQVA' };
const LATIN: Record<Essential, string> = { grain: 'Frumentum', water: 'Aqua' };
const DOMAIN: Record<Essential, RuleId[]> = {
  grain: ['annonae.grain.runout', 'annonae.famine', 'annonae.hiems.forecast', 'annonae.mess'],
  water: ['aquarum.water.runout', 'aquarum.aestas.forecast'],
};
const SEASON_SHORT = ['VER', 'AEST', 'AVT', 'HIEM'] as const;
const SEASON_TINT = ['rgba(156,204,90,.16)', 'rgba(242,201,76,.16)', 'rgba(227,132,58,.16)', 'rgba(143,163,181,.18)'] as const;
const BAND_COLOR = { good: '#9ccc5a', gold: '#f2c94c', warn: '#e3843a', bad: '#e5554a', empty: '#0a0710' } as const;
const DOH_NONE = 9999;
/** The red "empty …" line shows once the advisor would speak (Monitum run-out thresholds). */
const WARN_DAYS: Record<Essential, number> = { grain: B.advisors.RULES.GRAIN_RUNOUT[2], water: B.advisors.RULES.WATER_RUNOUT[2] };   // the forecast's "nobody needs it" sentinel (CONTRACT_NOTES, game stubs 4)

/** The month cell's band: good ≥ 30, gold 15–30, warn 7–15, bad < 7, empty at 0 (B.forecast.BANDS). */
export function bandOf(doh: number): keyof typeof BAND_COLOR {
  const [a, b, c] = B.forecast.BANDS;
  if (doh >= a) return 'good';
  if (doh >= b) return 'gold';
  if (doh >= c) return 'warn';
  return doh > 0.05 ? 'bad' : 'empty';
}

/** The season labels' row and what it last showed (a repaint only when the run of seasons changes). */
export interface SeasonRow { seasons: HTMLElement; seasonKey: string }

interface Tablet extends SeasonRow {
  el: HTMLElement; days: HTMLElement; unit: HTMLElement; trend: HTMLElement; arrow: HTMLElement; rate: HTMLElement; sub: HTMLElement;
  cells: HTMLElement[];
}

/** The month cells of a forecast strip (the tablet's, the Breviarium's larger one). */
export function stripCells(): HTMLElement[] {
  return Array.from({ length: B.forecast.CELLS }, () => h('i', { class: 'vit-cell' }));
}

/** Colours the month cells by each month's lowest days on hand; the first is today's. */
export function paintCells(cells: HTMLElement[], months: MonthCell[]): void {
  cells.forEach((cell, i) => {
    const m = months[i];
    cell.className = m ? `vit-cell ${bandOf(m.minDoh)}${i === 0 ? ' now' : ''}` : 'vit-cell';
  });
}

/** The trend of an essential from the last tick's ledger (so the arrow equals the card's "= a day" line). */
export function trendOf(g: Game, res: Essential): { arrow: string; rate: string; cls: '' | 'good' | 'bad' } {
  const net = netRate(g, res);
  return { arrow: net > 0.05 ? '▲' : net < -0.05 ? '▼' : '■', rate: fmtRate(net).replace('/d', ''), cls: net < -0.05 ? 'bad' : net > 0.05 ? 'good' : '' };
}

/** The red run-out line ("empty a.d. …"), once the advisor would speak; '' while the stores hold. */
export function emptyLine(g: Game, res: Essential, f: EssentialForecast): string {
  const empty = f.net < -0.05 && f.runout !== null && f.runout - g.state.day < WARN_DAYS[res];
  return empty && f.runout !== null ? `empty ${formatRoman(f.runout)}` : '';
}

/** The days on hand as the tablet writes them: whole days, or ∞ when nobody needs it. */
export function daysText(f: EssentialForecast): string {
  return fmtDays(f.doh) === '∞' ? '∞' : String(Math.max(0, Math.floor(f.doh)));
}

function tablet(g: Game, res: Essential, quiet: (el: HTMLElement) => boolean): Tablet {
  const days = h('span', { class: 'vit-days num' }, '—');
  const unit = h('span', { class: 'vit-unit num' }, 'd');
  const arrow = h('span', { class: 'vit-arrow' });
  const rate = h('span', { class: 'vit-rate' });
  const trend = h('span', { class: 'vit-trend num' }, arrow, rate);
  const sub = h('span', { class: 'vit-sub' });
  const cells = stripCells();
  const seasons = h('div', { class: 'vit-seasons' });
  // a figure of the HUD: a tap or click opens the Breviarium here (hud.ts → tray.ts); Enter does from the keyboard
  const el = h('div', { class: `hud-vital vit-${res}`, id: `vital-${res}`, role: 'group', tabindex: '0', 'aria-label': `${LATIN[res]}: days on hand`,
    'aria-controls': 'tray', 'aria-expanded': 'false', dataset: { fig: res } },
    img(resIcon(res), 2, 'vit-ico'),
    h('div', { class: 'vit-head' }, h('span', { class: 'vit-label' }, LABEL[res]), trend),
    h('div', { class: 'vit-main' }, days, unit),
    h('div', { class: 'vit-strip' }, cells),
    seasons, sub);
  tip(el, () => (quiet(el) ? '' : vitalTip(g, res)), { wide: true });
  return { el, days, unit, trend, arrow, rate, sub, cells, seasons, seasonKey: '' };
}

function paint(g: Game, t: Tablet, res: Essential, f: EssentialForecast): void {
  const n = daysText(f);
  t.days.textContent = n;
  t.unit.hidden = n === '∞';
  t.el.classList.toggle('long', n.length > 2);   // three digits: a phone's narrow tablet drops the unit (hud.css)
  const tr = trendOf(g, res);
  t.arrow.textContent = tr.arrow;
  t.rate.textContent = ` ${tr.rate}`;
  t.trend.className = `vit-trend num${tr.cls ? ` ${tr.cls}` : ''}`;
  const line = emptyLine(g, res, f);
  t.sub.textContent = line;
  t.el.classList.toggle('low', f.doh < B.forecast.BANDS[2]);
  t.el.classList.toggle('falling', line !== '');
  const peril = activeAdvisories(g.state).some((a) => a.memo.sev === 3 && DOMAIN[res].includes(a.rule));
  t.el.classList.toggle('peril', peril);
  const months = f.months.slice(0, t.cells.length);
  paintCells(t.cells, months);
  paintSeasons(t, months);
}

/** Season labels beneath the strip: one label per run of months in the same season. */
export function paintSeasons(t: SeasonRow, months: MonthCell[]): void {
  const key = months.map((m) => m.season).join('');
  if (key === t.seasonKey) return;
  t.seasonKey = key;
  t.seasons.replaceChildren();
  let i = 0;
  while (i < months.length) {
    let j = i;
    while (j < months.length && months[j].season === months[i].season) j++;
    const n = j - i;
    const label = SEASON_SHORT[months[i].season];
    t.seasons.appendChild(h('span', { class: `vit-season s${months[i].season}`, style: { flexGrow: String(n) } }, n >= 2 ? label : label[0]));
    i = j;
  }
}

/** The hover card (and the Breviarium's body for the essential): stock, need, flows, the run-out date, the outlook, the
 *  12-month stock line and how to get more. */
export function vitalTip(g: Game, res: Essential): HTMLElement {
  const f = forecast(g.state)[res];
  const low = f.lowestDoh < DOH_NONE ? `lowest ${fmtDays(f.lowestDoh)} on hand, ${formatRoman(f.lowestDay)}` : 'no need yet';
  return tipCard(
    tipHead(res === 'grain' ? 'Grain' : 'Water', `${LATIN[res]} · days on hand`),
    tipNote(`${fmt(f.stock)} of ${fmt(f.cap)} · need ${fmt(f.need)} a day · ${fmtDays(f.doh)} on hand · room for ${fmtRunway(f.need > 0 ? f.room / f.need : null)}`, 'tip-big'),
    tipSep(),
    ...ledger(g, res),
    tipRow('3-day average', fmtRate(f.net3), f.net3 >= 0 ? 'pos' : 'neg'),
    fxTags(g, res),
    f.runout !== null && f.net < 0 ? tipNote(`Runs out on ${formatRoman(f.runout)} unless something changes.`, 'bad') : null,
    f.structural ? tipNote('Even every able hand at work could not cover the need: build or import.', 'bad') : null,
    tipSep(),
    chart(f, res),
    tipNote(`The year ahead: ${sentence(low)} ${outlookLine(g, res)}`),
    ...moreSection(g, res),
  );
}

/** A small canvas line chart: end-of-month stock against the cap, with season bands and month initials. */
export function chart(f: EssentialForecast, res: Essential): HTMLElement {
  const W = 288, H = 92, PAD_B = 14, PAD_T = 6;
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const c = h('canvas', { class: 'vit-chart', width: String(W * dpr), height: String(H * dpr) });
  c.style.width = `${W}px`;
  c.style.height = `${H}px`;
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(dpr, dpr);
  const months = f.months;
  const cw = W / Math.max(1, months.length);
  const top = Math.max(f.cap, f.stock, ...months.map((m) => m.endStock), 1);
  const y = (v: number): number => PAD_T + (H - PAD_B - PAD_T) * (1 - Math.max(0, v) / top);
  g.font = '8px Silkscreen, monospace';
  months.forEach((m, i) => {
    g.fillStyle = SEASON_TINT[m.season];
    g.fillRect(i * cw, 0, cw - 1, H - PAD_B);
    g.fillStyle = '#bba58b';
    g.fillText(MONTH_ABBR[m.month - 1][0], i * cw + cw / 2 - 3, H - 3);
  });
  g.strokeStyle = 'rgba(244,234,214,.45)';
  g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(0, y(f.cap)); g.lineTo(W, y(f.cap)); g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(244,234,214,.7)';
  g.fillText('CAP', 2, Math.max(9, y(f.cap) - 3));
  g.strokeStyle = res === 'grain' ? '#f2c94c' : '#62b0d6';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, y(f.stock));
  months.forEach((m, i) => g.lineTo((i + 1) * cw, y(m.endStock)));
  g.stroke();
  months.forEach((m, i) => {
    g.fillStyle = BAND_COLOR[bandOf(m.minDoh)];
    g.fillRect(i * cw + 1, H - PAD_B - 3, cw - 3, 3);
  });
  return c;
}

/** The two vital tablets; `update()` refreshes them from today's forecast. */
export class Vitals {
  readonly el: HTMLElement;
  private readonly grain: Tablet;
  private readonly water: Tablet;

  /** `quiet`: true for a tablet whose hover card holds its tongue (the Breviarium is open beneath it and shows it). */
  constructor(private readonly g: Game, quiet: (el: HTMLElement) => boolean = () => false) {
    this.grain = tablet(g, 'grain', quiet);
    this.water = tablet(g, 'water', quiet);
    this.el = h('div', { class: 'hud-vitals' }, this.grain.el, this.water.el);
  }

  /** Refreshes numbers, trend, pulse and month cells. */
  update(): void {
    const f = forecast(this.g.state);
    paint(this.g, this.grain, 'grain', f.grain);
    paint(this.g, this.water, 'water', f.water);
  }
}

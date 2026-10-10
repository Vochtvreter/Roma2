// src/ui/vitals.ts — the Grain and Water tablets with the 12-month forecast strip (DESIGN §11.11). Owner: WP-H.
// SCAFFOLD: days on hand, trend and month cells from forecast(); hover lines, pulses and sprites are WP-H's.
import type { Essential, EssentialForecast, MonthCell } from '../game/types';
import type { Game } from './types';
import { h, fmtDays, fmtRate, tip, realTime } from './dom';
import { forecast } from '../game/forecast';
import { MONTH_ABBR, SEASON_NAMES, formatRoman } from '../game/calendar';

const LABEL: Record<Essential, string> = { grain: 'GRAIN', water: 'AQVA' };
const CELL_BANDS: [number, string][] = [[30, 'var(--good)'], [15, 'var(--gold)'], [7, 'var(--sev-2)'], [0.0001, 'var(--bad)']];
const EMPTY = '#0a0710';

function cellColor(c: MonthCell): string {
  for (const [min, col] of CELL_BANDS) if (c.minDoh >= min) return col;
  return EMPTY;
}

interface Tablet { el: HTMLElement; days: HTMLElement; trend: HTMLElement; sub: HTMLElement; cells: HTMLElement[] }

function tablet(g: Game, res: Essential): Tablet {
  const days = h('span', { class: 'vit-days num' }, '—');
  const trend = h('span', { class: 'vit-trend num' }, '');
  const sub = h('div', { class: 'vit-sub' });
  const cells = Array.from({ length: 12 }, () => h('i', { class: 'vit-cell' }));
  const el = h('div', { class: `hud-vital vit-${res}` },
    h('div', { class: 'vit-top' }, h('span', { class: 'kicker vit-label' }, LABEL[res]), days, trend),
    h('div', { class: 'vit-strip' }, cells), sub);
  tip(el, () => {
    const f = forecast(g.state)[res];
    return `${LABEL[res]} · ${Math.floor(f.stock)} of ${Math.floor(f.cap)} · need ${f.need.toFixed(1)}/day · ${fmtDays(f.doh)} on hand (${realTime(Math.min(f.doh, 9999), g.speed)})`
      + (f.runout !== null ? ` · empty ${formatRoman(f.runout)}` : '');
  });
  return { el, days, trend, sub, cells };
}

function paint(t: Tablet, f: EssentialForecast): void {
  t.days.textContent = fmtDays(f.doh);
  const arrow = f.net > 0.05 ? '▲' : f.net < -0.05 ? '▼' : '■';
  t.trend.textContent = `${arrow} ${fmtRate(f.net)}`;
  t.trend.classList.toggle('bad', f.net < -0.05);
  t.trend.classList.toggle('good', f.net > 0.05);
  t.sub.textContent = f.net < 0 && f.runout !== null ? `empty ${formatRoman(f.runout)}` : '';
  t.el.classList.toggle('low', f.doh < 7);
  f.months.slice(0, 12).forEach((c, i) => {
    const cell = t.cells[i];
    if (!cell) return;
    cell.style.background = cellColor(c);
    cell.dataset.m = `${MONTH_ABBR[c.month - 1]} ${SEASON_NAMES[c.season][0]}`;
  });
}

/** The two vital tablets; `update()` refreshes them from today's forecast. */
export class Vitals {
  readonly el: HTMLElement;
  private readonly grain: Tablet;
  private readonly water: Tablet;

  constructor(private readonly g: Game) {
    this.grain = tablet(g, 'grain');
    this.water = tablet(g, 'water');
    this.el = h('div', { class: 'hud-vitals' }, this.grain.el, this.water.el);
  }

  /** Refreshes numbers and month cells. */
  update(): void {
    const f = forecast(this.g.state);
    paint(this.grain, f.grain);
    paint(this.water, f.water);
  }
}

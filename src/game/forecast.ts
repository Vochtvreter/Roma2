// src/game/forecast.ts — the essentials forecast and the 12-month prospectus (ARCHITECTURE §8.3, DESIGN §11.11). Owner: WP-B.
// SCAFFOLD: a straight line from today's net (current staffing, current season) month by month, clamped to [0, cap].
import type { CrunchForecast, Essential, EssentialForecast, Forecast, GameState, MonthCell, SeasonIndex } from './types';
import { censusEpoch, memo, structEpoch } from './memo';
import { census } from './census';
import { buildingRate, maxPotential } from './economy';
import { B } from './balance';
import { dateOf, dayOf, daysInMonth, nextSeasonStart, seasonLength, seasonOf } from './calendar';

/** Days on hand reported when nobody needs the essential (finite, so it can sit in metrics). */
const DOH_NONE = 9999;   // STUB(WP-B): sentinel; move to B.forecast if kept
const CELLS = B.forecast.CELLS;

/** Today's forecast for grain, water and coin (memo on day + epochs; pure). */
export function forecast(s: GameState): Forecast {
  return memo(s, 'forecast', `${s.day}|${structEpoch(s)}|${censusEpoch(s)}`, () => {
    const stock = s.res.denarii + s.taxAccrued;
    const net30 = s.counters.coinEma;   // STUB(WP-B): 30-day average net denarii per day (accrual basis)
    return {
      day: s.day,
      grain: projectEssential(s, 'grain'),
      water: projectEssential(s, 'water'),
      coin: { stock, net30, runout: net30 < 0 ? s.day + Math.floor(stock / -net30) : null },
    };
  });
}

/** Projection of one essential: today's flows, days on hand, run-out day, 12 month cells and the crunch season. */
export function projectEssential(s: GameState, res: Essential): EssentialForecast {
  const c = census(s);
  const season = seasonOf(s.day);
  const stock = s.res[res];
  const cap = c.caps[res];
  const need = c.need[res];
  let prod = 0, draw = 0;
  for (const b of s.buildings) {
    const v = buildingRate(s, b, season, 'current')[res] ?? 0;
    if (v > 0) prod += v;
    else draw -= v;
  }
  if (res === 'grain') prod += c.idle.length * B.economy.IDLE_FORAGE;
  const cons = need + draw;
  const net = prod - cons;
  const doh = (x: number): number => (need > 0 ? x / need : DOH_NONE);
  const runout = net < 0 ? s.day + Math.floor(stock / -net) : null;

  // STUB(WP-B): month-by-month seasons, Ordo labour (maxPotential / need × 1.35), rot and evaporation.
  const months: MonthCell[] = [];
  const d0 = dateOf(s.day);
  let y = d0.year, m = d0.month, st = stock;
  let lowestDoh = doh(stock), lowestDay = s.day;
  for (let k = 0; k < CELLS; k++) {
    const first = dayOf(y, m, 1);
    const start = k === 0 ? s.day : first;
    const end = first + daysInMonth(y, m);
    const endStock = Math.min(cap, Math.max(0, st + net * (end - start)));
    const minStock = Math.min(st, endStock);
    const cell: MonthCell = { month: m, year: y, season: seasonOf(start), minDoh: doh(minStock), endStock };
    months.push(cell);
    if (cell.minDoh < lowestDoh) { lowestDoh = cell.minDoh; lowestDay = minStock === st ? start : end - 1; }
    st = endStock;
    m++;
    if (m > 12) { m = 1; y++; }
  }

  const crunchSeason: SeasonIndex = res === 'grain' ? 3 : 1;
  const crunchStart = season === crunchSeason ? s.day : nextSeasonStart(s.day, crunchSeason);
  const inCrunch = months.filter((cell) => cell.season === crunchSeason);
  let crunch: CrunchForecast | null = null;
  if (inCrunch.length > 0) {
    const low = inCrunch.reduce((a, b) => (b.minDoh < a.minDoh ? b : a));
    crunch = {
      season: crunchSeason, startsIn: crunchStart - s.day, lowestDoh: low.minDoh, lowestDay: dayOf(low.year, low.month, 1),
      emptyDay: runout, needInStore: need * seasonLength(crunchStart),
    };
  }

  const pot = maxPotential(s, res, season);
  return {
    stock, cap, need, prod, cons, net, net3: net, doh: doh(stock), runout, room: Math.max(0, cap - stock),
    maxPotential: pot, structural: pot < need, months, lowestDoh, lowestDay, crunch,
  };
}

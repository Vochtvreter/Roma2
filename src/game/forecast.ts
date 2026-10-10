// src/game/forecast.ts — the essentials forecast and the 12-month prospectus (ARCHITECTURE §8.3, DESIGN §11.11). Owner: WP-B.
// A pure day-by-day projection from today's stock to the end of the 12th month cell, using the economy module:
// production per season (Ordo labour on: min(maxPotential, need × 1.35 grain / × 1.10 water), the crunch season at
// maxPotential; Ordo labour off: today's staffing), consumption = today's need + industry draws, caps, rot, evaporation.
import { B } from './balance';
import type { CrunchForecast, Essential, EssentialForecast, Forecast, GameState, MonthCell, SeasonIndex } from './types';
import { dayEpoch, dayStruct, memo } from './memo';
import { census } from './census';
import { buildingRateOf, maxPotential } from './economy';
import { BUILDING_DEFS } from './data/buildings';
import { dateOf, dayOf, daysInMonth, nextSeasonStart, seasonOf, seasonStartOf } from './calendar';

const DOH_NONE = B.forecast.DOH_NONE;   // days on hand when nobody needs the essential (finite for metrics)
const CELLS = B.forecast.CELLS;
const E = B.economy;
const CRUNCH: Record<Essential, SeasonIndex> = { grain: 3, water: 1 };
const ORDO_FILL: Record<Essential, number> = { grain: B.forecast.GRAIN, water: B.forecast.WATER };
const SEASONS: readonly SeasonIndex[] = [0, 1, 2, 3];
const NET_DAYS = 3;      // net3 averages today's staffing over this many days

/** Today's forecast for grain, water and coin (memo on day + structure + Ordo labour toggle; pure). Under manual labour
 *  the projection is today's staffing, so the census epoch joins the key: the Ordo reads the forecast before
 *  assignJobs, and a forecast cached then would describe yesterday's jobs for the rest of the day. */
export function forecast(s: GameState): Forecast {
  return memo(s, 'forecast', s.ordo.on.labour ? -dayStruct(s) : dayEpoch(s), () => {
    const stock = s.res.denarii + s.taxAccrued;
    const net30 = s.counters.coinEma;   // 30-day EMA of net denarii per day (accrual basis)
    return {
      day: s.day,
      grain: projectEssential(s, 'grain'),
      water: projectEssential(s, 'water'),
      coin: { stock, net30, runout: net30 < 0 ? s.day + Math.floor(stock / -net30) : null },
    };
  });
}

/** Production and industry draw of an essential per day in a season at today's staffing (grain incl. idle forage). */
function currentFlows(s: GameState, res: Essential, season: SeasonIndex): { prod: number; draw: number } {
  let prod = 0, draw = 0;
  for (const b of s.buildings) {
    const def = BUILDING_DEFS[b.type];
    if (b.status !== 'done' || (def.output?.res !== res && def.passive?.res !== res && !def.inputs?.[res] && !(res === 'water' && def.waterDraw))) continue;
    const v = buildingRateOf(s, b, season, 'current', res);
    if (v > 0) prod += v;
    else draw -= v;
  }
  if (res === 'grain') prod += census(s).idle.length * E.IDLE_FORAGE;
  return { prod, draw };
}

/** Projection of one essential: today's flows, days on hand, run-out day, 12 month cells and the crunch season. */
export function projectEssential(s: GameState, res: Essential): EssentialForecast {
  const c = census(s);
  const season = seasonOf(s.day);
  const stock = s.res[res];
  const cap = c.caps[res];
  const need = c.need[res];
  const horrea = c.horreaCap;
  const today = currentFlows(s, res, season);
  const cons = need + today.draw;
  const net = today.prod - cons;
  const doh = (x: number): number => (need > 0 ? x / need : DOH_NONE);
  const ordo = s.ordo.on.labour;

  // production per season under the projection rule
  const prodBy: number[] = SEASONS.map((q) => {
    if (!ordo) return currentFlows(s, res, q).prod;
    const pot = maxPotential(s, res, q);
    return q === CRUNCH[res] ? pot : Math.min(pot, need * ORDO_FILL[res]);
  });

  const d0 = dateOf(s.day);
  const crunchSeason = CRUNCH[res];
  const crunchStart = season === crunchSeason ? seasonStartOf(s.day) : nextSeasonStart(s.day, crunchSeason);
  const crunchEnd = nextSeasonStart(crunchStart);
  let crunchLow = Infinity, crunchLowDay = Math.max(s.day, crunchStart), crunchEmpty: number | null = null, deficit = 0;

  const months: MonthCell[] = [];
  let y = d0.year, m = d0.month, st = stock;
  let lowestDoh = doh(stock), lowestDay = s.day;
  let day = s.day;
  for (let k = 0; k < CELLS; k++) {
    const end = dayOf(y, m, 1) + daysInMonth(y, m);   // first day of the next month
    let minSt = st;
    let minDay = day;
    const q = seasonOf(end - 1);                        // seasons change only on a Kalends
    const p = prodBy[q];
    while (day + 1 < end) {
      day++;
      st = Math.min(cap, Math.max(0, st + p - cons));
      if (res === 'grain') st -= Math.max(0, st - horrea) * E.SHED_ROT * E.ROT_SEASON[q];
      else st -= st * E.EVAPORATION * E.EVAP_SEASON[q];
      if (st < minSt) { minSt = st; minDay = day; }
      if (day >= crunchStart && day < crunchEnd) {
        deficit += cons - p;
        if (doh(st) < crunchLow) { crunchLow = doh(st); crunchLowDay = day; }
        if (crunchEmpty === null && st <= 0) crunchEmpty = day;
      }
    }
    const cell: MonthCell = { month: m, year: y, season: q, minDoh: doh(minSt), endStock: st };
    months.push(cell);
    if (cell.minDoh < lowestDoh) { lowestDoh = cell.minDoh; lowestDay = minDay; }
    m++;
    if (m > 12) { m = 1; y++; }
  }
  if (season === crunchSeason && doh(stock) < crunchLow) { crunchLow = doh(stock); crunchLowDay = s.day; }
  const crunch: CrunchForecast | null = crunchLow === Infinity ? null : {
    season: crunchSeason, startsIn: Math.max(0, crunchStart - s.day), lowestDoh: crunchLow, lowestDay: crunchLowDay,
    emptyDay: crunchEmpty, needInStore: Math.max(0, deficit),
  };

  // the next three days at today's staffing (a season boundary may fall inside them)
  const flows = new Map<SeasonIndex, number>([[season, today.prod]]);
  let avg = 0;
  for (let d = s.day; d < s.day + NET_DAYS; d++) {
    const q = seasonOf(d);
    if (!flows.has(q)) flows.set(q, currentFlows(s, res, q).prod);
    avg += ((flows.get(q) ?? 0) - cons) / NET_DAYS;
  }
  const pot = maxPotential(s, res, season);
  return {
    stock, cap, need, prod: today.prod, cons, net, net3: avg, doh: doh(stock),
    runout: avg < 0 ? s.day + Math.floor(stock / -avg) : null, room: Math.max(0, cap - stock),
    maxPotential: pot, structural: pot < need, months, lowestDoh, lowestDay, crunch,
  };
}

// src/game/ordo/goods.ts — oil and wine for the great houses, planned as the grain is for Hiems (DESIGN §7.6, §10.4 step
// 8, §10.5 row 9, §10.7 rule 2). Owner: WP-C (fix batch G).
// The presses rest through Ver and Aestas (olivetum ×0.2) and run in Autumnus and Hiems (×1.4, ×2.2): what the insulae
// draw through the lean half of the year must be in the stores when it begins, or come by caravan before they run dry.
// One plan a day per good: the houses' draw (housing.goodsDemand), the presses' yield by season at the Ordo's staffing,
// the lean-season reserve (what the stores should hold when Ver begins), the stock the Ordo keeps from export, and a
// day-by-day projection with the caravans on the road and the standing imports, whose low point is what must be bought.
// Wine has no press: its reserve is LUXURY_RUNWAY days of the draw, and every amphora comes by caravan.
import { B } from '../balance';
import { HUBS } from '../types';
import type { GameState, HubId, SeasonIndex, SimView } from '../types';
import { goodsDemand } from '../housing';
import { buildingRateOf, seasonMult } from '../economy';
import { nextSeasonStart, seasonOf, seasonStartOf } from '../calendar';
import { dayStruct, memo } from '../memo';
import { hubOpen, price, tripDays } from '../trade';

/** A good the great houses draw. */
export type Good = 'oil' | 'wine';

const VER: SeasonIndex = 0, AESTAS: SeasonIndex = 1;
const YEAR = 365;
/** Days the projection runs at least: as far as the Praefectus forecasts a shortage (GOODS_LEAD, held × CLEAR). */
const PROJECT = Math.ceil(B.advisors.RULES.GOODS_LEAD * B.advisors.CLEAR);

/** The day's plan for one good. */
export interface GoodsPlan {
  res: Good;
  /** amphorae a day the houses draw at full supply (T4 houses and the stone houses waiting only on the goods) */
  demand: number;
  /** what the presses yield a day in each season at the Ordo's staffing (manual labour: today's hands); 0 for wine */
  prod: readonly [number, number, number, number];
  /** …and with every post filled (the groves' potential) */
  potential: readonly [number, number, number, number];
  /** what the stores should hold when the lean season (Ver) begins to carry the draw to the next pressing (Autumnus);
   *  for wine, LUXURY_RUNWAY days of the draw */
  reserve: number;
  /** the stock the Ordo keeps from export today: what the days to the next pressing still take (in Autumnus and Hiems
   *  the whole lean-season reserve, which the stores fill toward), plus a floor of GOODS_FLOOR days */
  keep: number;
  /** a floor of GOODS_FLOOR days of the draw: below it the houses are one bad caravan from going without */
  floor: number;
  /** the projection's horizon in days (the import lead, LUXURY_RUNWAY, plus the cheapest round trip) */
  horizon: number;
  /** lowest projected stock within the horizon (may be negative: a shortfall) and its day */
  low: number;
  lowDay: number;
  /** first projected day the stores stand empty within the projection (the horizon, at least GOODS_LEAD × CLEAR days), or null */
  emptyDay: number | null;
  /** what must still be bought to keep the floor within the horizon (the caravans under way and standing counted) */
  short: number;
  /** the hub that sells the good cheapest, its unit price and its round trip with a full caravan; null if none sells */
  hub: { id: HubId; unit: number; roundTrip: number } | null;
}

/** The open hub that sells `res` cheapest, with its round trip for a full caravan (ties by hub order). */
function cheapest(s: GameState, res: Good): GoodsPlan['hub'] {
  let best: GoodsPlan['hub'] = null;
  for (const h of HUBS) {
    const p = hubOpen(s, h) ? price(s, h, res, 'buy') : null;
    if (p !== null && (!best || p < best.unit)) best = { id: h, unit: p, roundTrip: 2 * tripDays(s, h, B.ordo.CARGO) };
  }
  return best;
}

/** What the groves press a day in each season: every post filled, and as the Ordo staffs them (labour step 8: toward
 *  the draw × LUXURY at the season's yield, the potential at most) or, under manual labour, today's hands. */
function presses(s: GameState, demand: number): { prod: [number, number, number, number]; potential: [number, number, number, number] } {
  const potential: [number, number, number, number] = [0, 0, 0, 0];
  const current: [number, number, number, number] = [0, 0, 0, 0];
  for (const b of s.buildings) {
    if (b.type !== 'olivetum' || b.status !== 'done') continue;
    for (let q = 0; q < 4; q++) {
      potential[q] += buildingRateOf(s, b, q as SeasonIndex, 'full', 'oil');
      current[q] += buildingRateOf(s, b, q as SeasonIndex, 'current', 'oil');
    }
  }
  if (!s.ordo.on.labour) return { prod: current, potential };
  const prod = potential.map((p, q) => Math.min(p, demand * B.ordo.LUXURY * seasonMult(s, 'olivetum', q as SeasonIndex))) as [number, number, number, number];
  return { prod, potential };
}

/** The day's plan for oil or wine, made once a day for the structure and the trade of that hour (a contract made or a
 *  caravan sent moves the projection; a family moving in does not, until tomorrow). `own: false` leaves out the next
 *  trips of the Ordo's own standing imports of the good (the caravans already on the road stay): what the Ordo weighs
 *  when it decides how many to keep. */
export function goodsPlan(s: GameState, v: SimView, res: Good, own = true): GoodsPlan {
  return memo(s, `ordo.goods.${res}.${own ? 1 : 0}`, `${dayStruct(s)}|${tradeKey(s)}`, () => makePlan(s, v, res, own));
}

/** The trade as the projection reads it: the contracts (id, status) and the caravans on the road. */
function tradeKey(s: GameState): string {
  let k = '';
  for (const c of s.trade.contracts) k += `${c.id}${c.status[0]},`;
  return `${k}|${s.trade.caravans.length}|${s.trade.caravans[s.trade.caravans.length - 1]?.id ?? 0}`;
}

/** The Ordo's own standing import of an oil or wine (the contracts it keeps for the great houses). */
export function ordoLuxuryImport(c: GameState['trade']['contracts'][number], res: Good): boolean {
  return c.owner === 'ordo' && c.mode === 'import' && c.res === res && c.repeat;
}

function makePlan(s: GameState, v: SimView, res: Good, own: boolean): GoodsPlan {
  const g = goodsDemand(s);
  const demand = res === 'oil' ? g.oil : g.wine;
  const { prod, potential } = res === 'oil' ? presses(s, demand) : { prod: [0, 0, 0, 0] as [number, number, number, number], potential: [0, 0, 0, 0] as [number, number, number, number] };
  const floor = demand * B.ordo.GOODS_FLOOR * (s.decisions.focus === 'urbs' ? 2 : 1);   // Urbs keeps twice the floor
  const hub = cheapest(s, res);
  const horizon = B.ordo.LUXURY_RUNWAY + (hub?.roundTrip ?? 0);
  const net = (q: SeasonIndex): number => prod[q] - demand;

  // the lean-season reserve: the draw the presses do not cover from Kal. Mart. to Kal. Sept. (the season under way, or
  // the next); inside it, what the days left to Kal. Sept. still take
  const season = seasonOf(s.day);
  const lean = season === VER || season === AESTAS;
  const ver = season === VER ? seasonStartOf(s.day) : season === AESTAS ? seasonStartOf(seasonStartOf(s.day) - 1) : nextSeasonStart(s.day, VER);
  const aestas = nextSeasonStart(ver), press = nextSeasonStart(aestas);
  let reserve: number, toPress: number;
  if (res === 'oil') {
    const dv = Math.max(0, -net(VER)), da = Math.max(0, -net(AESTAS));
    reserve = dv * (aestas - ver) + da * (press - aestas);
    toPress = !lean ? reserve : season === VER ? dv * (aestas - s.day - 1) + da * (press - aestas) : da * (press - s.day - 1);
  } else {
    reserve = toPress = demand * B.ordo.LUXURY_RUNWAY;
  }
  const keep = toPress + floor;

  // the projection: stock + the presses − the draw, the caravans on the road and the standing imports' next trips
  const arrive = new Map<number, number>();
  const add = (day: number, qty: number): void => { if (day > s.day && day <= s.day + YEAR) arrive.set(day, (arrive.get(day) ?? 0) + qty); };   // a year at most
  for (const c of s.trade.caravans) if (c.mode === 'import' && c.res === res) add(c.arrive, c.qty);
  for (const c of s.trade.contracts) {
    if (c.mode !== 'import' || c.res !== res || c.status === 'paused') continue;
    if (!own && ordoLuxuryImport(c, res)) continue;
    const car = s.trade.caravans.find((x) => x.contract === c.id);
    if (car && !c.repeat) continue;                       // a single trip on the road: counted with the caravans
    const rt = 2 * tripDays(s, c.hub, c.qty);
    let next = car ? car.arrive + rt : s.day + 1 + rt;    // an idle contract sets out tomorrow at the earliest
    if (!c.repeat) { add(next, c.qty); continue; }
    for (; next <= s.day + YEAR; next += rt) add(next, c.qty);
  }
  const cap = v.c.caps[res];
  let st = s.res[res], low = st, lowDay = s.day, emptyDay: number | null = null;
  let q = season, nextQ = nextSeasonStart(s.day);
  const days = demand > 0 ? Math.max(horizon, PROJECT) : 0;   // nobody draws: nothing to project
  for (let d = s.day + 1; d <= s.day + days; d++) {
    if (d >= nextQ) { q = seasonOf(d); nextQ = nextSeasonStart(d); }
    st = Math.min(cap, st + net(q) + (arrive.get(d) ?? 0));
    if (d <= s.day + horizon && st < low) { low = st; lowDay = d; }
    if (emptyDay === null && st <= 0) emptyDay = d;
  }
  const short = demand > 0 ? Math.max(0, floor - low) : 0;
  return { res, demand, prod, potential, reserve, keep, floor, horizon, low, lowDay, emptyDay, short, hub };
}

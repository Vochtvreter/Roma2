// src/game/ordo/index.ts — the council's daily session and its last report (ARCHITECTURE §8.4, DESIGN §10). Owner: WP-C.
// Order: emergency (daily) → labour (daily) → the player's pin and requests (daily) → build (even days) → trade
// (day % 10 == 5). An area runs when its toggle is on, or offline with Govern while away; the Ordo builds only the duties
// handed to it (ordo/duties.ts; every duty offline with Govern while away); the player's own orders (pin, requests) are
// carried out either way. The report is kept in a WeakMap (never saved, never read by the sim).
import { B as B$ } from '../balance';
import type { CouncilReport, GameState, LaborCat, LabourPlan, OrdoArea, Reason, SimView, TickContext } from '../types';
import type { Rng } from '../rng';
import { switchOn } from '../decisions';
import { emergencyDay, emergencyHands } from './emergency';
import { governAway } from './duties';
import { manualPlan, planLabour } from './labour';
import { newWishes, ordoBuild, processRequests, wishList, wouldRaise } from './build';
import { ordoTrade, ordoTradeWould } from './trade';
import { savingFor, savingReason } from './saving';
import { beginDay, decisionsToday } from './chronicle';
import { layoutEpoch } from '../memo';
import { getBuilding } from '../lookup';
import { view } from '../sim';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$;

/** The day's report, what it was made from, and the report as shown: made again on read when the focus changed since
 *  the council sat, and without the sites finished since (a completion later in the tick: the ticker never says
 *  "Raising" of a work the Annales call finished, nor the Agenda "building 100%"). The rest of the Agenda stands until
 *  the next sitting, as the council left it. */
interface Kept { rep: CouncilReport; shown: CouncilReport; layout: number; focus: string; plan: LabourPlan; on: Record<OrdoArea, boolean> }
const reports = new WeakMap<GameState, Kept>();
const AGENDA = 3;            // wishes shown in the Agenda (DESIGN §10.6)
const TICKER_MAX = 5;        // ticker lines per day

/** True when the Ordo runs an area: its toggle is on, or (offline and Govern while away) it runs the manual areas too. */
export function ordoActive(s: GameState, area: OrdoArea, offline: boolean): boolean {
  return s.ordo.on[area] || (offline && switchOn(s, 'governAway'));
}

/** The council's daily session (emergency → labour → requests → build → trade); returns today's labour plan. */
export function runOrdo(s: GameState, ctx: TickContext, rng: Rng, v: SimView): LabourPlan {
  void rng;   // the council draws no lots: every choice it makes can be explained
  beginDay(s);
  emergencyDay(s, ctx, v);       // checks the Lex de annona switch itself
  const on = { labour: ordoActive(s, 'labour', ctx.offline), build: ordoActive(s, 'build', ctx.offline), trade: ordoActive(s, 'trade', ctx.offline) };
  // away with Govern while away on, the Ordo holds every duty today; at home only those handed to it (duties.ts)
  governAway(s, ctx.offline && switchOn(s, 'governAway'));
  const plan = on.labour ? planLabour(s, v) : manualPlan(s, v, emergencyHands(s, v) ?? undefined);
  processRequests(s, ctx, v);
  // the Ordo builds the duties it holds; holding none, it still raises a famine's field or a drought's well under the Lex de annona
  if ((on.build || switchOn(s, 'emergency')) && s.day % B.ordo.BUILD_EVERY === 0) ordoBuild(s, ctx, v);
  if (on.trade && s.day % B.ordo.TRADE_EVERY === B.ordo.TRADE_OFFSET) ordoTrade(s, ctx, v);
  const rep = report(s, v, plan, on);
  reports.set(s, { rep, shown: rep, layout: layoutEpoch(s), focus: s.decisions.focus, plan, on });
  return plan;
}

function report(s: GameState, v: SimView, plan: LabourPlan, on: Record<OrdoArea, boolean>): CouncilReport {
  const agenda = wishList(s, v, AGENDA);
  const would: CouncilReport['would'] = { labour: {}, build: wouldRaise(s, v), trade: on.trade ? null : ordoTradeWould(s, v) };
  if (!on.labour) for (const l of planLabour(s, v).lines) would.labour[l.cat] = l.target;
  const trade = s.trade.contracts.filter((c) => c.owner === 'ordo' && c.reason).map((c) => ({ contract: c.id, reason: c.reason as Reason }));
  return { day: s.day, labour: plan.lines, agenda, saving: savingFor(s, v), trade, would, ticker: ticker(s, v, plan, agenda, on.build) };
}

/** Ticker lines: today's decisions, the work in hand, the next wish, what is being saved, then the vital staffing lines. */
function ticker(s: GameState, v: SimView, plan: LabourPlan, agenda: CouncilReport['agenda'], build: boolean): Reason[] {
  const out: Reason[] = [...decisionsToday(s)];
  const tag = (r: Reason, state: string): Reason => ({ code: r.code, params: { ...r.params, state } });
  const site = agenda.find((w) => w.siteId !== undefined);
  const told = (r: Reason): boolean => out.some((x) => x.code === r.code && x.params.type === r.params.type);
  if (site && !told(site.reason)) out.push(tag(site.reason, site.state === 'staked' ? 'staked' : 'raising'));
  const next = agenda.find((w) => w.siteId === undefined) ?? newWishes(s, v, 1)[0];
  if (next && next.state !== 'saving') out.push(tag(next.reason, build ? 'next' : 'would'));
  const saving = savingReason(s, v);
  if (saving) out.push(saving);
  for (const cat of ['food', 'water'] as LaborCat[]) {
    const l = plan.lines.find((x) => x.cat === cat);
    if (l) out.push(l.reason);
  }
  return out.slice(0, TICKER_MAX);
}

/** The last council report of this state (never saved); an empty report before the first tick. Read only by the UI:
 *  the day's labour plan stands; the rest is made again after a change of focus, and a site finished since the
 *  sitting leaves the Agenda and the ticker. */
export function councilReport(s: GameState): CouncilReport {
  const k = reports.get(s);
  if (!k) {
    return {
      day: s.day, labour: [], agenda: [], saving: null, trade: [],
      would: { labour: {}, build: null, trade: null }, ticker: [],
    };
  }
  if (k.rep.day !== s.day) return k.shown;
  if (k.focus !== s.decisions.focus) {
    k.rep = k.shown = report(s, view(s), k.plan, k.on);
    k.focus = s.decisions.focus;
    k.layout = layoutEpoch(s);
  } else if (k.layout !== layoutEpoch(s)) {
    k.shown = withoutFinished(s, k.rep);
    k.layout = layoutEpoch(s);
  }
  return k.shown;
}

/** The report without the Agenda's sites that are finished (or gone) now, and the ticker lines that raise them. */
function withoutFinished(s: GameState, rep: CouncilReport): CouncilReport {
  const done = rep.agenda.filter((w) => w.siteId !== undefined && (getBuilding(s, w.siteId)?.status ?? 'done') === 'done');
  if (done.length === 0) return rep;
  const raises = (r: Reason): boolean => (r.params.state === 'raising' || r.params.state === 'staked')
    && done.some((w) => w.type === r.params.type && w.reason.code === r.code);
  return { ...rep, agenda: rep.agenda.filter((w) => !done.includes(w)), ticker: rep.ticker.filter((r) => !raises(r)) };
}

// src/game/ordo/index.ts — the council's daily session and its last report (ARCHITECTURE §8.4, DESIGN §10). Owner: WP-C.
// SCAFFOLD: emergency → labour → requests → build (even days) → trade (day % 10 == 5) in the documented order;
// only the labour step does anything yet (water, then food, then builders).
import { B } from '../balance';
import type { CouncilReport, GameState, LabourPlan, OrdoArea, SimView, TickContext } from '../types';
import type { Rng } from '../rng';
import { emergencyDay } from './emergency';
import { manualPlan, planLabour } from './labour';
import { ordoBuild, processRequests, wishList } from './build';
import { ordoTrade, ordoTradeWould } from './trade';
import { savingFor } from './saving';

const reports = new WeakMap<GameState, CouncilReport>();
/** Wishes shown in the Agenda (DESIGN §15.3). */
const AGENDA = 3;

/** True when the Ordo runs an area: its toggle is on, or (offline and Govern while away) it runs the manual areas too. */
export function ordoActive(s: GameState, area: OrdoArea, offline: boolean): boolean {
  return s.ordo.on[area] || (offline && s.decisions.switches.governAway);
}

/** The council's daily session (emergency → labour → requests → build → trade); returns today's labour plan. */
export function runOrdo(s: GameState, ctx: TickContext, rng: Rng, v: SimView): LabourPlan {
  void rng;   // STUB(WP-C): no Ordo step draws randomness yet
  emergencyDay(s, ctx, v);       // checks the Lex de annona switch itself
  const plan = ordoActive(s, 'labour', ctx.offline) ? planLabour(s, v) : manualPlan(s, v);
  const build = ordoActive(s, 'build', ctx.offline);
  if (build) {
    processRequests(s, ctx, v);
    if (s.day % B.ordo.BUILD_EVERY === 0) ordoBuild(s, ctx, v);
  }
  const trade = ordoActive(s, 'trade', ctx.offline);
  if (trade && s.day % B.ordo.TRADE_EVERY === B.ordo.TRADE_OFFSET) ordoTrade(s, ctx, v);
  const agenda = wishList(s, v, AGENDA);
  reports.set(s, {
    day: s.day, labour: plan.lines, agenda, saving: savingFor(s, v), trade: [],
    would: {
      labour: ordoActive(s, 'labour', ctx.offline) ? {} : Object.fromEntries(planLabour(s, v).lines.map((l) => [l.cat, l.target])),
      build: build ? null : agenda[0] ?? null,
      trade: trade ? null : ordoTradeWould(s, v),
    },
    ticker: plan.lines.map((l) => l.reason),
  });
  return plan;
}

/** The last council report of this state (never saved); an empty report before the first tick. */
export function councilReport(s: GameState): CouncilReport {
  return reports.get(s) ?? {
    day: s.day, labour: [], agenda: [], saving: null, trade: [],
    would: { labour: {}, build: null, trade: null }, ticker: [],
  };
}

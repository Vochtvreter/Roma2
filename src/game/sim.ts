// src/game/sim.ts — the daily tick in its exact order (ARCHITECTURE §9), the live SimView and rate ledgers.
// The scaffold writes the order against the stubs; WP-B owns this file afterwards and may only add private
// housekeeping details. Reordering any step needs the integrator.
import { B as B$ } from './balance';
import { RESOURCES as RESOURCES$ } from './types';
import type { GameState, RateSource, Rates, ResId, SimView, TickContext } from './types';
import { Rng } from './rng';
import { isKalends as isKalends$, seasonOf as seasonOf$, seasonStartOf as seasonStartOf$ } from './calendar';
import { derived as derived$ } from './derived';
import { census } from './census';
import { forecast } from './forecast';
import { coverage } from './coverage';
import { runOrdo } from './ordo/index';
import { assignJobs, immigrationDay, peopleDay } from './people';
import { constructionDay, payPlans, startStaked } from './construction';
import { consume, issueTools, produce, storage } from './economy';
import { goodsDay, housingDay } from './housing';
import { kalendsDay, moraleDay, taxesDay, upkeepDay } from './civic';
import { tradeDay } from './trade';
import { eventsDay } from './events';
import { checkObjectives, updateCounters } from './objectives';
import { advisorsDay } from './advisors/engine';
import { pruneGuide } from './guide';
import { introDay } from './intro';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, RESOURCES = RESOURCES$, isKalends = isKalends$, seasonOf = seasonOf$, seasonStartOf = seasonStartOf$,
  derived = derived$;

/** Advances the colony by one day (ARCHITECTURE §9; the order is part of the contract). */
export function tick(s: GameState, ctx: TickContext): void {
  const rng = new Rng(s.rng);
  const coin0 = s.res.denarii + s.taxAccrued;
  // 1 · calendar and housekeeping
  s.day += 1;
  housekeeping(s, ctx);          // drop modifiers with until ≤ day; drop Ordo requests older than REQUEST_DAYS and
                                 // priorities with until ≤ day; if the day is Kal. Mart./Iun./Sept./Dec. push fx {season}
  const v = view(s);             // live view: every getter re-reads its memo, so it is never stale after invalidate()
  // 2 · the council decides (emergency → labour → requests → build (even days) → trade (day % 10 == 5))
  const plan = runOrdo(s, ctx, rng, v);
  assignJobs(s, plan);
  // 3 · sites
  startStaked(s);                // staked ≥ STAKE_DAYS → building
  payPlans(s, ctx);              // player plans become sites when affordable
  // 4 · economy
  produce(s, ctx, rng);          // water → food → passive → processing → idle forage; skill XP; forest draw
  issueTools(s, ctx);
  consume(s, ctx);               // rationing (children first), hunger/thirst, fed EMA
  storage(s, ctx);               // spill over caps, shed rot (×2 Aestas), evaporation, forest regrowth
  goodsDay(s, ctx);              // oil and wine to T4 houses
  // 5 · works and homes
  constructionDay(s, ctx);       // builders along worksQueue(); Capitolium crew cap and materials; completions;
                                 // Capitolium completion sets s.victory, stats.victoryDay, fx victory
  housingDay(s, ctx);            // houses with (id + day) % CHECK_EVERY == 0 (DESIGN §7.2): needs, evolution, renovation, decline
  // 6 · people
  peopleDay(s, ctx, rng);        // aging logs, deaths, widowing, marriages, births, homeless, emigration
  immigrationDay(s, ctx, rng);   // Rome's roll, one Bernoulli roll
  // 7 · civic
  moraleDay(s, v);
  taxesDay(s, ctx);              // accrue; subsidy paid daily
  upkeepDay(s, ctx);             // pay or mark unpaid
  if (isKalends(s.day)) kalendsDay(s, ctx);
  // 8 · the world outside
  tradeDay(s, ctx, rng, v);      // market drift, caravan returns (banditCheck), dispatch, merchant
  eventsDay(s, ctx, rng, v);     // festivals, gate party expiry, choice expiry → default, random roll
  // 9 · bookkeeping and counsel
  updateCounters(s, v);
  checkObjectives(s, ctx);
  advisorsDay(s, ctx, v);        // appoints advisors, evaluates the 22 rules with hysteresis
  pruneGuide(s);
  introDay(s);                   // the Ordo builds once the colony is old enough, even before its lesson (§11.13)
  s.stats.peakPop = Math.max(s.stats.peakPop, s.people.length);
  s.counters.coinEma += B.economy.COIN_ALPHA * ((s.res.denarii + s.taxAccrued - coin0) - s.counters.coinEma);
  s.rng = rng.state;
}

/** Step 1 housekeeping: expire modifiers, stale Ordo requests and labour priorities; announce a new season. */
function housekeeping(s: GameState, ctx: TickContext): void {
  if (s.modifiers.some((m) => m.until <= s.day)) s.modifiers = s.modifiers.filter((m) => m.until > s.day);
  const o = s.ordo;
  if (o.requests.some((r) => s.day - r.day > B.ordo.REQUEST_DAYS)) {
    o.requests = o.requests.filter((r) => s.day - r.day <= B.ordo.REQUEST_DAYS);
  }
  if (o.priorities.some((p) => p.until <= s.day)) o.priorities = o.priorities.filter((p) => p.until > s.day);
  if (seasonStartOf(s.day) === s.day) ctx.fx.push({ kind: 'season', season: seasonOf(s.day) });
}

/** The live view of a state: each getter re-reads its memo (derived, census, forecast, coverage); nothing is computed until read. */
export function view(s: GameState): SimView {
  return {
    get d() { return derived(s); },
    get c() { return census(s); },
    get f() { return forecast(s); },
    get cov() { return coverage(s); },
  };
}

/** Rate sources that are one-day lumps, not flows: payments for works and renovations, felling, caravans, the merchant,
 *  festivals, events, the Legate's relief and the debt repaid on the Kalends. A per-day ledger shows them as "today". */
export const ONE_OFF_SOURCES: readonly RateSource[] = ['construction', 'renovation', 'felling', 'trade', 'merchant', 'festival', 'event', 'relief', 'debt'];

/** Net per day of a resource from a ledger's steady flows (one-off lumps left out). */
export function steadyNet(r: Rates, res: ResId): number {
  let n = 0;
  for (const [src, v] of Object.entries(r.prod[res])) if (!ONE_OFF_SOURCES.includes(src as RateSource)) n += v ?? 0;
  for (const [src, v] of Object.entries(r.cons[res])) if (!ONE_OFF_SOURCES.includes(src as RateSource)) n -= v ?? 0;
  return n;
}

/** A zeroed ledger: one empty source map per resource, for production and consumption. */
export function emptyRates(): Rates {
  const prod = {} as Rates['prod'];
  const cons = {} as Rates['cons'];
  for (const r of RESOURCES) {
    prod[r] = {};
    cons[r] = {};
  }
  return { prod, cons };
}

/** A fresh tick context (empty fx list, empty rates). */
export function newCtx(offline = false): TickContext {
  return { fx: [], rates: emptyRates(), offline };
}

/** One throwaway tick on a structured clone of `s`, returning its ledger (the HUD after a load). */
export function previewRates(s: GameState): Rates {
  const copy = structuredClone(s);
  const ctx = newCtx();
  tick(copy, ctx);
  return ctx.rates;
}

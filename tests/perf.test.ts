// tests/perf.test.ts — DESIGN §18.5 "performance" and the budgets of ARCHITECTURE §9 and §14.2 WP-A: a tick ≤ 1.5 ms
// median at pop 600, a capped 1,825-day absence ≤ 6 s, getMap ≤ 40 ms per seed (node). PERF_SLACK=2 loosens all three
// on a loaded machine. Needs the integrated sim. The tick test also prints where the time goes, step by step.
import { describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import type { GameState, LabourPlan, TickContext } from '../src/game/types';
import { Rng } from '../src/game/rng';
import { isKalends } from '../src/game/calendar';
import { runOrdo } from '../src/game/ordo/index';
import { assignJobs, immigrationDay, peopleDay } from '../src/game/people';
import { constructionDay, payPlans, startStaked } from '../src/game/construction';
import { consume, issueTools, produce, storage } from '../src/game/economy';
import { goodsDay, housingDay } from '../src/game/housing';
import { kalendsDay, moraleDay, taxesDay, upkeepDay } from '../src/game/civic';
import { tradeDay } from '../src/game/trade';
import { eventsDay } from '../src/game/events';
import { checkObjectives, updateCounters } from '../src/game/objectives';
import { advisorsDay } from '../src/game/advisors/engine';
import { pruneGuide } from '../src/game/guide';
import { getMap } from '../src/game/map';
import { touchPeople } from '../src/game/memo';
import { deserialize, serialize } from '../src/game/save';
import { simulateOffline } from '../src/game/offline';
import { newCtx, tick, view } from '../src/game/sim';
import { median, play } from './autoplayer';
import { INTEGRATED } from './util';

const SLACK = Number(process.env.PERF_SLACK ?? 1);
const TICK_MS = 1.5, OFFLINE_MS = 6000, MAP_MS = 40, POP = 600;
const SAMPLE = 200, INFLATED_SAMPLE = 15;   // an inflated colony is measured before its homeless leave (HOMELESS_LEAVE 20)
const T = { timeout: 1_800_000 };

/** A colony of ≥ 600 souls: the decision bot grown until then; if it never gets there, its peak padded with homeless copies. */
let colony: { s: GameState; inflated: boolean } | null = null;
function grown(): { s: GameState; inflated: boolean } {
  if (colony) return colony;
  const r = play(42, 'decision', { days: 17_500, stop: (s) => s.people.length >= POP });
  const s = r.s;
  const inflated = s.people.length < POP;
  if (inflated) {
    console.warn(`perf: the decision bot peaked at ${s.people.length} souls; padding to ${POP} with homeless copies`);
    const base = s.people.slice();
    for (let k = 0; s.people.length < POP; k++) {
      const p = base[k % base.length];
      s.people.push({ ...structuredClone(p), id: s.nextId++, home: null, work: null, spouse: null, mother: null, father: null });
    }
    touchPeople(s);
  }
  colony = { s, inflated };
  return colony;
}

/** Diagnostic only: the ARCHITECTURE §9 order replicated with a timer per step (memo views first, so their cost is
 *  not charged to their first reader). Never asserted on: sim.ts stays the one tick. Returns ms per step per day. */
function profile(s: GameState, days: number): [string, number][] {
  const ms: Record<string, number> = {};
  const step = (name: string, f: () => void): void => { const t0 = performance.now(); f(); ms[name] = (ms[name] ?? 0) + performance.now() - t0; };
  for (let d = 0; d < days; d++) {
    const ctx: TickContext = newCtx(), rng = new Rng(s.rng), coin0 = s.res.denarii + s.taxAccrued;
    s.day += 1;
    s.modifiers = s.modifiers.filter((m) => m.until > s.day);
    s.ordo.requests = s.ordo.requests.filter((r) => s.day - r.day <= B.ordo.REQUEST_DAYS);
    s.ordo.priorities = s.ordo.priorities.filter((p) => p.until > s.day);
    const v = view(s);
    let plan: LabourPlan | null = null;
    step('derived+census+coverage', () => void [v.d, v.c, v.cov]); step('forecast', () => void v.f);
    step('runOrdo', () => { plan = runOrdo(s, ctx, rng, v); }); step('assignJobs', () => assignJobs(s, plan!));
    step('sites', () => { startStaked(s); payPlans(s, ctx); });
    step('produce', () => produce(s, ctx, rng)); step('tools/consume/storage/goods', () => { issueTools(s, ctx); consume(s, ctx); storage(s, ctx); goodsDay(s, ctx); });
    step('construction', () => constructionDay(s, ctx)); step('housing', () => housingDay(s, ctx));
    step('people', () => { peopleDay(s, ctx, rng); immigrationDay(s, ctx, rng); });
    step('civic', () => { moraleDay(s, v); taxesDay(s, ctx); upkeepDay(s, ctx); if (isKalends(s.day)) kalendsDay(s, ctx); });
    step('trade', () => tradeDay(s, ctx, rng, v)); step('events', () => eventsDay(s, ctx, rng, v));
    step('counters/objectives', () => { updateCounters(s, v); checkObjectives(s, ctx); });
    step('advisors', () => advisorsDay(s, ctx, v)); step('guide', () => pruneGuide(s));
    s.stats.peakPop = Math.max(s.stats.peakPop, s.people.length);
    s.counters.coinEma += B.economy.COIN_ALPHA * ((s.res.denarii + s.taxAccrued - coin0) - s.counters.coinEma);
    s.rng = rng.state;
  }
  return Object.entries(ms).map(([k, v]): [string, number] => [k, v / days]).sort((a, b) => b[1] - a[1]);
}

describe.runIf(INTEGRATED)('performance (DESIGN §18.5)', () => {
  it('getMap ≤ 40 ms per seed', T, () => {
    getMap(999);   // warm up the JIT
    const ms: number[] = [];
    for (let seed = 1000; seed < 1010; seed++) {
      const t0 = performance.now();
      getMap(seed);
      ms.push(performance.now() - t0);
    }
    console.log(`getMap ms: ${ms.map((x) => x.toFixed(1)).join(' ')}`);
    expect(median(ms)).toBeLessThanOrEqual(MAP_MS * SLACK);
    expect(Math.max(...ms), 'a single seed (2× for GC pauses)').toBeLessThanOrEqual(2 * MAP_MS * SLACK);
  });

  it('tick ≤ 1.5 ms median at pop 600', T, () => {
    const { s, inflated } = grown();
    const copy = deserialize(serialize(s))!;
    const ms: number[] = [];
    for (let i = 0; i < (inflated ? INFLATED_SAMPLE : SAMPLE); i++) {
      const t0 = performance.now();
      tick(copy, newCtx());
      ms.push(performance.now() - t0);
    }
    const sorted = [...ms].sort((a, b) => a - b);
    console.log(`tick at pop ${s.people.length}: median ${median(ms).toFixed(3)} ms, p90 ${sorted[Math.floor(sorted.length * 0.9)].toFixed(3)} ms, max ${sorted[sorted.length - 1].toFixed(2)} ms`);
    const steps = profile(deserialize(serialize(s))!, inflated ? INFLATED_SAMPLE : SAMPLE / 2);
    console.log(`per step (ms/day): ${steps.map(([k, v]) => `${k} ${v.toFixed(3)}`).join(' · ')}`);
    expect(median(ms)).toBeLessThanOrEqual(TICK_MS * SLACK);
  });

  it('a capped 1,825-day absence ≤ 6 s', T, () => {
    const s = deserialize(serialize(grown().s))!;
    const t0 = performance.now();
    const rep = simulateOffline(s, (B.time.OFFLINE_MAX_DAYS / B.time.OFFLINE_RATE) * 1000);
    const ms = performance.now() - t0;
    console.log(`offline: ${rep?.days} days in ${ms.toFixed(0)} ms (pop ${rep?.before.pop} → ${rep?.after.pop})`);
    expect(rep?.days).toBeGreaterThan(0);
    expect(ms * (B.time.OFFLINE_MAX_DAYS / Math.max(1, rep?.days ?? 1))).toBeLessThanOrEqual(OFFLINE_MS * SLACK);
  });
});

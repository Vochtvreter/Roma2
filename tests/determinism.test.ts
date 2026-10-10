// tests/determinism.test.ts — ARCHITECTURE §10.9 and DESIGN §18.5 "determinism": one seed, one history; save → load →
// continue equals never saving; offline time is exactly N offline ticks; module caches never leak between states.
import { describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import type { GameState } from '../src/game/types';
import { deserialize, serialize } from '../src/game/save';
import { offlineDays, offlineRun, simulateOffline } from '../src/game/offline';
import { newCtx, tick } from '../src/game/sim';
import { makeBot } from './autoplayer';
import { INTEGRATED, fresh, noNaN, run } from './util';

const T = { timeout: 600_000 };
const reload = (s: GameState): GameState => {
  const back = deserialize(serialize(s));
  expect(back).not.toBeNull();
  return back!;
};
const offline = (s: GameState, days: number): GameState => {
  for (let i = 0; i < days; i++) tick(s, newCtx(true));
  return s;
};
/** The decision bot on a state for `days` days (its memory lives in `bot`, so a reloaded state can continue with it). */
function botRun(s: GameState, bot: ReturnType<typeof makeBot>, days: number): GameState {
  for (let i = 0; i < days; i++) { bot.step(s); tick(s, newCtx()); }
  return s;
}

describe('determinism (ARCHITECTURE §10.9)', () => {
  it('two 2,000-day runs of one seed serialise identically', T, () => {
    const a = run(fresh(7), 2000), b = run(fresh(7), 2000);
    expect(serialize(a)).toBe(serialize(b));
    expect(noNaN(a)).toEqual([]);
  });

  it('save → load → continue equals never saving (reloads on day 1, 500 and 1,000)', T, () => {
    const whole = serialize(run(fresh(11), 2000));
    let s = fresh(11);
    for (const [at, next] of [[0, 1], [1, 500], [500, 1000], [1000, 2000]]) {
      s = run(reload(s), next - at);
    }
    expect(serialize(s)).toBe(whole);
  });

  it('a clone continues identically, and two interleaved colonies never leak into each other', T, () => {
    const a = fresh(1), b = fresh(2);
    for (let i = 0; i < 600; i++) { tick(a, newCtx()); tick(b, newCtx()); }
    expect(serialize(a)).toBe(serialize(run(fresh(1), 600)));
    expect(serialize(b)).toBe(serialize(run(fresh(2), 600)));
    const c = structuredClone(a);
    expect(serialize(run(c, 300))).toBe(serialize(run(a, 300)));
  });

  it('offline time is N offline ticks: 200 s away = exactly 100 days, sliced or whole', T, () => {
    const base = run(fresh(5), 60);
    const expected = serialize(offline(reload(base), 100));
    const whole = reload(base);
    const rep = simulateOffline(whole, 200_000);
    expect(rep?.days).toBe(100);
    expect(rep?.daysPlanned).toBe(100);
    expect(serialize(whole)).toBe(expected);
    const sliced = reload(base);
    const r = offlineRun(sliced, 200_000)!;
    let steps = 0;
    while (!r.step(B.time.SLICE_DAYS - 3)) steps++;
    expect(steps).toBeGreaterThan(5);
    expect(r.progress()).toBe(1);
    expect(serialize(sliced)).toBe(expected);
    expect(noNaN(sliced)).toEqual([]);
  });

  it('absences: < 60 s simulates nothing, 24 h away is capped at 1,825 days', () => {
    expect(offlineRun(fresh(5), B.time.OFFLINE_MIN_MS - 1)).toBeNull();
    expect(offlineRun(fresh(5), B.time.OFFLINE_MIN_MS)?.days).toBe(30);
    expect(offlineDays(200_000)).toBe(100);
    expect(offlineDays(24 * 3600 * 1000)).toBe(B.time.OFFLINE_MAX_DAYS);
    expect(offlineDays(24 * 3600 * 1000)).toBe(1825);
  });

  describe.runIf(INTEGRATED)('with the decision bot acting between ticks', () => {
    it('two bot runs are identical, and a bot run reloaded midway continues identically', T, () => {
      const a = botRun(fresh(42), makeBot('decision', 42), 2000);
      const botB = makeBot('decision', 42);
      const b = botRun(reload(botRun(fresh(42), botB, 1000)), botB, 1000);
      expect(serialize(b)).toBe(serialize(a));
      expect(serialize(botRun(fresh(42), makeBot('decision', 42), 2000))).toBe(serialize(a));
      expect(noNaN(a)).toEqual([]);
    });

    it('a capped absence from a grown colony equals 1,825 offline ticks', T, () => {
      const base = botRun(fresh(3), makeBot('decision', 3), 3000);
      const expected = serialize(offline(reload(base), B.time.OFFLINE_MAX_DAYS));
      const s = reload(base);
      const rep = simulateOffline(s, 24 * 3600 * 1000);
      if (rep && rep.days === B.time.OFFLINE_MAX_DAYS) expect(serialize(s)).toBe(expected);
      else expect(s.victory).toBe(true);   // an absence stops early only on victory
    });
  });
});

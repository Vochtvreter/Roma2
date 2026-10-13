// tests/loop.test.ts — the main loop's clock (src/game/loop.ts, ARCHITECTURE §13.8): the colony does not care how often
// the loop turns. 30 s of wall time give the same ticks and the same state (the serialised state's hash, as in
// determinism.test.ts) at 12, 15, 60 and 120 turns a second, also through speed changes and a pause; DT_CLAMP still
// drops the time of turns further apart than 100 ms, which the covered loop's clamp does not; MAX_STEPS still drops a
// backlog; time never runs backwards.
import { describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import type { GameState } from '../src/game/types';
import { COVERED_DT_CLAMP, COVERED_HZ, advance, startClock, zeroOwed } from '../src/game/loop';
import { serialize } from '../src/game/save';
import { hashStr } from '../src/game/rng';
import { newCtx, tick } from '../src/game/sim';
import { fresh } from './util';

/** Turns the clock as main.ts does for `seconds` of wall time at `hz` turns a second, ticking a fresh colony. The speed
 *  (0: paused) comes from `speedAt(ms)` and is applied after the turn at that moment (a click lands between turns). */
function play(hz: number, seconds: number, speedAt: (ms: number) => number, clamp: number = B.time.DT_CLAMP): { ticks: number; s: GameState; hash: number } {
  const s = fresh(9);
  let c = startClock(0), ticks = 0, speed = speedAt(0);
  for (let i = 1; i <= Math.round(seconds * hz); i++) {
    const t = (i * 1000) / hz;
    const r = advance(c, t, speed, { run: speed > 0, clamp });
    c = r.clock;
    for (let k = 0; k < r.ticks; k++) tick(s, newCtx());
    ticks += r.ticks;
    speed = speedAt(Math.round(t));
  }
  return { ticks, s, hash: hashStr(serialize(s)) };
}

const at5 = (): number => 5;
/** 1× for 10 s, 10× for 10 s, paused for 3 s, then 2×: 10 + 100 + 0 + 14 ticks over 30 s. */
const schedule = (ms: number): number => (ms < 10_000 ? 1 : ms < 20_000 ? 10 : ms < 23_000 ? 0 : 2);

describe('the loop clock (src/game/loop.ts)', () => {
  it('30 s at 5×: the same 150 ticks and the same colony at 12 Hz and at 60 Hz', () => {
    const a = play(12, 30, at5), b = play(60, 30, at5);
    expect(a.ticks).toBe(150);
    expect(b.ticks).toBe(150);
    expect(a.s.day - B.time.START_DAY).toBe(150);
    expect(b.s.day).toBe(a.s.day);
    expect(a.hash).toBe(b.hash);
    expect(serialize(a.s)).toBe(serialize(b.s));
  });

  it('speed changes and a pause: 124 ticks and one colony at 12, 15 (covered), 60 and 120 Hz', () => {
    const runs = [play(12, 30, schedule), play(COVERED_HZ, 30, schedule, COVERED_DT_CLAMP), play(60, 30, schedule), play(120, 30, schedule)];
    for (const r of runs) {
      expect(r.ticks).toBe(124);
      expect(r.hash).toBe(runs[0].hash);
    }
  });

  it('frame rates that do not divide a second evenly still add up exactly (whole µs telescope)', () => {
    for (const hz of [13, 29, 47, 90, 144]) expect(play(hz, 30, () => 10).ticks, `${hz} Hz`).toBe(300);
  });

  it('DT_CLAMP: turns 250 ms apart count 100 ms each; the covered clamp counts them whole', () => {
    expect(play(4, 30, at5).ticks).toBe(60);                       // 120 turns × 0.1 s × 5
    expect(play(4, 30, at5, COVERED_DT_CLAMP).ticks).toBe(150);
    expect(1 / COVERED_HZ).toBeLessThan(B.time.DT_CLAMP);          // the covered timer loses nothing even unclamped
    expect(COVERED_HZ).toBeGreaterThanOrEqual(12);
  });

  it('a paused colony keeps the part of a tick it was owed; zeroOwed forgets it', () => {
    let c = startClock(1000);
    let r = advance(c, 1700, 1, { run: true, clamp: 1 });          // 0.7 s at 1×: no tick yet
    expect(r.ticks).toBe(0);
    c = r.clock;
    r = advance(c, 5000, 1, { run: false, clamp: 1 });             // paused: nothing owed is lost, nothing added
    expect(r.ticks).toBe(0);
    expect(r.dt).toBe(1);                                          // the animations still get the (clamped) turn
    c = r.clock;
    r = advance(c, 5300, 1, { run: true, clamp: 1 });              // 0.7 + 0.3 = one tick
    expect(r.ticks).toBe(1);
    expect(r.clock.owed).toBe(0);
    c = advance(r.clock, 5900, 1, { run: true, clamp: 1 }).clock;
    expect(c.owed).toBeGreaterThan(0);
    expect(zeroOwed(c)).toEqual({ at: c.at, owed: 0 });
  });

  it('MAX_STEPS: a backlog beyond it is dropped, under it carried', () => {
    const c = startClock(0);
    const big = advance(c, 1000, 10, { run: true, clamp: 1 });     // 10 ticks owed, 8 run
    expect(big.ticks).toBe(B.time.MAX_STEPS);
    expect(big.clock.owed).toBe(0);
    const small = advance(c, 750, 10, { run: true, clamp: 1 });    // 7.5 owed: 7 run, half a tick carried
    expect(small.ticks).toBe(7);
    expect(small.clock.owed).toBe(500_000);
  });

  it('time never runs backwards: an earlier timestamp counts as nothing, and is not counted twice', () => {
    let c = startClock(0);
    c = advance(c, 600, 1, { run: true, clamp: 1 }).clock;
    const back = advance(c, 590, 1, { run: true, clamp: 1 });      // an animation frame's start, read after a timer turn
    expect(back.dt).toBe(0);
    expect(back.clock.at).toBe(c.at);
    expect(advance(back.clock, 1000, 1, { run: true, clamp: 1 }).ticks).toBe(1);
  });
});

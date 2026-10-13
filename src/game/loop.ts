// src/game/loop.ts — the main loop's clock (ARCHITECTURE §13.8): wall time in, whole sim ticks out. Owner: WP-H.
// main.ts calls advance() once per turn of its loop, an animation frame while the map shows, a ≥ 12 Hz timer while the
// UI covers it all (view.suspended, COVERED_HZ). The colony must not care which: N seconds of wall time at a speed are
// the same ticks at 12 frames a second as at 120 (tests/loop.test.ts). So the clock keeps whole microseconds: each
// turn's wall time is the difference of two rounded timestamps, which telescopes (the turns of any frame rate add up to
// exactly the time between the first and the last), and the time owed to the sim (wall µs × speed) is an integer, so no
// float drift ever drops or adds a tick at a boundary. A turn's wall time is clamped (DT_CLAMP: a stall, a debugger, a
// dropped frame never bursts the sim nor the animations); the covered timer's turns are 66 ms apart and may slip, so
// they are clamped at COVERED_DT_CLAMP instead, and lose nothing. MAX_STEPS ticks at most per turn; a backlog beyond it
// is dropped, as it always was. Pure: the wall clock enters only as `nowMs`.
import { B } from './balance';

/** Wall µs per tick at 1×: one game day a second (DESIGN §0). */
const US_PER_TICK = 1_000_000;

/** The clock between two turns: `at`, the last turn's wall time (whole µs); `owed`, game time owed to the sim, in µs ×
 *  speed (whole: under one tick after any turn that ran its ticks). */
export interface Clock { readonly at: number; readonly owed: number }

/** What one turn of the loop gets: `ticks` to run now, `dt` the turn's wall time in seconds after the clamp (what the
 *  map's animations, the play-time counter and the autosave timer advance by), and the clock for the next turn. */
export interface Turn { clock: Clock; ticks: number; dt: number }

/** How a turn runs: `run`, the sim runs (a game, not paused, no modal, not broken); `clamp`, the most wall seconds one
 *  turn may count (B.time.DT_CLAMP, or COVERED_DT_CLAMP while the map is covered); `maxSteps`, the most ticks a turn
 *  runs (B.time.MAX_STEPS). */
export interface TurnOpts { run: boolean; clamp: number; maxSteps?: number }

/** A clock started at `nowMs`, nothing owed. */
export function startClock(nowMs: number): Clock {
  return { at: Math.round(nowMs * 1000), owed: 0 };
}

/** The same clock with nothing owed (a colony entered, a catch-up done). */
export function zeroOwed(c: Clock): Clock {
  return { at: c.at, owed: 0 };
}

/** One turn of the loop at wall time `nowMs` (ms, any monotonic origin) and game speed `speed` (ticks per second). Time
 *  never runs backwards: a timestamp before the last (an animation frame's start, read after a timer's turn) counts as
 *  no time. While the sim does not run, what it was owed waits (a paused colony resumes mid-tick). */
export function advance(c: Clock, nowMs: number, speed: number, o: TurnOpts): Turn {
  const now = Math.round(nowMs * 1000);
  const wall = Math.min(Math.max(0, now - c.at), Math.round(o.clamp * 1_000_000));
  const at = Math.max(c.at, now);
  if (!o.run) return { clock: { at, owed: c.owed }, ticks: 0, dt: wall / 1_000_000 };
  const max = o.maxSteps ?? B.time.MAX_STEPS;
  let owed = c.owed + wall * Math.max(0, Math.round(speed));   // (speeds are whole: 1, 2, 5, 10, 20)
  let ticks = Math.floor(owed / US_PER_TICK);
  if (ticks >= max) { ticks = max; owed = 0; }   // the backlog goes (a long stall at 10×), as it always did
  else owed -= ticks * US_PER_TICK;
  return { clock: { at, owed }, ticks, dt: wall / 1_000_000 };
}

/** The covered loop's rate: while nothing of the map shows the loop runs on a timer at this rate (≥ 12 Hz: the HUD's
 *  figures, the sheet's ledgers and the counsel still move with the colony; the UI refreshes every 200 ms anyway). */
export const COVERED_HZ = 15;
/** The covered loop's clamp, in seconds: its timer turns may come late (a busy main thread) without losing sim time. */
export const COVERED_DT_CLAMP = 0.25;

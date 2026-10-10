// src/game/objectives.ts — Res Gestae milestones and their counters (ARCHITECTURE §8.5, DESIGN §9.4). Owner: WP-D.
// SCAFFOLD: no milestones yet; only the fed streak counter runs.
import { B } from './balance';
import type { GameState, MilestoneDef, MilestoneId, SimView, TickContext } from './types';

/** The 24 milestones in order (DESIGN §9.4). */
export const MILESTONES: MilestoneDef[] = [];   // STUB(WP-D): DESIGN §9.4 table

/** Completes the current milestone(s) while their progress is met (loops); logs, fx milestone. */
export function checkObjectives(s: GameState, ctx: TickContext): void {
  // STUB(WP-D)
  void s; void ctx;
}

/** The milestone currently pursued, or null when all are done. */
export function currentMilestone(s: GameState): MilestoneDef | null {
  return MILESTONES[s.guidance.objective] ?? null;
}

/** True when a milestone has been achieved. */
export function milestoneDone(s: GameState, id: MilestoneId): boolean {
  return s.guidance.milestoneDays[id] !== undefined;
}

/** Daily counters behind milestones: fed streak, stability streak. */
export function updateCounters(s: GameState, v: SimView): void {
  void v;
  s.counters.fedStreak = s.fed >= B.needs.FED_MIN ? s.counters.fedStreak + 1 : 0;
  // STUB(WP-D): stabStreak (B.progress.STAB).
}

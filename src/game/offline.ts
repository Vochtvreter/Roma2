// src/game/offline.ts — offline catch-up: literally N ticks with ctx.offline, and the away report (ARCHITECTURE §11.5, DESIGN §14). Owner: WP-D.
import { B } from './balance';
import type { AwayReport, GameState, LogEntry, OfflineRun, RankIndex, Snapshot } from './types';
import { newCtx, tick, view } from './sim';
import { census } from './census';
import { activeAdvisories } from './advisors/engine';
import { petitionNeeds } from './decisions';

const DECIDED_MAX = 12;       // "decided in your name" lines kept (ARCHITECTURE §11.5)
const HIGHLIGHTS_MAX = 40;    // highlight entries kept, newest
const AWAITING_MAX = 3;       // advisories listed under "Awaiting you"

/** Days to simulate for an absence: min(OFFLINE_MAX_DAYS, floor(awayMs / 1000 × OFFLINE_RATE)). */
export function offlineDays(awayMs: number): number {
  return Math.min(B.time.OFFLINE_MAX_DAYS, Math.floor((awayMs / 1000) * B.time.OFFLINE_RATE));
}

function doh(stock: number, need: number): number {
  return need > 0 ? stock / need : Infinity;
}

function snapshot(s: GameState): Snapshot {
  const c = census(s);
  return {
    day: s.day, pop: s.people.length, rank: s.rank, morale: s.morale, res: { ...s.res },
    grainDoh: doh(s.res.grain, c.need.grain), waterDoh: doh(s.res.water, c.need.water),
    births: s.stats.births, deaths: s.stats.deaths, immigrants: s.stats.immigrants, emigrants: s.stats.emigrants,
    built: s.stats.built, evolvedBy: { ...s.stats.evolvedBy }, builtBy: { ...s.stats.builtBy },
  };
}

function track(lowest: AwayReport['lowest'], s: GameState): void {
  const c = census(s);
  const g = doh(s.res.grain, c.need.grain);
  const w = doh(s.res.water, c.need.water);
  if (g < lowest.grain.doh) lowest.grain = { doh: g, day: s.day };
  if (w < lowest.water.doh) lowest.water = { doh: w, day: s.day };
}

/** Today's log entries: 'decided' texts (≤ 12) and 'highlight' entries (≤ 40, newest kept). */
function collect(s: GameState, decided: string[], highlights: LogEntry[]): void {
  let k = s.log.length;
  while (k > 0 && s.log[k - 1].day === s.day) k--;
  for (let i = k; i < s.log.length; i++) {
    const e = s.log[i];
    if (e.tags?.includes('decided') && decided.length < DECIDED_MAX) decided.push(e.text);
    if (e.tags?.includes('highlight')) {
      highlights.push(e);
      if (highlights.length > HIGHLIGHTS_MAX) highlights.shift();
    }
  }
}

function readyPetitionRank(s: GameState): RankIndex | null {
  const pn = petitionNeeds(s, view(s));
  return pn && pn.ready && pn.rank !== null ? pn.rank : null;
}

/** A sliced offline run of N real ticks (ctx.offline = true); null below OFFLINE_MIN_MS or under one day. */
export function offlineRun(s: GameState, awayMs: number): OfflineRun | null {
  if (awayMs < B.time.OFFLINE_MIN_MS) return null;
  const days = offlineDays(awayMs);
  if (days < 1) return null;
  const before = snapshot(s);
  const lowest: AwayReport['lowest'] = { grain: { doh: Infinity, day: s.day }, water: { doh: Infinity, day: s.day } };
  const decided: string[] = [];
  const highlights: LogEntry[] = [];
  let done = 0;
  let stopped = false;
  return {
    days,
    progress: () => done / days,
    step(n: number): boolean {
      for (let i = 0; i < n && done < days && !stopped; i++) {
        const won = s.victory;
        tick(s, newCtx(true));
        done++;
        track(lowest, s);
        collect(s, decided, highlights);
        if (!won && s.victory) stopped = true;   // stop early on victory
      }
      return done >= days || stopped;
    },
    report: () => ({
      awayMs, daysPlanned: days, days: done, before, after: snapshot(s), decided, highlights, lowest,
      awaiting: {
        petition: readyPetitionRank(s),
        advisories: activeAdvisories(s, { forCard: true }).slice(0, AWAITING_MAX).map((a) => a.rule),
      },
    }),
  };
}

/** Runs an absence to completion synchronously and returns its report (null when nothing would be simulated). */
export function simulateOffline(s: GameState, awayMs: number): AwayReport | null {
  const run = offlineRun(s, awayMs);
  if (!run) return null;
  run.step(run.days);
  return run.report();
}

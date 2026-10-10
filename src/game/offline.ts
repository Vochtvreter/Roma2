// src/game/offline.ts — offline catch-up: literally N ticks with ctx.offline, and the away report (ARCHITECTURE §11.5, DESIGN §14). Owner: WP-D.
import { B } from './balance';
import { BUILDINGS, HOUSE_TIERS } from './types';
import type { AwayReport, GameState, LogEntry, OfflineRun, RankIndex, Snapshot } from './types';
import { formatRoman } from './calendar';
import { BUILDING_DEFS } from './data/buildings';
import { TIER_DEFS } from './data/housing';
import { RANK_DEFS } from './data/ranks';
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

/** "7 min 22 s", "2 h 05 min": a real-time duration in words. */
export function awayDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return m > 0 ? `${m} min ${r} s` : `${r} s`;
}

const signed = (n: number): string => (n >= 0 ? `+${Math.round(n)}` : `−${Math.round(-n)}`);
const days = (d: number): string => (Number.isFinite(d) ? `${Math.round(d)} days` : 'plenty');

/** The Litterae Ordinis as text lines (DESIGN §14), built from a report: the dispatch renders these as it likes. */
export function describeAway(r: AwayReport): { heading: string; city: string; stores: string; works: string; homes: string; decided: string[]; lowest: string; awaiting: string | null } {
  const b = r.before, a = r.after;
  const heading = `Litterae Ordinis · from ${formatRoman(b.day + 1)} to ${formatRoman(a.day, { year: true })} (${r.days} days · you were away ${awayDuration(r.awayMs)})`;
  const births = a.births - b.births, deaths = a.deaths - b.deaths, arr = a.immigrants - b.immigrants, left = a.emigrants - b.emigrants;
  const city = `Souls ${b.pop} → ${a.pop} (+${births} births, +${arr} arrivals, −${deaths} deaths, −${left} departed) · Rank ${RANK_DEFS[a.rank].name} · Spirits ${Math.round(b.morale)} → ${Math.round(a.morale)}`;
  const coin = a.res.denarii - b.res.denarii;
  const stores = `Grain ${days(b.grainDoh)} → ${days(a.grainDoh)} · Water ${days(b.waterDoh)} → ${days(a.waterDoh)} · Coin ${Math.round(b.res.denarii)} → ${Math.round(a.res.denarii)} (${signed(coin)})`;
  const works: string[] = [];
  for (const t of BUILDINGS) {
    const n = (a.builtBy[t] ?? 0) - (b.builtBy[t] ?? 0);
    if (n > 0) works.push(n === 1 ? BUILDING_DEFS[t].name : `${n} × ${BUILDING_DEFS[t].name}`);
  }
  const homes: string[] = [];
  for (const t of HOUSE_TIERS) {
    const n = (a.evolvedBy[t] ?? 0) - (b.evolvedBy[t] ?? 0);
    if (n > 0) homes.push(`${n} ${n === 1 ? 'home' : 'homes'} became ${TIER_DEFS[t].latin}`);
  }
  const g = r.lowest.grain, w = r.lowest.water;
  const low = g.doh <= w.doh ? { what: 'Grain', ...g } : { what: 'Water', ...w };
  const lowest = Number.isFinite(low.doh) ? `${low.what} fell to ${Math.round(low.doh)} days on ${formatRoman(low.day)}.` : 'Grain and water never ran short.';
  const awaiting = r.awaiting.petition !== null ? `Rome would hear our petition for ${RANK_DEFS[r.awaiting.petition].name}.` : null;
  return {
    heading, city, stores,
    works: works.length ? works.join(' · ') : 'No works finished.',
    homes: homes.length ? homes.join(' · ') : 'No home changed its roof.',
    decided: r.decided, lowest, awaiting,
  };
}

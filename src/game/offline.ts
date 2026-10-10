// src/game/offline.ts — offline catch-up: literally N ticks with ctx.offline, and the away report (ARCHITECTURE §11.5, DESIGN §14). Owner: WP-D.
import { B } from './balance';
import { BUILDINGS, HOUSE_TIERS } from './types';
import type { AwayReport, GameState, LogEntry, LogKind, OfflineRun, RankIndex, Snapshot } from './types';
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

/** One "decided in your name" line: repeats of a decision (numbers aside) fold into its latest wording with a count. */
export interface Decided { key: string; text: string; kind: LogKind; n: number }
/** Routine council work, given up first when the letter is full (rations, relief and events are kept longer). */
const ROUTINE: readonly LogKind[] = ['ordo', 'trade'];

/** Adds a decision: an earlier one with the same wording (digits aside) counts it; over DECIDED_MAX, the oldest routine
 *  line goes, or the oldest line when only emergencies and events are left. */
export function keepDecided(list: Decided[], e: LogEntry): void {
  const key = e.text.replace(/[\d.,]+/g, '#');
  const hit = list.find((x) => x.key === key);
  if (hit) { hit.text = e.text; hit.n++; return; }
  list.push({ key, text: e.text, kind: e.kind, n: 1 });
  if (list.length <= DECIDED_MAX) return;
  const k = list.findIndex((x) => ROUTINE.includes(x.kind));
  list.splice(Math.max(0, k), 1);
}

/** The letter's lines: the latest wording of each decision, with "(×n)" when it was taken n times. */
export const decidedLines = (list: readonly Decided[]): string[] => list.map((x) => (x.n > 1 ? `${x.text} (×${x.n})` : x.text));

/** Today's log entries: 'decided' entries (≤ 12 lines, grouped) and 'highlight' entries (≤ 40, newest kept). */
function collect(s: GameState, decided: Decided[], highlights: LogEntry[]): void {
  let k = s.log.length;
  while (k > 0 && s.log[k - 1].day === s.day) k--;
  for (let i = k; i < s.log.length; i++) {
    const e = s.log[i];
    if (e.tags?.includes('decided')) keepDecided(decided, e);
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
  const decided: Decided[] = [];
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
    report: () => {
      const petition = readyPetitionRank(s);
      return {
        awayMs, daysPlanned: days, days: done, before, after: snapshot(s), decided: decidedLines(decided), highlights: highlights.slice(), lowest,
        awaiting: {
          petition,
          // the ready petition has its own line (with its button): the Augur's advisory saying the same is left out
          advisories: activeAdvisories(s, { forCard: true }).filter((a) => petition === null || a.rule !== 'augur.petition')
            .slice(0, AWAITING_MAX).map((a) => a.rule),
        },
      };
    },
  };
}

/** True when the Capitolium was dedicated during the absence the report covers. The catch-up ticks with throwaway contexts,
 *  so the one-off 'victory' fx is lost: the app replays it from this (the Victory dispatch and the Fasti entry). */
export function wonWhileAway(s: GameState, r: AwayReport): boolean {
  const vd = s.stats.victoryDay;
  return s.victory && vd !== null && vd > r.before.day && vd <= r.after.day;
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

/** Ends a sentence with a full stop, unless it already ends in one (every Roman date ends in an abbreviation's stop). */
export const sentence = (t: string): string => (t.endsWith('.') ? t : `${t}.`);
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
  const lowest = Number.isFinite(low.doh) ? sentence(`${low.what} fell to ${Math.round(low.doh)} days on ${formatRoman(low.day)}`) : 'Grain and water never ran short.';
  const awaiting = r.awaiting.petition !== null ? `Rome would hear our petition for ${RANK_DEFS[r.awaiting.petition].name}.` : null;
  return {
    heading, city, stores,
    works: works.length ? works.join(' · ') : 'No works finished.',
    homes: homes.length ? homes.join(' · ') : 'No home changed its roof.',
    decided: r.decided, lowest, awaiting,
  };
}

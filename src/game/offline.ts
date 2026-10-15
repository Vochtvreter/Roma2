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
import { nextRankNeeds, petitionNeeds } from './decisions';
import { int } from './advisors/util';

const DECIDED_MAX = 12;       // "decided in your name" lines kept (ARCHITECTURE §11.5)
const HIGHLIGHTS_MAX = 40;    // highlight entries kept, newest
const AWAITING_MAX = 3;       // advisories listed under "Awaiting you"
const LACKING_MAX = 3;        // unmet petition items a stalled letter names

/** Days to simulate for an absence: min(OFFLINE_MAX_DAYS, floor(awayMs / 1000 × OFFLINE_RATE)). */
export function offlineDays(awayMs: number): number {
  return Math.min(B.time.OFFLINE_MAX_DAYS, Math.floor((awayMs / 1000) * B.time.OFFLINE_RATE));
}

/** The real time an absence takes to fill the cap: OFFLINE_MAX_DAYS / OFFLINE_RATE seconds (3,650 s, ≈ 61 min). */
export const AWAY_CAP_MS = (B.time.OFFLINE_MAX_DAYS / B.time.OFFLINE_RATE) * 1000;
/** The cap in years (one lustrum: 5). */
export const AWAY_CAP_YEARS = Math.round(B.time.OFFLINE_MAX_DAYS / B.time.YEAR_DAYS);

/** How time away runs, in real time (How to play, DESIGN §14): the rate, the cap and when it is reached. */
export function awayRule(): string {
  return `Time away passes at half speed: each minute you are gone is ${60 * B.time.OFFLINE_RATE} days in the colony, up to ${AWAY_CAP_YEARS} years. `
    + `That takes ${Math.round(AWAY_CAP_MS / 60_000)} minutes; time away beyond it is not counted.`;
}

/** The part of an absence the cap left uncounted: 0 unless the whole lustrum ran and a minute or more was left over. */
export function awayUnusedMs(r: AwayReport): number {
  const over = r.awayMs - AWAY_CAP_MS;
  return r.days >= B.time.OFFLINE_MAX_DAYS && over >= B.time.OFFLINE_MIN_MS ? over : 0;
}

function doh(stock: number, need: number): number {
  return need > 0 ? stock / need : Infinity;
}

function snapshot(s: GameState): Snapshot {
  const c = census(s);
  const next = nextRankNeeds(s, view(s));
  const cap = s.buildings.find((b) => b.type === 'capitolium');
  return {
    day: s.day, pop: s.people.length, rank: s.rank, morale: s.morale, res: { ...s.res },
    grainDoh: doh(s.res.grain, c.need.grain), waterDoh: doh(s.res.water, c.need.water),
    births: s.stats.births, deaths: s.stats.deaths, immigrants: s.stats.immigrants, emigrants: s.stats.emigrants,
    built: s.stats.built, evolvedBy: { ...s.stats.evolvedBy }, builtBy: { ...s.stats.builtBy },
    petition: next ? { rank: next.rank, met: next.needs.filter((n) => n.met).length, of: next.needs.length } : null,
    capitolium: cap ? (cap.status === 'done' ? 1 : cap.progress) : null,
  };
}

/** True when the absence moved the colony on: more souls, a work raised, a home risen, a petition item met, the
 *  Capitolium higher. */
function moved(b: Snapshot, a: Snapshot): boolean {
  return a.pop > b.pop || a.built > b.built || HOUSE_TIERS.some((t) => (a.evolvedBy[t] ?? 0) > (b.evolvedBy[t] ?? 0))
    || (a.petition?.met ?? 0) > (b.petition?.met ?? 0) || (a.capitolium ?? 0) > (b.capitolium ?? 0);
}

/** What holds the next rank when nothing moved and no petition waits on the player (DESIGN §14 "Stalled"): the next
 *  rank's unmet items in checklist order, or (rank null) the Capitolium that did not rise; null when something moved. */
function stalled(s: GameState, b: Snapshot, a: Snapshot, ready: boolean): AwayReport['awaiting']['stalled'] {
  if (ready || moved(b, a)) return null;
  const next = nextRankNeeds(s, view(s));
  if (next) return { rank: next.rank, lacking: next.needs.filter((n) => !n.met).slice(0, LACKING_MAX).map((n) => n.label) };
  return a.capitolium !== null && a.capitolium < 1 ? { rank: null, lacking: [] } : null;
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
      const after = snapshot(s);
      const opp = s.guidance.advisories['augur.petition'];   // raised the day the petition became ready (the Augur's Opportunitas)
      return {
        awayMs, daysPlanned: days, days: done, before, after, decided: decidedLines(decided), highlights: highlights.slice(), lowest,
        awaiting: {
          petition,
          readySince: petition !== null && opp?.active && opp.params.rank === petition ? opp.since : null,
          stalled: stalled(s, before, after, petition !== null),
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

/** "34%": the Capitolium's progress, rounded down (99.9% is not yet done). */
export const pct = (x: number): string => `${Math.floor(x * 100 + 1e-9)}%`;

/** The cap's line when an absence ran past it (DESIGN §14): "The colony ran 5 years, the most it runs without you; 6 h 59 min
 *  of your absence went uncounted." `dur` words the real time (the dispatch passes its own). */
export function capLine(r: AwayReport, dur: (ms: number) => string = awayDuration): string | null {
  const unused = awayUnusedMs(r);
  return unused > 0 ? `The colony ran ${AWAY_CAP_YEARS} years, the most it runs without you; ${dur(unused)} of your absence went uncounted.` : null;
}

/** The ready petition's line: "Rome would hear our petition for Oppidum: ready since a.d. III Id. Iul. AUC DCCCV, 412 days."
 *  (without the date when the Augur never raised it). */
export function readyLine(r: AwayReport): string | null {
  const rank = r.awaiting.petition, since = r.awaiting.readySince;
  if (rank === null) return null;
  const head = `Rome would hear our petition for ${RANK_DEFS[rank].name}`;
  if (since === null) return `${head}.`;
  const d = r.after.day - since;
  return d > 0 ? `${head}: ready since ${formatRoman(since, { year: true })}, ${int(d)} ${d === 1 ? 'day' : 'days'}.` : `${head}: ready as of today.`;
}

/** The stall's line, leading Awaiting you when nothing moved: the next rank and what it still lacks (the checklist's
 *  "Souls: 120 / 180" read "Souls 120 / 180"), or the Capitolium that did not rise. */
export function stalledLine(r: AwayReport): string | null {
  const st = r.awaiting.stalled;
  if (!st) return null;
  if (st.rank === null) return `Stalled: the Capitolium did not rise past ${pct(r.after.capitolium ?? 0)}.`;
  const lack = st.lacking.map((l) => l.replace(/: (?=[\d,]+ \/ )/, ' '));
  return `Stalled: nothing moved toward ${RANK_DEFS[st.rank].name}.${lack.length ? ` Still lacking: ${lack.join(' · ')}.` : ''}`;
}

/** The progress line: the next rank's checklist and the Capitolium, before → after ("Oppidum petition 2 → 4 of 5 met"). */
function progressLine(b: Snapshot, a: Snapshot): string | null {
  const parts: string[] = [];
  const p = a.petition;
  if (p) parts.push(`${RANK_DEFS[p.rank].name} petition: ${b.petition?.rank === p.rank ? b.petition.met : p.met} → ${p.met} of ${p.of} met`);
  if (a.capitolium !== null && b.capitolium !== 1) parts.push(`Capitolium ${pct(b.capitolium ?? 0)} → ${pct(a.capitolium)}`);
  return parts.length ? parts.join(' · ') : null;
}

/** The Litterae Ordinis as text lines (DESIGN §14), built from a report: the dispatch renders these as it likes. */
export function describeAway(r: AwayReport): { heading: string; cap: string | null; city: string; stores: string; progress: string | null; works: string; homes: string; decided: string[]; lowest: string; awaiting: string | null; stalled: string | null } {
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
  return {
    heading, cap: capLine(r), city, stores, progress: progressLine(b, a),
    works: works.length ? works.join(' · ') : 'No works finished.',
    homes: homes.length ? homes.join(' · ') : 'No home changed its roof.',
    decided: r.decided, lowest, awaiting: readyLine(r), stalled: stalledLine(r),
  };
}

// tests/trace.test.ts — the tuning table (`npm run trace`, ARCHITECTURE §14.4): per seed a row every 300 days — day, AUC,
// rank, pop, beds, houses by tier, grain/water days on hand, coin, morale, dignitas, Ordo sites, advisories ≥ Cave — then the
// medians over the seeds against the DESIGN §18.4 target curve. Skipped by `npm test`; TRACE=1 runs it from plain vitest.
// Knobs: TRACE_SEEDS=1,42 · TRACE_DAYS=6000 · TRACE_EVERY=300 · TRACE_BOT=decision|undecided|follower|builder|neglect · TRACE_LOG=20
import { describe, expect, it } from 'vitest';
import { HOUSE_TIERS } from '../src/game/types';
import type { GameState } from '../src/game/types';
import { activeAdvisories } from '../src/game/advisors/engine';
import { dignitas } from '../src/game/civic';
import { view } from '../src/game/sim';
import { aucYear, elapsed, formatRoman, toRoman } from '../src/game/calendar';
import { RANK_DEFS } from '../src/game/data/ranks';
import { BANDS, COIN_NET, RANK_BANDS, SEEDS, TARGETS, median, play, summary } from './autoplayer';
import type { BotKind, Run } from './autoplayer';

const env = process.env;
const ON = env.npm_lifecycle_event === 'trace' || !!env.TRACE;
const TRACE_SEEDS = env.TRACE_SEEDS ? env.TRACE_SEEDS.split(',').map(Number) : SEEDS;
const DAYS = Number(env.TRACE_DAYS ?? BANDS.victory[1]);
const EVERY = Number(env.TRACE_EVERY ?? 300);
const KIND = (env.TRACE_BOT ?? 'decision') as BotKind;
const LOG = Number(env.TRACE_LOG ?? 0);
const T = { timeout: 3_600_000 };

const COLS: [string, number][] = [
  ['day', 6], ['AUC', 9], ['rank', 10], ['pop', 5], ['beds', 5], ['T0/T1/T2/T3/T4i/T4d', 19], ['grain', 6], ['water', 6],
  ['coin', 7], ['net/d', 6], ['mor', 4], ['dign', 5], ['ordo/pl', 7], ['advisories ≥ Cave', 0],
];
const line = (cells: string[]): string => cells.map((c, k) => (COLS[k][1] ? c.padStart(COLS[k][1]) : ` ${c}`)).join(' ');
const days = (d: number): string => (d >= 9999 ? '∞' : d.toFixed(0));

/** One row of the tuning table (rank-up rows are marked with *). */
function row(s: GameState, mark: string): string {
  const v = view(s), c = v.c, f = v.f;
  const sites = s.buildings.filter((b) => b.status !== 'done');
  const ordo = sites.filter((b) => b.owner === 'ordo').length;
  const cave = activeAdvisories(s).filter((a) => a.memo.sev >= 2)
    .map((a) => a.rule.slice(a.rule.indexOf('.') + 1) + (a.memo.sev >= 3 ? '!' : '')).join(' ');
  return line([
    `${mark}${elapsed(s)}`, toRoman(aucYear(s.day)), RANK_DEFS[s.rank].name, String(c.pop), String(c.beds),
    HOUSE_TIERS.map((t) => c.byTier[t]).join('/'), days(f.grain.doh), days(f.water.doh), Math.round(s.res.denarii).toString(),
    s.counters.coinEma.toFixed(1), Math.round(s.morale).toString(), Math.round(dignitas(s).value).toString(),
    `${ordo}/${sites.length - ordo}`, cave,
  ]);
}

interface Result { run: Run; at: Map<number, { pop: number; tiers: number[] }>; net: number[] }
const results: Result[] = [];
const fmtBand = (x: number | undefined, band: readonly number[] | null): string =>
  x === undefined || !Number.isFinite(x) ? '—' : `${Math.round(x)}${band && (x < band[0] || x > band[1]) ? '✗' : '✓'}`;

describe.runIf(ON)(`trace: the ${KIND} bot, a row every ${EVERY} days`, () => {
  for (const seed of TRACE_SEEDS) {
    it(`seed ${seed}`, T, () => {
      const out = [line(COLS.map(([h]) => h))];
      const at = new Map<number, { pop: number; tiers: number[] }>();
      const coin = (s: GameState): number => s.res.denarii + s.taxAccrued;
      const net: number[] = [];
      let rank = 0, since = { day: 0, coin: 0 };
      const r = play(seed, KIND, {
        days: DAYS, snapshots: false,
        onDay: (s) => {
          const e = elapsed(s);
          if (s.rank !== rank) {
            net[rank] = (coin(s) - since.coin) / Math.max(1, e - since.day);
            since = { day: e, coin: coin(s) };
            rank = s.rank;
            out.push(row(s, '*'));
          } else if (e % EVERY === 0) out.push(row(s, ''));
          if (TARGETS.some((t) => t.day === e)) at.set(e, { pop: s.people.length, tiers: HOUSE_TIERS.map((t) => view(s).c.byTier[t]) });
        },
      });
      const s = r.s, e = elapsed(s);
      net[rank] = (coin(s) - since.coin) / Math.max(1, e - since.day);
      if (e % EVERY !== 0) out.push(row(s, '='));
      out.push(summary(r));
      out.push(`  Capitolium stages: ${r.stageDay.join(' / ') || '—'} · net coin/day by rank: ` +
        net.map((x, k) => `${RANK_DEFS[k].name} ${x.toFixed(1)} (${COIN_NET[k].join('–')})`).join(' · '));
      out.push(`  deaths: ${Object.entries(s.stats.deathsBy).map(([k, v]) => `${k} ${v}`).join(' · ')} · births ${s.stats.births} · ` +
        `immigrants ${s.stats.immigrants} · emigrants ${s.stats.emigrants} · milestones ${Object.keys(s.guidance.milestoneDays).length} · ` +
        `stalls ${r.stall.construction}/${r.stall.renovation} · worst coin streak at 0: ${r.zeroStreak} d`);
      if (LOG > 0) out.push(...s.log.slice(-LOG).map((l) => `  ${formatRoman(l.day, { year: true })} · ${l.kind} · ${l.text}`));
      console.log(`\n${out.join('\n')}`);
      results.push({ run: r, at, net });
      expect(r.nan).toEqual([]);
    });
  }

  it(`medians over ${TRACE_SEEDS.length} seeds against DESIGN §18.4`, () => {
    if (results.length === 0) return;
    const out = ['  day   target pop   median pop (min–max)   target tiers         median tiers'];
    for (const t of TARGETS) {
      const xs = results.flatMap((x) => x.at.get(t.day) ?? []);
      if (xs.length === 0) continue;
      const pops = xs.map((x) => x.pop);
      const tiers = t.tiers.map((_, k) => median(xs.map((x) => x.tiers[k])));
      out.push(`${String(t.day).padStart(5)}   ${String(t.pop).padStart(10)}   ${`${median(pops)} (${Math.min(...pops)}–${Math.max(...pops)})`.padStart(20)}   ` +
        `${t.tiers.join('/').padEnd(18)}   ${tiers.join('/')}`);
    }
    out.push(`ranks (median elapsed day vs band): ` + RANK_DEFS.slice(1).map((d, k) =>
      `${d.name} ${fmtBand(median(results.map((x) => x.run.rankDay[k + 1] ?? Infinity)), RANK_BANDS[k + 1])}`).join(' · ') +
      ` · victory ${fmtBand(median(results.map((x) => x.run.victoryDay ?? Infinity)), BANDS.victory)}`);
    out.push(`net coin/day (median vs §18.4): ` + RANK_DEFS.map((d, k) =>
      `${d.name} ${fmtBand(median(results.flatMap((x) => x.net[k] ?? [])), COIN_NET[k])}`).join(' · '));
    console.log(`\n${out.join('\n')}`);
  });
});

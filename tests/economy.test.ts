// tests/economy.test.ts — the economy ledger (`npm run economy`): one bot game per seed, and per rank where the coin comes
// from and goes, how full the stores sit, what spills, how much of the builders' capacity is used, how many hands idle,
// what the tool kits do and Rome's favour; then the whole game's coin: earned, spent by sink, and still unspent at the end.
// It measures the sinks of docs/ECONOMY_REVIEW.md before and after they are tuned. Skipped by `npm test`; ECONOMY=1 runs it
// from plain vitest. Knobs: ECON_SEEDS=42,1 · ECON_BOT=active|decision|… · ECON_DAYS=17500.
import { describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import { RESOURCES } from '../src/game/types';
import type { GameState, ResId } from '../src/game/types';
import { makeBot } from './autoplayer';
import type { BotKind } from './autoplayer';
import { fresh, noNaN } from './util';
import { newCtx, tick } from '../src/game/sim';
import { caps } from '../src/game/economy';
import { builderFactor, builderWork } from '../src/game/construction';
import { census, peopleIndex } from '../src/game/census';
import { renownFactor } from '../src/game/people';
import { elapsed } from '../src/game/calendar';
import { BUILDING_DEFS } from '../src/game/data/buildings';
import { RANK_DEFS } from '../src/game/data/ranks';

const env = process.env;
const ON = env.npm_lifecycle_event === 'economy' || !!env.ECONOMY;
const SEEDS = env.ECON_SEEDS ? env.ECON_SEEDS.split(',').map(Number) : [42];
const KIND = (env.ECON_BOT ?? 'active') as BotKind;
const DAYS = Number(env.ECON_DAYS ?? 17_500);
const AT_CAP = 0.95;                                     // a store this full counts as at its cap
const MATERIALS = RESOURCES.filter((r) => r !== 'denarii');

type Sum = Record<string, number>;
/** One rank's totals (divided by its days when printed). */
interface Seg {
  days: number; coin0: number; coin1: number; inc: Sum; out: Sum; works: number;
  fill: Sum; atCap: Sum; spill: Sum; made: Sum; sold: Sum; bought: Sum;
  pop: number; idle: number; builders: number; crew: number; used: number; sites: number; siteDays: number; siteBusy: number;
  kits: number; kitted: number; kittedDays: number; kitsToSites: number; kitsToWorks: number; renown: number;
}
const seg = (s: GameState): Seg => ({
  days: 0, coin0: coin(s), coin1: 0, inc: {}, out: {}, works: 0, fill: {}, atCap: {}, spill: {}, made: {}, sold: {}, bought: {},
  pop: 0, idle: 0, builders: 0, crew: 0, used: 0, sites: 0, siteDays: 0, siteBusy: 0,
  kits: 0, kitted: 0, kittedDays: 0, kitsToSites: 0, kitsToWorks: 0, renown: 0,
});
const coin = (s: GameState): number => s.res.denarii + s.taxAccrued;
const add = (o: Sum, k: string, v: number): void => { o[k] = (o[k] ?? 0) + v; };
const f1 = (x: number): string => x.toFixed(1);
const k0 = (x: number): string => (Math.abs(x) >= 10_000 ? `${(x / 1000).toFixed(0)}k` : Math.round(x).toLocaleString('en-US'));
const pct = (x: number): string => `${Math.round(100 * x)}%`;

/** Plays one bot game and returns the per-rank ledger lines. */
function ledger(seed: number): string[] {
  const s = fresh(seed);
  const bot = makeBot(KIND, seed);
  const segs: Seg[] = [seg(s)];
  let rank = s.rank;
  for (let i = 0; i < DAYS && !s.victory; i++) {
    // the bot's own spending (works placed, petitions) happens outside the tick's ledger
    const before = coin(s);
    bot.step(s);
    const works = Math.max(0, before - coin(s));
    // what the builders could do today, and where every unfinished site stands, before the tick
    const factor = builderFactor(s);
    const builders = peopleIndex(s).builders;
    let crew = 0;
    for (const p of builders) crew += builderWork(s, p, factor);
    const idle = census(s).idle.length;
    const progress = new Map<number, number>();
    for (const b of s.buildings) if (b.status !== 'done' && b.type !== 'capitolium') progress.set(b.id, b.progress);
    const ctx = newCtx();
    tick(s, ctx);
    if (s.rank !== rank) { segs[rank].coin1 = before; segs[s.rank] = { ...seg(s), coin0: before }; rank = s.rank; }
    const g = segs[rank];
    g.days++; g.works += works; g.pop += s.people.length; g.idle += idle; g.builders += builders.length;
    g.crew += crew + idle * B.economy.IDLE_BUILD; g.renown += renownFactor(s);
    for (const b of s.buildings) {
      const p0 = progress.get(b.id);
      if (p0 === undefined) continue;
      g.used += Math.max(0, (b.progress - p0) * b.work);
      if (b.status === 'done') { g.sites++; g.siteDays += s.day - b.placed; }
    }
    if (s.buildings.some((b) => b.status === 'building' && b.type !== 'capitolium')) g.siteBusy++;
    for (const [k, v] of Object.entries(ctx.rates.prod.denarii)) add(g.inc, k, v ?? 0);
    for (const [k, v] of Object.entries(ctx.rates.cons.denarii)) add(g.out, k, v ?? 0);
    const cap = caps(s);
    for (const r of MATERIALS) {
      add(g.fill, r, s.res[r] / cap[r]);
      if (s.res[r] >= AT_CAP * cap[r]) add(g.atCap, r, 1);
      add(g.spill, r, ctx.rates.cons[r].spill ?? 0);
      add(g.sold, r, ctx.rates.cons[r].trade ?? 0);
      add(g.bought, r, ctx.rates.prod[r].trade ?? 0);
      for (const [k, v] of Object.entries(ctx.rates.prod[r])) if (k !== 'trade' && k !== 'merchant') add(g.made, r, v ?? 0);
    }
    g.kits += s.res.tools;
    const users = s.buildings.filter((b) => b.status === 'done' && BUILDING_DEFS[b.type].tool && (peopleIndex(s).byWork.get(b.id)?.length ?? 0) > 0);
    if (users.length > 0) { g.kitted += users.filter((b) => (b.toolUntil ?? 0) > s.day).length / users.length; g.kittedDays++; }
    g.kitsToSites += ctx.rates.cons.tools.construction ?? 0;
    for (const [k, v] of Object.entries(ctx.rates.cons.tools)) if (k !== 'construction') g.kitsToWorks += v ?? 0;
  }
  segs[rank].coin1 = coin(s);
  expect(noNaN(s)).toEqual([]);

  const out = [`${KIND} seed ${seed}: day ${elapsed(s)} · ${RANK_DEFS[s.rank].name}${s.victory ? ' · dedicated' : ''} · pop ${s.people.length}`];
  const total = { earned: 0, works: 0, out: {} as Sum };
  segs.forEach((g, rank) => {
    const d = Math.max(1, g.days);
    const perDay = (o: Sum): string => Object.entries(o).filter(([, v]) => v / d >= 0.05).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${f1(v / d)}`).join(' · ') || '—';
    for (const v of Object.values(g.inc)) total.earned += v;
    for (const [k, v] of Object.entries(g.out)) add(total.out, k, v);
    total.works += g.works;
    out.push('', `== ${RANK_DEFS[rank].name}: ${g.days} days · pop ${Math.round(g.pop / d)} · coin ${k0(g.coin0)} → ${k0(g.coin1)} ` +
      `(net ${f1((g.coin1 - g.coin0) / d)}/day) · Rome's favour ×${(g.renown / d).toFixed(2)}`);
    out.push(`   coin in a day:  ${perDay(g.inc)}`);
    out.push(`   coin out a day: ${perDay(g.out)} · works and fees placed by the player ${f1(g.works / d)}`);
    out.push(`   ${'store'.padEnd(9)}${'avg full'.padStart(9)}${'at cap'.padStart(8)}${'made/d'.padStart(8)}${'spilt/d'.padStart(9)}${'sold/d'.padStart(8)}${'bought/d'.padStart(9)}`);
    for (const r of MATERIALS as ResId[]) {
      if (!g.fill[r] && !g.made[r] && !g.bought[r]) continue;
      out.push(`   ${r.padEnd(9)}${pct((g.fill[r] ?? 0) / d).padStart(9)}${pct((g.atCap[r] ?? 0) / d).padStart(8)}${f1((g.made[r] ?? 0) / d).padStart(8)}` +
        `${f1((g.spill[r] ?? 0) / d).padStart(9)}${f1((g.sold[r] ?? 0) / d).padStart(8)}${f1((g.bought[r] ?? 0) / d).padStart(9)}`);
    }
    out.push(`   hands: idle ${f1(g.idle / d)} · builders ${f1(g.builders / d)} · builders' capacity used ${pct(g.used / Math.max(1, g.crew))} · ` +
      `${g.sites} sites done, ${f1(g.siteDays / Math.max(1, g.sites))} days placed → done · a site under way on ${pct(g.siteBusy / d)} of days`);
    out.push(`   tool kits: ${f1(g.kits / d)} in store · ${pct(g.kitted / Math.max(1, g.kittedDays))} of staffed tool works kitted · ` +
      `${f1((365 * g.kitsToSites) / d)} a year to sites, ${f1((365 * g.kitsToWorks) / d)} to works`);
  });
  const end = coin(s), start = segs[0].coin0;
  const ledgerOut = Object.values(total.out).reduce((a, b) => a + b, 0);
  const placedByOrdo = Math.max(0, start + total.earned - ledgerOut - total.works - end);   // the Ordo's works and the renovations
  const spent = ledgerOut + total.works + placedByOrdo;
  const share = (x: number): string => `${k0(x)} (${pct(x / Math.max(1, total.earned))})`;
  out.push('', `== the whole game: earned ${k0(total.earned)} · spent ${share(spent)} · unspent at the end ${share(end)}`);
  out.push(`   by sink: ${Object.entries(total.out).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${share(v)}`).join(' · ')} · ` +
    `works, renovations and fees ${share(total.works + placedByOrdo)}`);
  return out;
}

describe.runIf(ON)(`economy: the ${KIND} bot's ledger per rank`, () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, { timeout: 3_600_000 }, () => {
      console.log(`\n${ledger(seed).join('\n')}`);
    });
  }
});

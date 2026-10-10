// tests/balance.test.ts — the balance-bot assertions of DESIGN §18.5 and the idle contract of §1.4 (ARCHITECTURE §14.2 WP-J).
// Every assertion needs the integrated simulation (INTEGRATED); the opening rows always run then, the full pacing
// bands only with BAL_FULL=1 (`npm run balance`). Bot runs are cached per (bot, seed) and shared between rows.
import { describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import { EVENTS, RESOURCES, TABS } from '../src/game/types';
import { deserialize } from '../src/game/save';
import { simulateOffline } from '../src/game/offline';
import { settingValue } from '../src/game/decisions';
import { chooseOption } from '../src/game/events';
import { newCtx, tick } from '../src/game/sim';
import { BANDS, SEEDS, median, play, summary, worstYear } from './autoplayer';
import type { BotKind, Run } from './autoplayer';
import { INTEGRATED, forceEvent, noNaN } from './util';

const FULL = !!process.env.BAL_FULL;
const OPENING = 4000, UNDECIDED = 3000, NEGLECT = 20 * 365;
const HORIZON = FULL ? BANDS.victory[1] + 1 : OPENING;
const T = { timeout: 3_600_000 };
const ABSENCE_MS = (B.time.OFFLINE_MAX_DAYS / B.time.OFFLINE_RATE) * 1000;   // a capped absence
const HUNGER_MAX = 0.05, OFFLINE_POP = 0.9, DEADLOCK = 120, ZERO_DAYS = 60, FOLLOW_SLACK = 1.1, BUILDER_GAIN = 0.9;
const CLAMP_EPS = 1e-6, EVENT_TRIALS = 2000, FEVER_DAYS = 25;

const cache = new Map<string, Run>();
function get(kind: BotKind, seed: number): Run {
  const key = `${kind}:${seed}`;
  let r = cache.get(key);
  if (!r) {
    r = kind === 'decision' ? play(seed, kind, { days: HORIZON, snapshots: true, guidanceDays: 2 * 365 })
      : kind === 'follower' ? play(seed, kind, { days: HORIZON })
      : kind === 'builder' ? play(seed, kind, { days: OPENING, stop: (s) => s.rank >= 2 })
      : play(seed, kind, { days: kind === 'neglect' ? NEGLECT : UNDECIDED });
    console.log(summary(r));
    cache.set(key, r);
  }
  return r;
}
const runs = (kinds: BotKind[]): Run[] => kinds.flatMap((k) => SEEDS.map((seed) => get(k, seed)));

function expectBand(day: number | null | undefined, band: readonly [number, number], what: string): void {
  expect(day, `${what}: never reached`).not.toBeUndefined();
  expect(day, `${what}: never reached`).not.toBeNull();
  expect(day!, `${what} on day ${day}, band ${band[0]}–${band[1]}`).toBeGreaterThanOrEqual(band[0]);
  expect(day!, `${what} on day ${day}, band ${band[0]}–${band[1]}`).toBeLessThanOrEqual(band[1]);
}

describe('bots (always: stubs or the real sim)', () => {
  it('every bot plays a year without throwing or NaN', T, () => {
    for (const kind of ['decision', 'undecided', 'follower', 'builder', 'neglect'] as BotKind[]) {
      const r = play(42, kind, { days: 365, snapshots: true, guidanceDays: 365 });
      expect(r.nan, kind).toEqual([]);
      expect(r.remedyIssues, kind).toEqual([]);
      expect(r.pops.length, kind).toBe(365);
    }
  });
});

describe.runIf(INTEGRATED)('balance (DESIGN §18.5)', () => {
  describe('opening: the decision bot over 4,000 days', () => {
    for (const seed of SEEDS) {
      it(`seed ${seed}: min pop ≥ 20 after day 30; Vicus and Oppidum inside their bands`, T, () => {
        const r = get('decision', seed);
        expect(r.nan).toEqual([]);
        expect(r.minPop).toBeGreaterThanOrEqual(20);
        expectBand(r.rankDay[1], BANDS.vicus, `seed ${seed} Vicus`);
        expectBand(r.rankDay[2], BANDS.oppidum, `seed ${seed} Oppidum`);
      });
    }
  });

  describe.runIf(FULL)('full: the decision bot to the dedication', () => {
    for (const seed of SEEDS) {
      it(`seed ${seed}: Municipium, Colonia, victory, Capitolium phase and stages inside their bands`, T, () => {
        const r = get('decision', seed);
        expectBand(r.rankDay[3], BANDS.municipium, `seed ${seed} Municipium`);
        expectBand(r.rankDay[4], BANDS.colonia, `seed ${seed} Colonia`);
        expectBand(r.victoryDay, BANDS.victory, `seed ${seed} victory`);
        expectBand((r.victoryDay ?? Infinity) - (r.rankDay[4] ?? 0), BANDS.capPhase, `seed ${seed} Capitolium phase`);
        r.stageDay.forEach((d, k) => expectBand(d - (k === 0 ? r.rankDay[4] : r.stageDay[k - 1]), BANDS.capStage, `seed ${seed} stage ${k + 1}`));
        expectBand(r.s.people.length, BANDS.victoryPop, `seed ${seed} pop at victory`);
      });
    }
  });

  it('undecided: no decisions, Ordo on, 3,000 days → pop ≥ 20, still Castra, pop ≤ 125', T, () => {
    for (const r of runs(['undecided'])) {
      expect(r.nan).toEqual([]);
      expect(r.minPop, `seed ${r.seed}`).toBeGreaterThanOrEqual(20);
      expect(r.s.rank, `seed ${r.seed}`).toBe(0);
      expect(r.maxPop, `seed ${r.seed}`).toBeLessThanOrEqual(125);
    }
  });

  it('hunger: in every Ordo-only run, hunger + thirst deaths ≤ 5% of the average population in every 365-day window', T, () => {
    for (const r of runs(['decision', 'undecided', 'follower'])) {
      const w = worstYear(r);
      expect(w.share, `${r.kind} seed ${r.seed}: ${(w.share * 100).toFixed(1)}% in the year to day ${w.day}`).toBeLessThanOrEqual(HUNGER_MAX);
    }
  });

  it('advisor-follower: each rank no later than decision-only + 10% (median over the seeds)', T, () => {
    const dec = runs(['decision']), fol = runs(['follower']);
    for (let rank = 1; rank < 5; rank++) {
      const d = median(dec.map((r) => r.rankDay[rank] ?? Infinity));
      if (!Number.isFinite(d)) continue;
      const f = median(fol.map((r) => r.rankDay[rank] ?? Infinity));
      expect(f, `rank ${rank}: follower ${f} vs decision ${d}`).toBeLessThanOrEqual(d * FOLLOW_SLACK);
    }
  });

  it('builder: placing the Aedilis/Fabrum remedies reaches Oppidum ≥ 10% sooner (median)', T, () => {
    const d = median(runs(['decision']).map((r) => r.rankDay[2] ?? Infinity));
    const b = median(runs(['builder']).map((r) => r.rankDay[2] ?? Infinity));
    expect(Number.isFinite(d), 'the decision bot never reached Oppidum').toBe(true);
    expect(b, `builder ${b} vs decision ${d}`).toBeLessThanOrEqual(d * BUILDER_GAIN);
  });

  it('neglect: all three Ordo toggles off, no input, 20 years → no crash, no NaN', T, () => {
    for (const r of runs(['neglect'])) {
      expect(r.nan, `seed ${r.seed}`).toEqual([]);
      expect(r.pops.length, `seed ${r.seed}`).toBe(NEGLECT);
    }
  });

  it('offline safety: a capped absence from each rank keeps ≥ 90% of the people, every tier and the treasury', T, () => {
    let n = 0;
    for (const r of runs(['decision'])) {
      for (const snap of r.snapshots.filter((x) => x.rank > 0)) {
        const s = deserialize(snap.json)!;
        const pop0 = s.people.length, den0 = s.res.denarii, dev0 = s.stats.devolved, floor = settingValue(s, 'treasuryFloor');
        const rep = simulateOffline(s, ABSENCE_MS);
        const at = `seed ${r.seed} rank ${snap.rank}`;
        expect(rep?.days, at).toBeGreaterThan(0);
        expect(s.people.length, `${at}: ${pop0} → ${s.people.length}`).toBeGreaterThanOrEqual(OFFLINE_POP * pop0);
        expect(s.stats.devolved, `${at}: tier drops`).toBe(dev0);
        expect(s.res.denarii, `${at}: treasury ${den0} → ${s.res.denarii}`).toBeGreaterThanOrEqual(Math.min(den0, floor) - CLAMP_EPS);
        expect(noNaN(s), at).toEqual([]);
        n++;
      }
    }
    expect(n, 'no rank was reached').toBeGreaterThan(0);
  });

  it('no deadlock: renovation and construction each progress at least once in every 120-day window while both have work', T, () => {
    for (const r of runs(['decision', 'undecided', 'follower', 'builder', 'neglect'])) {
      expect(r.stall.construction, `${r.kind} seed ${r.seed}: construction`).toBeLessThanOrEqual(DEADLOCK);
      expect(r.stall.renovation, `${r.kind} seed ${r.seed}: renovation`).toBeLessThanOrEqual(DEADLOCK);
    }
  });

  it('guardrails: the treasury is never negative, and never at 0 for > 60 consecutive days with the Ordo on', T, () => {
    for (const r of runs(['decision', 'undecided', 'follower', 'builder'])) {
      expect(r.minCoin, `${r.kind} seed ${r.seed}`).toBeGreaterThanOrEqual(-CLAMP_EPS);
      expect(r.zeroStreak, `${r.kind} seed ${r.seed}`).toBeLessThanOrEqual(ZERO_DAYS);
    }
  });

  it('guardrails: no event takes > 30% of a stock or > 5% of the people (2,000 forced events)', T, () => {
    const bases = runs(['decision']).flatMap((r) => [...r.snapshots.map((x) => x.json), JSON.stringify(r.s)]);
    let fired = 0;
    for (let k = 0; k < EVENT_TRIALS; k++) {
      const id = EVENTS[k % EVENTS.length];
      const s = deserialize(bases[Math.floor(k / EVENTS.length) % bases.length])!;
      s.rng = (s.rng + k * 7919) | 0;   // a different draw per trial
      const before = { res: { ...s.res }, pop: s.people.length, fever: s.stats.deathsBy.fever };
      const choice0 = s.choice;
      if (!forceEvent(s, id)) continue;
      fired++;
      if (s.choice && s.choice !== choice0) chooseOption(s, s.choice.defaultIndex);   // the cautious default
      const at = `event ${id} (trial ${k})`;
      for (const res of RESOURCES) {
        expect(s.res[res], `${at}: ${res} ${before.res[res]} → ${s.res[res]}`).toBeGreaterThanOrEqual((1 - B.events.CLAMP_RES) * before.res[res] - CLAMP_EPS);
      }
      if (id === 'pestilentia') for (let d = 0; d < FEVER_DAYS; d++) tick(s, newCtx());   // the sick die over the following days
      const lost = id === 'pestilentia' ? s.stats.deathsBy.fever - before.fever : before.pop - s.people.length;
      expect(lost, `${at}: ${lost} of ${before.pop} people`).toBeLessThanOrEqual(B.events.CLAMP_POP * before.pop + CLAMP_EPS);
    }
    expect(fired, 'no forced event fired').toBeGreaterThan(0);
  });

  it('guidance: remedies render for every advisory over 2 years, no rule flaps, welcome then vitals before day 10, every tab by day 4,000', T, () => {
    for (const r of runs(['decision'])) {
      const at = `seed ${r.seed}`;
      expect(r.remedyIssues, at).toEqual([]);
      expect(r.flaps, `${at}: re-raises of one rule within 60 days`).toBeLessThanOrEqual(B.advisors.FLAP_MAX);
      expect(r.tipDay.welcome, at).toBeLessThanOrEqual(1);
      expect(r.tipDay.vitals, at).toBeLessThan(10);
      for (const tab of TABS) expect(r.tabDay[tab], `${at}: tab ${tab}`).toBeLessThanOrEqual(OPENING);
    }
  });
});

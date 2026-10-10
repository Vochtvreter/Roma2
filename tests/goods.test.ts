// tests/goods.test.ts — late-game robustness of the Ordo (fix batch G): oil and wine planned like the grain for Hiems
// (DESIGN §7.6, §10.4 step 8, §10.5 row 9, §10.7 rule 2).
import { describe, expect, it } from 'vitest';
import type { GameState, SimView } from '../src/game/types';
import { view } from '../src/game/sim';
import { elapsed } from '../src/game/calendar';
import { invalidate, touchPeople } from '../src/game/memo';
import { goodsPlan } from '../src/game/ordo/goods';
import { luxuryCaravans, tradeMoves } from '../src/game/ordo/trade';
import { caravanSlots, checkDispatch } from '../src/game/trade';
import { B } from '../src/game/balance';
import { INTEGRATED, fresh } from './util';
import { play } from './autoplayer';

const T = { timeout: 600_000 };

/** An Oppidum whose six homes are insulae of 24 souls (7.2 amphorae of oil a day), with no olive grove, rich in coin. */
function insulae(): GameState {
  const s = fresh(42);
  s.rank = 2;
  s.res.denarii = 20_000;
  const homes = s.buildings.filter((b) => b.house);
  const proto = s.people[0];
  for (const b of homes) {
    b.house!.tier = 'insula';
    for (let k = s.people.filter((p) => p.home === b.id).length; k < 24; k++) {
      s.people.push({ ...structuredClone(proto), id: s.nextId++, home: b.id, work: null, spouse: null, mother: null, father: null });
    }
  }
  touchPeople(s);
  invalidate(s);
  return s;
}

/** The real view with the oil stores at `oil` (as if warehouses stood). */
function withOilCap(s: GameState, oil: number): SimView {
  const v = view(s);
  return { get d() { return v.d; }, get f() { return v.f; }, get cov() { return v.cov; }, c: { ...v.c, caps: { ...v.c.caps, oil } } };
}

describe('oil for the great houses (DESIGN §7.6, §10.7)', () => {
  it('keeps what the lean season takes from export, the player\'s caravans too', () => {
    const s = insulae();
    const v = withOilCap(s, 1000);
    const plan = goodsPlan(s, v, 'oil');
    expect(plan.demand).toBeCloseTo(6 * 24 * B.housing.GOODS.oil, 9);
    expect(plan.reserve).toBeGreaterThan(1000);           // no presses: Ver and Aestas draw more than a full store
    s.res.oil = 1000;                                     // a full store, which the old rule sold from
    expect(tradeMoves(s, v).filter((m) => m.spec.mode === 'export' && m.spec.res === 'oil')).toEqual([]);
    const chk = checkDispatch(s, { hub: 'silvanum', mode: 'export', res: 'oil', qty: 80, repeat: false }, v);
    expect(chk).toMatchObject({ ok: false, code: 'reserve' });
    expect(chk.ok ? '' : chk.reason).toMatch(/the great houses draw 8 oil a day and we keep \d+ to carry them through Ver and Aestas/);
    s.res.oil = plan.keep + 200;                          // above the lean season's need the surplus may go
    expect(tradeMoves(s, v).some((m) => m.spec.mode === 'export' && m.spec.res === 'oil')).toBe(true);
    expect(checkDispatch(s, { hub: 'silvanum', mode: 'export', res: 'oil', qty: 80, repeat: false }, v).ok).toBe(true);
  });

  it('buys the shortfall with as many standing caravans as the projection lacks, and lets them go when it is covered', () => {
    const s = insulae();
    s.res.oil = 300;
    const v = withOilCap(s, 1000);
    const bare = goodsPlan(s, v, 'oil', false);
    expect(bare.short).toBeGreaterThan(B.ordo.CARGO);
    const { need } = luxuryCaravans(s, v, 'oil');
    expect(need).toBeGreaterThan(1);                      // one caravan of 80 was the old answer to any shortfall
    const moves = tradeMoves(s, v).filter((m) => m.reason.code === 'luxuryImport');
    expect(moves.length).toBe(Math.min(need, caravanSlots(s)));
    for (const m of moves) expect(m.spec).toMatchObject({ mode: 'import', res: 'oil', qty: B.ordo.CARGO, repeat: true, hub: bare.hub?.id });
    // with the houses gone there is nothing to buy
    for (const b of s.buildings) if (b.house) b.house.tier = 'casa';
    s.day++;
    invalidate(s);
    expect(luxuryCaravans(s, withOilCap(s, 1000), 'oil').need).toBe(0);
  });
});

describe('wine for the atrium houses (DESIGN §7.6, §10.7)', () => {
  it('comes only by caravan: the Ordo keeps 60 days of the draw and sends for it before the cellar empties', () => {
    const s = insulae();
    for (const b of s.buildings) if (b.house) b.house.tier = 'domus';
    invalidate(s);
    const v = view(s);
    const plan = goodsPlan(s, v, 'wine');
    expect(plan.demand).toBeGreaterThan(0);
    expect(plan.prod).toEqual([0, 0, 0, 0]);
    expect(plan.reserve).toBeCloseTo(plan.demand * B.ordo.LUXURY_RUNWAY, 9);
    expect(plan.emptyDay).toBe(s.day + 1);              // an empty cellar
    expect(luxuryCaravans(s, v, 'wine').need).toBeGreaterThanOrEqual(1);
    expect(tradeMoves(s, v).some((m) => m.spec.mode === 'import' && m.spec.res === 'wine' && m.spec.repeat)).toBe(true);
  });
});

describe.runIf(INTEGRATED)('the Ordo late in the game (decision bot)', () => {
  it('seed 2: never sells oil the insulae need through the lean season, and no house lapses for want of oil', T, () => {
    let sold = 0, below = 0, lapsed = 0;
    const r = play(2, 'decision', {
      days: 17_500,
      onDay: (s) => {
        const v = view(s);
        for (const c of s.trade.caravans) {
          if (c.mode !== 'export' || c.res !== 'oil' || c.depart !== s.day) continue;
          sold++;
          if (s.res.oil < goodsPlan(s, v, 'oil').keep - 1e-6) below++;
        }
        if (elapsed(s) % 5 === 0) for (const b of s.buildings) if (b.house?.declining && (b.house.tier === 'insula' || b.house.tier === 'domus') && b.house.oil < B.housing.SUPPLIED) lapsed++;
      },
    });
    expect(r.victoryDay, 'the Capitolium is dedicated').not.toBeNull();
    expect(sold, 'the Ordo still sells the surplus of the presses').toBeGreaterThan(0);
    expect(below, 'oil sold below the lean-season reserve').toBe(0);
    expect(lapsed, 'insula-days declining for want of oil').toBe(0);
    expect(r.s.stats.devolved).toBe(0);
    expect(r.s.people.length, 'pop at victory').toBeGreaterThan(1000);
  });
});

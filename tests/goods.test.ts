// tests/goods.test.ts — late-game robustness of the Ordo (fix batch G): oil and wine planned like the grain for Hiems
// (DESIGN §7.6, §10.4 step 8, §10.5 row 9, §10.7 rule 2), services raised where they serve the houses that wait for them
// (§10.5 row 6, §11.6 aedilis.evolve), and the blocks the charter's works need kept free (§10.5 row 7).
import { describe, expect, it } from 'vitest';
import type { BuildingId, GameState, NeedId, SimView } from '../src/game/types';
import { view } from '../src/game/sim';
import { elapsed } from '../src/game/calendar';
import { invalidate, touchPeople } from '../src/game/memo';
import { goodsPlan } from '../src/game/ordo/goods';
import { luxuryCaravans, tradeMoves } from '../src/game/ordo/trade';
import { keptBlocks } from '../src/game/ordo/build';
import { unmetNeeds } from '../src/game/housing';
import { caravanSlots, checkDispatch } from '../src/game/trade';
import { houseWants, liftSlot, serveSlot, serviceFor } from '../src/game/advisors/util';
import { rectGap } from '../src/game/world/grid';
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

/** Rome's favour at its height (DESIGN §6.6) as a standing modifier: a colony the Ordo alone keeps then grows at the
 *  attentive player's pace (§18.4), while every work, trade and siting decision these tests watch stays the Ordo's. */
function favoured(s: GameState): void {
  if (s.modifiers.some((m) => m.id === 'test.favour')) return;
  const max = B.people.RENOWN.MAX;
  s.modifiers.push({ id: 'test.favour', label: 'favour', until: 1e9, fx: { mul: { immigration: max, births: max } }, benign: true, source: 'stage' });
}

describe.runIf(INTEGRATED)('the Ordo late in the game (decision and follower bots)', () => {
  it('seed 2: never sells oil the insulae need through the lean season, and no house lapses for want of oil', T, () => {
    let sold = 0, below = 0, lapsed = 0;
    const cause = new Map<number, NeedId[]>(), dropped: string[] = [];
    let devolved = 0;
    const r = play(2, 'decision', {
      days: 17_500,
      onDay: (s) => {
        favoured(s);
        // what each declining house first lacked: a fall for want of anything but desirability (a neighbour grown into an
        // insula lowers it: the housing rules, not the Ordo's goods) is a goods or service failure
        for (const b of s.buildings) {
          if (b.house?.declining && !cause.has(b.id)) cause.set(b.id, unmetNeeds(s, b, b.house.tier));
          else if (b.house && !b.house.declining && s.stats.devolved === devolved) cause.delete(b.id);
        }
        if (s.stats.devolved !== devolved) {
          for (const [id, needs] of cause) if (!s.buildings.find((b) => b.id === id)?.house?.declining) {
            if (needs.some((n) => n !== 'desirability')) dropped.push(`#${id} day ${elapsed(s)}: ${needs.join(', ')}`);
            cause.delete(id);
          }
          devolved = s.stats.devolved;
        }
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
    expect(dropped, 'houses fallen for want of goods or services').toEqual([]);
    expect(r.s.people.length, 'pop at victory').toBeGreaterThan(1000);
  });

  it('follower seed 2: no group of houses waits more than 180 days for a service that a free slot could bring them', T, () => {
    const NEEDS: NeedId[] = ['water', 'religion', 'market', 'temple', 'baths', 'macellum', 'desirability'];
    const streak = new Map<NeedId, number>();
    let worst = { days: 0, at: 0, need: '' };
    play(2, 'follower', {
      days: 9000,
      onDay: (s) => {
        const e = elapsed(s);
        if (e % 5 !== 0) return;
        const v = view(s);
        const by = new Map<NeedId, number[]>();
        for (const w of houseWants(s, v)) if (w.next && w.unmet.length === 1 && NEEDS.includes(w.unmet[0])) by.set(w.unmet[0], [...(by.get(w.unmet[0]) ?? []), w.id]);
        for (const need of NEEDS) {
          const ids = by.get(need) ?? [];
          let open = false;
          if (ids.length >= B.advisors.RULES.EVOLVE_HOUSES) {
            if (need === 'desirability') open = liftSlot(s, 'player', ids) !== null;
            else {
              const t = serviceFor(s, need, v.d.castellumActive) as BuildingId;
              const ts: BuildingId[] = t === 'lacus' ? ['lacus', 'puteus'] : t === 'thermae' ? ['thermae', 'balneum'] : [t];
              open = ts.some((x) => serveSlot(s, x, 'player', need, ids) !== null);
            }
          }
          const n = open ? (streak.get(need) ?? 0) + 5 : 0;
          streak.set(need, n);
          if (n > worst.days) worst = { days: n, at: e, need };
        }
      },
    });
    expect(worst.days, `${worst.need} on day ${worst.at}`).toBeLessThanOrEqual(180);
  });

  it('seed 3: the castellum goes where a free block for the thermae lies in its reach; the Ordo keeps it and raises the thermae there', T, () => {
    let atCastellum: number | null = null, kept = false, other = false;
    const r = play(3, 'decision', {
      days: 17_500,
      stop: (s) => s.buildings.some((b) => b.type === 'thermae'),
      onDay: (s) => {
        favoured(s);
        const cas = s.buildings.find((b) => b.type === 'castellum');
        if (!cas) return;
        const k = keptBlocks(s).find((x) => x.for === 'thermae');
        if (atCastellum === null) {
          atCastellum = elapsed(s);
          kept = k !== undefined && rectGap(k.rect, { x: cas.x, y: cas.y, w: 2, h: 2 }) <= B.map.CASTELLUM_REACH;
        }
        // nothing but the thermae is raised in its block meanwhile
        if (k) for (const b of s.buildings) if (b.type !== 'thermae' && b.x >= k.rect.x && b.x < k.rect.x + 4 && b.y >= k.rect.y && b.y < k.rect.y + 4) other = true;
      },
    });
    expect(atCastellum, 'a castellum is placed').not.toBeNull();
    expect(kept, 'a free block lies within its reach and is kept').toBe(true);
    expect(other).toBe(false);
    expect(r.s.buildings.some((b) => b.type === 'thermae'), 'the thermae is raised').toBe(true);
  });
});

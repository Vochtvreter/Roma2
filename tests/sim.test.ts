// tests/sim.test.ts — WP-B: opening arithmetic, rationing, hunger/thirst, storage, morale, taxes, immigration, forecast
// (ARCHITECTURE §14.2 WP-B, DESIGN §18.2). Site multipliers are pinned per building through a module mock so the
// opening numbers can be checked without WP-A's site formulas.
import { describe, expect, it, vi } from 'vitest';
import { BUILDER } from '../src/game/types';
import type { Building, GameState, Person } from '../src/game/types';
import { Rng } from '../src/game/rng';
import { census, canWork } from '../src/game/census';
import { buildingRate, consume, issueTools, lastRations, maxPotential, produce, storage, workerOutput } from '../src/game/economy';
import { assignJobs, immigrationDay, peopleDay, personName } from '../src/game/people';
import { constructionDay, startStaked } from '../src/game/construction';
import { dignitas, kalendsDay, moraleDay, moraleTarget, taxesDay } from '../src/game/civic';
import { forecast } from '../src/game/forecast';
import { newCtx, tick, view } from '../src/game/sim';
import { invalidate, touchPeople } from '../src/game/memo';
import { dateOf, dayOf } from '../src/game/calendar';
import { B } from '../src/game/balance';
import { ctx, fresh, noNaN, place, run } from './util';

const pins = vi.hoisted(() => new Map<number, number>());
vi.mock('../src/game/site', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/game/site')>();
  return { ...real, siteMult: (s: GameState, b: Building) => pins.get(b.id) ?? real.siteMult(s, b) };
});

const VER = 0, AESTAS = 1, HIEMS = 3;
const near = (v: number, want: number, tol = 0.03): void => expect(Math.abs(v - want) / want).toBeLessThanOrEqual(tol);
const first = (s: GameState, type: Building['type']): Building => s.buildings.find((b) => b.type === type) as Building;
const plan = (perBuilding: Record<number, number>, builders = 0) => ({ perBuilding, builders, lines: [] });
const able = (s: GameState): Person[] => s.people.filter((p) => canWork(s, p));
/** One more adult in every start tent: 30 souls in 30 beds (no arrivals, no births). */
function fillBeds(s: GameState): void {
  const houses = s.buildings.filter((b) => b.house);
  houses.forEach((h, k) => s.people.push({ ...s.people[2], id: 10_000 + k, spouse: null, work: null, home: h.id, skills: {} }));
  s.nextId = 20_000;
  touchPeople(s);
}

describe('opening arithmetic (DESIGN §18.2)', () => {
  it('needs 20.35 grain and water a day', () => {
    const s = fresh();
    near(census(s).need.grain, 20.35, 0.001);
    near(census(s).need.water, 20.35, 0.001);
    expect(census(s).workforce).toBe(13);
  });

  it('two aqua-1 well workers draw 23.9 water in Ver and 19.1 in Aestas', () => {
    const s = fresh();
    const well = first(s, 'puteus');
    assignJobs(s, plan({ [well.id]: 2 }));
    expect(able(s).filter((p) => p.work === well.id).every((p) => p.skills.aqua === 1)).toBe(true);
    near(buildingRate(s, well, VER, 'current').water ?? 0, 23.9);
    near(buildingRate(s, well, AESTAS, 'current').water ?? 0, 19.1);
    const c = ctx();
    produce(s, c, new Rng(1));
    near(c.rates.prod.water.puteus ?? 0, 23.9);
  });

  it('a 1.4 field gives ≈ 8.8 grain per worker, three hands ≈ 27 a day', () => {
    const s = fresh();
    const ager = first(s, 'ager');
    pins.set(ager.id, 1.4);
    try {
      assignJobs(s, plan({ [ager.id]: 3 }));
      const hands = able(s).filter((p) => p.work === ager.id);
      const marcus = hands.find((p) => p.prae === 'Marcus') as Person;
      const novice = hands.find((p) => (p.skills.agri ?? 0) === 0) as Person;
      near(workerOutput(s, ager, novice, VER), 8.8);
      near(workerOutput(s, ager, marcus, VER), 8.8 * 1.08);
      near(buildingRate(s, ager, VER, 'current').grain ?? 0, 27);
      near(buildingRate(s, ager, HIEMS, 'current').grain ?? 0, 27 * 0.35);
    } finally {
      pins.delete(ager.id);
    }
  });

  it('caps the per-worker multiplier at ×2.5', () => {
    const s = fresh();
    const ager = first(s, 'ager');
    pins.set(ager.id, 10);
    try {
      assignJobs(s, plan({ [ager.id]: 1 }));
      const p = able(s).find((x) => x.work === ager.id) as Person;
      expect(workerOutput(s, ager, p, VER)).toBeCloseTo(6 * B.economy.MULT_CAP, 6);
    } finally {
      pins.delete(ager.id);
    }
  });

  it('a cistern catches 9.6 water in Ver and 2.4 in Aestas', () => {
    const s = fresh();
    expect(place(s, 'cisterna', 37, 29, { ignoreCost: true }).ok).toBe(true);
    const cis = first(s, 'cisterna');
    cis.status = 'done';
    near(buildingRate(s, cis, VER, 'full').water ?? 0, 9.6, 0.001);
    near(buildingRate(s, cis, AESTAS, 'full').water ?? 0, 2.4, 0.001);
  });

  it('two builders and three idle hands (≈ 3 work/day) finish a staked cistern ≈ 13 days after its stake', () => {
    const finish = (kits: number): number => {
      const s = fresh();
      s.res.tools = kits;
      expect(place(s, 'cisterna', 37, 29, { owner: 'ordo' }).ok).toBe(true);
      const cis = first(s, 'cisterna');
      expect(cis.status).toBe('staked');
      const well = first(s, 'puteus'), ager = first(s, 'ager');
      assignJobs(s, plan({ [well.id]: 2, [ager.id]: 6 }, 2));
      expect(census(s).idle.length).toBe(3);
      expect(able(s).filter((p) => p.work === BUILDER).some((p) => p.prae === 'Decimus')).toBe(true);
      for (let d = 0; d < 30 && cis.status !== 'done'; d++) {
        s.day++;
        const c = ctx();
        startStaked(s);
        issueTools(s, c);
        constructionDay(s, c);
      }
      expect(cis.status).toBe('done');
      return (cis.doneDay ?? 0) - cis.placed;
    };
    expect(finish(0)).toBe(13);
    expect(finish(4)).toBeLessThan(13);   // the first tool kit goes to the site (+20%)
  });
});

describe('rationing and hunger (DESIGN §8.4–8.5)', () => {
  function withElder(): GameState {
    const s = fresh();
    s.people[0].born = s.day - 60 * B.time.YEAR_DAYS - 10;   // Marcus Valerius becomes an elder
    touchPeople(s);
    return s;
  }

  it('feeds children first, then youths and adults, then elders', () => {
    const s = withElder();
    const g = census(s).groupNeed.grain;
    s.res.grain = g[0] + 0.5 * (g[1] + g[2]);
    consume(s, ctx());
    const r = lastRations(s).grain;
    expect(r[0]).toBe(1);
    expect(r[1]).toBeCloseTo(0.5, 9);
    expect(r[2]).toBeCloseTo(0.5, 9);
    expect(r[3]).toBe(0);
    expect(s.res.grain).toBeCloseTo(0, 9);
  });

  it('moves hunger and thirst by the DESIGN bands', () => {
    const s = fresh();
    s.needs.hunger = [50, 50, 50, 50];
    s.needs.thirst = [50, 50, 50, 50];
    const need = census(s).need;
    s.res.grain = need.grain * 2;
    s.res.water = need.water * 0.9;
    consume(s, ctx());
    expect(s.needs.hunger).toEqual([45, 45, 45, 45]);
    expect(s.needs.thirst[0]).toBe(44);                       // children drink first and in full
    expect(lastRations(s).water[2]).toBeGreaterThanOrEqual(0.8);
    expect(s.needs.thirst[2]).toBe(48);                       // 0.8 ≤ r < 1 → −2
    s.res.grain = 0;
    s.res.water = 0;
    consume(s, ctx());
    expect(s.needs.hunger[2]).toBe(50);
    expect(s.needs.thirst[2]).toBe(55);
  });

  it('holds at 0.6–0.8 rations (Arctae is survivable)', () => {
    const s = fresh();
    s.needs.hunger = [30, 30, 30, 30];
    const g = census(s).groupNeed.grain;
    s.res.grain = g[0] + 0.7 * (g[1] + g[2]);
    consume(s, ctx());
    expect(s.needs.hunger[2]).toBe(30);
  });

  it('kills from hunger or thirst only past the Starving / Dehydrated band, ×0.4 offline', () => {
    const count = (level: number, offline: boolean, need: 'hunger' | 'thirst'): number => {
      let n = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const s = fresh();
        const rng = new Rng(seed);
        for (let d = 0; d < 40; d++) {
          s.needs[need] = [level, level, level, level];
          s.day++;
          peopleDay(s, newCtx(offline), rng);
        }
        n += s.stats.deathsBy[need];
      }
      return n;
    };
    expect(count(75, false, 'hunger')).toBe(0);
    expect(count(75, false, 'thirst')).toBe(0);
    const online = count(80, false, 'hunger');
    const offline = count(80, true, 'hunger');
    expect(online).toBeGreaterThan(30);
    expect(offline).toBeLessThan(online * 0.65);
    expect(count(80, false, 'thirst')).toBeGreaterThan(30);
  });

  it('logs a Watch line when a group turns hungry', () => {
    const s = fresh();
    s.needs.hunger = [49, 49, 49, 49];
    s.res.grain = 0;
    consume(s, ctx());
    expect(s.log.some((e) => e.text.startsWith('Watch: the adults are hungry'))).toBe(true);
  });
});

describe('storage (DESIGN §8.6)', () => {
  it('spills above caps, rots shed grain ×2 in Aestas, evaporates water in Aestas', () => {
    const s = fresh();
    s.res.grain = 700;
    s.res.water = 200;
    const c = ctx();
    storage(s, c);
    expect(c.rates.cons.grain.spill).toBeCloseTo(100, 9);
    expect(c.rates.cons.grain.rot).toBeCloseTo(600 * 0.003, 9);
    expect(c.rates.cons.water.evaporation ?? 0).toBe(0);
    s.day = dayOf(dateOf(s.day).year, 7, 1);
    s.res.grain = 500;
    const c2 = ctx();
    storage(s, c2);
    expect(c2.rates.cons.grain.rot).toBeCloseTo(500 * 0.006, 9);
    expect(c2.rates.cons.water.evaporation).toBeCloseTo(200 * 0.002, 9);
  });
});

describe('morale, taxes and dignitas (DESIGN §8.8–8.11)', () => {
  it('moves morale 5% of the way to its target', () => {
    const s = fresh();
    const v = view(s);
    const t = moraleTarget(s, v);
    expect(t.terms.find((x) => x.label === 'Base')?.value).toBe(50);
    expect(t.terms.find((x) => x.label === 'Grain in store')?.value).toBe(2);   // 23.6 days on hand
    const before = s.morale;
    moraleDay(s, v);
    expect(s.morale).toBeCloseTo(before + 0.05 * (t.value - before), 9);
    s.decisions.edicts.rationes = 'parcae';
    expect(moraleTarget(s, view(s)).terms.find((x) => x.label.startsWith('Rations'))?.value).toBe(-6);
  });

  it('accrues taxes daily and pays them on the Kalends, the relief debt first', () => {
    const s = fresh();
    const den = s.res.denarii;
    for (let i = 0; i < 10; i++) taxesDay(s, ctx());
    const accrued = s.taxAccrued;
    near(accrued, 10 * 24 * 0.02, 0.001);
    expect(s.res.denarii).toBeCloseTo(den + 10 * 3, 9);   // the stipendium is paid daily
    s.trade.debt = 1;
    const c = ctx();
    kalendsDay(s, c);
    expect(s.taxAccrued).toBe(0);
    expect(s.trade.debt).toBeCloseTo(0, 9);
    expect(s.res.denarii).toBeCloseTo(den + 30 + accrued - 1, 9);
    expect(c.fx.some((f) => f.kind === 'taxes')).toBe(true);
    expect(s.log[s.log.length - 1].kind).toBe('ledger');
  });

  it('pays the accrued taxes through the tick on every Kalends', () => {
    const s = fresh();
    run(s, 40, (st) => {
      if (dateOf(st.day).day === 1) expect(st.taxAccrued).toBe(0);
    });
    expect(s.stats.denariiTaxed).toBeGreaterThan(0);
  });

  it('rates the founding colony at about 5 dignitas', () => {
    expect(dignitas(fresh()).value).toBeCloseTo(5, 6);
  });
});

describe('people (DESIGN §6)', () => {
  it('names sons with ordinals and daughters by birth order', () => {
    const s = fresh();
    expect(personName(s.people[0])).toBe('Marcus Valerius');
    const valeria = s.people.find((p) => p.female && p.gens === 'Valerius' && p.mother !== null) as Person;
    expect(personName(valeria)).toBe('Valeria');
    expect(personName({ ...s.people[0], ord: 2 })).toBe('Marcus II Valerius');
  });

  it('keeps jobs sticky and fills slots with the best skill first', () => {
    const s = fresh();
    const well = first(s, 'puteus'), ager = first(s, 'ager');
    assignJobs(s, plan({ [well.id]: 2, [ager.id]: 1 }, 1));
    const atWell = s.people.filter((p) => p.work === well.id).map((p) => p.id);
    expect(s.people.find((p) => p.work === ager.id)?.prae).toBe('Marcus');
    expect(s.people.find((p) => p.work === BUILDER)?.prae).toBe('Decimus');
    assignJobs(s, plan({ [well.id]: 2, [ager.id]: 1 }, 1));
    expect(s.people.filter((p) => p.work === well.id).map((p) => p.id)).toEqual(atWell);
    assignJobs(s, plan({ [well.id]: 1 }, 0));
    expect(s.people.filter((p) => p.work === well.id).length).toBe(1);
    expect(s.people.filter((p) => p.work === ager.id || p.work === BUILDER).length).toBe(0);
  });

  it('immigration respects Rome\'s roll and the beds', () => {
    // no free beds: nobody arrives, the block is recorded
    const s = fresh();
    s.morale = 100;
    fillBeds(s);
    expect(census(s).freeBeds).toBe(0);
    for (let d = 0; d < 400; d++) { s.day++; immigrationDay(s, ctx(), new Rng(d + 1)); }
    expect(s.stats.immigrants).toBe(0);
    expect(s.counters.lastArrivalBlocked).toBeGreaterThan(B.time.START_DAY);

    // beds aplenty but the roll is full
    const t = fresh();
    t.morale = 100;
    for (const b of t.buildings) if (b.house) b.house.tier = 'insula';
    const roll = census(t).roll;
    const extra = Array.from({ length: roll - t.people.length }, (_, k) => ({ ...t.people[2], id: 10_000 + k, spouse: null, home: null }));
    t.people.push(...extra);
    t.nextId = 20_000;
    touchPeople(t);
    for (let d = 0; d < 400; d++) { t.day++; immigrationDay(t, ctx(), new Rng(d + 1)); }
    expect(t.people.length).toBe(roll);

    // beds and room on the roll: households arrive, never past it, each housed
    const u = fresh();
    u.morale = 100;
    for (const b of u.buildings) if (b.house) b.house.tier = 'insula';
    touchPeople(u);
    for (let d = 0; d < 1500; d++) { u.day++; immigrationDay(u, ctx(), new Rng(d + 7)); }
    expect(u.stats.immigrants).toBeGreaterThan(0);
    expect(u.people.length).toBeLessThanOrEqual(census(u).roll);
    expect(u.people.every((p) => p.home !== null)).toBe(true);
    const ids = u.people.map((p) => p.id);
    expect(ids.every((v, i) => i === 0 || ids[i - 1] < v)).toBe(true);
  });

  it('marries, bears children and buries over the years without NaN', () => {
    const s = fresh();
    for (const b of s.buildings) if (b.house) b.house.tier = 'insula';
    touchPeople(s);
    const rng = new Rng(5);
    for (let d = 0; d < 3000; d++) { s.day++; peopleDay(s, newCtx(), rng); }
    expect(s.stats.births).toBeGreaterThan(0);
    expect(s.stats.deaths).toBeGreaterThan(0);
    expect(noNaN(s)).toEqual([]);
    for (const p of s.people) if (p.spouse !== null) expect(s.people.find((q) => q.id === p.spouse)?.spouse).toBe(p.id);
    for (const f of s.families) expect(s.people.some((p) => p.family === f.id)).toBe(true);
  });
});

describe('forecast (DESIGN §11.11)', () => {
  it('shows 12 month cells from the current month', () => {
    const f = forecast(fresh());
    expect(f.grain.months.length).toBe(12);
    expect(f.grain.months[0].month).toBe(4);
    expect(f.water.crunch?.season).toBe(1);
    expect(f.grain.crunch?.season).toBe(3);
    expect(f.water.crunch?.startsIn).toBe(61);
  });

  it('flags the opening Aestas water crunch (lowest under ~10 days on hand)', () => {
    const f = forecast(fresh());
    expect(f.water.crunch?.lowestDoh ?? 99).toBeLessThan(B.advisors.RULES.AESTAS_M);
    expect(f.water.crunch?.lowestDoh ?? 0).toBeGreaterThan(3);
  });

  it('matches a brute-force 365-tick projection within 10% (fixed staffing, toy map)', () => {
    const s = fresh();
    // freeze the colony: manual labour, no building or trade, every bed taken (no arrivals, no births);
    // a horreum and a cistern keep both stocks off their floors and caps so the comparison means something
    s.ordo.on = { labour: false, build: false, trade: false };
    s.ordo.manual.water = 2;
    s.ordo.manual.food = 5;
    fillBeds(s);
    expect(place(s, 'cisterna', 37, 29, { ignoreCost: true }).ok).toBe(true);
    expect(place(s, 'horreum', 42, 29, { ignoreCost: true }).ok).toBe(true);
    for (const b of s.buildings) if (b.status !== 'done') { b.status = 'done'; b.progress = 1; }
    invalidate(s);
    s.res.grain = 1500;
    s.res.water = 400;
    run(s, 1);
    const f = forecast(s);
    const ends = f.grain.months.map((m) => dayOf(m.month === 12 ? m.year + 1 : m.year, m.month === 12 ? 1 : m.month + 1, 1) - 1);
    const actual: { grain: number; water: number }[] = [];
    run(s, ends[11] - s.day, (st) => {
      if (ends.includes(st.day)) actual.push({ grain: st.res.grain, water: st.res.water });
    });
    expect(actual.length).toBe(12);
    for (let i = 0; i < 12; i++) {
      const g = f.grain.months[i].endStock, w = f.water.months[i].endStock;
      expect(g).toBeGreaterThan(0.05 * f.grain.cap);
      expect(Math.abs(g - actual[i].grain)).toBeLessThanOrEqual(0.1 * actual[i].grain);
      expect(Math.abs(w - actual[i].water)).toBeLessThanOrEqual(0.1 * Math.max(actual[i].water, 0.1 * f.water.cap));
    }
  });
});

describe('the tick', () => {
  it('runs 2,000 days deterministically without NaN', () => {
    const a = run(fresh(9), 2000);
    expect(noNaN(a)).toEqual([]);
    const b = run(fresh(9), 2000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('save → load → continue equals the uninterrupted run', () => {
    const a = run(fresh(11), 400);
    const b = structuredClone(run(fresh(11), 200));
    run(b, 200);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('keeps maxPotential at least the current grain output', () => {
    const s = run(fresh(), 5);
    const ager = first(s, 'ager');
    expect(maxPotential(s, 'grain', VER)).toBeGreaterThanOrEqual((buildingRate(s, ager, VER, 'current').grain ?? 0) - 1e-9);
  });

  it('runs one tick in place with a fresh context', () => {
    const s = fresh();
    const c = newCtx();
    tick(s, c);
    expect(s.day).toBe(B.time.START_DAY + 1);
    expect((c.rates.cons.grain.eating ?? 0) + (c.rates.cons.water.drinking ?? 0)).toBeGreaterThan(0);
  });
});

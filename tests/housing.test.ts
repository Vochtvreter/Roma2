// tests/housing.test.ts — WP-B: evolution, renovation, the fork, decline, drop, the offline stop, goods, taxes
// (ARCHITECTURE §14.2 WP-B, DESIGN §7). Coverage and desirability come from WP-A; here they are pinned per house
// through a module mock (houses without a pin fall through to the real functions).
import { describe, expect, it, vi } from 'vitest';
import type { Building, CoverageLayerId, GameState, HouseTierId } from '../src/game/types';
import { census, houseBeds, residents } from '../src/game/census';
import {
  firstWant, goodsDay, houseTax, housesUnlockedBy, housingDay, nextTier, setHousePref, targetTier, unmetNeeds,
} from '../src/game/housing';
import { invalidate, touchPeople } from '../src/game/memo';
import { log } from '../src/game/state';
import { aTier } from '../src/game/data/housing';
import { B } from '../src/game/balance';
import { ctx, fresh } from './util';

const pin = vi.hoisted(() => ({
  layers: new Map<number, Set<string>>(),
  desir: new Map<number, number>(),
  preview: [] as { layer: string; houses: number[] }[],
}));
vi.mock('../src/game/coverage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/game/coverage')>();
  return {
    ...real,
    houseHas: (s: GameState, id: number, layer: CoverageLayerId) => (pin.layers.has(id) ? pin.layers.get(id)!.has(layer) : real.houseHas(s, id, layer)),
    houseDesir: (s: GameState, id: number) => pin.desir.get(id) ?? real.houseDesir(s, id),
    previewCoverage: (s: GameState, type: Parameters<typeof real.previewCoverage>[1], x: number, y: number) =>
      pin.preview.length > 0 ? pin.preview.map((p) => ({ ...p, tiles: new Uint8Array(0) })) : real.previewCoverage(s, type, x, y),
  };
});

const H = B.housing;
const ALL: CoverageLayerId[] = ['water', 'fountain', 'shrine', 'temple', 'market', 'macellum', 'baths', 'culture'];

function setup(): { s: GameState; houses: Building[] } {
  pin.layers.clear();
  pin.desir.clear();
  pin.preview = [];
  const s = fresh();
  s.fed = 1;
  s.res.timber = 200;
  s.res.stone = 200;
  s.res.tiles = 200;
  s.res.concrete = 200;
  s.res.iron = 200;
  return { s, houses: s.buildings.filter((b) => b.house) };
}

function cover(b: Building, layers: CoverageLayerId[], desir = 0): void {
  pin.layers.set(b.id, new Set(layers));
  pin.desir.set(b.id, desir);
}

function setTier(s: GameState, b: Building, tier: HouseTierId): void {
  b.house!.tier = tier;
  invalidate(s);
}

/** Runs the housing step for `days` days; returns the days on which a renovation started. */
function days(s: GameState, n: number, offline = false): number[] {
  const starts: number[] = [];
  for (let d = 0; d < n; d++) {
    s.day++;
    const before = s.buildings.filter((b) => b.house?.renovating).length;
    housingDay(s, ctx(offline));
    if (s.buildings.filter((b) => b.house?.renovating).length > before) starts.push(s.day);
  }
  return starts;
}

describe('evolution (DESIGN §7.2)', () => {
  it('needs 15 OK days, then renovates for 8 days with the next tier\'s materials', () => {
    const { s, houses } = setup();
    const h = houses[0];
    cover(h, ['water']);
    for (const o of houses.slice(1)) cover(o, []);
    expect(nextTier(s, h)).toBe('casa');
    expect(unmetNeeds(s, h, 'casa')).toEqual([]);
    const timber = s.res.timber;
    const starts = days(s, 40);
    expect(starts.length).toBe(1);
    const firstCheck = Array.from({ length: 5 }, (_, k) => B.time.START_DAY + 1 + k).find((d) => (h.id + d) % H.CHECK_EVERY === 0)!;
    expect(starts[0]).toBe(firstCheck + 2 * H.CHECK_EVERY);   // the third OK check reaches 15 days
    expect(s.res.timber).toBe(timber - 8);
    expect(h.house!.tier).toBe('casa');
    expect(s.stats.evolved).toBe(1);
    expect(s.stats.evolvedBy.casa).toBe(1);
    expect(houseBeds(s, h)).toBe(8);
  });

  it('waits for renovation materials and wants them', () => {
    const { s, houses } = setup();
    const h = houses[0];
    cover(h, ['water']);
    for (const o of houses.slice(1)) cover(o, []);
    s.res.timber = 5;
    expect(firstWant(s, h)).toBe('materials');
    days(s, 40);
    expect(h.house!.tier).toBe('tentoria');
    expect(h.house!.okDays).toBeGreaterThanOrEqual(H.OK_DAYS);
    s.res.timber = 50;
    expect(firstWant(s, h)).toBe(null);
    days(s, 15);
    expect(h.house!.tier).toBe('casa');
  });

  it('only lets 1 + houses/8 renovations start in each 10-day window', () => {
    const { s, houses } = setup();
    for (const h of houses) cover(h, ['water']);
    const starts = days(s, 60);
    for (const d of starts) expect(starts.filter((x) => Math.floor((x - B.time.START_DAY) / 10) === Math.floor((d - B.time.START_DAY) / 10)).length).toBeLessThanOrEqual(1);
    expect(starts.length).toBeGreaterThanOrEqual(3);
  });

  it('wants the first unmet need of the next tier', () => {
    const { s, houses } = setup();
    const h = houses[0];
    cover(h, []);
    expect(firstWant(s, h)).toBe('water');
    cover(h, ['water']);
    s.fed = 0.5;
    expect(firstWant(s, h)).toBe('fed');
    setTier(s, h, 'casa');
    s.fed = 1;
    expect(firstWant(s, h)).toBe('religion');
    cover(h, ['water', 'shrine', 'market']);
    expect(firstWant(s, h)).toBe('rank');
  });

  it('shows a service only once the rank can build it, else the charter (R03, DESIGN §7.7)', () => {
    const { s, houses } = setup();
    const h = houses[0];
    setTier(s, h, 'casa');
    cover(h, ['water', 'shrine']);                      // fed, a shrine, water; no market (a taberna is a Vicus work)
    expect(s.rank).toBe(0);
    expect(unmetNeeds(s, h, 'tegulata')).toEqual(['market', 'rank']);   // the Ordo's order is kept
    expect(firstWant(s, h)).toBe('rank');
    s.rank = 1;
    expect(firstWant(s, h)).toBe('market');
    s.rank = 0;
    cover(h, ['water']);                                // missing religion and the market: the shrine comes first
    expect(firstWant(s, h)).toBe('religion');
    setTier(s, h, 'tegulata');
    s.rank = 1;
    cover(h, ['water', 'shrine', 'market']);            // a templum is an Oppidum work
    expect(unmetNeeds(s, h, 'domusParva')[0]).toBe('temple');
    expect(firstWant(s, h)).toBe('rank');
  });

  it('reports the houses a service would let evolve', () => {
    const { s, houses } = setup();
    for (const h of houses) setTier(s, h, 'casa');
    s.rank = 1;
    cover(houses[0], ['water', 'market']);
    cover(houses[1], ['market']);                       // its first want is water, not a shrine
    cover(houses[2], ['water']);                        // a shrine is its first want, even with the market missing
    pin.preview = [{ layer: 'shrine', houses: [houses[0].id, houses[1].id, houses[2].id] }];
    expect(housesUnlockedBy(s, 'lararium', 37, 29)).toEqual([houses[0].id, houses[2].id].sort((a, c) => a - c));
  });
});

describe('house names in running text (R48)', () => {
  it('"tents" take no article and a plural verb; the other tiers a or an', () => {
    expect(aTier('tentoria')).toBe('tents');
    expect(aTier('casa')).toBe('a wattle-and-thatch hut');
    expect(aTier('insula')).toBe('an apartment block');
    expect(aTier('domus')).toBe('an atrium house');
    const { s, houses } = setup();
    const h = houses[0];
    cover(h, ['water']);
    for (const o of houses.slice(1)) cover(o, []);
    days(s, 40);
    expect(h.house!.tier).toBe('casa');
    const line = s.log.find((e) => e.ref === h.id && e.text.includes('wattle-and-thatch'))!.text;
    expect(line).toMatch(/^The tents of the gens \w+ become a wattle-and-thatch hut\.$/);
  });

  it('the founding line carries no date of its own; no sentence ends on a doubled full stop', () => {
    const s = fresh();
    expect(s.log[0].text).toMatch(/^24 souls of \d+ families pitch their tents at /);
    log(s, 'info', 'Settled until Kal. Sept..');
    expect(s.log.at(-1)!.text).toBe('Settled until Kal. Sept.');
    log(s, 'info', 'Due pridie Kal. Aug.. The rest waits...');
    expect(s.log.at(-1)!.text).toBe('Due pridie Kal. Aug. The rest waits...');
  });
});

describe('the fork (DESIGN §7.1)', () => {
  it('chooses insula or domus by preference and desirability', () => {
    const { s, houses } = setup();
    const h = houses[0];
    setTier(s, h, 'domusParva');
    cover(h, [], 12);
    expect(nextTier(s, h)).toBe('domus');
    cover(h, [], 5);
    expect(nextTier(s, h)).toBe('insula');
    expect(setHousePref(s, h.id, 'domus').ok).toBe(true);
    expect(nextTier(s, h)).toBe('domus');
    expect(unmetNeeds(s, h, 'domus')).toContain('desirability');
    setHousePref(s, h.id, 'insula');
    cover(h, [], 12);
    expect(nextTier(s, h)).toBe('insula');
  });

  it('converts a finished T4 house to the other branch when its preference changes', () => {
    const { s, houses } = setup();
    const h = houses[0];
    for (const o of houses.slice(1)) cover(o, []);
    s.rank = 2;
    setTier(s, h, 'insula');
    cover(h, ALL, 12);
    h.house!.oil = 1;
    h.house!.wine = 1;
    expect(targetTier(s, h)).toBe(null);
    setHousePref(s, h.id, 'domus');
    expect(targetTier(s, h)).toBe('domus');
    days(s, 5 + H.CONVERT_DAYS + 1);
    expect(h.house!.tier).toBe('domus');
    expect(s.stats.evolved).toBe(0);                 // a conversion is not an evolution
    expect(residents(s, h.id).length).toBeLessThanOrEqual(houseBeds(s, h));
  });
});

describe('decline and devolution (DESIGN §7.3)', () => {
  function declining(): { s: GameState; h: Building } {
    const { s, houses } = setup();
    for (const o of houses) cover(o, []);
    s.rank = 1;
    const h = houses[0];
    setTier(s, h, 'tegulata');
    cover(h, ['water', 'market']);                    // the shrine has lapsed
    return { s, h };
  }

  it('declines after 20 days of failed needs, then drops one tier 60 days later', () => {
    const { s, h } = declining();
    let failedOn = 0, declinedOn = 0, droppedOn = 0;
    for (let d = 0; d < 120 && !droppedOn; d++) {
      days(s, 1);
      if (!failedOn && h.house!.badDays > 0) failedOn = s.day;
      if (!declinedOn && h.house!.declining) declinedOn = s.day;
      if (h.house!.tier === 'casa') droppedOn = s.day;
    }
    expect(failedOn).toBeGreaterThan(0);
    expect(declinedOn - failedOn).toBe(H.DECLINE_AFTER - H.CHECK_EVERY);   // the 4th failed check: 20 days counted
    expect(droppedOn - declinedOn).toBe(H.DROP_AFTER);
    expect(s.stats.devolved).toBe(1);
    expect(h.house!.declining).toBe(false);
  });

  it('halves the tax while declining and counts it in the census', () => {
    const { s, h } = declining();
    const full = houseTax(s, h);
    days(s, 25);
    expect(h.house!.declining).toBe(true);
    expect(houseTax(s, h)).toBeCloseTo(full * H.DECLINE_TAX, 9);
    expect(census(s).declining).toBe(1);
  });

  it('never drops while offline: the counter stops at 55, the loss waits for the return', () => {
    const { s, h } = declining();
    days(s, 30);
    expect(h.house!.declining).toBe(true);
    days(s, 400, true);
    expect(h.house!.tier).toBe('tegulata');
    expect(h.house!.declineDays).toBe(H.OFFLINE_DECLINE_STOP);
    days(s, 5);
    expect(h.house!.tier).toBe('casa');
  });

  it('recovers after its needs hold for 10 days', () => {
    const { s, h } = declining();
    days(s, 30);
    expect(h.house!.declining).toBe(true);
    cover(h, ['water', 'market', 'shrine']);
    days(s, 11);
    expect(h.house!.declining).toBe(false);
    expect(h.house!.tier).toBe('tegulata');
  });

  it('never drops below a casa', () => {
    const { s, houses } = setup();
    const h = houses[0];
    for (const o of houses) cover(o, []);
    setTier(s, h, 'casa');
    days(s, 200);
    expect(h.house!.declining).toBe(true);
    expect(h.house!.tier).toBe('casa');
  });

  it('turns residents above the new beds out (they become homeless)', () => {
    const { s, h } = declining();
    const extra = Array.from({ length: 6 }, (_, k) => ({ ...s.people[2], id: 10_000 + k, spouse: null, home: h.id, work: null }));
    s.people.push(...extra);
    s.nextId = 20_000;
    touchPeople(s);
    expect(residents(s, h.id).length).toBe(10);
    days(s, 90);
    expect(h.house!.tier).toBe('casa');
    expect(residents(s, h.id).length).toBe(8);
    expect(s.people.filter((p) => p.home === null).length).toBe(2);
  });
});

describe('goods and taxes (DESIGN §7.6, §8.8)', () => {
  it('delivers oil and wine inside macellum coverage, domus first, and keeps a supply EMA', () => {
    const { s, houses } = setup();
    const [a, b, c] = houses;
    setTier(s, a, 'insula');
    setTier(s, b, 'domus');
    setTier(s, c, 'insula');
    cover(a, ['macellum']);
    cover(b, ['macellum']);
    cover(c, []);
    for (const o of houses.slice(3)) cover(o, []);
    s.res.oil = 100;
    s.res.wine = 100;
    for (let d = 0; d < 60; d++) goodsDay(s, ctx());
    expect(a.house!.oil).toBeGreaterThan(H.SUPPLIED);
    expect(b.house!.oil).toBeGreaterThan(H.SUPPLIED);
    expect(b.house!.wine).toBeGreaterThan(H.SUPPLIED);
    expect(a.house!.wine).toBe(0);
    expect(c.house!.oil).toBe(0);
    // scarce oil: the domus is served before the insula
    a.house!.oil = 0.5;
    b.house!.oil = 0.5;
    s.res.oil = residents(s, b.id).length * H.GOODS.oil;
    goodsDay(s, ctx());
    expect(b.house!.oil).toBeGreaterThan(a.house!.oil);
  });

  it('applies the aquae variant: insula beds +6, domus tax ×1.3', () => {
    const { s, houses } = setup();
    const [a, b] = houses;
    setTier(s, a, 'insula');
    setTier(s, b, 'domus');
    cover(a, []);
    cover(b, []);
    const beds = houseBeds(s, a), tax = houseTax(s, b);
    cover(a, ['fountain']);
    cover(b, ['fountain']);
    expect(houseBeds(s, a)).toBe(beds + H.AQUAE_BEDS);
    expect(houseTax(s, b)).toBeCloseTo(tax * H.AQUAE_TAX, 9);
  });
});

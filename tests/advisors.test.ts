// tests/advisors.test.ts — the 24 rule fixtures (raise at each severity, then clear), hysteresis, flapping, ordering,
// hush/mute, appointment, and remedies that never throw (ARCHITECTURE §14.2 WP-E, §15). Owner: WP-E.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVISORS, BUILDINGS, EDICTS, HUBS, LABOR_CATS, ORDO_AREAS, OVERLAYS, RULES, SETTINGS, TABS, TRADE_RES } from '../src/game/types';
import type { CapitoliumFlow } from '../src/game/construction';
import type { Building, BuildingId, Census, CoverageLayerId, EssentialForecast, Forecast, GameState, HouseTierId, Remedy, RuleId, Severity, SimView, TickContext } from '../src/game/types';

const ctl = vi.hoisted(() => ({ pet: null as unknown, flow: null as unknown, morale: null as unknown, covered: null as string[] | null, wishes: null as unknown }));
vi.mock('../src/game/decisions', async (orig) => {
  const m = await orig<typeof import('../src/game/decisions')>();
  return { ...m, petitionNeeds: (...a: Parameters<typeof m.petitionNeeds>) => (ctl.pet ?? m.petitionNeeds(...a)) as ReturnType<typeof m.petitionNeeds> };
});
vi.mock('../src/game/construction', async (orig) => {
  const m = await orig<typeof import('../src/game/construction')>();
  return { ...m, capitoliumFlow: (s: GameState) => (ctl.flow ?? m.capitoliumFlow(s)) as ReturnType<typeof m.capitoliumFlow> };
});
vi.mock('../src/game/civic', async (orig) => {
  const m = await orig<typeof import('../src/game/civic')>();
  return { ...m, moraleTarget: (...a: Parameters<typeof m.moraleTarget>) => (ctl.morale ?? m.moraleTarget(...a)) as ReturnType<typeof m.moraleTarget> };
});
vi.mock('../src/game/ordo/build', async (orig) => {
  const m = await orig<typeof import('../src/game/ordo/build')>();
  return { ...m, newWishes: (...a: Parameters<typeof m.newWishes>) => (ctl.wishes ?? m.newWishes(...a)) as ReturnType<typeof m.newWishes> };
});
vi.mock('../src/game/coverage', async (orig) => {
  const m = await orig<typeof import('../src/game/coverage')>();
  return { ...m, houseHas: (s: GameState, id: number, l: CoverageLayerId) => (ctl.covered ? ctl.covered.includes(l) : m.houseHas(s, id, l)) };
});

// The rule modules are imported first on purpose: the real modules import each other in cycles, and a module first
// loaded from inside one of the mocks' importOriginal() would bind the original export instead of the mock.
import { activeAdvisories, advisorMood, advisorsDay, hush, mute, renderAdvisory, RULE_DEFS } from '../src/game/advisors/engine';
import { applyRemedy, checkRemedy, clearPrompt, isUiRemedy, remedyLabel, remedyTip } from '../src/game/advisors/remedies';
import { freeSlots, fresh, place, run, setJobs } from './util';
import { follow } from './autoplayer';
import { EDICT_DEFS, SETTING_DEFS } from '../src/game/data/decisions';
import { B } from '../src/game/balance';
import { Rng } from '../src/game/rng';
import { invalidate, touchPeople } from '../src/game/memo';
import { newCtx, view } from '../src/game/sim';
import { moraleTarget } from '../src/game/civic';
import { bestFood, blockWorks, clearSite, idleFor, int, serveSlot } from '../src/game/advisors/util';
import { favourPaces, immigrationChance, renownFactor } from '../src/game/people';
import { canPlace, placeBuilding, validSlots } from '../src/game/place';
import { getMap, tx, ty } from '../src/game/map';
import { census, residents } from '../src/game/census';
import { effectiveRadius, fullReachHands, houseHas, previewCovered } from '../src/game/coverage';
import { BUILDING_DEFS, slotsOf } from '../src/game/data/buildings';

type Patch = { grain?: Partial<EssentialForecast>; water?: Partial<EssentialForecast>; coin?: Partial<Forecast['coin']>; c?: Partial<Census>; eat?: number; rot?: number; spill?: number };
type Setup = (s: GameState) => Patch | void;
interface Fix { levels: [Severity, Setup, number?][]; clear: Setup }

const A = B.advisors;
const ZERO = { water: 0, food: 0, materials: 0, industry: 0, services: 0, builders: 0 };
const ALL_LAYERS = ['water', 'fountain', 'shrine', 'temple', 'market', 'macellum', 'baths', 'culture'];
const DRY = ALL_LAYERS.filter((l) => l !== 'water' && l !== 'fountain');
const NEUTRAL: Patch = { grain: { net3: 1, crunch: null }, water: { net3: 1, crunch: null }, coin: { net30: 1 } };

/** A view over the real derived/census/coverage with forecast and census fields patched. */
function fake(s: GameState, p: Patch): SimView {
  const v = view(s);
  const f = v.f;
  return {
    d: v.d, cov: v.cov, c: { ...v.c, ...p.c },
    f: { ...f, grain: { ...f.grain, ...NEUTRAL.grain, ...p.grain }, water: { ...f.water, ...NEUTRAL.water, ...p.water }, coin: { ...f.coin, ...NEUTRAL.coin, ...p.coin } },
  };
}

/** One advisors pass on the next day with the patch applied; returns the context. */
function day(s: GameState, p: Patch = {}): TickContext {
  s.day++;
  const ctx = newCtx();
  const v = fake(s, p);
  const g = v.c.groupNeed.grain;
  ctx.rates.cons.grain.eating = p.eat ?? g[0] + g[1] + g[2] + g[3];   // everyone fed unless the patch says otherwise
  if (p.rot !== undefined) ctx.rates.cons.grain.rot = p.rot;
  if (p.spill !== undefined) ctx.rates.cons.grain.spill = p.spill;
  advisorsDay(s, ctx, v);
  return ctx;
}

function base(): GameState {
  const s = fresh(42);
  s.guidance.appointed = [...ADVISORS];
  return s;
}

const houses = (s: GameState) => s.buildings.filter((b) => b.house);
const setTier = (s: GameState, t: HouseTierId): void => { for (const b of houses(s)) { b.house!.tier = t; b.house!.declining = false; } };
const crunch = (season: number, startsIn: number, low: number) => (s: GameState) =>
  ({ season, startsIn, lowestDoh: low, lowestDay: s.day + startsIn + 20, emptyDay: low <= 0 ? s.day + startsIn + 30 : null, needInStore: 2000 }) as EssentialForecast['crunch'];
const ess = (stock: number, net3: number): Partial<EssentialForecast> => ({ stock, net3, need: 50, cons: 50 - net3, prod: 50, maxPotential: 200, structural: false });
const runout = (res: 'grain' | 'water', t: readonly number[]): Fix => ({
  levels: [[3, () => ({ [res]: ess(t[0] * 50, -100) })], [2, () => ({ [res]: ess((t[0] + t[1]) * 50, -100) })], [1, () => ({ [res]: ess((t[1] + t[2]) * 50, -100) })]],
  clear: () => ({ [res]: { net3: 5 } }),
});
function site(s: GameState, ago: number | null): void {
  s.buildings = s.buildings.filter((b) => b.status !== 'plan');
  if (ago !== null) s.buildings.push({ id: s.nextId++, type: 'horreum', x: 2, y: 2, owner: 'player', status: 'plan', placed: s.day - ago, progress: 0, work: 60, paid: false, order: 1, open: true, prio: 1 });
  invalidate(s);
}
function extraHouses(s: GameState, declining: number): void {
  while (houses(s).length < 16) {
    const k = houses(s).length;
    s.buildings.push({ id: s.nextId++, type: 'area', x: 2 + 3 * k, y: 70, owner: 'player', status: 'done', placed: 0, progress: 1, work: 4, paid: true, order: 1, open: true, prio: 1,
      house: { tier: 'tentoria', pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 } });
    invalidate(s);
  }
  houses(s).forEach((b, i) => { b.house!.declining = i < declining; b.house!.declineDays = 20; });
}
function gardens(s: GameState, n: number): void {
  s.buildings = s.buildings.filter((b) => b.type !== 'hortus');
  for (let k = 0; k < n; k++) s.buildings.push({ id: s.nextId++, type: 'hortus', x: 2 + 3 * k, y: 76, owner: 'player', status: 'done', placed: 0, progress: 1, work: 6, paid: true, order: 1, open: true, prio: 1 });
  invalidate(s);
}
const choice = (d: number) => (s: GameState) => {
  s.choice = { event: 'legatus', kicker: 'NUNTIUS', title: 'The Legate writes', text: '', defaultIndex: 1, created: s.day, expires: s.day + d,
    options: [{ label: 'Agree', note: '', key: 'a' }, { label: 'Decline politely', note: 'Nothing changes.', key: 'b' }] };
};
const merchant = (s: GameState): void => {
  if (s.rank < 1) s.rank = 1;   // Commercium is open (a Castra colony does not trade)
  s.trade.merchant = { name: 'Syrian spice traders', arrived: s.day, until: s.day + 12, offers: [{ id: 1, kind: 'buy', res: 'grain', qty: 40, price: 2, taken: false }] };
};
const pet = (ready: boolean, label = '50 souls') => ({ decision: 'path1', rank: 1, ready, fee: { denarii: 9e9 }, affordable: false, needs: [{ label, met: ready }] });

/** A Capitolium flow for the mocked capitoliumFlow: the Cella 400 days off, its full crew of 64 at work. */
const FLOW: CapitoliumFlow = {
  stage: 1, eta: 400, bottleneck: 'crew', rate: 3, need: 1200, supply: 0, demand: 0, crew: 64, walls: 0, spare: 0, stock: 0, inflow: 0, starved: null,
};

const FIX: Record<RuleId, Fix> = {
  'annonae.grain.runout': runout('grain', A.RULES.GRAIN_RUNOUT),
  'annonae.famine': { levels: [[3, () => ({ grain: { ...ess(250, -50), maxPotential: 20, structural: true } })]], clear: () => ({ grain: { maxPotential: 90 } }) },
  'annonae.hiems.forecast': {
    levels: [[3, (s) => ({ grain: { crunch: crunch(3, 30, 0)(s) } })], [2, (s) => ({ grain: { crunch: crunch(3, 60, 0)(s) } })], [1, (s) => ({ grain: { crunch: crunch(3, 60, 10)(s) } })]],
    clear: (s) => ({ grain: { crunch: crunch(3, 60, 30)(s) } }),
  },
  'annonae.mess': {
    levels: [[3, () => ({ eat: 1, c: { groupNeed: { grain: [2, 2, 10, 2], water: [2, 2, 10, 2] } } })], [2, () => ({ eat: 3, c: { groupNeed: { grain: [2, 2, 10, 2], water: [2, 2, 10, 2] } } })]],
    clear: () => ({ eat: 16, c: { groupNeed: { grain: [2, 2, 10, 2], water: [2, 2, 10, 2] } } }),
  },
  'annonae.storage': {
    levels: [[0, () => ({ grain: { stock: 990, cap: 1000, net3: 5 } }), A.RULES.STORAGE_DAYS], [1, () => ({ spill: 4, grain: { stock: 990, cap: 1000, net3: 5 } }), A.RULES.STORAGE_DAYS],
      [1, () => ({ rot: 4, grain: { stock: 990, cap: 1000 } })], [2, () => ({ rot: 12, grain: { stock: 990, cap: 1000 } })]],
    clear: () => ({ rot: 0, spill: 0, grain: { stock: 500, cap: 1000 } }),
  },
  'annonae.goods': {
    // the plan's projection: a Monitum when the stores run dry within GOODS_LEAD days, a Cave within GOODS_DAYS or when a house lapses
    levels: [[1, (s) => { setTier(s, 'tentoria'); houses(s)[0].house!.tier = 'insula'; houses(s)[0].house!.oil = 1; s.res.oil = 60 * residents(s, houses(s)[0].id).length * B.housing.GOODS.oil; }],
      [2, (s) => { setTier(s, 'tentoria'); houses(s)[0].house!.tier = 'insula'; houses(s)[0].house!.oil = 1; s.res.oil = 3; }],
      [2, (s) => { setTier(s, 'tentoria'); Object.assign(houses(s)[0].house!, { tier: 'insula', oil: 0.4, declining: true }); s.res.oil = 3; }]],
    clear: (s) => { setTier(s, 'tentoria'); s.res.oil = 1000; },
  },
  'aquarum.water.runout': runout('water', A.RULES.WATER_RUNOUT),
  'aquarum.aestas.forecast': {
    levels: [[3, (s) => ({ water: { crunch: crunch(1, 20, 0)(s) } })], [2, (s) => ({ water: { crunch: crunch(1, 50, 0)(s) } })], [1, (s) => ({ water: { crunch: crunch(1, 50, 5)(s) } })]],
    clear: (s) => ({ water: { crunch: crunch(1, 50, 20)(s) } }),
  },
  'aquarum.access': {
    // no well reaches these homes (on the real map the start well covers the start tents)
    levels: [[1, (s) => { setTier(s, 'tentoria'); ctl.covered = DRY; invalidate(s); }],
      [2, (s) => { setTier(s, 'tentoria'); Object.assign(houses(s)[0].house!, { tier: 'casa', declining: true }); ctl.covered = DRY; invalidate(s); }]],
    clear: (s) => { setTier(s, 'domus'); ctl.covered = null; invalidate(s); },
  },
  'aquarum.aqueduct': { levels: [[1, (s) => { s.rank = 3; }], [2, (s) => { s.rank = 3; ctl.pet = { ...pet(false, 'Aqueduct flowing'), rank: 4 }; }]], clear: (s) => { s.rank = 0; } },
  'fabrum.labour': {
    levels: [[1, (s) => ({ c: { idle: s.people.slice(0, 5).map((p) => p.id), workforce: 20, catSlots: ZERO, catStaffed: ZERO } }), A.RULES.IDLE_DAYS],
      [2, () => ({ c: { idle: [], catSlots: { ...ZERO, food: 10 }, catStaffed: ZERO }, grain: { stock: 10, net3: -1 } })]],
    clear: () => ({ c: { idle: [], catSlots: ZERO, catStaffed: ZERO } }),
  },
  'fabrum.stalled': { levels: [[1, (s) => site(s, 25)], [2, (s) => site(s, 45)]], clear: (s) => site(s, null) },
  'fabrum.agenda': {   // the Ordo's next growth work waits on its pace: the Fabrum names it, and the player may raise it now
    levels: [[1, () => { ctl.wishes = [{ type: 'lignarius', state: 'paced', eta: 6, tile: 1000, reason: { code: 'materials', params: { res: 'timber', qty: 40, for: 'wish' } } }]; }]],
    clear: () => { ctl.wishes = []; },
  },
  'fabrum.capitolium': {
    levels: [[1, () => { ctl.flow = { ...FLOW, bottleneck: 'stone', supply: 1.7, demand: 3.8, stock: 12, inflow: 1.3 }; }]],
    clear: () => { ctl.flow = { ...FLOW, eta: 100, bottleneck: null, rate: 11, need: 1100 }; },
  },
  'quaestor.coin': {
    levels: [[3, () => ({ coin: { stock: 1000, net30: -100 } })], [2, () => ({ coin: { stock: 3000, net30: -100 } })], [1, () => ({ coin: { stock: 8000, net30: -100 } })],
      [3, (s) => { s.buildings[1].unpaid = true; }]],
    clear: (s) => { delete s.buildings[1].unpaid; return { coin: { net30: 5 } }; },
  },
  'quaestor.contract': {
    levels: [[1, (s) => { s.trade.contracts = [{ id: 500, hub: 'metellianus', mode: 'export', res: 'timber', qty: 40, repeat: true, owner: 'player', status: 'paused', pause: 'reserve', trips: 0, created: s.day }]; }]],
    clear: (s) => { s.trade.contracts = []; },
  },
  'quaestor.merchant': { levels: [[0, merchant], [1, (s) => { merchant(s); return { grain: ess(1000, -100) }; }]], clear: (s) => { s.trade.merchant = null; } },
  'aedilis.evolve': {   // coverage is mocked here, so each setup bumps the structure epoch as a real coverage change would
    levels: [[1, (s) => { setTier(s, 'casa'); s.rank = 1; ctl.covered = ALL_LAYERS.filter((l) => l !== 'shrine' && l !== 'temple'); invalidate(s); }],
      [2, (s) => { setTier(s, 'casa'); s.rank = 1; ctl.covered = ALL_LAYERS.filter((l) => l !== 'shrine' && l !== 'temple'); ctl.pet = pet(false, '10 houses at T2+'); invalidate(s); }]],
    clear: (s) => { ctl.covered = ALL_LAYERS; invalidate(s); },
  },
  'aedilis.declining': { levels: [[2, (s) => extraHouses(s, 1)], [3, (s) => extraHouses(s, 2)]], clear: (s) => extraHouses(s, 0) },
  'aedilis.beds': {
    levels: [[1, (s) => { s.counters.lastArrivalBlocked = s.day; return { c: { freeBeds: 0, homeless: 0 } }; }], [2, () => ({ c: { freeBeds: 0, homeless: 3 } })],
      [1, () => ({ c: { pop: 100, roll: 100, freeBeds: 10, homeless: 0 } })]],
    clear: (s) => { s.counters.lastArrivalBlocked = -9999; return { c: { freeBeds: 10, homeless: 0, pop: 24, roll: 100 } }; },
  },
  'aedilis.morale': {
    levels: [[1, (s) => { s.morale = 45; }], [2, (s) => { s.morale = 30; }], [3, (s) => { s.morale = 20; }],
      [1, (s) => { s.morale = 60; ctl.morale = { value: 40, terms: [{ label: 'Rations', value: -6 }, { label: 'Deaths', value: -4 }] }; }, A.RULES.MORALE_FALL_DAYS]],
    clear: (s) => { s.morale = 70; ctl.morale = { value: 70, terms: [] }; },
  },
  'aedilis.favour': {   // a camp kept by the Ordo alone has ×1; gardens among the homes lift it past the bar
    levels: [[1, (s) => gardens(s, 0)]],
    clear: (s) => gardens(s, 12),
  },
  'augur.choice': { levels: [[0, choice(20)], [1, choice(5)]], clear: (s) => { s.choice = null; } },
  'augur.petition': { levels: [[1, () => { ctl.pet = pet(true); }]], clear: () => { ctl.pet = pet(false); } },
};

const ruleDef = (id: RuleId) => RULE_DEFS.find((r) => r.id === id)!;
const every = (id: RuleId): number => (ruleDef(id) as { every?: number }).every ?? 1;   // the house rules follow the house checks
const life = (id: RuleId): number => (A.MIN_LIFE + A.DOWNGRADE_DAYS + 2) * every(id);
const LIFE = life('annonae.grain.runout');

beforeEach(() => { ctl.pet = null; ctl.flow = null; ctl.morale = null; ctl.covered = null; ctl.wishes = null; });

describe('rule fixtures', () => {
  it('has one rule per RULES id, in order, each with a fixture', () => {
    expect(RULE_DEFS.map((r) => r.id)).toEqual([...RULES]);
    for (const r of RULE_DEFS) expect(r.id.startsWith(`${r.advisor}.`)).toBe(true);
  });
  for (const id of RULES) {
    FIX[id].levels.forEach(([sev, setup, hold = 1], k) => {
      it(`${id} raises at severity ${sev} (#${k}) with 1–3 remedies, then clears`, () => {
        const s = base();
        for (let i = 0; i < Math.max(hold, every(id)); i++) day(s, setup(s) ?? {});
        const m = s.guidance.advisories[id]!;
        expect(m?.active).toBe(true);
        expect(m.sev).toBe(sev);
        const r = renderAdvisory(s, fake(s, setup(s) ?? {}), { rule: id, advisor: ruleDef(id).advisor, memo: m });
        expect(r.remedies.length).toBeGreaterThanOrEqual(1);
        expect(r.remedies.length).toBeLessThanOrEqual(3);
        expect(r.title.length).toBeGreaterThan(8);
        expect(`${r.title} ${r.text} ${r.remedies.map((x) => x.label).join()}`).not.toMatch(/undefined|NaN|\[object|\.\./);
        for (let i = 0; i < life(id); i++) day(s, FIX[id].clear(s) ?? {});
        expect(s.guidance.advisories[id]!.active).toBe(false);
      });
    });
  }
});

describe('the Aedilis counsels what can be done (fix batch G)', () => {
  const E = 'aedilis.evolve';
  const waitTemple = (s: GameState, rank: 1 | 2): void => {
    setTier(s, 'tegulata');
    s.rank = rank;
    s.fed = 1;
    ctl.covered = ALL_LAYERS.filter((l) => l !== 'temple');
    invalidate(s);
  };
  it('the remedy is a temple at the free block that serves the most of the waiting houses', () => {
    const s = base();
    for (let i = 0; i < every(E); i++) { waitTemple(s, 2); day(s); }
    const m = s.guidance.advisories[E]!;
    expect(m.sev).toBeGreaterThanOrEqual(1);
    const r = renderAdvisory(s, fake(s, {}), { rule: E, advisor: 'aedilis', memo: m });
    const place = r.remedies[0].remedy;
    expect(place).toMatchObject({ kind: 'place', building: 'templum' });
    expect(r.text).toMatch(/^A temple .* would let \d+ of them grow\.$/);
  });
});

describe('a block to clear for the work the homes wait for (playtest #2, DESIGN §11.6 row 17)', () => {
  const E = 'aedilis.evolve';
  /** A finished work of the player's at (x, y) (a home when `tier` is given). */
  const put = (s: GameState, type: BuildingId, x: number, y: number, tier?: HouseTierId): Building => {
    const b: Building = { id: s.nextId++, type, x, y, owner: 'player', status: 'done', placed: 0, doneDay: 0, progress: 1, work: 1, paid: true, order: 1, open: true, prio: 1 };
    if (tier) b.house = { tier, pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 };
    s.buildings.push(b);
    invalidate(s);
    return b;
  };
  /** One `type` on every block a temple could take (its top-left plot, or its top half), so no free block is left. */
  const fill = (s: GameState, type: BuildingId, tier?: HouseTierId): void => {
    for (const tile of [...validSlots(s, 'templum', 'player').keys()].sort((a, b) => a - b)) put(s, type, tx(tile), ty(tile), tier);
  };
  /** The founders' homes wait for a temple at Oppidum (tiled cottages that have everything else). */
  const wait = (s: GameState): void => {
    setTier(s, 'tegulata');
    s.rank = 2;
    s.fed = 1;
    ctl.covered = ALL_LAYERS.filter((l) => l !== 'temple');
    invalidate(s);
  };
  const raise = (s: GameState) => {
    for (let i = 0; i < every(E); i++) { wait(s); day(s); }
    const m = s.guidance.advisories[E]!;
    return { m, r: renderAdvisory(s, fake(s, {}), { rule: E, advisor: 'aedilis', memo: m }) };
  };
  const waiting = (s: GameState): number[] => houses(s).filter((b) => b.owner === 'start').map((b) => b.id).sort((a, b) => a - b);

  it('no free block reaches them: the Aedilis names a block to clear, and the remedy clears it for the temple', () => {
    const s = base();
    wait(s);
    fill(s, 'hortus');
    expect(validSlots(s, 'templum', 'player').size).toBe(0);
    const { m, r } = raise(s);
    expect(m.sev).toBe(1);                                                // on the card: something can be done
    const rem = r.remedies[0].remedy;
    expect(rem).toMatchObject({ kind: 'clear', building: 'templum' });
    if (rem.kind !== 'clear') throw new Error('no clear remedy');
    expect(r.remedies[0].label).toBe('Clear this block for a temple');
    expect(r.remedies[0].check.ok).toBe(true);
    expect(r.text).toMatch(/^No free block within reach of their doors can take a temple\. Clear the block .+ \(a garden\) and a temple there would let \d+ of them grow\.$/);
    expect(blockWorks(s, rem.tile)).toEqual(rem.ids);
    expect(clearPrompt(s, rem)).toMatchObject({ yes: 'Clear it for a temple' });
    expect(clearPrompt(s, rem).text).toMatch(/^A garden comes down, and a quarter of its cost is salvaged\. Then you place a temple on the cleared block\.$/);
    // the sim part pulls down what stands there; the temple may then stand on the block
    const t = structuredClone(s);
    expect(applyRemedy(t, rem).ok).toBe(true);
    expect(t.buildings.some((b) => rem.ids.includes(b.id))).toBe(false);
    expect(canPlace(t, 'templum', rem.tile, { owner: 'player', ignoreCost: true }).ok).toBe(true);
    // once the block changes, the remedy says so instead of pulling down what it did not name
    put(s, 'puteus', tx(rem.tile) + 2, ty(rem.tile) + 2);
    expect(checkRemedy(s, rem)).toMatchObject({ ok: false, code: 'notReady' });
    expect(checkRemedy(t, rem)).toMatchObject({ ok: false, code: 'notReady' });   // cleared already: a place remedy now
  });

  it('once the temple rises on the cleared block, the homes it will reach wait for it: no second block to clear', () => {
    const s = base();
    wait(s);
    fill(s, 'hortus');
    const { r } = raise(s);
    const rem = r.remedies[0].remedy;
    if (rem.kind !== 'clear') throw new Error('no clear remedy');
    const ids = waiting(s);
    expect(applyRemedy(s, rem).ok).toBe(true);
    expect(placeBuilding(s, 'templum', rem.tile, { owner: 'player' }).ok).toBe(true);
    const temple = s.buildings.find((b) => b.type === 'templum')!;
    expect(temple.status).not.toBe('done');
    // at once, before the next check lets the advice go: it says what they wait for, and shows the site
    const now = renderAdvisory(s, fake(s, {}), { rule: E, advisor: 'aedilis', memo: s.guidance.advisories[E]! });
    expect(now.text).toMatch(/^A temple rises .+: they grow once it stands\.$/);
    expect(now.remedies[0].remedy).toEqual({ kind: 'building', op: 'center', id: temple.id });
    // the checks that follow while the temple is still a site (coverage is mocked: it never reaches them) offer no
    // second block, and the advice lets go
    for (let i = 0; i < 4 * every(E); i++) {
      wait(s);
      day(s);
      const m = s.guidance.advisories[E]!;
      if (!m.active) continue;
      const q = renderAdvisory(s, fake(s, {}), { rule: E, advisor: 'aedilis', memo: m });
      expect(q.remedies.some((x) => x.remedy.kind === 'clear')).toBe(false);
      expect(q.text).not.toMatch(/Clear the block/);
    }
    expect(s.guidance.advisories[E]!.active).toBe(false);
    // a second block for the same homes, however it was found, is refused while a temple rises
    const again = clearSite(s, 'templum', 'temple', ids).site!;
    expect(checkRemedy(s, { kind: 'clear', building: 'templum', tile: again.tile, ids: again.ids }))
      .toMatchObject({ ok: false, code: 'chosen', reason: 'A temple is already being raised.' });
  });

  it('one block at a time: while a temple rises out of their reach, the Nota says the block waits until it stands', () => {
    const s = base();
    wait(s);
    // a temple already rising on a block that reaches none of them; a garden on every other block
    const ids = waiting(s);
    const far = [...validSlots(s, 'templum', 'player').keys()].sort((a, b) => a - b)
      .find((t) => !previewCovered(s, 'templum', tx(t), ty(t)).some((p) => p.layer === 'temple' && p.houses.some((h) => ids.includes(h))))!;
    expect(placeBuilding(s, 'templum', far, { owner: 'player' }).ok).toBe(true);
    fill(s, 'hortus');
    const { m, r } = raise(s);
    expect(m.sev).toBe(0);
    expect(r.remedies.some((x) => x.remedy.kind === 'clear')).toBe(false);
    expect(r.text).toMatch(/^No free block within reach of their doors can take a temple, nor will the Ordo raise one where it would not serve them\. A temple already rises .+: once it stands, a block near them can be cleared for another\.$/);
    // once it stands, the block is offered
    const t = s.buildings.find((b) => b.type === 'templum')!;
    t.status = 'done';
    t.progress = 1;
    invalidate(s);
    const after = raise(s);
    expect(after.m.sev).toBe(1);
    expect(after.r.remedies[0].remedy).toMatchObject({ kind: 'clear', building: 'templum' });
  });

  it('the advisor-follower clears one block and places the temple there, then waits for it to stand', () => {
    const s = base();
    wait(s);
    fill(s, 'hortus');
    raise(s);
    const count = (type: BuildingId): number => s.buildings.filter((b) => b.type === type).length;
    const gardens = count('hortus');
    follow(s);
    expect(count('templum')).toBe(1);
    expect(count('hortus')).toBe(gardens - 1);
    for (let i = 1; i <= 40; i++) {
      wait(s);
      day(s);
      if (i % 10 === 0) follow(s);
    }
    expect(count('templum')).toBe(1);
    expect(count('hortus')).toBe(gardens - 1);
  });

  it('names who must move when the block holds homes, and whether the town has the beds', () => {
    const s = base();
    wait(s);
    fill(s, 'area', 'tegulata');                                           // a home on every block: they wait for a temple too
    for (const h of houses(s).filter((b) => b.owner === 'player')) {   // a soul in each (a copy of a founder)
      const p = structuredClone(s.people[0]);
      p.id = s.nextId++;
      p.home = h.id;
      s.people.push(p);
    }
    touchPeople(s);
    const { m, r } = raise(s);
    expect(m.sev).toBe(1);
    const rem = r.remedies[0].remedy;
    if (rem.kind !== 'clear') throw new Error('no clear remedy');
    expect(r.text).toMatch(/ \(a tiled cottage\) and a temple there would let \d+ of them grow\. The (one soul who lives there finds a bed|\d+ souls who live there find beds) in the town's other homes\.$/);
    expect(clearPrompt(s, rem).text).toMatch(/^A tiled cottage comes down, and a quarter of its cost is salvaged\. The .+ there looks? for (a bed|beds) in the town's other homes\. Then you place a temple on the cleared block\.$/);
  });

  it('weighs the cost: a block of homes only when it lets more homes rise than one of gardens', () => {
    const s = fresh(42);
    s.rank = 2;
    invalidate(s);
    fill(s, 'hortus');
    const ids = waiting(s);
    const first = clearSite(s, 'templum', 'temple', ids).site!;
    expect(first.homes).toBe(0);
    expect(first.k).toBeGreaterThanOrEqual(B.advisors.RULES.CLEAR_GAIN);
    // two homes with a family each go up on that block: another block of gardens serves them at less cost
    const x = tx(first.tile), y = ty(first.tile);
    const h1 = put(s, 'area', x + 2, y, 'casa'), h2 = put(s, 'area', x, y + 2, 'casa');
    s.people.filter((p) => p.home !== null).slice(0, 4).forEach((p, k) => { p.home = k < 2 ? h1.id : h2.id; });
    touchPeople(s);
    const next = clearSite(s, 'templum', 'temple', ids).site!;
    expect(next.tile).not.toBe(first.tile);
    expect(next.homes).toBe(0);
    expect(next.k).toBeGreaterThanOrEqual(first.k - 2);
    // granaries everywhere: only the founders' own blocks could be cleared, and pulling down homes to raise the same
    // homes gains nothing; kept free by the player, those are not offered either — and the advice says which it was
    const g = fresh(42);
    g.rank = 2;
    invalidate(g);
    fill(g, 'horreum');
    expect(clearSite(g, 'templum', 'temple', waiting(g))).toEqual({ site: null, why: 'gain' });
    const map = getMap(42);
    g.ordo.reserved = [...new Set(houses(g).map((b) => map.survey.blockAt[b.y * map.W + b.x]))].sort((a, b) => a - b);
    invalidate(g);
    expect(clearSite(g, 'templum', 'temple', waiting(g))).toEqual({ site: null, why: 'works' });
  });

  it('never pulls down the only shop row (shrine, well) that brings a waiting home another need of its next tier', () => {
    const s = fresh(42);
    s.rank = 2;
    for (const b of houses(s)) b.house!.tier = 'tegulata';              // a stone house needs a market too
    invalidate(s);
    fill(s, 'hortus');
    const ids = waiting(s);
    const first = clearSite(s, 'templum', 'temple', ids).site!;
    // the garden there gives way to the town's one shop row: the same block, the same cost, but their market with it
    s.buildings = s.buildings.filter((b) => b.id !== first.ids[0]);
    const shop = put(s, 'taberna', tx(first.tile), ty(first.tile));
    const next = clearSite(s, 'templum', 'temple', ids).site!;
    expect(next.tile).not.toBe(first.tile);
    expect(next.ids).not.toContain(shop.id);
  });

  it('never pulls down the only shop row (shrine, well) of a home that does not wait: it would decline', () => {
    const s = fresh(42);
    s.rank = 2;
    for (const b of houses(s)) b.house!.tier = 'tegulata';              // a tiled cottage needs a market already
    invalidate(s);
    fill(s, 'hortus');
    const first = clearSite(s, 'templum', 'temple', waiting(s)).site!;
    // the garden there gives way to the town's one shop row, the only market of the homes it reaches; those homes are
    // left out of the waiting group, so only the others are asked about
    s.buildings = s.buildings.filter((b) => b.id !== first.ids[0]);
    const shop = put(s, 'taberna', tx(first.tile), ty(first.tile));
    const served = previewCovered(s, 'taberna', shop.x, shop.y).find((p) => p.layer === 'market')?.houses ?? [];
    const others = waiting(s).filter((id) => served.includes(id));
    expect(others.length).toBeGreaterThan(0);
    const ids = waiting(s).filter((id) => !others.includes(id));
    const next = clearSite(s, 'templum', 'temple', ids).site!;
    expect(next).not.toBeNull();
    expect(next.tile).not.toBe(first.tile);
    expect(next.ids).not.toContain(shop.id);
  });

  it('when no block may be cleared the Nota says why; a work with no site says why too', () => {
    const s = base();
    wait(s);
    fill(s, 'horreum');
    const { m, r } = raise(s);
    expect(m.sev).toBe(0);
    expect(r.remedies.some((x) => x.remedy.kind === 'clear')).toBe(false);
    expect(r.text).toBe('No free block within reach of their doors can take a temple, nor will the Ordo raise one where it would not serve them, '
      + 'and no block near them is worth clearing: each would let too few of them rise for the homes and works it pulls down.');
    expect(checkRemedy(s, { kind: 'place', building: 'templum' })).toMatchObject({ ok: false, code: 'noSlots', reason: 'Every block of the town is built on: pull down what stands on one to clear it.' });
    const k = fresh(42);
    k.rank = 2;
    k.ordo.on.build = true;
    k.ordo.reserved = getMap(42).survey.blocks.map((b) => b.id);
    invalidate(k);
    expect(checkRemedy(k, { kind: 'ask', building: 'templum' })).toMatchObject({ ok: false, reason: 'Every free block is one you keep from the Ordo: place it yourself, or release one.' });
    const t = fresh(42);
    t.rank = 3;
    invalidate(t);
    expect(checkRemedy(t, { kind: 'place', building: 'thermae' })).toMatchObject({ ok: false, reason: 'No free block can take great baths: no castellum within 18 paces.' });
  });
});

describe('staffing by hand: hands before another work (finding 11)', () => {
  /** Manual labour with no targets: every work's hands go home (a work finished under manual labour stands so). */
  const byHand = (s: GameState): void => {
    s.ordo.on.labour = false;
    for (const p of s.people) p.work = null;
    touchPeople(s);
    invalidate(s);
  };
  const render = (s: GameState, id: RuleId, p: Patch = {}) =>
    renderAdvisory(s, fake(s, p), { rule: id, advisor: ruleDef(id).advisor, memo: s.guidance.advisories[id]! });

  it('aedilis.declining: the empty well that would serve the houses comes before another well, and is named', () => {
    const s = base();
    byHand(s);
    for (const b of houses(s)) Object.assign(b.house!, { tier: 'casa', declining: true, declineDays: 5 });
    invalidate(s);
    for (let i = 0; i < every('aedilis.declining'); i++) day(s);
    expect(s.guidance.advisories['aedilis.declining']?.params.need).toBe('water');
    const r = render(s, 'aedilis.declining');
    expect(r.remedies[0].remedy).toEqual({ kind: 'assign', cat: 'water', n: 1 });   // a well reaches its full radius at one hand of two
    expect(r.remedies[0].check.ok).toBe(true);
    expect(r.remedies[0].label).toBe('Put 1 more hand on the wells');
    expect(r.remedies[1].remedy).toMatchObject({ kind: 'place', building: 'puteus' });
    expect(r.text).toMatch(/ The well .+ has 0 of 2 hands: staffed, it would serve \d+ of them\.$/);
    expect(applyRemedy(s, r.remedies[0].remedy).ok).toBe(true);
    expect(s.ordo.manual.water).toBe(1);
    s.ordo.on.labour = true;   // the Ordo staffs: its remedy is the work, as before
    expect(render(s, 'aedilis.declining').remedies[0].remedy).toMatchObject({ kind: 'place', building: 'puteus' });
  });

  it('aquarum.access: the dry homes wait on the well\'s hands, not on a new well (and it is no quiet Nota)', () => {
    const s = base();
    byHand(s);
    setTier(s, 'tentoria');
    invalidate(s);
    for (let i = 0; i < every('aquarum.access'); i++) day(s);
    const m = s.guidance.advisories['aquarum.access']!;
    expect(m.active).toBe(true);
    expect(m.sev).toBe(1);
    const r = render(s, 'aquarum.access');
    expect(r.remedies[0].remedy).toEqual({ kind: 'assign', cat: 'water', n: 1 });
    expect(r.text).toMatch(/^The well .+ has 0 of 2 hands: staffed, it would reach \d+ of them\.$/);
    s.ordo.manual.water = 2;   // the target reaches it: the hands come with the next day's staffing
    expect(render(s, 'aquarum.access').remedies[0].remedy.kind).not.toBe('assign');
  });

  it('from the Oppidum a well has 4 posts but its full reach at 1 hand: 1 is asked, not 2, and a well with it is not short', () => {
    const s = base();
    byHand(s);
    s.rank = 2;
    setTier(s, 'tentoria');
    invalidate(s);
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    expect(slotsOf('puteus', s.rank)).toBe(4);
    expect(fullReachHands('puteus')).toBe(1);   // the reach coverage.radiusWith gives it: ceil(2 × 0.5), not ceil(4 × 0.5)
    for (let i = 0; i < every('aquarum.access'); i++) day(s);
    const r = render(s, 'aquarum.access');
    expect(r.remedies[0].remedy).toEqual({ kind: 'assign', cat: 'water', n: 1 });
    expect(r.text).toMatch(/^The well .+ has 0 of 4 hands: staffed, it would reach \d+ of them\.$/);
    // one hand on it: its full reach already, so it is no longer a work short of hands
    s.ordo.manual.water = 1;
    setJobs(s, { perBuilding: { [well.id]: 1 } });
    expect(census(s).staffed[well.id]).toBe(1);
    expect(effectiveRadius(s, well, 'water')).toBe(BUILDING_DEFS.puteus.service![0].radius);
    expect(idleFor(s, view(s), 'water', houses(s).map((b) => b.id))).toBeNull();
    expect(render(s, 'aquarum.access').remedies[0].remedy.kind).not.toBe('assign');
  });

  it('annonae.hiems.forecast: a field short of hands is staffed before a lodge is raised', () => {
    const s = base();
    s.ordo.on.labour = false;
    s.ordo.manual.food = census(s).catStaffed.food;
    const p: Patch = { grain: { crunch: crunch(3, 60, 0)(s), cap: 2500 } };   // room for the 2,000 needed in store
    day(s, p);
    const field = s.buildings.find((b) => b.type === 'ager')!;
    const have = census(s).staffed[field.id] ?? 0;
    const r = render(s, 'annonae.hiems.forecast', p);
    expect(r.remedies[0].remedy).toEqual({ kind: 'assign', cat: 'food', n: 6 - have });
    expect(r.text).toMatch(new RegExp(`with room for 2,500\\. The field .+ has ${have} of 6 hands\\.$`));
    s.ordo.on.labour = true;   // the Ordo staffs: the works and the reserve as before, which the hands now lead
    expect(r.remedies.slice(1).map((x) => x.remedy)).toEqual(render(s, 'annonae.hiems.forecast', p).remedies.slice(0, 2).map((x) => x.remedy));
  });

  it('annonae.hiems.forecast: when even full stores are too small, the granary comes first and the field\'s hands after', () => {
    const s = base();
    s.ordo.on.labour = false;
    s.ordo.manual.food = census(s).catStaffed.food;
    const p: Patch = { grain: { crunch: crunch(3, 60, 0)(s), cap: 1500 } };   // 2,000 needed in store
    day(s, p);
    const field = s.buildings.find((b) => b.type === 'ager')!;
    const have = census(s).staffed[field.id] ?? 0;
    const r = render(s, 'annonae.hiems.forecast', p);
    expect(r.text).toMatch(new RegExp(` Even full, our stores are too small\\. The field .+ has ${have} of 6 hands\\.$`));
    expect(r.remedies.slice(0, 2).map((x) => x.remedy)).toEqual([{ kind: 'place', building: 'horreum' }, { kind: 'assign', cat: 'food', n: 6 - have }]);
  });

  it('annonae.goods: an olive grove standing empty is staffed before another is planted', () => {
    const s = base();
    s.rank = 1;
    const at = [...validSlots(s, 'olivetum', 'player').keys()].sort((a, b) => a - b)[0];
    const res = { ...s.res };
    const placed = placeBuilding(s, 'olivetum', at, { owner: 'player', ignoreCost: true, noStake: true });
    if (!placed.ok) throw new Error(placed.reason);
    s.res = res;
    const grove = s.buildings.find((b) => b.id === placed.id)!;
    Object.assign(grove, { status: 'done', progress: 1 });
    s.ordo.on.labour = false;
    s.ordo.manual.food = 6;   // the fields' posts all asked for: the grove's 4 hands are what the target lacks
    invalidate(s);
    setTier(s, 'tentoria');
    houses(s)[0].house!.tier = 'insula';
    houses(s)[0].house!.oil = 1;
    s.res.oil = 3;
    day(s);
    expect(s.guidance.advisories['annonae.goods']?.active).toBe(true);
    const r = render(s, 'annonae.goods');
    expect(r.remedies[0].remedy).toEqual({ kind: 'assign', cat: 'food', n: 4 });
    expect(r.remedies[0].label).toBe('Put 4 more hands on the food');
    expect(r.text).toMatch(/ The olive grove .+ has 0 of 4 hands\.$/);
    // stores too small for the lean season: the card's diagnosis is the stores, so the oil store comes first
    const small: Patch = { c: { caps: { ...census(s).caps, oil: 1 } } };
    day(s, small);
    const q = render(s, 'annonae.goods', small);
    expect(q.text).toMatch(/: the stores must hold [\d,]+ when Ver begins, and they hold 1\. A house without its oil falls back a tier\. The olive grove .+ has 0 of 4 hands\.$/);
    expect(q.remedies.slice(0, 2).map((x) => x.remedy)).toEqual([{ kind: 'place', building: 'apotheca' }, { kind: 'assign', cat: 'food', n: 4 }]);
  });

  it('aedilis.evolve: the empty shrine near the waiting houses is staffed first, and the work to place follows', () => {
    const s = base();
    s.rank = 1;
    s.fed = 1;
    setTier(s, 'casa');
    ctl.covered = ALL_LAYERS.filter((l) => l !== 'shrine' && l !== 'temple');
    invalidate(s);
    const ids = houses(s).map((b) => b.id);
    const slot = serveSlot(s, 'lararium', 'player', 'religion', ids)!;
    const placed = placeBuilding(s, 'lararium', slot.tile, { owner: 'player', ignoreCost: true, noStake: true });
    if (!placed.ok) throw new Error(placed.reason);
    Object.assign(s.buildings.find((b) => b.id === placed.id)!, { status: 'done', progress: 1 });
    s.ordo.on.labour = false;
    invalidate(s);
    for (let i = 0; i < every('aedilis.evolve'); i++) day(s);
    const r = render(s, 'aedilis.evolve');
    expect(r.remedies[0].remedy).toEqual({ kind: 'assign', cat: 'services', n: 1 });
    expect(r.text).toMatch(/^The wayside shrine .+ has 0 of 1 hand: staffed, it would let \d+ of them grow\.$/);
    expect(r.remedies[1].remedy.kind).toBe('place');
  });
});

describe('hysteresis', () => {
  const at = (r: number): Patch => ({ grain: ess(r * 100, -100) });
  const G = 'annonae.grain.runout';
  it('clears only past threshold × 1.25, and falls only after 3 stable days', () => {
    const s = base();
    day(s, at(40));
    expect(s.guidance.advisories[G]!.sev).toBe(1);
    day(s, at(5));
    expect(s.guidance.advisories[G]!.sev).toBe(3);               // rises at once
    for (let i = 0; i < A.DOWNGRADE_DAYS; i++) day(s, at(40));
    expect(s.guidance.advisories[G]!.sev).toBe(3);               // not yet
    day(s, at(40));
    expect(s.guidance.advisories[G]!.sev).toBe(1);
    for (let i = 0; i < 10; i++) day(s, at(70));                 // inside the band (60 … 75)
    expect(s.guidance.advisories[G]!.active).toBe(true);
    for (let i = 0; i < LIFE; i++) day(s, at(80));
    expect(s.guidance.advisories[G]!.active).toBe(false);
  });
  it('lives at least MIN_LIFE days', () => {
    const s = base();
    day(s, at(40));
    for (let i = 0; i < A.MIN_LIFE - 1; i++) day(s, at(200));
    expect(s.guidance.advisories[G]!.active).toBe(true);
  });
  for (const id of RULES) {
    it(`${id} is raised at most FLAP_MAX times in any ${A.FLAP_WINDOW} days on a sawtooth`, () => {
      const s = base();
      const [, on, hold = 1] = FIX[id].levels[FIX[id].levels.length - 1];
      const n = Math.max(hold, every(id));
      const raises: number[] = [];
      for (let d = 0; d < 240; d++) {
        const was = s.guidance.advisories[id]?.active === true;
        day(s, (d % (n + 10) < n + 4 ? on : FIX[id].clear)(s) ?? {});
        if (!was && s.guidance.advisories[id]?.active) raises.push(s.day);
      }
      expect(raises.length).toBeGreaterThan(0);
      for (const r of raises) expect(raises.filter((x) => x > r - A.FLAP_WINDOW && x <= r).length).toBeLessThanOrEqual(A.FLAP_MAX);
    });
  }
});

describe('engine', () => {
  it('orders by severity, advisor tie order and age; supersedes; logs new ≥ Cave with fx', () => {
    const s = base();
    const ctx = day(s, { grain: { ...ess(250, -50), maxPotential: 20, structural: true }, water: ess(1000, -100) });
    const list = activeAdvisories(s).map((a) => a.rule);
    expect(list[0]).toBe('annonae.famine');
    expect(list).not.toContain('annonae.grain.runout');            // hidden by the famine
    expect(list.indexOf('aquarum.water.runout')).toBeGreaterThan(0);
    expect(ctx.fx).toContainEqual({ kind: 'advisory', rule: 'annonae.famine', sev: 3 });
    expect(s.log.some((l) => l.kind === 'advisor' && l.text.startsWith('Praefectus Annonae: Famine looms'))).toBe(true);
    expect(advisorMood(s, 'annonae')).toBe(2);
  });
  it('hushes below Periculum, mutes only a Nota, and the card drops Nota and hushed', () => {
    const s = base();
    merchant(s);
    day(s, { grain: ess(4000, -100) });
    expect(hush(s, 'annonae.grain.runout').ok).toBe(true);
    expect(activeAdvisories(s, { forCard: true }).map((a) => a.rule)).not.toContain('annonae.grain.runout');
    expect(activeAdvisories(s, { forCard: true }).map((a) => a.rule)).not.toContain('quaestor.merchant');
    expect(mute(s, 'annonae.grain.runout').ok).toBe(false);
    expect(mute(s, 'quaestor.merchant').ok).toBe(true);
    expect(activeAdvisories(s).map((a) => a.rule)).not.toContain('quaestor.merchant');
    day(s, { grain: ess(500, -100) });
    expect(hush(s, 'annonae.grain.runout').ok).toBe(false);
  });
  describe('a hush lasts its 30 days (R11)', () => {
    const G = 'annonae.grain.runout';
    const at = (r: number): Patch => ({ grain: ess(r * 100, -100) });
    const onCard = (s: GameState): RuleId[] => activeAdvisories(s, { forCard: true }).map((a) => a.rule);
    const told = (ctx: TickContext): boolean => ctx.fx.some((f) => f.kind === 'advisory' && f.rule === G);
    it('a clear and a re-raise at the same severity stay hushed, quietly', () => {
      const s = base();
      day(s, at(20));                                               // Cave
      expect(hush(s, G).ok).toBe(true);
      for (let i = 0; i < LIFE; i++) day(s, at(200));
      expect(s.guidance.advisories[G]!.active).toBe(false);
      const lines = s.log.length;
      const ctx = day(s, at(20));
      expect(s.guidance.advisories[G]!.active).toBe(true);
      expect(s.day).toBeLessThan(s.guidance.advisories[G]!.snoozeUntil!);
      expect(onCard(s)).not.toContain(G);
      expect(told(ctx)).toBe(false);
      expect(s.log.length).toBe(lines);                             // no second Annales line for the same Cave
    });
    it('a fall to a watch Nota (flapping) and back stays hushed', () => {
      const s = base();
      day(s, at(40));
      for (let i = 0; i < LIFE; i++) day(s, at(200));
      day(s, at(40));                                               // second raise inside the flap window
      expect(hush(s, G).ok).toBe(true);
      for (let i = 0; i < LIFE; i++) day(s, at(200));
      expect(s.guidance.advisories[G]!.params.watch).toBe(1);       // kept as a watch Nota
      expect(s.guidance.advisories[G]!.sev).toBe(0);
      day(s, at(40));
      expect(s.guidance.advisories[G]!.sev).toBe(1);
      expect(onCard(s)).not.toContain(G);
    });
    it('a fall and a rise back to the hushed severity stay hushed; a graver one shows', () => {
      const s = base();
      day(s, at(20));
      expect(hush(s, G).ok).toBe(true);
      for (let i = 0; i <= A.DOWNGRADE_DAYS; i++) day(s, at(40));
      expect(s.guidance.advisories[G]!.sev).toBe(1);
      expect(told(day(s, at(20)))).toBe(false);
      expect(s.guidance.advisories[G]!.sev).toBe(2);
      expect(onCard(s)).not.toContain(G);
      const m = base();
      day(m, at(40));                                               // hushed at Monitum …
      expect(hush(m, G).ok).toBe(true);
      expect(told(day(m, at(20)))).toBe(true);                      // … a Cave breaks it
      expect(onCard(m)).toContain(G);
      expect(m.guidance.advisories[G]!.snoozeUntil).toBeUndefined();
    });
  });
  it('appoints advisors by their triggers and keeps unappointed rules silent', () => {
    const s = fresh(42);
    s.morale = 10;
    day(s, { coin: { stock: 500, net30: -100 }, c: { roll: 0 } });    // the roll full: no favour advisory appoints the Aedilis
    expect(s.guidance.appointed).toContain('quaestor');               // his first coin advisory
    expect(s.guidance.advisories['quaestor.coin']?.active).toBe(true);
    expect(s.guidance.appointed).not.toContain('aedilis');
    expect(s.guidance.advisories['aedilis.morale']).toBeUndefined();
    s.day = 242;
    day(s);
    expect(s.guidance.appointed).toContain('augur');                  // Kal. Sept. AUC DCCC
    expect(s.guidance.appointed).toEqual(ADVISORS.filter((a) => s.guidance.appointed.includes(a)));
  });
  it('appoints the Aedilis with his first favour advisory, though every founding home has its well within reach', () => {
    const s = fresh(42);
    for (const b of houses(s)) expect(houseHas(s, b.id, 'water')).toBe(true);
    expect(s.guidance.appointed).not.toContain('aedilis');
    day(s);
    expect(s.guidance.appointed).toContain('aedilis');
    expect(s.guidance.advisories['aedilis.favour']?.active).toBe(true);
  });
  it('replays identically from a JSON copy (no hidden state)', () => {
    const a = run(base(), 60);
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    run(a, 60); run(b, 60);
    expect(JSON.stringify(b.guidance)).toBe(JSON.stringify(a.guidance));
  });
});

describe('fabrum.labour: "We lack N hands" (R10)', () => {
  const L = 'fabrum.labour';
  const lack = (p: Patch): Patch => ({ ...p, c: { idle: [], catSlots: { ...ZERO, food: 10, materials: 8 }, catStaffed: { ...ZERO, materials: 1 } } });
  it('stays quiet while the stores hold months, however negative the 3-day net', () => {
    const s = base();
    for (let i = 0; i < 5; i++) day(s, lack({ grain: { stock: 6000, net3: -20 }, water: { stock: 3000, net3: -5 } }));
    expect(s.guidance.advisories[L]?.active ?? false).toBe(false);
  });
  it('stays quiet when the short essential has no open post (it wants a work, not hands)', () => {
    const s = base();
    day(s, lack({ water: { stock: 10, net3: -2 } }));                // water short, but no open post at the wells
    expect(s.guidance.advisories[L]?.active ?? false).toBe(false);
  });
  it('raises a Cave on a short runway and first offers the short work\'s hands, usable', () => {
    const s = base();
    const p = lack({ grain: { stock: 100, net3: -10 } });
    day(s, p);
    const m = s.guidance.advisories[L]!;
    expect(m.active).toBe(true);
    expect(m.sev).toBe(2);
    const r = renderAdvisory(s, fake(s, p), { rule: L, advisor: 'fabrum', memo: m });
    expect(r.text).toMatch(/grain lasts 10 days/);
    expect(r.remedies[0].remedy).toEqual({ kind: 'priority', cat: 'food', days: B.ordo.PRIORITY_DAYS });
    expect(r.remedies[0].check.ok).toBe(true);
    s.ordo.on.labour = false;
    expect(renderAdvisory(s, fake(s, p), { rule: L, advisor: 'fabrum', memo: m }).remedies[0].remedy).toEqual({ kind: 'open', tab: 'people', anchor: 'labour' });
  });
});

describe('annonae.storage: full sheds (R12)', () => {
  const S = 'annonae.storage';
  const render = (s: GameState, p: Patch) => renderAdvisory(s, fake(s, p), { rule: S, advisor: 'annonae', memo: s.guidance.advisories[S]! });
  it('full stores and the open sheds\' ordinary rot stay off the counsel card; spilling grain does not', () => {
    const s = base();
    for (let i = 0; i < A.RULES.STORAGE_DAYS; i++) day(s, { rot: 1.1, grain: { stock: 990, cap: 1000, net3: 5 } });
    expect(s.guidance.advisories[S]!.active).toBe(true);
    expect(s.guidance.advisories[S]!.sev).toBe(0);
    expect(activeAdvisories(s, { forCard: true }).map((a) => a.rule)).not.toContain(S);
    expect(render(s, { rot: 1.1 }).title).toBe('Grain rots in the open sheds: 1.1 a day.');
    day(s, { spill: 6, rot: 1.1, grain: { stock: 1000, cap: 1000, net3: 5 } });
    expect(s.guidance.advisories[S]!.sev).toBe(1);
    expect(render(s, {}).title).toBe('The sheds overflow: 6 grain a day spills and 1.1 rots.');
  });
  it('with more than twice the grain reserve in store, selling comes before another granary', () => {
    const s = base();
    s.rank = 1;                                                        // Commercium is open
    day(s, { rot: 4, grain: { stock: 990, cap: 1000, doh: 200 } });
    const rich = render(s, {}).remedies.map((r) => r.remedy.kind);
    expect(rich[0]).toBe('contract');
    expect(rich).toContain('place');
    const t = base();
    t.rank = 1;
    day(t, { rot: 4, grain: { stock: 990, cap: 1000, doh: 30 } });
    expect(render(t, {}).remedies[0].remedy).toEqual({ kind: 'place', building: 'horreum' });
  });
});

describe('aedilis.favour: the pace, what holds the settlers back, the Pave brush (playtest #6)', () => {
  const F = 'aedilis.favour';
  const PAVE: Remedy = { kind: 'tool', tool: 'pave' };
  const render = (s: GameState) => renderAdvisory(s, view(s), { rule: F, advisor: 'aedilis', memo: s.guidance.advisories[F]! });
  const remedies = (s: GameState): Remedy[] => render(s).remedies.map((x) => x.remedy);
  const plenty = (s: GameState): void => { s.res.grain = 1e5; s.res.water = 1e5; };

  it('gives the pace in days and names what holds the settlers back most', () => {
    const s = base();
    plenty(s);
    s.morale = 80;
    day(s);
    expect(s.guidance.advisories[F]?.active).toBe(true);
    let r = render(s);
    expect(r.title).toBe(`Colonists come slowly: about one family every ${int(1 / immigrationChance(s))} days.`);
    expect(r.text).toMatch(/^Rome's favour stands at ×1\.0 of ×3: gardens and paved streets among the homes draw settlers faster; the Ordo raises neither/);
    s.morale = 40;                                                   // spirits now hold them back more than the favour
    r = render(s);
    expect(r.text).toMatch(/^Spirits hold them back most \(40\): .* Rome's favour stands at ×1\.0 of ×3 as well: /);
    s.morale = 25;                                                   // below 30 Rome draws none at all
    expect(render(s).title).toBe('No colonists come: Rome draws none to us at this pace.');
  });

  it('offers the Pave brush once it is ours, where paving would raise the favour; the garden stays first', () => {
    const s = base();
    plenty(s);
    s.res.stone = 50;
    day(s);
    expect(remedies(s)[0]).toEqual({ kind: 'place', building: 'hortus' });   // the advisor-follower bot's pick is unchanged
    expect(remedies(s)).not.toContainEqual(PAVE);                            // the brush comes with the Templum (Res Gestae)
    expect(checkRemedy(s, PAVE)).toMatchObject({ ok: false, code: 'locked', reason: 'Unlocked by the Res Gestae: Raise a Templum' });
    s.guidance.milestoneDays.templum = s.day;
    expect(favourPaces(s)).toBeGreaterThan(0);                               // the camp's dirt streets, the via
    expect(remedies(s)[1]).toEqual(PAVE);
    // as many paces as lift the favour to its height (×3 for the camp's few homes), not every dirt road there is
    const homes = houses(s).length, R = B.people.RENOWN;
    const k = Math.min(favourPaces(s), Math.ceil(((R.MAX - renownFactor(s)) * homes) / (R.K * B.dignitas.ROADS)));
    expect(k).toBeLessThan(favourPaces(s));
    expect(render(s).text).toMatch(new RegExp(` Paving ${k} paces of our dirt roads \\(${k * B.map.PAVE_STONE} stone\\) would raise it to ×3\\.0\\.$`));
    expect(checkRemedy(s, PAVE).ok).toBe(true);
    expect(isUiRemedy(PAVE)).toBe(true);                                     // App starts the brush (ARCHITECTURE §13.6)
    expect(remedyLabel(s, PAVE)).toBe(`Pave roads (${B.map.PAVE_STONE} stone a pace)`);
    const before = JSON.stringify(s);
    expect(applyRemedy(s, PAVE)).toEqual({ ok: true });
    expect(JSON.stringify(s)).toBe(before);
    s.res.stone = 1;
    expect(checkRemedy(s, PAVE)).toMatchObject({ ok: false, code: 'unaffordable' });
    // every road paved: nothing left to raise the favour with the brush
    s.paved = [...s.roads];
    invalidate(s);
    expect(favourPaces(s)).toBe(0);
    expect(remedies(s)).not.toContainEqual(PAVE);
    expect(checkRemedy(s, PAVE).ok).toBe(false);
  });

  it('offers the brush only where its sentence names the raise: none for a few paces among many homes', () => {
    const s = base();
    plenty(s);
    s.res.stone = 50;
    s.guidance.milestoneDays.templum = s.day;
    extraHouses(s, 0);                                                     // 16 homes: a pace adds ×0.0125
    day(s);
    expect(s.guidance.advisories[F]?.active).toBe(true);
    // two dirt paces left that Rome would mark: ×0.025 more, too little to name
    const all = [...s.roads];
    s.roads = [];
    s.paved = [];
    for (const i of all) {
      invalidate(s);
      if (favourPaces(s) >= 2) break;
      s.roads.push(i);
    }
    expect(favourPaces(s)).toBe(2);
    expect(renownFactor(s)).toBeLessThan(B.people.RENOWN.MAX);
    const r = render(s);
    expect(r.text).not.toMatch(/Paving/);
    expect(r.remedies.map((x) => x.remedy)).not.toContainEqual(PAVE);
  });
});

describe('aedilis.morale under emergency rations (R19)', () => {
  it('offers no rations edict while the Lex de annona\'s cut sets the portion, but food for the granary', () => {
    const s = base();
    s.rank = 1;
    s.guidance.milestoneDays.fed30 = s.day;                          // the rationes edict is unlocked
    s.ordo.emergency.rations = 'parcae';
    const terms = moraleTarget(s, view(s)).terms.map((x) => x.label);
    expect(terms).toContain('Emergency rations: Parcae');
    s.morale = 30;
    ctl.morale = { value: 40, terms: [{ label: 'Emergency rations: Parcae', value: -6 }, { label: 'Deaths', value: -4 }] };
    day(s);
    const m = s.guidance.advisories['aedilis.morale']!;
    expect(m.active).toBe(true);
    const r = renderAdvisory(s, view(s), { rule: 'aedilis.morale', advisor: 'aedilis', memo: m }).remedies.map((x) => x.remedy);
    expect(r.some((x) => x.kind === 'edict' && x.edict === 'rationes')).toBe(false);
    expect(r[0]).toEqual({ kind: 'place', building: bestFood(s) });
    ctl.morale = null;
    s.ordo.emergency.rations = 'none';
    expect(moraleTarget(s, view(s)).terms.map((x) => x.label).some((l) => l.startsWith('Emergency'))).toBe(false);
  });
});

describe('the Legate\'s relief remedy (R20) and dates in remedy reasons (R48)', () => {
  it('is disabled during the cooldown under Annona publica too, exactly when applying it would fail', () => {
    const s = base();
    s.decisions.paths.path3 = 'annonaPublica';
    s.ordo.emergency.lastRelief = s.day - 100;
    const c = checkRemedy(s, { kind: 'relief' });
    expect(c.ok).toBe(false);
    expect(c.ok ? '' : c.reason).toMatch(/^The Legate helped us lately; he hears us again on .+\.$/);
    expect(c.ok ? '' : c.reason).not.toMatch(/\.\.$/);
    expect(applyRemedy(structuredClone(s), { kind: 'relief' }).ok).toBe(c.ok);
    s.ordo.emergency.lastRelief = s.day - B.emergency.RELIEF_COOLDOWN;
    expect(checkRemedy(s, { kind: 'relief' }).ok).toBe(true);
    expect(applyRemedy(structuredClone(s), { kind: 'relief' }).ok).toBe(true);
  });
  it('ends a date in its own point, not two', () => {
    const s = base();
    s.ordo.priorities.push({ cat: 'food', until: s.day + 20 });
    const c = checkRemedy(s, { kind: 'priority', cat: 'food', days: 30 });
    expect(c.ok ? '' : c.reason).toMatch(/^Food already comes first until .+\.$/);
    expect(c.ok ? '' : c.reason).not.toMatch(/\.\.$/);
  });
});

describe('fabrum.capitolium names what really holds it back (R23, playtest #7)', () => {
  const C = 'fabrum.capitolium';
  const say = (s: GameState) => renderAdvisory(s, view(s), { rule: C, advisor: 'fabrum', memo: s.guidance.advisories[C]! });
  const levers = (s: GameState) => say(s).remedies.map((x) => x.remedy);

  it('a material in its own units: what is in store and what comes in a day, against what the crew would use', () => {
    const s = base();
    ctl.flow = { ...FLOW, bottleneck: 'stone', supply: 1.7, demand: 3.8, stock: 12, inflow: 1.3, crew: 64 };
    day(s);
    expect(say(s).title).toBe('At this flow the Cella rises in 400 days; it waits for stone: 12 in store, +1.3/day of 3.8.');
    expect(levers(s)).toContainEqual({ kind: 'place', building: 'lapicidina' });
    expect(levers(s)).not.toContainEqual({ kind: 'edict', edict: 'opera', option: 'magna' });   // harder work lays no more stone
  });

  it('concrete works without water: it names the water, and the remedies bring water to the works', () => {
    const s = base();
    ctl.flow = { ...FLOW, eta: null, rate: 0, bottleneck: 'concrete', demand: 3.9, starved: { works: 'caementarium', input: 'water', share: 0 } };
    day(s);
    const r = say(s);
    expect(r.title).toBe('At this flow the Cella will not rise; it waits for concrete: 0 in store, +0/day of 3.9.');
    expect(r.text).toBe('The Caementarium (concrete works) gets no water, so the temple waits for its concrete. The Capitolium stands at stage I of IV.');
    expect(levers(s)).toEqual([{ kind: 'edict', edict: 'aquae', option: 'operibus' }, { kind: 'place', building: 'puteus' }]);
    s.decisions.edicts.aquae = 'operibus';                          // a lever in force is not offered again
    day(s);
    expect(levers(s)).toEqual([{ kind: 'place', building: 'puteus' }]);
    s.decisions.edicts.aquae = 'populo';
    s.ordo.emergency.waterPause = true;                              // nor one the Lex de annona's water pause overrules
    day(s);
    expect(levers(s)).toEqual([{ kind: 'place', building: 'puteus' }]);
  });

  it('the full crew: "at its maximum", Opera Magna the one lever, and silence once it is in force', () => {
    const s = base();
    ctl.flow = { ...FLOW };
    day(s);
    expect(say(s).title).toBe('At this flow the Cella rises in 400 days; the crew is at its maximum (64 fabri, the most that can work on it).');
    expect(levers(s)).toEqual([{ kind: 'edict', edict: 'opera', option: 'magna' }]);   // never the builder share: it adds no crew
    s.decisions.edicts.opera = 'magna';
    for (let i = 0; i < LIFE; i++) day(s);
    expect(s.guidance.advisories[C]!.active).toBe(false);
  });

  it('a crew short of 64: more builders (by hand, or builders first), not the builder share', () => {
    const s = base();
    ctl.flow = { ...FLOW, crew: 40 };
    day(s);
    expect(say(s).title).toBe('At this flow the Cella rises in 400 days; the crew is the bottleneck (40 of the 64 fabri who could work on it).');
    expect(levers(s)).toEqual([{ kind: 'priority', cat: 'builders', days: B.ordo.PRIORITY_DAYS }, { kind: 'edict', edict: 'opera', option: 'magna' }]);
    s.ordo.on.labour = false;
    day(s);
    expect(levers(s)[0]).toEqual({ kind: 'assign', cat: 'builders', n: 24 });
    expect(levers(s).some((x) => x.kind === 'setting')).toBe(false);
  });
});

describe('fabrum.stalled: a plan that waits on works idle for water (playtest #8)', () => {
  it('names the idle concrete works and why, and offers Aequa, a reserve the stock meets and water, not patience', () => {
    const s = base();
    s.rank = 2;
    invalidate(s);
    const at = freeSlots(s, 'caementarium')[0];
    const r = place(s, 'caementarium', at.x, at.y, { ignoreCost: true, noStake: true });
    if (!r.ok) throw new Error(r.reason);
    const works = s.buildings.find((b) => b.id === r.id)!;
    Object.assign(works, { status: 'done', progress: 1 });
    invalidate(s);
    setJobs(s, { perBuilding: { [works.id]: 2 } });
    s.res.concrete = 0;
    s.res.water = 5 * census(s).need.water;                                      // 5 days: below the 15-day reserve
    s.buildings.push({ id: s.nextId++, type: 'balneum', x: 2, y: 2, owner: 'player', status: 'plan', placed: s.day - 30, progress: 0, work: 160, paid: false, order: 1, open: true, prio: 1 });
    invalidate(s);
    day(s);
    const m = s.guidance.advisories['fabrum.stalled']!;
    expect(m.active).toBe(true);
    const out = renderAdvisory(s, view(s), { rule: 'fabrum.stalled', advisor: 'fabrum', memo: m });
    expect(out.title).toMatch(/has waited \d+ days for .*20 concrete/);
    // a fresh colony's stores hold 17 days: the works may draw above three-quarters of them, 13 days, not the 15 asked
    expect(out.text).toMatch(/^It stays a plan until the stores cover it, and our concrete works .+ stand idle: the water reserve is not met; the stores hold 5 days, and the works draw only above 13, three-quarters of the 17 a full store holds\. Under Populo prius the people drink first\.$/);
    expect(out.remedies.map((x) => x.remedy).slice(0, 2)).toEqual([
      { kind: 'edict', edict: 'aquae', option: 'aequa' }, { kind: 'setting', setting: 'waterReserve', value: 5 },
    ]);
    expect(out.remedies).toHaveLength(3);
    // with the water flowing to the works again, the plan only waits: the old counsel
    s.decisions.edicts.aquae = 'aequa';
    const calm = renderAdvisory(s, view(s), { rule: 'fabrum.stalled', advisor: 'fabrum', memo: m });
    expect(calm.text).toBe('It stays a plan until the stores cover it; every day of production brings it nearer.');
    expect(calm.remedies[0].remedy).toEqual({ kind: 'building', op: 'prioritise', id: m.params.id });
  });
});

describe('quaestor.merchant before Commercium opens (R28)', () => {
  it('a merchant at a Castra the player cannot trade from raises no counsel', () => {
    const s = base();
    s.trade.merchant = { name: 'Syrian spice traders', arrived: s.day, until: s.day + 12, offers: [{ id: 1, kind: 'buy', res: 'grain', qty: 40, price: 2, taken: false }] };
    day(s, { grain: ess(1000, -100) });
    expect(s.guidance.advisories['quaestor.merchant']?.active ?? false).toBe(false);
    s.decisions.paths.charter = 'mercatores';                       // the Mercatores charter opens Commercium at Castra
    day(s, { grain: ess(1000, -100) });
    expect(s.guidance.advisories['quaestor.merchant']?.active).toBe(true);
  });
});

describe('remedies', () => {
  it('applies sim remedies through the actions and leaves UI remedies to the UI', () => {
    const s = base();
    // the setting and the edict are unlocked by their milestones (WP-D's reveal; the phase-1 stub unlocked everything)
    for (const m of [SETTING_DEFS.grainReserve.unlock, EDICT_DEFS.rationes.unlock]) s.guidance.milestoneDays[m] = s.day;
    expect(applyRemedy(s, { kind: 'setting', setting: 'grainReserve', value: 60 }).ok).toBe(true);
    expect(s.decisions.settings.grainReserve).toBe(60);
    expect(checkRemedy(s, { kind: 'setting', setting: 'grainReserve', value: 60 }).ok).toBe(false);
    expect(applyRemedy(s, { kind: 'edict', edict: 'rationes', option: 'parcae' }).ok).toBe(true);
    const w = checkRemedy(s, { kind: 'edict', edict: 'rationes', option: 'largae' });
    expect(w.ok ? '' : w.reason).toMatch(/^Next edict window: Kal\. Iun\./);
    expect(isUiRemedy({ kind: 'place', building: 'puteus' })).toBe(true);
    expect(remedyLabel(s, { kind: 'priority', cat: 'food', days: 30 })).toBe('Food first for 30 days');
    expect(remedyLabel(s, { kind: 'edict', edict: 'tributum', option: 'grave' })).toBe('Edict: Tributum Grave');
    expect(checkRemedy(s, { kind: 'place', building: 'thermae' })).toMatchObject({ ok: false, code: 'rankLocked' });
  });
  it('a focus remedy says before it is applied what the council will raise (Urbs: gardens on free plots)', () => {
    expect(remedyTip({ kind: 'focus', focus: 'urbs' })).toMatch(/^Urbs · The city beautiful\n.*gardens on free plots/);
    expect(remedyTip({ kind: 'place', building: 'hortus' })).toBeNull();
    const s = base();
    const memo = { rule: 'aedilis.favour' as const, active: true, sev: 1 as const, since: s.day, lowerSince: null, params: { f: 1.2 }, flips: [] };
    expect(renderAdvisory(s, view(s), { rule: 'aedilis.favour', advisor: 'aedilis', memo }).text).toContain('then it plants gardens on free plots');
  });
  it('never throws over random states and random remedies', () => {
    const rng = new Rng(7);
    const pick = <T>(xs: readonly T[]): T => xs[rng.int(0, xs.length - 1)];
    for (let k = 0; k < 25; k++) {
      const s = run(fresh(1 + k), rng.int(0, 40));
      s.rank = rng.int(0, 4) as GameState['rank'];
      for (const r of Object.keys(s.res) as (keyof GameState['res'])[]) s.res[r] = pick([0, 1, 50, 1e6]);
      for (const a of ORDO_AREAS) s.ordo.on[a] = rng.chance(0.5);
      if (rng.chance(0.3)) choice(rng.int(1, 30))(s);
      if (rng.chance(0.3)) s.buildings = s.buildings.filter(() => rng.chance(0.7));
      if (rng.chance(0.3)) s.people = s.people.filter(() => rng.chance(0.5));
      invalidate(s);
      const v = view(s);
      for (const rule of RULE_DEFS) expect(() => rule.evaluate(s, v)).not.toThrow();
      const remedies: Remedy[] = [
        { kind: 'ask', building: pick(BUILDINGS) }, { kind: 'place', building: pick(BUILDINGS), tile: rng.int(-5, 99999) },
        { kind: 'priority', cat: pick(LABOR_CATS), days: rng.int(-1, 30) }, { kind: 'assign', cat: pick(LABOR_CATS), n: rng.int(-1, 5) },
        { kind: 'edict', edict: pick(EDICTS), option: pick(['parcae', 'grave', 'nope']) }, { kind: 'setting', setting: pick(SETTINGS), value: rng.range(-10, 4000) },
        { kind: 'switch', sw: 'emergency', value: rng.chance(0.5) }, { kind: 'focus', focus: 'copia' },
        { kind: 'contract', spec: { hub: pick(HUBS), mode: pick(['import', 'export'] as const), res: pick(TRADE_RES), qty: rng.int(-5, 200), repeat: false } },
        { kind: 'buyNow', res: pick(TRADE_RES), qty: rng.int(0, 500) }, { kind: 'relief' }, { kind: 'toggleOrdo', area: pick(ORDO_AREAS), on: rng.chance(0.5) },
        { kind: 'building', op: pick(['open', 'close', 'prioritise', 'center'] as const), id: rng.int(0, 200) },
        { kind: 'clear', building: pick(BUILDINGS), tile: rng.int(-5, 99999), ids: [rng.int(0, 200)] },
        { kind: 'open', tab: pick(TABS), anchor: 'petition' }, { kind: 'overlay', overlay: pick(OVERLAYS) },
        { kind: 'tool', tool: pick(['road', 'pave', 'reserve', 'demolish'] as const) },
      ];
      for (const r of remedies) {
        expect(() => { checkRemedy(s, r); remedyLabel(s, r); applyRemedy(structuredClone(s), r); }).not.toThrow();
      }
      for (const a of activeAdvisories(s)) expect(() => renderAdvisory(s, v, a)).not.toThrow();
    }
  });
});

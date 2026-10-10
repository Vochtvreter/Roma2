// tests/data.test.ts — registry completeness (ARCHITECTURE §14.1) and the DESIGN §18.1 start state. Owner: scaffold.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADD_KEYS, ADVISORS, BUILDINGS, EDICTS, EVENTS, FESTIVALS, FOCUSES, HOUSE_TIERS, HUBS, LABOR_CATS, LAYERS, MILESTONE_IDS,
  MUL_KEYS, NEEDS, ORDO_AREAS, OVERLAYS, PATH_DECISIONS, PATH_OPTIONS, RANK_IDS, RESOURCES, RULES, SEASONS, SETTINGS,
  SKILLS, STAGES, SWITCHES, TABS, TIPS, TRADE_RES,
} from '../src/game/types';
import type { BuildCat, BuildingId, Cost, Effects, GameState, PathOptionId } from '../src/game/types';
import { RESOURCE_DEFS } from '../src/game/data/resources';
import { BUILDING_DEFS, BUILD_ORDER, CAT_LABELS, TOOL_ORDER } from '../src/game/data/buildings';
import { LAYER_META, NEED_META, TIER_DEFS } from '../src/game/data/housing';
import { EDICT_DEFS, FOCUS_DEFS, PATH_DEFS, SETTING_DEFS, SWITCH_DEFS } from '../src/game/data/decisions';
import { RANK_DEFS } from '../src/game/data/ranks';
import { HUB_DEFS, MERCHANT_NAMES, SEASON_TARGET, TRADE_BASE } from '../src/game/data/hubs';
import {
  COLONY_NAMES, DAUGHTER_COG, GENTES_FOUNDING, GENTES_IMMIGRANT, GENTES_VETERAN, PRAENOMINA, feminine,
} from '../src/game/data/names';
import { ADVISOR_DEFS, MENTOR } from '../src/game/data/advisors';

const BUILD_CATS: BuildCat[] = ['domus', 'annona', 'aqua', 'materia', 'officinae', 'mercatus', 'religio', 'salus', 'ornamenta', 'civitas'];

/** Keys of a registry equal the id array exactly (one def per id), and every def's `id` matches its key. */
function expectRegistry(rec: Record<string, { id: string }>, ids: readonly string[]): void {
  expect(Object.keys(rec).sort()).toEqual([...ids].sort());
  for (const id of ids) expect(rec[id].id).toBe(id);
}
function expectKeys(rec: object, ids: readonly string[]): void {
  expect(Object.keys(rec).sort()).toEqual([...ids].sort());
}
function expectCost(c: Cost): void {
  for (const [k, v] of Object.entries(c)) {
    expect(RESOURCES as readonly string[]).toContain(k);
    expect(Number.isFinite(v) && (v ?? -1) >= 0).toBe(true);
  }
}
function expectEffects(fx: Effects): void {
  for (const [k, v] of Object.entries(fx.mul ?? {})) {
    expect(MUL_KEYS as readonly string[]).toContain(k);
    expect(Number.isFinite(v) && (v ?? -1) >= 0).toBe(true);
  }
  for (const [k, v] of Object.entries(fx.add ?? {})) {
    expect(ADD_KEYS as readonly string[]).toContain(k);
    expect(Number.isFinite(v)).toBe(true);
  }
}

describe('id arrays', () => {
  it('every frozen id array is free of duplicates', () => {
    const arrays: readonly (readonly string[])[] = [
      RESOURCES, TRADE_RES, BUILDINGS, HOUSE_TIERS, RANK_IDS, SEASONS, STAGES, SKILLS, LABOR_CATS, LAYERS, NEEDS, FOCUSES,
      EDICTS, SETTINGS, SWITCHES, PATH_DECISIONS, PATH_OPTIONS, ORDO_AREAS, ADVISORS, RULES, TIPS, MILESTONE_IDS, EVENTS,
      FESTIVALS, HUBS, TABS, OVERLAYS, MUL_KEYS, ADD_KEYS,
    ];
    for (const a of arrays) expect(new Set(a).size).toBe(a.length);
  });
  it('every rule id prefix is an AdvisorId and every advisor owns a rule', () => {
    for (const r of RULES) expect(ADVISORS as readonly string[]).toContain(r.split('.')[0]);
    for (const a of ADVISORS) expect(RULES.some(r => r.startsWith(a + '.'))).toBe(true);
    expect(RULES.length).toBe(22);
  });
});

describe('resources (DESIGN §4)', () => {
  it('one def per resource', () => expectRegistry(RESOURCE_DEFS, RESOURCES));
  it('caps and trade prices', () => {
    expect(RESOURCE_DEFS.grain.baseCap).toBe(600);
    expect(RESOURCE_DEFS.water.baseCap).toBe(300);
    expect(RESOURCE_DEFS.tools.baseCap).toBe(20);
    for (const r of RESOURCES) {
      const d = RESOURCE_DEFS[r];
      expect(d.baseCap).toBeGreaterThan(0);
      expect(d.icon).toBe(`i_${r}`);
      expect(d.trade !== null).toBe((TRADE_RES as readonly string[]).includes(r));
    }
    for (const r of TRADE_RES) expect(RESOURCE_DEFS[r].trade).toBe(TRADE_BASE[r]);
  });
});

describe('buildings (DESIGN §5)', () => {
  it('29 buildings, one def each', () => {
    expect(BUILDINGS.length).toBe(29);
    expectRegistry(BUILDING_DEFS, BUILDINGS);
  });
  it('every row is well-formed', () => {
    for (const id of BUILDINGS) {
      const d = BUILDING_DEFS[id];
      expect(d.place.length).toBeGreaterThan(0);
      expect(d.place.includes('fixed')).toBe(d.rule === 'fixed');
      expect(d.slots > 0).toBe(d.labor !== null);
      expect(d.slots > 0).toBe(d.skill !== null);
      expect(d.rank >= 0 && d.rank <= 4).toBe(true);
      expect(BUILD_CATS).toContain(d.cat);
      expect(d.size.every(n => Number.isInteger(n) && n >= 2)).toBe(true);
      expectCost(d.cost);
      if (d.perTile) expectCost(d.perTile.cost);
      if (d.storage) expectCost(d.storage);
      if (d.inputs) expectCost(d.inputs);
      if (d.output) expect(RESOURCES as readonly string[]).toContain(d.output.res);
      if (d.passive) expect(RESOURCES as readonly string[]).toContain(d.passive.res);
      if (d.inputs) expect(d.output).toBeDefined();
      if (d.seasons) expect(d.seasons.length).toBe(4);
      if (d.fxKey) expect(MUL_KEYS as readonly string[]).toContain(d.fxKey);
      for (const sv of d.service ?? []) {
        expect(LAYERS as readonly string[]).toContain(sv.layer);
        expect(sv.radius).toBeGreaterThan(0);
      }
      expect(d.upkeep).toBeGreaterThanOrEqual(0);
      expect(d.tool).toBe(TOOL_ORDER.includes(id));
      for (const s of [d.name, d.latin, d.desc, d.benefit, d.hint]) expect(s.length).toBeGreaterThan(0);
    }
  });
  it('spot-checks the numbers the opening depends on (DESIGN §18.2)', () => {
    expect(BUILDING_DEFS.puteus.output).toEqual({ res: 'water', perWorker: 11 });
    expect(BUILDING_DEFS.puteus.seasons).toEqual([1, 0.8, 1, 1]);
    expect(BUILDING_DEFS.ager.output).toEqual({ res: 'grain', perWorker: 6 });
    expect(BUILDING_DEFS.ager.seasons?.[3]).toBe(0.35);
    expect(BUILDING_DEFS.cisterna.passive).toEqual({ res: 'water', perDay: 8 });
    expect(BUILDING_DEFS.cisterna.work).toBe(25);
    expect(BUILDING_DEFS.horreum.storage).toEqual({ grain: 4000 });
    expect(BUILDING_DEFS.capitolium.work).toBe(320_000);
    expect(BUILDING_DEFS.thermae.cost).toEqual({ denarii: 600, timber: 60, stone: 300, tiles: 80, concrete: 120, iron: 20 });
  });
  it('BUILD_ORDER lists every placeable type once, by rank', () => {
    const placeable = BUILDINGS.filter(b => !BUILDING_DEFS[b].place.includes('fixed'));
    expect([...BUILD_ORDER].sort()).toEqual([...placeable].sort());
    for (let i = 1; i < BUILD_ORDER.length; i++) {
      expect(BUILDING_DEFS[BUILD_ORDER[i]].rank).toBeGreaterThanOrEqual(BUILDING_DEFS[BUILD_ORDER[i - 1]].rank);
    }
  });
  it('category labels cover every category', () => expectKeys(CAT_LABELS, BUILD_CATS));
});

describe('ranks (DESIGN §9.1)', () => {
  it('five ranks in order with the DESIGN numbers', () => {
    expect(RANK_DEFS.map(r => r.id)).toEqual([...RANK_IDS]);
    RANK_DEFS.forEach((r, i) => { expect(r.index).toBe(i); expect(r.forumStage).toBe(i); expectCost(r.fee); });
    expect(RANK_DEFS.map(r => r.ceiling)).toEqual([100, 260, 560, 900, 1500]);
    expect(RANK_DEFS.map(r => r.territory)).toEqual([20, 26, 34, 44, 999]);
    expect(RANK_DEFS.map(r => r.immRate)).toEqual([0.014, 0.011, 0.0075, 0.0035, 0.04]);
    expect(RANK_DEFS.map(r => r.dignitas)).toEqual([0, 12, 40, 100, 190]);
    expect(RANK_DEFS.map(r => r.subsidy)).toEqual([3, 1.5, 0, 0, 0]);
  });
  it('every building except the principia is unlocked exactly once, at its own rank', () => {
    const all = RANK_DEFS.flatMap(r => r.unlocks);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(BUILDINGS.filter(b => b !== 'principia').sort());
    for (const r of RANK_DEFS) for (const b of r.unlocks) expect(BUILDING_DEFS[b].rank).toBe(r.index);
  });
  it('every hub opens exactly once, at its own rank', () => {
    const all = RANK_DEFS.flatMap(r => r.hubs);
    expect([...all].sort()).toEqual([...HUBS].sort());
    for (const r of RANK_DEFS) for (const h of r.hubs) expect(HUB_DEFS[h].rank).toBe(r.index);
  });
});

describe('housing (DESIGN §7.1)', () => {
  it('one def per tier, need and layer', () => {
    expectRegistry(TIER_DEFS, HOUSE_TIERS);
    expectKeys(NEED_META, NEEDS);
    expectKeys(LAYER_META, LAYERS);
    for (const l of LAYERS) expect(LAYER_META[l].color).toMatch(/^#[0-9a-f]{6}$/);
    for (const n of NEEDS) expect(NEED_META[n].icon).toBe(`i_want_${n}`);
  });
  it('tiers: beds, tax, levels, cumulative needs in NEEDS order', () => {
    expect(HOUSE_TIERS.map(t => TIER_DEFS[t].beds)).toEqual([5, 8, 10, 13, 24, 10]);
    expect(HOUSE_TIERS.map(t => TIER_DEFS[t].tax)).toEqual([0.02, 0.04, 0.06, 0.12, 0.11, 0.40]);
    expect(HOUSE_TIERS.map(t => TIER_DEFS[t].level)).toEqual([0, 1, 2, 3, 4, 4]);
    expect(HOUSE_TIERS.map(t => TIER_DEFS[t].desirMin)).toEqual([null, null, -5, 0, -3, 10]);
    expect(TIER_DEFS.domus.patrician).toBe(true);
    for (const t of HOUSE_TIERS) {
      const d = TIER_DEFS[t];
      const pos = d.needs.map(n => NEEDS.indexOf(n));
      expect(pos.every(p => p >= 0)).toBe(true);
      expect([...pos].sort((a, b) => a - b)).toEqual(pos);
      expect(d.needs).not.toContain('materials');
      expect(d.needs.includes('rank')).toBe(d.rank > 0);
      expect(d.needs.includes('desirability')).toBe(d.desirMin !== null);
      expectCost(d.renovation);
    }
    const prev = { 1: 'tentoria', 2: 'casa', 3: 'tegulata', 4: 'domusParva' } as const;
    for (const t of HOUSE_TIERS) {
      const lvl = TIER_DEFS[t].level;
      if (lvl === 0) continue;
      for (const n of TIER_DEFS[prev[lvl]].needs) expect(TIER_DEFS[t].needs).toContain(n);
    }
  });
});

describe('decisions (DESIGN §9.2, §10.8–10.10)', () => {
  it('one def per focus, edict, setting, switch and path decision', () => {
    expectRegistry(FOCUS_DEFS, FOCUSES);
    expectRegistry(EDICT_DEFS, EDICTS);
    expectRegistry(SETTING_DEFS, SETTINGS);
    expectRegistry(SWITCH_DEFS, SWITCHES);
    expectRegistry(PATH_DEFS, PATH_DECISIONS);
  });
  it('focus plans name buildings and splits sum to 1', () => {
    for (const f of FOCUSES) {
      const d = FOCUS_DEFS[f];
      expect(d.plan.length).toBeGreaterThan(0);
      for (const [b, n] of d.plan) { expect(BUILDINGS as readonly string[]).toContain(b); expect(n).toBeGreaterThanOrEqual(1); }
      for (const k of Object.keys(d.split)) expect(LABOR_CATS as readonly string[]).toContain(k);
      expect(Object.values(d.split).reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1, 9);
    }
  });
  it('9 edicts × 3 options; option ids unique within each edict; initial is an option', () => {
    expect(EDICTS.length).toBe(9);
    for (const e of EDICTS) {
      const d = EDICT_DEFS[e];
      const ids = d.options.map(o => o.id);
      expect(ids.length).toBe(3);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(d.initial);
      expect(ids[1]).toBe(d.initial);
      expect(MILESTONE_IDS as readonly string[]).toContain(d.unlock);
      for (const o of d.options) expectEffects(o.fx);
    }
    expect(EDICT_DEFS.rationes.options.map(o => o.id)).toEqual(['largae', 'plenae', 'parcae']);
  });
  it('15 path options in 5 decisions, each option exactly once', () => {
    expect(PATH_DECISIONS.length).toBe(5);
    const all: PathOptionId[] = PATH_DECISIONS.flatMap(p => PATH_DEFS[p].options.map(o => o.id));
    expect(all.length).toBe(15);
    expect([...all].sort()).toEqual([...PATH_OPTIONS].sort());
    for (const p of PATH_DECISIONS) {
      expect(PATH_DEFS[p].options.length).toBe(3);
      for (const o of PATH_DEFS[p].options) { expectEffects(o.fx); expect(o.visible?.length ?? 0).toBeGreaterThan(0); }
    }
    expect(PATH_DECISIONS.map(p => PATH_DEFS[p].grants)).toEqual([0, 1, 2, 3, 4]);
  });
  it('settings: defaults inside their range on a step; milestone unlocks', () => {
    for (const id of SETTINGS) {
      const d = SETTING_DEFS[id];
      expect(d.initial).toBeGreaterThanOrEqual(d.min);
      expect(d.initial).toBeLessThanOrEqual(d.max);
      const k = (d.initial - d.min) / d.step;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
      if (d.unit === '%') expect(d.max).toBeLessThanOrEqual(1);
      expect(MILESTONE_IDS as readonly string[]).toContain(d.unlock);
    }
    for (const id of SWITCHES) expect(SWITCH_DEFS[id].initial).toBe(true);
  });
});

describe('hubs and trade (DESIGN §13)', () => {
  it('one def per hub; quirks name tradeable goods', () => {
    expectRegistry(HUB_DEFS, HUBS);
    expectKeys(TRADE_BASE, TRADE_RES);
    expectKeys(SEASON_TARGET, TRADE_RES);
    for (const h of HUBS) for (const r of Object.keys(HUB_DEFS[h].quirks)) expect(TRADE_RES as readonly string[]).toContain(r);
    for (const r of TRADE_RES) expect(SEASON_TARGET[r].length).toBe(4);
    expect(MERCHANT_NAMES.length).toBe(5);
  });
  it('every good is sold by some hub; wine only by Silvanum, Narbo and Massilia', () => {
    const sellers = (r: (typeof TRADE_RES)[number]) => HUBS.filter(h => HUB_DEFS[h].quirks[r]?.buy !== 'refused');
    for (const r of TRADE_RES) expect(sellers(r).length).toBeGreaterThan(0);
    expect(sellers('wine')).toEqual(['silvanum', 'narbo', 'massilia']);
    expect(sellers('grain')).not.toContain('massilia');
    expect(sellers('iron')).not.toContain('narbo');
  });
});

describe('names and advisors', () => {
  it('name pools', () => {
    expect(PRAENOMINA.length).toBe(36);
    expect(new Set(PRAENOMINA).size).toBe(36);
    expect(DAUGHTER_COG).toEqual(['', 'Secunda', 'Tertia', 'Quarta', 'Quinta']);
    expect(GENTES_FOUNDING).toEqual(['Valerius', 'Antonius', 'Flavius', 'Cassius', 'Aemilius', 'Iulius']);
    expect(GENTES_VETERAN.length).toBe(14);
    expect(GENTES_IMMIGRANT.length).toBe(30);
    const gentes = [...GENTES_FOUNDING, ...GENTES_VETERAN, ...GENTES_IMMIGRANT];
    expect(new Set(gentes).size).toBe(gentes.length);
    expect(COLONY_NAMES[0]).toBe('Castra Valeria');
    expect(feminine('Valerius')).toBe('Valeria');
    expect(feminine('Iulius')).toBe('Iulia');
    expect(feminine('Crassus')).toBe('Crassa');
  });
  it('six advisors with the DESIGN tie order', () => {
    expectRegistry(ADVISOR_DEFS, ADVISORS);
    const byOrder = [...ADVISORS].sort((a, b) => ADVISOR_DEFS[a].order - ADVISOR_DEFS[b].order);
    expect(byOrder).toEqual(['annonae', 'aquarum', 'aedilis', 'fabrum', 'quaestor', 'augur']);
    expect(MENTOR.name).toBe('Decimus Cassius');
  });
});

// ───────────── DESIGN §18.1: newGame(42) (runs once state.ts exports newGame) ─────────────
type StateModule = typeof import('../src/game/state');
let stateMod: Partial<StateModule> = {};
try {
  stateMod = await import('../src/game/state');
} catch (e) {
  console.warn('data.test: src/game/state.ts is not loadable yet; the §18.1 start-state checks are skipped.', String(e));
}
const newGameFn = stateMod.newGame;

describe.runIf(typeof newGameFn === 'function')('newGame(42) matches DESIGN §18.1', () => {
  let s: GameState;
  beforeAll(() => { s = (newGameFn as StateModule['newGame'])({ seed: 42, now: 0 }); });
  const age = (born: number) => Math.floor((s.day - born) / 365);
  const stageOf = (born: number) => { const a = age(born); return a < 12 ? 0 : a < 16 ? 1 : a < 55 ? 2 : 3; };
  const person = (prae: string, gens: string) => s.people.filter(p => p.prae === prae && p.gens === gens && !p.female).sort((a, b) => a.born - b.born)[0];
  const ofType = (t: BuildingId) => s.buildings.filter(b => b.type === t);

  it('day, seed, rank, rng stream', () => {
    expect(s.day).toBe(90);
    expect(s.seed).toBe(42);
    expect(s.rank).toBe(0);
    expect(s.victory).toBe(false);
    expect(s.rng).toBe((42 ^ 0x9e3779b9) | 0);
  });
  it('24 people in 6 founding families: 13 adults, 3 youths, 8 children; need 20.35', () => {
    expect(s.people.length).toBe(24);
    expect(s.families.length).toBe(6);
    expect(s.families.map(f => f.gens).sort()).toEqual([...GENTES_FOUNDING].sort());
    const byStage = [0, 0, 0, 0];
    for (const p of s.people) byStage[stageOf(p.born)]++;
    expect(byStage).toEqual([8, 3, 13, 0]);
    const need = byStage[0] * 0.6 + byStage[1] * 0.85 + byStage[2] * 1 + byStage[3] * 0.75;
    expect(need).toBeCloseTo(20.35, 6);
    expect(person('Decimus', 'Cassius')).toBeDefined();
    for (let i = 1; i < s.people.length; i++) expect(s.people[i].id).toBeGreaterThan(s.people[i - 1].id);
  });
  it('starting stocks', () => {
    expect(s.res).toEqual({ denarii: 600, grain: 480, water: 240, timber: 80, stone: 40, tiles: 0, concrete: 0, ore: 0, iron: 0, tools: 4, oil: 0, wine: 0 });
  });
  it('six tentoria plots with 30 beds house everyone; principia, well and field stand', () => {
    const houses = ofType('area');
    expect(houses.length).toBe(6);
    for (const h of houses) { expect(h.status).toBe('done'); expect(h.house?.tier).toBe('tentoria'); }
    expect(houses.reduce((a, h) => a + TIER_DEFS[h.house?.tier ?? 'tentoria'].beds, 0)).toBe(30);
    const homes = new Set(houses.map(h => h.id));
    for (const p of s.people) expect(p.home !== null && homes.has(p.home)).toBe(true);
    for (const t of ['principia', 'puteus', 'ager'] as const) {
      expect(ofType(t).length).toBe(1);
      expect(ofType(t)[0].status).toBe('done');
    }
    for (const b of s.buildings) expect(b.owner).toBe('start');
    for (let i = 1; i < s.buildings.length; i++) expect(s.buildings[i].id).toBeGreaterThan(s.buildings[i - 1].id);
    expect(s.roads.length).toBeGreaterThan(0);
  });
  it('founding jobs: Marcus Valerius in the fields, Lucius Antonius and Titus Flavius at the well', () => {
    expect(person('Marcus', 'Valerius')?.work).toBe(ofType('ager')[0].id);
    expect(person('Lucius', 'Antonius')?.work).toBe(ofType('puteus')[0].id);
    expect(person('Titus', 'Flavius')?.work).toBe(ofType('puteus')[0].id);
  });
  it('meters, decisions, Ordo, market, advisors at their defaults', () => {
    expect(s.morale).toBe(65);
    expect(s.fed).toBe(1);
    expect(s.decisions.focus).toBe('concordia');
    for (const e of EDICTS) expect(s.decisions.edicts[e]).toBe(EDICT_DEFS[e].initial);
    for (const k of SETTINGS) expect(s.decisions.settings[k]).toBe(SETTING_DEFS[k].initial);
    for (const k of SWITCHES) expect(s.decisions.switches[k]).toBe(true);
    for (const a of ORDO_AREAS) expect(s.ordo.on[a]).toBe(true);
    for (const r of TRADE_RES) expect(s.trade.market[r]).toBe(1);
    expect([...s.guidance.appointed].sort()).toEqual(['annonae', 'aquarum', 'fabrum']);
  });
  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
  });
});

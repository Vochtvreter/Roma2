// tests/progression.test.ts — petitions, paths, edict windows, settings, milestones and reveal (WP-D, ARCHITECTURE §15).
import { beforeEach, describe, expect, it, vi } from 'vitest';
// decisions.ts is imported first on purpose: the real civic.ts imports housing.ts → decisions.ts, so if decisions.ts were
// first loaded from inside the civic mock's importOriginal() it would bind the original dignitas, not the mock below.
import {
  choosePath, edictWindow, isUnlocked, nextColonyLegacy, nextPath, pathStory, petitionNeeds, rankUp, setEdict, setFocus, setSetting,
  setSwitch, settingValue,
} from '../src/game/decisions';
import { HUBS, MILESTONE_IDS, PATH_DECISIONS } from '../src/game/types';
import type { Building, BuildingId, GameState, HouseTierId, MilestoneId, MulKey, AddKey } from '../src/game/types';
import { nextId } from '../src/game/state';
import { drainActionFx, invalidate, touchPeople } from '../src/game/memo';
import { fx, fxAdd } from '../src/game/fx';
import { formatRoman, nextSeasonStart } from '../src/game/calendar';
import { view } from '../src/game/sim';
import { FIRST_HIEMS_OVER, MILESTONES, checkObjectives, currentMilestone, milestoneDone, updateCounters } from '../src/game/objectives';
import {
  buildingVisible, nextTeaser, overlayRevealed, resourceRevealed, revealedRef, sectionRevealed, tabRevealed, toolRevealed,
} from '../src/game/reveal';
import { hubOpen } from '../src/game/trade';
import { charterPaving } from '../src/game/urbs';
import { PATH_DEFS } from '../src/game/data/decisions';
import { B } from '../src/game/balance';
import { INTEGRATED, ctx, fresh, run } from './util';

// Phase 1 stubs: dignitas and coverage are WP-B / WP-A's. The checklist logic is tested with them pinned.
const hooks = vi.hoisted(() => ({ dignitas: null as number | null, covered: false }));
vi.mock('../src/game/civic', async (orig) => {
  const m = await orig<typeof import('../src/game/civic')>();
  return {
    ...m,
    dignitas: (s: GameState) => (hooks.dignitas === null ? m.dignitas(s)
      : { value: hooks.dignitas, groups: { works: hooks.dignitas, homes: 0, roads: 0, deeds: 0, fama: 0 } }),
  };
});
vi.mock('../src/game/coverage', async (orig) => {
  const m = await orig<typeof import('../src/game/coverage')>();
  return { ...m, houseHas: (s: GameState, id: number, layer: Parameters<typeof m.houseHas>[2]) => hooks.covered || m.houseHas(s, id, layer) };
});

beforeEach(() => { hooks.dignitas = null; hooks.covered = false; drainActionFx(); });

function addBuilding(s: GameState, type: BuildingId, extra?: Partial<Building>): Building {
  const id = nextId(s);
  const b: Building = {
    id, type, x: 2 + (id % 40) * 2, y: 2 + Math.floor(id / 40) * 4, owner: 'player', status: 'done', placed: s.day, progress: 1,
    work: 1, paid: true, order: id, open: true, prio: 1, doneDay: s.day, ...extra,
  };
  s.buildings.push(b);
  invalidate(s);
  return b;
}

function addHouse(s: GameState, tier: HouseTierId): Building {
  return addBuilding(s, 'area', { house: { tier, pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 } });
}

/** Adult workers (homeless) until the population reaches `pop`. */
function growTo(s: GameState, pop: number): void {
  while (s.people.length < pop) {
    const id = nextId(s);
    s.people.push({ id, prae: 'Gaius', gens: 'Marius', female: false, born: s.day - 30 * 365, family: 1, spouse: null, mother: null, father: null, home: null, work: null, skills: {} });
  }
  touchPeople(s);
}

function staff(s: GameState, b: Building): void {
  const p = s.people.find((x) => x.work === null && s.day - x.born >= 20 * 365);
  if (p) p.work = b.id;
  touchPeople(s);
}

function finish(s: GameState, ...ids: MilestoneId[]): void {
  for (const id of ids) s.guidance.milestoneDays[id] = s.day;
  s.guidance.objective = Math.max(s.guidance.objective, ...ids.map((id) => MILESTONES.findIndex((m) => m.id === id) + 1));
}

function rich(s: GameState): void {
  for (const r of ['denarii', 'timber', 'stone', 'tiles', 'concrete', 'iron'] as const) s.res[r] = 20_000;
}

describe('petitions', () => {
  it('starts with the charter: free, ready, no rank', () => {
    const s = fresh();
    const pn = petitionNeeds(s, view(s))!;
    expect(pn.decision).toBe('charter');
    expect(pn.rank).toBeNull();
    expect(pn.ready).toBe(true);
    expect(pn.fee).toEqual({});
    expect(choosePath(s, 'path1', 'canabae')).toMatchObject({ ok: false, code: 'locked' });
    expect(choosePath(s, 'charter', 'veterani').ok).toBe(true);
    expect(s.rank).toBe(0);
    expect(choosePath(s, 'charter', 'agricolae')).toMatchObject({ ok: false, code: 'chosen' });
    expect(nextPath(s)).toBe('path1');
  });

  it('Vicus: every line of the checklist flips the readiness', () => {
    const s = fresh();
    choosePath(s, 'charter', 'agricolae');
    hooks.dignitas = 11;
    const pn = (): NonNullable<ReturnType<typeof petitionNeeds>> => petitionNeeds(s, view(s))!;
    expect(pn().rank).toBe(1);
    expect(pn().needs.map((n) => n.met)).toEqual([true, false, false, false, false, false]);
    growTo(s, 50);
    s.day = FIRST_HIEMS_OVER;
    addBuilding(s, 'horreum');
    s.counters.stabStreak = 10;
    expect(pn().ready).toBe(false);
    expect(pn().needs.find((n) => !n.met)?.label).toContain('Dignitas');
    hooks.dignitas = 12;
    expect(pn().ready).toBe(true);
    expect(pn().fee).toEqual({ denarii: 250, timber: 100 });
    s.res.timber = 50;
    expect(pn().affordable).toBe(false);
    expect(choosePath(s, 'path1', 'canabae')).toMatchObject({ ok: false, code: 'unaffordable' });
    s.res.timber = 150;
    const den = s.res.denarii;
    expect(choosePath(s, 'path1', 'canabae').ok).toBe(true);
    expect(s.rank).toBe(1);
    expect(s.res.denarii).toBe(den - 250);
    expect(s.res.timber).toBe(50);
    expect(drainActionFx()).toContainEqual({ kind: 'rank', rank: 1 });
    expect(s.log.some((e) => e.kind === 'rank' && e.text.includes('FIT VICVS'))).toBe(true);
  });

  it('Oppidum: tiled homes, shrine-and-market reach, two markets, dignitas', () => {
    const s = fresh();
    s.decisions.paths = { charter: 'veterani', path1: 'pagus' };
    s.rank = 1;
    rich(s);
    hooks.dignitas = 40;
    growTo(s, 180);
    for (let i = 0; i < 10; i++) addHouse(s, 'tegulata');
    s.trade.hubsTraded = ['metellianus', 'durii'];
    const pn = (): NonNullable<ReturnType<typeof petitionNeeds>> => petitionNeeds(s, view(s))!;
    expect(pn().rank).toBe(2);
    expect(pn().ready).toBe(false);                       // the stub coverage reaches nobody
    hooks.covered = true;
    expect(pn().ready).toBe(true);
    s.trade.hubsTraded = ['durii'];
    expect(pn().ready).toBe(false);
    s.trade.hubsTraded = ['metellianus', 'durii'];
    expect(choosePath(s, 'path2', 'arsFabrilis').ok).toBe(true);
    expect(s.rank).toBe(2);
    expect(s.log.some((e) => e.text.includes('cardo and the decumanus of the camp are to be paved'))).toBe(true);
    const stone = s.res.stone;
    const paved = charterPaving(s);                       // the Kalends pave the cardo and decumanus, for stone
    expect(paved).toBeGreaterThan(0);
    expect(s.paved.length).toBe(paved);
    expect(s.res.stone).toBe(stone - paved * B.map.PAVE_STONE);
  });

  it('Municipium: stone homes, staffed temple/market hall/baths, smelted iron', () => {
    const s = fresh();
    s.decisions.paths = { charter: 'veterani', path1: 'pagus', path2: 'pietas' };
    s.rank = 2;
    rich(s);
    hooks.dignitas = 100;
    growTo(s, 400);
    for (let i = 0; i < 12; i++) addHouse(s, 'domusParva');
    for (let i = 0; i < 4; i++) addHouse(s, 'insula');
    s.counters.ironMade = 60;
    const t = addBuilding(s, 'templum'); const m = addBuilding(s, 'macellum'); const b = addBuilding(s, 'balneum');
    const pn = (): NonNullable<ReturnType<typeof petitionNeeds>> => petitionNeeds(s, view(s))!;
    expect(pn().ready).toBe(false);
    expect(pn().needs.find((n) => !n.met)?.label).toContain('missing: Temple');
    staff(s, t); staff(s, m);
    expect(pn().ready).toBe(false);
    staff(s, b);
    expect(pn().ready).toBe(true);
    s.counters.ironMade = 59;
    expect(pn().ready).toBe(false);
    s.counters.ironMade = 60;
    expect(choosePath(s, 'path3', 'iusLatii').ok).toBe(true);
    expect(s.res.iron).toBe(20_000 - 60);
  });

  it('Colonia: aqueduct, staffed thermae and theatrum, twelve T4 homes, five markets — and the Capitolium begins', () => {
    const s = fresh();
    s.decisions.paths = { charter: 'veterani', path1: 'pagus', path2: 'pietas', path3: 'annonaPublica' };
    s.rank = 3;
    rich(s);
    hooks.dignitas = 190;
    growTo(s, 700);
    for (let i = 0; i < 12; i++) addHouse(s, i % 2 ? 'insula' : 'domus');
    s.trade.hubsTraded = HUBS.slice(0, 5);
    const th = addBuilding(s, 'thermae'); const tt = addBuilding(s, 'theatrum');
    staff(s, th); staff(s, tt);
    const pn = (): NonNullable<ReturnType<typeof petitionNeeds>> => petitionNeeds(s, view(s))!;
    expect(pn().ready).toBe(false);
    expect(pn().needs.find((n) => !n.met)?.label).toBe('The aqueduct flows');
    addBuilding(s, 'castellum');
    expect(pn().ready).toBe(true);
    expect(choosePath(s, 'path4', 'iuppiter').ok).toBe(true);
    expect(s.rank).toBe(4);
    expect(s.buildings.some((b) => b.type === 'capitolium' && b.status === 'building')).toBe(true);
    expect(petitionNeeds(s, view(s))).toBeNull();
    expect(nextPath(s)).toBeNull();
  });

  it('the Legate\'s good word lowers the next fee once', () => {
    const s = fresh();
    choosePath(s, 'charter', 'veterani');
    s.modifiers.push({ id: 'legatus.fee', label: 'fee', until: s.day + 99_999, fx: { mul: { petitionFee: 0.85 } }, benign: true, source: 'legatus' });
    hooks.dignitas = 50;
    growTo(s, 50);
    s.day = FIRST_HIEMS_OVER;
    addBuilding(s, 'horreum');
    s.counters.stabStreak = 10;
    s.res.timber = 100;
    expect(petitionNeeds(s, view(s))!.fee).toEqual({ denarii: 250 * 0.85, timber: 100 * 0.85 });
    expect(choosePath(s, 'path1', 'coloni').ok).toBe(true);
    expect(s.modifiers.some((m) => m.id === 'legatus.fee')).toBe(false);
  });

  it('rankUp only raises', () => {
    const s = fresh();
    rankUp(s, 2);
    expect(s.rank).toBe(2);
    rankUp(s, 1);
    expect(s.rank).toBe(2);
  });
});

describe('paths and the effect bus', () => {
  it('every path option\'s effect appears in fx', () => {
    for (const d of PATH_DECISIONS) {
      for (const o of PATH_DEFS[d].options) {
        const s = fresh();
        s.decisions.paths = { [d]: o.id };
        for (const [k, v] of Object.entries(o.fx.mul ?? {})) expect(fx(s, k as MulKey), `${o.id}.${k}`).toBeCloseTo(v as number, 9);
        for (const [k, v] of Object.entries(o.fx.add ?? {})) expect(fxAdd(s, k as AddKey), `${o.id}.${k}`).toBeCloseTo(v as number, 9);
        expect(Object.keys(o.fx.mul ?? {}).length + Object.keys(o.fx.add ?? {}).length).toBeGreaterThan(0);
      }
    }
  });

  it('effects off the bus: Mercatores opens the nearest market at Castra; Imperium lifts the next legacy', () => {
    const s = fresh();
    expect(hubOpen(s, 'metellianus')).toBe(false);
    choosePath(s, 'charter', 'mercatores');
    expect(hubOpen(s, 'metellianus')).toBe(true);
    expect(hubOpen(s, 'durii')).toBe(false);
    expect(nextColonyLegacy(s)).toEqual({ legacy: 0, legacyBonus: 0 });   // abandoning adds nothing
    s.victory = true;
    expect(nextColonyLegacy(s)).toEqual({ legacy: 1, legacyBonus: 0 });
    s.decisions.paths.path4 = 'imperium';
    expect(nextColonyLegacy(s).legacyBonus).toBeCloseTo(0.05);
  });

  it('Via militaris paves the via; Your story lists each choice', () => {
    const s = fresh();
    s.decisions.paths = { charter: 'veterani', path1: 'pagus' };
    s.decisions.pathDays = { charter: 100, path1: 700 };
    s.rank = 1;
    rich(s);
    hooks.dignitas = 40; hooks.covered = true;
    growTo(s, 180);
    for (let i = 0; i < 10; i++) addHouse(s, 'tegulata');
    s.trade.hubsTraded = ['metellianus', 'durii'];
    expect(choosePath(s, 'path2', 'viaMilitaris').ok).toBe(true);
    const story = pathStory(s);
    expect(story.map((x) => x.option)).toEqual(['veterani', 'pagus', 'viaMilitaris']);
    expect(story[1].text).toMatch(/^AUC DCCC[IV]*: the vicus became a farming pagus\.$/);
    expect(s.paved.length).toBeGreaterThan(20);
  });
});

describe('focus, edicts, settings, switches', () => {
  it('focus opens with the charter milestone', () => {
    const s = fresh();
    expect(setFocus(s, 'copia')).toMatchObject({ ok: false, code: 'locked' });
    finish(s, 'firstWork', 'charter');
    expect(setFocus(s, 'copia').ok).toBe(true);
    expect(s.decisions.focus).toBe('copia');
  });

  it('an edict cannot change twice inside one season window; the reason names the next Kalends', () => {
    const s = fresh();
    const r0 = setEdict(s, 'rationes', 'parcae');
    expect(r0).toMatchObject({ ok: false, code: 'locked' });
    expect(!r0.ok && r0.reason).toContain('Thirty days without hunger');
    finish(s, 'firstWork', 'charter', 'fed30');
    expect(setEdict(s, 'rationes', 'plenae').ok).toBe(true);          // the current option: a no-op, no lock
    expect(s.decisions.edictLock.rationes).toBeUndefined();
    expect(setEdict(s, 'rationes', 'parcae').ok).toBe(true);
    const next = nextSeasonStart(s.day);
    expect(edictWindow(s, 'rationes')).toEqual({ open: false, next });
    s.day += 10;
    const r = setEdict(s, 'rationes', 'largae');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('window');
      expect(r.reason).toContain(formatRoman(next));
      expect(r.reason).toContain(`in ${next - s.day} days`);
    }
    expect(setEdict(s, 'rationes', 'parcae').ok).toBe(true);           // re-clicking the current option is fine
    s.day = next;
    expect(setEdict(s, 'rationes', 'largae').ok).toBe(true);
    expect(s.decisions.edictLock.rationes).toBe(nextSeasonStart(next));
    expect(setEdict(s, 'rationes', 'bogus')).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('settings keep their default until unlocked, then clamp and snap', () => {
    const s = fresh();
    s.decisions.settings.grainReserve = 90;
    expect(settingValue(s, 'grainReserve')).toBe(45);
    expect(setSetting(s, 'grainReserve', 60)).toMatchObject({ ok: false, code: 'locked' });
    finish(s, 'firstWork', 'charter', 'fed30');
    expect(settingValue(s, 'grainReserve')).toBe(90);
    expect(setSetting(s, 'grainReserve', 63).ok).toBe(true);
    expect(s.decisions.settings.grainReserve).toBe(65);
    setSetting(s, 'grainReserve', 999);
    expect(s.decisions.settings.grainReserve).toBe(120);
    finish(s, 'horreum', 'hiems');
    setSetting(s, 'builderShare', 0.2);
    expect(s.decisions.settings.builderShare).toBe(0.2);
    expect(setSetting(s, 'builderShare', Number.NaN)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('switches are shown at their milestone; Govern while away at Vicus or when a toggle is off', () => {
    const s = fresh();
    expect(setSwitch(s, 'emergency', false)).toMatchObject({ ok: false, code: 'locked' });
    expect(isUnlocked(s, { kind: 'switch', id: 'governAway' })).toBe(false);
    s.ordo.on.trade = false;
    expect(isUnlocked(s, { kind: 'switch', id: 'governAway' })).toBe(true);
    finish(s, 'firstWork', 'charter', 'fed30', 'horreum', 'hiems');
    expect(setSwitch(s, 'emergency', false).ok).toBe(true);
    expect(s.decisions.switches.emergency).toBe(false);
  });
});

/** Mutates a state so that milestone `id`'s goal is met. */
function satisfy(s: GameState, id: MilestoneId): void {
  switch (id) {
    case 'firstWork': addBuilding(s, 'lararium'); break;
    case 'charter': s.decisions.paths.charter = 'veterani'; break;
    case 'fed30': s.counters.fedStreak = 30; break;
    case 'horreum': addBuilding(s, 'horreum'); break;
    case 'hiems': s.day = FIRST_HIEMS_OVER; break;
    case 'pop50': growTo(s, 50); break;
    case 'stabilitas': s.counters.stabStreak = 10; break;
    case 'vicus': s.rank = 1; invalidate(s); break;
    case 'caravan': s.counters.caravansReturned = 1; break;
    case 'tegulae': for (let i = 0; i < 10; i++) addHouse(s, 'tegulata'); break;
    case 'pop150': growTo(s, 150); break;
    case 'oppidum': s.rank = 2; invalidate(s); break;
    case 'templum': addBuilding(s, 'templum'); break;
    case 'fork': addHouse(s, 'insula'); break;
    case 'iron60': s.counters.ironMade = 60; break;
    case 'municipium': s.rank = 3; invalidate(s); break;
    case 'aqua': addBuilding(s, 'castellum'); break;
    case 'pop500': growTo(s, 500); break;
    case 'colonia': s.rank = 4; invalidate(s); break;
    case 'capitolium': s.victory = true; break;
    case 'pop1200': growTo(s, 1200); break;
    case 'allT3': for (const b of s.buildings) if (b.house && b.house.tier !== 'insula') b.house.tier = 'domusParva'; invalidate(s); break;
    case 'sixHubs': s.trade.hubsTraded = HUBS.slice(); break;
    case 'saturnalia10': s.counters.festivalsKept.saturnalia = 10; break;
  }
}

describe('Res Gestae', () => {
  it('lists the 24 milestones of DESIGN §9.4 in order, each unlocking something', () => {
    expect(MILESTONES.map((m) => m.id)).toEqual([...MILESTONE_IDS]);
    for (const m of MILESTONES) expect(m.unlocks.length, m.id).toBeGreaterThan(0);
    expect(MILESTONES.filter((m) => m.postVictory).map((m) => m.id)).toEqual(['pop1200', 'allT3', 'sixHubs', 'saturnalia10']);
  });

  it('fire strictly in order; each unlock becomes visible through reveal', () => {
    const s = fresh();
    satisfy(s, 'fed30');                                   // a later goal met early waits its turn
    const c0 = ctx();
    checkObjectives(s, c0);
    expect(s.guidance.objective).toBe(0);
    for (let i = 0; i < MILESTONES.length; i++) {
      const m = MILESTONES[i];
      if (milestoneDone(s, m.id)) continue;               // completed in the same loop as the one before
      expect(currentMilestone(s)?.id).toBe(m.id);
      for (const u of m.unlocks) if (u.kind !== 'victory') expect(revealedRef(s, u), `${m.id} → ${JSON.stringify(u)} early`).toBe(false);
      satisfy(s, m.id);
      const c = ctx();
      checkObjectives(s, c);
      expect(milestoneDone(s, m.id)).toBe(true);
      expect(c.fx).toContainEqual({ kind: 'milestone', id: m.id });
      for (const u of m.unlocks) expect(revealedRef(s, u), `${m.id} → ${JSON.stringify(u)}`).toBe(true);
      if (i === 1) expect(milestoneDone(s, 'fed30')).toBe(true);   // the loop completes the waiting goal too
    }
    expect(currentMilestone(s)).toBeNull();
    expect(s.log.filter((e) => e.kind === 'milestone').length).toBe(24);
    expect(s.log.find((e) => e.text.startsWith('Res Gestae VI:'))?.text).toContain('Hospites edict');
  });

  it('after the Capitolium, every post-victory goal already met completes; the objective skips the done ones (R45)', () => {
    const s = fresh();
    const pv = MILESTONES.findIndex((m) => m.postVictory);
    for (const m of MILESTONES.slice(0, pv)) s.guidance.milestoneDays[m.id] = s.day;
    s.guidance.objective = pv;
    satisfy(s, 'capitolium');
    satisfy(s, 'sixHubs');
    satisfy(s, 'saturnalia10');                            // met while pop1200 and allT3 are not
    const c = ctx();
    checkObjectives(s, c);
    expect(milestoneDone(s, 'sixHubs')).toBe(true);
    expect(milestoneDone(s, 'saturnalia10')).toBe(true);
    expect(c.fx).toEqual([{ kind: 'milestone', id: 'sixHubs' }, { kind: 'milestone', id: 'saturnalia10' }]);
    expect(milestoneDone(s, 'pop1200')).toBe(false);
    expect(currentMilestone(s)?.id).toBe('pop1200');
    satisfy(s, 'pop1200');
    checkObjectives(s, ctx());
    expect(currentMilestone(s)?.id).toBe('allT3');
    satisfy(s, 'allT3');
    checkObjectives(s, ctx());
    expect(currentMilestone(s)).toBeNull();
    expect(s.guidance.objective).toBe(MILESTONES.length);
  });

  it('counts the fed and stable streaks', () => {
    const s = fresh();
    const v = view(s);
    updateCounters(s, v);
    expect(s.counters.fedStreak).toBe(1);
    expect(s.counters.stabStreak).toBe(0);               // 480 grain is under 30 days
    s.res.grain = 2000;
    s.res.water = 300;
    updateCounters(s, view(s));
    expect(s.counters.stabStreak).toBe(1);
    expect(s.counters.fedStreak).toBe(2);
    s.needs.hunger[2] = 40;
    updateCounters(s, view(s));
    expect(s.counters.fedStreak).toBe(0);
    s.needs.hunger[2] = 0;
    s.decisions.edicts.rationes = 'parcae';
    updateCounters(s, view(s));
    expect(s.counters.fedStreak).toBe(0);
  });
});

describe('progressive reveal', () => {
  it('tabs appear as DESIGN §15.3 says', () => {
    const s = fresh();
    expect(['council', 'advisors', 'build', 'people', 'trade', 'annals'].map((t) => tabRevealed(s, t as never))).toEqual([true, false, false, false, false, false]);
    s.day += 10;
    expect(tabRevealed(s, 'people')).toBe(true);
    expect(tabRevealed(s, 'build')).toBe(false);
    s.day += 10;
    expect(tabRevealed(s, 'build')).toBe(true);
    s.guidance.advisories['aquarum.aestas.forecast'] = { rule: 'aquarum.aestas.forecast', active: false, sev: 1, since: s.day, lowerSince: null, params: {}, flips: [] };
    expect(tabRevealed(s, 'advisors')).toBe(true);
    s.decisions.paths.charter = 'mercatores';
    expect(tabRevealed(s, 'trade')).toBe(true);
    finish(s, 'firstWork');
    expect(tabRevealed(s, 'annals')).toBe(true);
  });

  it('resources, sections, overlays and tools', () => {
    const s = fresh();
    expect(resourceRevealed(s, 'timber')).toBe(true);
    expect(resourceRevealed(s, 'tools')).toBe(true);     // four kits at the founding
    expect(resourceRevealed(s, 'tiles')).toBe(false);
    expect(resourceRevealed(s, 'oil')).toBe(false);
    expect(resourceRevealed(s, 'wine')).toBe(false);
    addBuilding(s, 'figlina', { status: 'staked', progress: 0 });
    expect(resourceRevealed(s, 'tiles')).toBe(true);
    s.rank = 1;
    expect(resourceRevealed(s, 'oil')).toBe(true);
    expect(resourceRevealed(s, 'wine')).toBe(true);
    expect(sectionRevealed(s, 'story')).toBe(false);
    s.decisions.paths.charter = 'veterani';
    expect(sectionRevealed(s, 'story')).toBe(true);
    expect(sectionRevealed(s, 'edicts')).toBe(false);
    expect(overlayRevealed(s, 'aqua')).toBe(true);
    expect(overlayRevealed(s, 'officia')).toBe(false);   // the start well is water, not an office
    addBuilding(s, 'lararium');
    expect(overlayRevealed(s, 'officia')).toBe(true);
    expect(overlayRevealed(s, 'terra')).toBe(false);
    s.day += 30;
    expect(overlayRevealed(s, 'terra')).toBe(true);
    expect(toolRevealed(s, 'road')).toBe(true);
    expect(toolRevealed(s, 'demolish')).toBe(true);
    expect(toolRevealed(s, 'pin')).toBe(false);
    expect(toolRevealed(s, 'pave')).toBe(false);
  });

  it('cards two ranks ahead stay hidden; the teaser names the next unlock', () => {
    const s = fresh();
    expect(buildingVisible(s, 'figlina')).toBe(true);
    expect(buildingVisible(s, 'templum')).toBe(false);
    s.rank = 1;
    expect(buildingVisible(s, 'templum')).toBe(true);
    expect(buildingVisible(s, 'thermae')).toBe(false);
    const t = nextTeaser(s)!;
    expect(t.label).toContain('Spare beds setting');
    expect(t.at).toBe('Res Gestae I: Raise your first building');
    finish(s, ...MILESTONE_IDS);
    expect(nextTeaser(s)).toBeNull();
  });
});

describe.runIf(INTEGRATED)('with the real simulation', () => {
  it('a charter and petitions when ready (the Ordo alone): the early Res Gestae complete in order and the Vicus comes, about three times later than the attentive pace', () => {
    const s = fresh(42);
    let vicusDay: number | null = null;
    run(s, 4000, (st) => {
      if (st.day - B.time.START_DAY === 10) choosePath(st, 'charter', 'agricolae');
      const pn = petitionNeeds(st, view(st));
      if (pn && pn.rank !== null && pn.ready && pn.affordable) {
        choosePath(st, pn.decision, PATH_DEFS[pn.decision].options[0].id);
        if (st.rank === 1 && vicusDay === null) vicusDay = st.day - B.time.START_DAY;
      }
    });
    const order = MILESTONES.filter((m) => milestoneDone(s, m.id)).map((m) => s.guidance.milestoneDays[m.id] as number);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(milestoneDone(s, 'hiems')).toBe(true);
    expect(vicusDay).not.toBeNull();
    // the idle floor (DESIGN §18.4): the Vicus band (420–780) × the Ordo alone's 2.2–3.6 (autoplayer BANDS, ORDO_RATIO)
    expect(vicusDay!).toBeGreaterThanOrEqual(420 * 2.2);
    expect(vicusDay!).toBeLessThanOrEqual(780 * 3.6);
  });
});

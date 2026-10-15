// tests/construction.test.ts — WP-B: works queue, stakes, plans, refunds, tools, builders, the Capitolium flow
// (ARCHITECTURE §14.2 WP-B, DESIGN §5.3, §9.5).
import { describe, expect, it } from 'vitest';
import { BUILDER } from '../src/game/types';
import type { Building, GameState, Person } from '../src/game/types';
import {
  builderWork, cancelSite, capitoliumFlow, capitoliumHold, capitoliumStage, constructionDay, crewWords, payPlans, prioritise, setOpen,
  startCapitolium, startStaked, worksQueue,
} from '../src/game/construction';
import { issueTools, produce } from '../src/game/economy';
import { Rng } from '../src/game/rng';
import { assignJobs } from '../src/game/people';
import { census, peopleIndex } from '../src/game/census';
import { demolish } from '../src/game/place';
import { touchPeople } from '../src/game/memo';
import { fx } from '../src/game/fx';
import { B } from '../src/game/balance';
import { ctx, freeSlots, fresh, place } from './util';

const C = B.construction;
const PLOTS: [number, number][] = freeSlots(fresh(), 'area', 6).map((p) => [p.x, p.y]);   // six free plots of seed 42's survey

function site(s: GameState, k: number, owner: 'player' | 'ordo', type: Building['type'] = 'lararium'): Building {
  const r = place(s, type, PLOTS[k][0], PLOTS[k][1], { owner });
  expect(r.ok).toBe(true);
  return s.buildings.find((b) => b.id === (r as { id: number }).id) as Building;
}

function step(s: GameState, n = 1): void {
  for (let d = 0; d < n; d++) {
    s.day++;
    const c = ctx();
    startStaked(s);
    payPlans(s, c);
    constructionDay(s, c);
  }
}

/** Adds `n` unskilled adults (homeless is fine for these tests). */
function hands(s: GameState, n: number): void {
  for (let k = 0; k < n; k++) {
    const p: Person = { ...s.people[0], id: 10_000 + k, spouse: null, home: null, work: null, skills: {}, family: s.people[0].family };
    s.people.push(p);
  }
  s.nextId = 20_000;
  touchPeople(s);
}

describe('the works queue (DESIGN §5.3)', () => {
  it('serves player sites first, then the Ordo\'s, each by order then id; ↑ moves a site to the front of its group', () => {
    const s = fresh();
    s.res.denarii = 5000;
    s.res.timber = 300;
    s.res.stone = 300;
    const a = site(s, 0, 'ordo'), b = site(s, 1, 'player'), c = site(s, 2, 'ordo'), d = site(s, 3, 'player');
    expect(worksQueue(s).map((x) => x.id)).toEqual([b.id, d.id, a.id, c.id]);
    prioritise(s, c.id);
    expect(worksQueue(s).map((x) => x.id)).toEqual([b.id, d.id, c.id, a.id]);
    prioritise(s, d.id);
    expect(worksQueue(s).map((x) => x.id)).toEqual([d.id, b.id, c.id, a.id]);
  });

  it('pours the builders\' work into the first site until it is done, then the next', () => {
    const s = fresh();
    s.res.denarii = 5000;
    const first = site(s, 0, 'player'), second = site(s, 1, 'player');
    assignJobs(s, { perBuilding: {}, builders: 2, lines: [] });
    step(s, 1);
    expect(first.progress).toBeGreaterThan(0);
    expect(second.progress).toBe(0);
    for (let d = 0; d < 20 && first.status !== 'done'; d++) step(s);
    expect(first.status).toBe('done');
    expect(s.stats.built).toBe(1);
  });

  it('keeps Ordo stakes for STAKE_DAYS before work begins', () => {
    const s = fresh();
    const o = site(s, 0, 'ordo');
    expect(o.status).toBe('staked');
    assignJobs(s, { perBuilding: {}, builders: 2, lines: [] });
    step(s, C.STAKE_DAYS - 1);
    expect(o.status).toBe('staked');
    expect(o.progress).toBe(0);
    step(s, 1);
    expect(o.status).toBe('building');
    expect(o.progress).toBeGreaterThan(0);
  });

  it('turns a player plan into a site once the stores cover it', () => {
    const s = fresh();
    s.res.denarii = 10;
    const p = site(s, 0, 'player', 'cisterna');
    expect(p.status).toBe('plan');
    expect(p.paid).toBe(false);
    step(s, 1);
    expect(p.status).toBe('plan');
    s.res.denarii = 600;
    const stone = s.res.stone;
    step(s, 1);
    expect(p.status).toBe('building');
    expect(p.paid).toBe(true);
    expect(s.res.stone).toBe(stone - 20);
  });

  it('completes a house plot as tentoria and logs it', () => {
    const s = fresh();
    const a = site(s, 0, 'player', 'area');
    assignJobs(s, { perBuilding: {}, builders: 2, lines: [] });
    step(s, 5);
    expect(a.status).toBe('done');
    expect(a.house?.tier).toBe('tentoria');
    expect(census(s).beds).toBe(35);
  });
});

describe('refunds (DESIGN §5.3)', () => {
  it('cancel within 5 days and before any work: 100%', () => {
    const s = fresh();
    const den = s.res.denarii, timber = s.res.timber;
    const o = site(s, 0, 'ordo');
    expect(s.res.denarii).toBe(den - 25);
    expect(cancelSite(s, o.id).ok).toBe(true);
    expect(s.res.denarii).toBe(den);
    expect(s.res.timber).toBe(timber);
    expect(s.buildings.some((b) => b.id === o.id)).toBe(false);
  });

  it('cancel after work has begun: 75%', () => {
    const s = fresh();
    const den = s.res.denarii;
    const p = site(s, 0, 'player', 'cisterna');
    assignJobs(s, { perBuilding: {}, builders: 1, lines: [] });
    step(s, 1);
    expect(p.progress).toBeGreaterThan(0);
    cancelSite(s, p.id);
    expect(s.res.denarii).toBeCloseTo(den - 50 + 50 * C.REFUND_CANCEL, 9);
  });

  it('cancel after the 5-day window: 75%', () => {
    const s = fresh();
    const den = s.res.denarii;
    const o = site(s, 0, 'ordo');
    s.day += C.FULL_REFUND_DAYS + 1;
    cancelSite(s, o.id);
    expect(s.res.denarii).toBeCloseTo(den - 25 + 25 * C.REFUND_CANCEL, 9);
  });

  it('a plan refunds nothing (it was never paid); demolishing a finished work returns 25%', () => {
    const s = fresh();
    s.res.denarii = 10;
    const p = site(s, 0, 'player', 'cisterna');
    expect(cancelSite(s, p.id).ok).toBe(true);
    expect(s.res.denarii).toBe(10);
    s.res.denarii = 600;
    const w = site(s, 1, 'player', 'cisterna');
    w.status = 'done';
    w.progress = 1;
    const den = s.res.denarii;
    expect(demolish(s, w.id).ok).toBe(true);
    expect(s.res.denarii).toBeCloseTo(den + 50 * C.REFUND_DEMOLISH, 9);
  });

  it('the Capitolium cannot be cancelled', () => {
    const s = fresh();
    startCapitolium(s);
    const cap = s.buildings.find((b) => b.type === 'capitolium') as Building;
    expect(cancelSite(s, cap.id).ok).toBe(false);
  });
});

describe('tools and builders (DESIGN §5.3)', () => {
  it('issues kits to construction sites first, then by TOOL_ORDER to staffed works', () => {
    const s = fresh();
    s.res.tools = 2;
    const p = site(s, 0, 'player', 'cisterna');
    const ager = s.buildings.find((b) => b.type === 'ager') as Building;
    issueTools(s, ctx());
    expect(p.toolUntil).toBe(s.day + B.economy.TOOL_DAYS);
    expect(ager.toolUntil).toBe(s.day + B.economy.TOOL_DAYS);
    expect(s.res.tools).toBe(0);
    s.res.tools = 3;
    issueTools(s, ctx());
    expect(s.res.tools).toBe(3);   // every eligible work already holds an active kit
  });

  it('a builder works 1 × skill × productivity × fx, idle hands add 0.3 each, kits ×1.2', () => {
    const s = fresh();
    const decimus = s.people.find((p) => p.prae === 'Decimus') as Person;
    expect(builderWork(s, decimus)).toBeCloseTo(1.08 * (0.85 + 0.3 * 0.65), 9);
    const p = site(s, 0, 'player', 'cisterna');
    assignJobs(s, { perBuilding: {}, builders: 1, lines: [] });
    const idle = census(s).idle.length;
    const w1 = builderWork(s, decimus);
    step(s, 1);
    expect(p.progress * p.work).toBeCloseTo(w1 + idle * B.economy.IDLE_BUILD, 9);
    const before = p.progress;
    p.toolUntil = s.day + 100;
    const w2 = builderWork(s, decimus);
    step(s, 1);
    expect((p.progress - before) * p.work).toBeCloseTo((w2 + idle * B.economy.IDLE_BUILD) * B.economy.TOOL_MULT, 9);
    expect(decimus.skills.fabri).toBeGreaterThan(2);
  });

  it('closing a building releases its workers', () => {
    const s = fresh();
    const well = s.buildings.find((b) => b.type === 'puteus') as Building;
    expect(s.people.some((p) => p.work === well.id)).toBe(true);
    setOpen(s, well.id, false);
    expect(s.people.some((p) => p.work === well.id)).toBe(false);
    expect(census(s).slots[well.id]).toBe(0);
  });
});

describe('the Capitolium (DESIGN §9.5)', () => {
  function monument(builders: number): { s: GameState; cap: Building } {
    const s = fresh();
    hands(s, builders);
    startCapitolium(s);
    const cap = s.buildings.find((b) => b.type === 'capitolium') as Building;
    for (const r of ['stone', 'concrete', 'tiles', 'iron', 'denarii'] as const) s.res[r] = 1e6;
    assignJobs(s, { perBuilding: {}, builders, lines: [] });
    return { s, cap };
  }

  it('starts on the Area Capitolina with its full work and no up-front cost', () => {
    const s = fresh();
    const den = s.res.denarii;
    startCapitolium(s);
    const cap = s.buildings.find((b) => b.type === 'capitolium') as Building;
    expect(cap.work).toBe(C.CAP_WORK * fx(s, 'capWork'));
    expect(cap.status).toBe('building');
    expect(s.res.denarii).toBe(den);
  });

  it('lets at most 64 builders work on it', () => {
    const { s, cap } = monument(100);
    const crew = (st: GameState): number => st.people.filter((p) => p.work === BUILDER).reduce((a, p) => a + builderWork(st, p), 0);
    expect(s.people.filter((p) => p.work === BUILDER).length).toBe(100);
    const all = crew(s);
    step(s, 1);
    expect(cap.progress * cap.work).toBeCloseTo((C.CAP_CREW * all) / 100, 6);
    const small = monument(10);
    const ten = crew(small.s);
    step(small.s, 1);
    expect(small.cap.progress * small.cap.work).toBeCloseTo(ten, 6);
  });

  it('draws its materials pro rata to the work', () => {
    const { s, cap } = monument(40);
    step(s, 30);
    const done = cap.progress;
    for (const r of ['stone', 'concrete', 'tiles', 'iron', 'denarii'] as const) {
      expect((cap.matUsed?.[r] ?? 0) / C.CAP_MAT[r]).toBeCloseTo(done, 9);
      expect(s.res[r]).toBeCloseTo(1e6 - C.CAP_MAT[r] * done, 6);
    }
  });

  it('stalls on the scarcest material and names it the bottleneck', () => {
    const { s, cap } = monument(40);
    s.res.stone = 1.5;
    step(s, 1);
    expect(cap.progress * cap.work).toBeCloseTo(1.5 / (C.CAP_MAT.stone / C.CAP_WORK), 6);
    expect(s.res.stone).toBeCloseTo(0, 9);
    step(s, 1);
    const flow = capitoliumFlow(s);
    expect(flow?.bottleneck).toBe('stone');
    expect(flow?.eta).toBe(null);
    // the bottleneck in stone a day, not in work units (R23): nothing comes in, the crew would lay its share of the
    // temple's stone each day
    expect(flow?.supply).toBe(0);
    expect(flow!.demand).toBeLessThan(C.CAP_MAT.stone);
    s.res.stone = 1e6;
    const f2 = capitoliumFlow(s);
    expect(f2?.bottleneck).toBe('crew');
    expect(f2?.eta).toBeGreaterThan(0);
    expect(f2?.demand).toBe(0);
    expect(flow?.demand).toBeCloseTo((C.CAP_MAT.stone * fx(s, 'capMat') / cap.work) * f2!.rate, 6);   // the crew's work a day × stone per work
  });

  it('says how many builders work on it: at most 64, the town wall\'s crew apart, the rest with nothing to build (playtest #7)', () => {
    const { s } = monument(100);
    const f = capitoliumFlow(s)!;
    expect(f).toMatchObject({ bottleneck: 'crew', crew: 64, walls: 0, spare: 36 });
    expect(capitoliumHold(f)).toBe('crew at its maximum: 64 of 64 builders (the most that can work on it)');
    expect(crewWords(f)).toBe('64 of 64 builders on the Capitolium (the most that can work on it); 36 more have nothing to build.');
    const few = capitoliumFlow(monument(40).s)!;
    expect(few).toMatchObject({ bottleneck: 'crew', crew: 40, spare: 0 });
    expect(capitoliumHold(few)).toBe('bottleneck: builders (40 of the 64 who could work on it)');
    expect(crewWords(few)).toBe('40 builders on the Capitolium, which takes up to 64.');
    // while the town wall rises its crew of 8 is served first (constructionDay): 72 builders are 64 on the temple and 8 on the wall
    const walled = monument(72).s;
    walled.urbs.moenia = { tiles: [], gates: [], surveyed: walled.day, work: 30_000, progress: 0, matUsed: {}, done: null };
    const w = capitoliumFlow(walled)!;
    expect(w).toMatchObject({ crew: 64, walls: B.urbs.MOENIA.CREW, spare: 0 });
    expect(crewWords(w)).toBe('64 of 64 builders on the Capitolium (the most that can work on it), 8 on the town wall.');
  });

  it('counts concrete works at what their inputs allow: without water they make none, and it waits for concrete (playtest #7)', () => {
    const { s } = monument(40);
    s.rank = 2;
    const at = freeSlots(s, 'caementarium', 1)[0];
    const r = place(s, 'caementarium', at.x, at.y, { ignoreCost: true });
    expect(r.ok).toBe(true);
    const works = s.buildings.find((b) => b.type === 'caementarium') as Building;
    Object.assign(works, { status: 'done', progress: 1 });
    hands(s, 2);
    assignJobs(s, { perBuilding: { [works.id]: 2 }, builders: 40, lines: [] });
    expect(peopleIndex(s).byWork.get(works.id)?.length).toBe(2);
    s.res.concrete = 0;
    s.res.water = 0;                                                  // the staffed works stand dry
    const f = capitoliumFlow(s)!;
    expect(f).toMatchObject({ bottleneck: 'concrete', eta: null, stock: 0, inflow: 0, starved: { works: 'caementarium', input: 'water', share: 0 } });
    expect(capitoliumHold(f)).toMatch(/^waiting for concrete: 0 in store, \+0\/day of [\d.]+ \(no water for the concrete works\)$/);
    // the day bears it out: no concrete is mixed and the temple does not rise
    const before = s.buildings.find((b) => b.type === 'capitolium')!.progress;
    s.day++;
    const c = ctx();
    produce(s, c, new Rng(1));
    constructionDay(s, c);
    expect(s.res.concrete).toBe(0);
    expect(s.buildings.find((b) => b.type === 'capitolium')!.progress).toBe(before);
    // with water the same works mix their concrete, and the crew binds again
    s.res.water = 1e6;
    const g = capitoliumFlow(s)!;
    expect(g.starved).toBe(null);
    expect(g.bottleneck).toBe('crew');
    // unless the Lex de annona pauses them for water (DESIGN §8.12)
    s.ordo.emergency.waterPause = true;
    s.res.concrete = 0;
    expect(capitoliumFlow(s)).toMatchObject({ bottleneck: 'concrete', starved: { works: 'caementarium', input: 'water', share: 0 } });
  });

  it('says what the stores hold of the bottleneck, and what the Ordo keeps back of it for another work (fix3)', () => {
    const { s } = monument(40);
    s.res.concrete = 12;
    s.ordo.pin = 'balneum';                                           // the bathhouse pinned: its 20 concrete are saved for it
    let f = capitoliumFlow(s)!;
    expect(f).toMatchObject({ bottleneck: 'concrete', eta: null, stock: 12, held: 12, heldFor: 'balneum' });
    expect(capitoliumHold(f)).toMatch(/^waiting for concrete: 12 in store, all held for the bathhouse, \+0\/day of [\d.]+$/);
    s.res.concrete = 30;                                              // 10 above what the bathhouse needs: the temple may draw those
    f = capitoliumFlow(s)!;
    expect(f).toMatchObject({ bottleneck: 'concrete', stock: 30, held: 20, heldFor: 'balneum' });
    expect(capitoliumHold(f)).toMatch(/^waiting for concrete: 30 in store, 20 held for the bathhouse, \+0\/day of [\d.]+$/);
    s.ordo.pin = null;                                                // nothing kept back: the stock is the temple's
    s.res.concrete = 1;
    f = capitoliumFlow(s)!;
    expect(f).toMatchObject({ bottleneck: 'concrete', stock: 1, held: 0, heldFor: null });
    expect(capitoliumHold(f)).toMatch(/^waiting for concrete: 1 in store, \+0\/day of [\d.]+$/);
    // coin under the treasury floor is the floor's, not the temple's
    s.res.concrete = 1e6;
    s.res.denarii = 50;
    f = capitoliumFlow(s)!;
    expect(f).toMatchObject({ bottleneck: 'denarii', stock: 50, held: 50, heldFor: 'floor' });
    expect(capitoliumHold(f)).toMatch(/^waiting for coin: 50 in store, all kept as the treasury floor, \+0\/day of [\d.]+$/);
  });

  it('raises a stage at each quarter (fx, log, morale for 30 days) and completes in victory', () => {
    const { s, cap } = monument(64);
    cap.progress = C.CAP_STAGES[0] - 1e-4;
    const c = ctx();
    s.day++;
    constructionDay(s, c);
    expect(capitoliumStage(cap)).toBe(1);
    expect(c.fx.some((f) => f.kind === 'stage' && f.stage === 1)).toBe(true);
    const mod = s.modifiers.find((m) => m.id === 'capitolium.stage1');
    expect(mod?.until).toBe(s.day + B.morale.STAGE_DAYS);
    expect(mod?.fx.add?.morale).toBe(B.morale.STAGE);
    cap.progress = 1 - 1e-5;
    const c2 = ctx();
    s.day++;
    constructionDay(s, c2);
    expect(cap.status).toBe('done');
    expect(s.victory).toBe(true);
    expect(s.stats.victoryDay).toBe(s.day);
    expect(c2.fx.some((f) => f.kind === 'victory')).toBe(true);
    expect(c2.fx.filter((f) => f.kind === 'stage').map((f) => (f as { stage: number }).stage)).toEqual([4]);
  });

  it('serves the other sites first and takes what is left', () => {
    const { s, cap } = monument(40);
    s.res.timber = 300;
    const p = site(s, 0, 'player', 'cisterna');
    step(s, 1);
    expect(p.status).toBe('done');
    expect(cap.progress).toBeGreaterThan(0);
  });
});

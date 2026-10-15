// tests/ordo.test.ts — the Ordo: labour steps, wish list, stakes, saving, emergency ladder, toggles, trade, reasons. Owner: WP-C.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Building, BuildingId, EssentialForecast, GameState, Reason, ReasonCode, SimView } from '../src/game/types';
import { deserialize, serialize } from '../src/game/save';
import { newCtx, tick, view } from '../src/game/sim';
import { getMap, idx } from '../src/game/map';
import { isActiveBlock } from '../src/game/survey';
import { blockOfTile, footprintOf } from '../src/game/derived';
import { census } from '../src/game/census';
import { invalidate, touchPeople } from '../src/game/memo';
import { canPlace, placeBuilding, validSlots } from '../src/game/place';
import { createContract, emergencyImport } from '../src/game/trade';
import { triggerRelief } from '../src/game/events';
import { councilReport, runOrdo } from '../src/game/ordo/index';
import { manualPlan, manualReach, planLabour } from '../src/game/ordo/labour';
import { currentReason, gardenSlot, growthWait, keptBlocks, maxSites, newWishes, ordoAlone, ordoBuild, ordoSites, ordoSlot, processRequests, walkWishes, wishList, wouldRaise } from '../src/game/ordo/build';
import type { Wish } from '../src/game/ordo/build';
import { aestasWork } from '../src/game/ordo/water';
import { caps, maxPotential } from '../src/game/economy';
import { startCapitolium } from '../src/game/construction';
import { projectEssential } from '../src/game/forecast';
import { B } from '../src/game/balance';
import { BUILDING_DEFS, slotsOf } from '../src/game/data/buildings';
import { play } from './autoplayer';
import { addCost } from '../src/game/state';
import { canSpend, fullRate, reserved, savingFor } from '../src/game/ordo/saving';
import { siteMult } from '../src/game/site';
import { emergencyDay } from '../src/game/ordo/emergency';
import { ordoTrade, ordoTradeWould, tradeMoves } from '../src/game/ordo/trade';
import { reasonShort, reasonText } from '../src/game/ordo/reasons';
import { applyOnce, askOrdo, pinBuild, setDuty, setLabourPriority, setManualTarget, setOrdo } from '../src/game/ordo/actions';
import { Rng } from '../src/game/rng';
import { INTEGRATED, ctx, dryHouse, fresh, noNaN, run, setJobs } from './util';
import { reachSteps, serveSlot, serviceReach } from '../src/game/advisors/util';
import { FABRUM_RULES } from '../src/game/advisors/rules-fabrum';
import { houseDesir, previewDesir } from '../src/game/coverage';
import type { Game } from '../src/ui/types';
import { wishState } from '../src/ui/tabs/common';
import { noPlotNote } from '../src/ui/tabs/house';

// Pass-through spies: the emergency tests make the (WP-D) import and relief succeed on demand.
vi.mock('../src/game/trade', async (orig) => {
  const m = await orig<typeof import('../src/game/trade')>();
  return { ...m, emergencyImport: vi.fn(m.emergencyImport) };
});
vi.mock('../src/game/events', async (orig) => {
  const m = await orig<typeof import('../src/game/events')>();
  return { ...m, triggerRelief: vi.fn(m.triggerRelief) };
});
afterEach(() => vi.clearAllMocks());

/** A finished building of `type` at the Ordo's slot (inserted as a player work). */
function built(s: GameState, type: BuildingId): Building {
  const tile = ordoSlot(s, type, 'focusPlan');
  if (tile === null) throw new Error(`no slot for ${type}`);
  const res = { ...s.res };
  const r = placeBuilding(s, type, tile, { owner: 'player', ignoreCost: true, noStake: true });
  if (!r.ok || r.id === undefined) throw new Error(`cannot place ${type}`);
  s.res = res;   // the felled footprint's timber would fill the stores (WP-A felling), and a full store idles its producers
  const b = s.buildings.find((x) => x.id === r.id) as Building;
  Object.assign(b, { status: 'done', progress: 1 });
  invalidate(s);
  return b;
}

/** The live view with chosen forecast figures for grain and water (emergency and trade thresholds). */
function withForecast(s: GameState, grain: Partial<EssentialForecast>, water: Partial<EssentialForecast> = {}): SimView {
  const v = view(s);
  const f = v.f;
  return { get d() { return v.d; }, get c() { return v.c; }, get cov() { return v.cov; }, f: { ...f, grain: { ...f.grain, ...grain }, water: { ...f.water, ...water } } };
}

/** The game as the Agenda's words read it (wishState reads only the state). */
const game = (s: GameState): Game => ({ state: s }) as unknown as Game;

/** Offline days (the away replay): ticks with ctx.offline. */
function away(s: GameState, days: number): void {
  for (let i = 0; i < days; i++) tick(s, newCtx(true));
}

const clean = (r: Reason): void => {
  const t = reasonText(r);
  expect(t).toMatch(/[.]$/);
  expect(t).not.toMatch(/[{}…]|undefined|NaN/);
  expect(reasonShort(r)).not.toMatch(/[{}…]|undefined|NaN|\.$/);
};

describe('labour', () => {
  it('staffs water → food → required services → builders → focus split, a Reason per line', () => {
    const s = fresh(42);
    const home = s.buildings.find((b) => b.house) as Building;
    (home.house as NonNullable<Building['house']>).tier = 'tegulata';       // a tier that depends on a shrine
    built(s, 'lararium');
    built(s, 'lignarius');
    const site = built(s, 'cisterna');
    Object.assign(site, { status: 'building', progress: 0 });
    invalidate(s);
    const plan = planLabour(s, view(s));
    const cats = plan.lines.map((l) => l.cat);
    expect(cats.slice(0, 5)).toEqual(['water', 'food', 'services', 'builders', 'materials']);
    expect(plan.lines.map((l) => l.reason.code).slice(0, 5)).toEqual(['needWater', 'reserveTopup', 'requiredService', 'builderShare', 'focusSplit']);
    for (const l of plan.lines) clean(l.reason);
    const total = Object.values(plan.perBuilding).reduce((a, b) => a + b, 0) + plan.builders;
    expect(total).toBeLessThanOrEqual(census(s).workforce);
  });

  it('raises the water base for thirst and keeps food within 75% (90% when hungry) of the workforce', () => {
    const s = fresh(42);
    for (let k = 0; k < 3; k++) built(s, 'ager');
    s.needs.thirst = [30, 0, 0, 0];
    const v = view(s);
    const w = planLabour(s, v).lines.find((l) => l.cat === 'water');
    expect(w?.reason.params.why).toBe('thirst');
    expect(w?.reason.params.goal).toBeCloseTo(census(s).need.water * 1.5, 0);
    const food = (p: ReturnType<typeof planLabour>): number => s.buildings.filter((b) => b.type === 'ager').reduce((a, b) => a + (p.perBuilding[b.id] ?? 0), 0);
    const W = census(s).workforce;
    expect(food(planLabour(s, v))).toBeLessThanOrEqual(Math.floor(W * 0.75));
    s.needs.hunger = [40, 40, 40, 40];
    const hungry = planLabour(s, v);
    expect(food(hungry)).toBeLessThanOrEqual(Math.floor(W * 0.9));
    expect(hungry.lines.find((l) => l.cat === 'food')?.reason.params.why).toBe('hungry');
  });

  it('puts a prioritised category directly after food', () => {
    const s = fresh(42);
    built(s, 'lignarius');
    expect(setLabourPriority(s, 'materials', 30).ok).toBe(true);
    const lines = planLabour(s, view(s)).lines;
    expect(lines.map((l) => l.cat).slice(0, 3)).toEqual(['water', 'food', 'materials']);
    expect(lines[2].reason).toEqual({ code: 'priority', params: { cat: 'materials', days: 30 } });
  });

  it('manual labour: a seamless hand-over, targets by hand, and Apply once', () => {
    const s = fresh(42);
    expect(setManualTarget(s, 'water', 1).ok).toBe(false);
    expect(setOrdo(s, 'labour', false).ok).toBe(true);
    expect(s.ordo.manual.water).toBe(2);
    expect(s.ordo.manual.food).toBe(1);
    expect(setManualTarget(s, 'water', 1).ok).toBe(true);
    const well = s.buildings.find((b) => b.type === 'puteus') as Building;
    expect(manualPlan(s, view(s)).perBuilding[well.id]).toBe(1);
    expect(applyOnce(s, 'labour').ok).toBe(true);
    for (const l of planLabour(s, view(s)).lines) expect(s.ordo.manual[l.cat]).toBe(l.target);
  });

  it('manual labour: a finished work adds posts, not hands; manualReach is what its target lacks (finding 11)', () => {
    const s = fresh(42);
    expect(setOrdo(s, 'labour', false).ok).toBe(true);   // the targets: today's hands (water 2)
    s.ordo.on.build = false;
    s.ordo.on.trade = false;
    const old = s.buildings.find((b) => b.type === 'puteus') as Building;
    expect(manualReach(s, view(s), old.id)).toBe(0);      // its target keeps its hands
    const well = built(s, 'puteus');
    const slots = slotsOf('puteus', s.rank);
    // the least the water target must rise by so the new well is staffed in full and no staffed post loses a hand,
    // whichever of the two the manual order (nearest the forum) fills first
    const fills = (extra: number): boolean => {
      const keep = s.ordo.manual.water;
      s.ordo.manual.water = keep + extra;
      const per = manualPlan(s, view(s)).perBuilding;
      s.ordo.manual.water = keep;
      return (per[well.id] ?? 0) === slots && (per[old.id] ?? 0) >= (census(s).staffed[old.id] ?? 0);
    };
    const n = manualReach(s, view(s), well.id);
    expect(n).toBe(slots);
    expect(fills(n)).toBe(true);
    expect(fills(n - 1)).toBe(false);
    const one = manualReach(s, view(s), well.id, 1);         // one hand only (a service's full reach): no more
    expect(one).toBeGreaterThanOrEqual(1);
    expect(one).toBeLessThanOrEqual(n);
    run(s, 1);                                              // unchanged, the target leaves one well short
    expect(census(s).catStaffed.water).toBe(2);
    // the posts ahead of a work count: with one hand off the target, the idle well needs that one too
    s.ordo.manual.water = 1;
    run(s, 1);
    const idle = [old, well].find((b) => (census(s).staffed[b.id] ?? 0) === 0) as Building;
    const m = manualReach(s, view(s), idle.id);
    expect(m).toBeGreaterThanOrEqual(slots);
    s.ordo.manual.water += m;
    run(s, 1);
    expect(census(s).staffed[well.id]).toBe(slots);
    expect(census(s).staffed[old.id]).toBe(slots);
    expect(manualReach(s, view(s), well.id)).toBe(0);
  });
});

describe('building', () => {
  it('stakes its wishes within the site limit and keeps every never-rule', () => {
    const s = fresh(42);
    const sv = getMap(s.seed).survey;
    const free = sv.blocks.filter((b) => isActiveBlock(sv, b, s.rank) && [0, 1, 2, 3].every((p) => view(s).d.plotOwner[b.id * 4 + p] === 0));
    s.ordo.reserved = free.slice(0, 2).map((b) => b.id).sort((a, b) => a - b);
    const timber = s.res.timber;
    s.res.timber = 0;
    const plan = placeBuilding(s, 'area', idx(free[2].x, free[2].y), { owner: 'player' });   // a player plan: its block stays closed
    s.res.timber = timber;
    expect(plan.ok).toBe(true);
    const planId = plan.ok ? plan.id : -1;
    // DESIGN §10.3: reserved blocks, and the plan's block only while the player's work there is unfinished
    const closedOn = (st: GameState): number[] => [...st.ordo.reserved, ...(st.buildings.find((b) => b.id === planId)?.status === 'done' ? [] : [free[2].id])];
    const before = s.buildings.map((b) => ({ id: b.id, type: b.type, x: b.x, y: b.y, pref: b.house?.pref }));
    run(s, 400, (st) => {
      const v = view(st);
      const closed = closedOn(st);
      expect(ordoSites(st)).toBeLessThanOrEqual(maxSites(v) + 1);       // + one survival site at most
      for (const b of st.buildings) {
        if (b.owner !== 'ordo') continue;
        if (b.placed === st.day && !String(b.reason?.code).startsWith('survival')) expect(b.status).toBe('staked');
        expect(b.type).not.toBe('hortus');
        for (const i of footprintOf(b, st)) {
          const blk = blockOfTile(st, i);
          // DESIGN §10.3: never on closed or reserved blocks, nor on an unmasked block of a ring not yet surveyed (masked land is rural ground)
          if (blk) expect(closed.includes(blk.id) || blk.reserved !== null || (!blk.masked && !isActiveBlock(sv, blk, st.rank))).toBe(false);
        }
      }
    });
    for (const o of before) expect(s.buildings.find((b) => b.id === o.id && b.type === o.type && b.x === o.x && b.y === o.y && (o.pref === undefined || b.house?.pref === o.pref))).toBeTruthy();
    expect(s.buildings.filter((b) => b.owner === 'ordo').length).toBeGreaterThan(2);
    expect(noNaN(s)).toEqual([]);
  });

  it('raises requests and the pin first, as player sites without a stake', () => {
    const s = fresh(42);
    expect(askOrdo(s, 'lararium').ok).toBe(true);
    const c = ctx();
    runOrdo(s, c, new Rng(1), view(s));
    const shrine = s.buildings.find((b) => b.type === 'lararium') as Building;
    expect(shrine.owner).toBe('player');
    expect(shrine.status).toBe('building');
    expect(shrine.reason?.code).toBe('request');
    expect(c.fx).toContainEqual({ kind: 'ordoPlaced', id: shrine.id });
    expect(s.ordo.requests).toEqual([]);
    for (let k = 0; k < 3; k++) expect(askOrdo(s, 'area').ok).toBe(true);
    expect(askOrdo(s, 'area')).toMatchObject({ ok: false, code: 'full' });
    expect(askOrdo(s, 'capitolium').ok).toBe(false);
    setOrdo(s, 'build', false);
    s.ordo.requests = [];
    expect(askOrdo(s, 'area')).toMatchObject({ ok: false, code: 'ordoOnly' });
  });

  it('a house card\'s request carries its home: the Ordo raises the work where it reaches that home', () => {
    const s = fresh(42);
    const b = dryHouse(s);                                       // a tent beyond the founders' well and shrine
    const plain = structuredClone(s);
    expect(askOrdo(s, 'lararium', b.id).ok).toBe(true);
    expect(s.ordo.requests).toEqual([{ type: 'lararium', day: s.day, house: b.id }]);
    expect(s.log[s.log.length - 1].text).toContain('within reach of that home');
    processRequests(s, ctx(), view(s));
    const shrine = s.buildings.find((x) => x.type === 'lararium' && x.reason?.code === 'request') as Building;
    expect(shrine.owner).toBe('player');
    expect(reachSteps(s, 'lararium', shrine.x, shrine.y, b.id, 'religion')).not.toBeNull();
    expect(shrine.reason?.params).toMatchObject({ n: 1, want: 'religion' });   // that home lacked one
    // asked for no home, the shrine goes to the Ordo's best site, which does not reach that tent (the advice ignored)
    expect(askOrdo(plain, 'lararium').ok).toBe(true);
    expect(plain.ordo.requests).toEqual([{ type: 'lararium', day: plain.day }]);
    processRequests(plain, ctx(), view(plain));
    const other = plain.buildings.find((x) => x.type === 'lararium' && x.reason?.code === 'request') as Building;
    expect(reachSteps(plain, 'lararium', other.x, other.y, b.id, 'religion')).toBeNull();
  });

  it('asked for a home no free plot reaches, the Ordo says so at once; one that comes to pass later is said as it builds', () => {
    const s = fresh(42);
    const b = dryHouse(s);
    const fill = (st: GameState): void => {                      // every free slot whose well would reach the tent taken
      for (let i = 0; i < 60; i++) {
        const at = serveSlot(st, 'puteus', 'ordo', 'water', [b.id])?.tile;
        if (at === undefined) return;
        expect(placeBuilding(st, 'puteus', at, { owner: 'ordo', ignoreCost: true }).ok).toBe(true);
      }
    };
    const later = structuredClone(s);
    fill(s);
    expect(askOrdo(s, 'puteus', b.id)).toEqual({ ok: false, code: 'noSlots',
      reason: `The surveyors find no free plot within ${serviceReach(s, 'puteus', 'water')} steps of this house for a well; clearing one would help.` });
    expect(s.ordo.requests).toEqual([]);
    expect(askOrdo(s, 'puteus').ok).toBe(true);                  // asked for no home, it goes to the best site as before
    // asked while a plot reached the tent, and the plots taken before the stores allowed it: the Ordo says so as it builds
    expect(askOrdo(later, 'puteus', b.id).ok).toBe(true);
    fill(later);
    processRequests(later, ctx(), view(later));
    const well = later.buildings.find((x) => x.type === 'puteus' && x.reason?.code === 'request');
    expect(well).toBeDefined();
    expect(later.log.some((l) => l.text === 'No free plot reaches the home that asked for a well any longer; the Ordo raises it at its best site.')).toBe(true);
    expect(later.ordo.requests).toEqual([]);
  });

  it('asked for a home only plots the Ordo leaves alone reach, it says a hand may still raise the work there', () => {
    const s = fresh(42);
    const b = dryHouse(s);
    const sv = getMap(s.seed).survey;
    // the player reserves the block of each plot whose well would reach the tent, until none is the Ordo's to take
    for (let i = 0; i < 60; i++) {
      const at = serveSlot(s, 'puteus', 'ordo', 'water', [b.id])?.tile;
      if (at === undefined) break;
      s.ordo.reserved = [...s.ordo.reserved, sv.blockAt[at]].sort((x, y) => x - y);
      invalidate(s);
    }
    expect(s.ordo.reserved.length).toBeGreaterThan(0);
    // a plot still reaches it by hand: the house card says nothing of "no free plot", and neither does the Ordo
    expect(serveSlot(s, 'puteus', 'player', 'water', [b.id])).not.toBeNull();
    expect(noPlotNote(s, b.id, 'water', 'puteus')).toBeNull();
    expect(askOrdo(s, 'puteus', b.id)).toEqual({ ok: false, code: 'noSlots',
      reason: `The only free plots within ${serviceReach(s, 'puteus', 'water')} steps of this house are on land the Ordo leaves alone: reserved, kept for a work to come, where you are building, or beyond the walls in the rings to come. Place a well there yourself.` });
    expect(s.ordo.requests).toEqual([]);
  });

  it('a work raised where the Ordo buys out homes is not offered to raise by hand (Apply once, the Fabrum, the Agenda)', () => {
    // rank 3: six stone houses wait for a temple round a block of the founders' tents, and every free block is the
    // player's reserve: the Ordo would buy out the tents and raise the temple there (DESIGN §3.9)
    const s = fresh(42);
    s.rank = 3;
    const sv = getMap(s.seed).survey, W = getMap(s.seed).W;
    const start = view(s).d.houses.map((id) => s.buildings.find((x) => x.id === id) as Building);
    const tents = sv.blockAt[idx(start[0].x, start[0].y)];
    for (const b of start) if (sv.blockAt[idx(b.x, b.y)] !== tents) b.house!.tier = 'domusParva';
    // four more stone houses, raised by the Ordo today (a growth work: the next waits on the pace) nearest the tents
    const near = (t: number): number => Math.abs((t % W) - start[0].x) + Math.abs(Math.floor(t / W) - start[0].y);
    for (const tile of [...validSlots(s, 'area', 'player').keys()].sort((a, c) => near(a) - near(c) || a - c).slice(0, 4)) {
      const r = placeBuilding(s, 'area', tile, { owner: 'ordo', ignoreCost: true, noStake: true, reason: { code: 'beds', params: { free: 0, keep: 8 } } });
      expect(r.ok).toBe(true);
      const h = s.buildings[s.buildings.length - 1];
      Object.assign(h, { status: 'done', progress: 1, doneDay: s.day });
      h.house = { tier: 'domusParva', pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 };
    }
    invalidate(s);
    // a well, a shrine and a shop row of the player's, staffed, give them all but the temple
    const jobs: Record<number, number> = {};
    for (const [need, type] of [['water', 'puteus'], ['religion', 'lararium'], ['market', 'taberna']] as const) {
      const at = serveSlot(s, type, 'player', need, view(s).d.houses);
      if (!at) continue;
      const r = placeBuilding(s, type, at.tile, { owner: 'player', ignoreCost: true, noStake: true });
      expect(r.ok).toBe(true);
      Object.assign(s.buildings[s.buildings.length - 1], { status: 'done', progress: 1 });
      invalidate(s);
    }
    for (const b of s.buildings) if (b.type === 'puteus' || b.type === 'lararium' || b.type === 'taberna') jobs[b.id] = 2;
    setJobs(s, { perBuilding: jobs });
    const d = view(s).d;
    s.ordo.reserved = sv.blocks.filter((k) => isActiveBlock(sv, k, s.rank) && k.reserved === null && [0, 1, 2, 3].every((p) => d.plotOwner[k.id * 4 + p] === 0))
      .map((k) => k.id).sort((a, c) => a - c);
    for (const r of Object.keys(s.res) as (keyof typeof s.res)[]) s.res[r] = 5000;
    invalidate(s);
    const renew = walkWishes(s, view(s), true).list.map((e) => e.wish).find((w) => w.renew);
    expect(renew?.type).toBe('templum');
    expect(renew?.reason.code).toBe('renewal');
    expect(sv.blockAt[renew!.tile]).toBe(tents);
    // the services are the player's: the temple is the one service the Ordo would raise, and no hand can place it on
    // the tents, so Apply once has nothing to offer (it once failed with "That plot is taken.")
    s.ordo.works.services = false;
    const ids = s.buildings.map((b) => b.id);
    expect(wouldRaise(s, view(s))).toBeNull();
    expect(applyOnce(s, 'build')).toMatchObject({ ok: false, code: 'notFound' });
    expect(s.buildings.map((b) => b.id)).toEqual(ids);
    // the Ordo holds them again and the temple waits on the pace: the Praefectus Fabrum does not offer to place it, and
    // its Agenda row does not ask for a hand
    s.ordo.works.services = true;
    const temple = newWishes(s, view(s), 3).find((w) => w.reason.code === 'renewal');
    expect(temple?.state).toBe('paced');
    expect(FABRUM_RULES.find((x) => x.id === 'fabrum.agenda')!.evaluate(s, view(s))).toBeNull();
    expect(wishState(game(s), temple!)).toBe(`the Ordo raises it in ${growthWait(s)} d`);
  });

  it('a lumber camp whose woods are felled yields nothing; its replacement is saved for before the orders that lack timber', () => {
    const s = fresh(42);
    const camp = built(s, 'lignarius');
    const R = B.economy.WOOD.CATCHMENT;
    for (let y = camp.y - R; y < camp.y + 2 + R; y++) for (let x = camp.x - R; x < camp.x + 2 + R; x++) if (getMap(42).woodMax[idx(x, y)] > 0) s.wood[idx(x, y)] = 0;
    invalidate(s);
    expect(siteMult(s, camp)).toBe(0);                           // not the regrowth floor: nothing stands to regrow
    expect(fullRate(s, camp).timber ?? 0).toBe(0);
    for (const d of ['materials', 'water', 'homes', 'services', 'food'] as const) setDuty(s, d, true);
    s.res.timber = 15;                                           // a well asked for (10 timber), but not the camp as well
    s.res.denarii = 2000;
    s.res.stone = 200;
    expect(askOrdo(s, 'puteus').ok).toBe(true);
    const v = view(s);
    const rv = walkWishes(s, v).list.find((e) => e.wish.revive === 'timber');
    expect(rv?.wish.type).toBe('lignarius');
    expect(['saving', 'proposed']).toContain(rv?.state);
    processRequests(s, ctx(), v);
    expect(s.buildings.some((b) => b.type === 'puteus' && b.reason?.code === 'request')).toBe(false);   // the camp's timber is kept
    s.res.timber = 25;
    invalidate(s);
    processRequests(s, ctx(), view(s));
    expect(s.buildings.some((b) => b.type === 'puteus' && b.reason?.code === 'request')).toBe(true);
  });

  it('saves for the pin, holds the stock back, then releases it without a long stall', () => {
    const s = fresh(42);
    s.res.stone = 0;                                             // the pinned horreum lacks stone; no quarry stands
    expect(pinBuild(s, 'horreum').ok).toBe(true);
    const v = view(s);
    expect(savingFor(s, v)?.for).toBe('pin');
    // DESIGN §10.5: the saving target is the pin plus the Ordo's own pending wish (none in the phase-1 stub world)
    expect(reserved(s, v)).toEqual(addCost({ denarii: 80, timber: 40, stone: 20 }, walkWishes(s, v).pending?.cost ?? {}));
    expect(canSpend(s, { timber: s.res.timber - 30 }, v)).toBe(false);
    expect(canSpend(s, { timber: 30 }, v)).toBe(true);
    let day = -1;
    run(s, 120, (st, _c, i) => { if (day < 0 && st.buildings.some((b) => b.type === 'horreum' && b.reason?.code === 'pin')) day = i; });
    expect(day).toBeGreaterThanOrEqual(0);
    expect(s.ordo.pin).toBeNull();
    expect(s.buildings.some((b) => b.type === 'lapicidina' && b.reason?.code === 'materials')).toBe(true);
    expect(savingFor(s, view(s))?.for).not.toBe('pin');
  });

  it('keeps a pure wish list in which every item explains itself', () => {
    const s = run(fresh(42), 30);
    const a = structuredClone(s), b = structuredClone(s);
    const json = serialize(a);
    const la = wishList(a, view(a), 6);
    expect(la.length).toBeGreaterThan(0);
    expect(wishList(b, view(b), 6)).toEqual(la);
    expect(wishList(a, view(a), 6)).toEqual(la);
    expect(serialize(a)).toBe(json);
    for (const w of la) clean(w.reason);
  });

  it('decides the same after a save and load as without one (its memory lives in the state)', () => {
    const a = run(fresh(3), 150);
    const b = deserialize(serialize(a)) as GameState;
    expect(serialize(run(b, 250))).toBe(serialize(run(a, 250)));
  });

  it('reports the day: labour, agenda, ticker', () => {
    const s = run(fresh(42), 3);
    const r = councilReport(s);
    expect(r.day).toBe(s.day);
    expect(r.labour.length).toBeGreaterThanOrEqual(2);
    expect(r.ticker.length).toBeGreaterThan(0);
    for (const t of r.ticker) clean(t);
    expect(r.would).toEqual({ labour: {}, build: null, trade: null });
  });
});

describe('reasons that stay true (R47)', () => {
  it('a lack the stores now hold is told as covered, a smaller one by its number', () => {
    const s = run(fresh(42), 5);
    const v = view(s);
    const r: Reason = { code: 'materials', params: { type: 'lignarius', res: 'timber', qty: 24, for: 'renovation', eta: 40 } };
    const covered = currentReason(s, v, r, { timber: 0 });
    expect(reasonText(covered)).toBe('We have timber enough for the renovations; a lumber camp keeps the supply coming.');
    expect(reasonShort(covered)).toBe('Lumber camp — keeps the timber coming');
    expect(currentReason(s, v, r, { timber: 12 }).params).toMatchObject({ qty: 12, eta: 20, for: 'renovation' });
    expect(currentReason(s, v, r, { timber: 24 })).toBe(r);
    const beds: Reason = { code: 'beds', params: { type: 'area', free: 2, keep: 8 } };
    expect(currentReason(s, v, beds)).toBe(beds);
    clean({ code: 'capitolium', params: { type: 'fodina', res: 'ore', covered: 1 } });
  });
  it('a lumber camp whose own felling fills the store does not say "we lack timber" (decision bot, 8 seeds)', () => {
    let placed = 0;
    for (let seed = 1; seed <= 8; seed++) {
      play(seed, 'decision', {
        days: 160,
        onDay: (st) => {
          for (const b of st.buildings) {
            if (b.owner !== 'ordo' || b.placed !== st.day || b.reason?.code !== 'materials') continue;
            placed++;
            const res = b.reason.params.res as keyof GameState['res'];
            if (b.reason.params.covered !== 1) expect(st.res[res], `seed ${seed} day ${st.day}: ${reasonText(b.reason)}`).toBeLessThan(census(st).caps[res]);
            expect(st.log.some((l) => l.day === st.day && l.kind === 'ordo' && l.text === reasonText(b.reason!))).toBe(true);
          }
        },
      });
    }
    expect(placed).toBeGreaterThan(0);
  }, 120_000);
  it('names the council focus only once the player can see it', () => {
    expect(reasonText({ code: 'focusPlan', params: { type: 'lignarius' } })).toBe('The council\'s plan calls for a lumber camp.');
    expect(reasonShort({ code: 'focusPlan', params: { type: 'lignarius' } })).toBe('Lumber camp — the council\'s plan');
    expect(reasonText({ code: 'focusPlan', params: { type: 'lignarius', focus: 'concordia' } })).toBe('The council\'s plan for Concordia calls for a lumber camp.');
    const s = run(fresh(42), 12);
    const plan = (st: GameState): Reason[] => walkWishes(st, view(st)).list.map((e) => e.wish.reason).filter((r) => r.code === 'focusPlan');
    expect(s.guidance.milestoneDays.charter).toBeUndefined();
    const before = plan(s);
    expect(before.length).toBeGreaterThan(0);
    for (const r of before) expect(r.params.focus).toBeUndefined();
    const t = structuredClone(s);
    t.decisions.paths.charter = 'veterani';
    t.guidance.milestoneDays.charter = t.day;
    for (const r of plan(t)) expect(r.params.focus).toBe('concordia');
  });
  it('a site finished after the council sat leaves the Agenda and the ticker; a new focus makes the report again', () => {
    const s = fresh(42);
    let site: Building | undefined;
    for (let i = 0; i < 60 && !site; i++) {
      run(s, 1);
      const a = councilReport(s).agenda.find((w) => w.state === 'building');
      site = a ? s.buildings.find((b) => b.id === a.siteId) : undefined;
    }
    expect(site).toBeDefined();
    Object.assign(site!, { status: 'done', progress: 1 });
    invalidate(s);
    const rep = councilReport(s);
    expect(rep.agenda.some((w) => w.siteId === site!.id)).toBe(false);
    expect(rep.ticker.some((r) => r.params.state === 'raising' && r.params.type === site!.type && r.code === site!.reason?.code)).toBe(false);
    s.decisions.focus = 'copia';
    expect(councilReport(s)).not.toBe(rep);
    expect(councilReport(s).agenda.every((w) => w.reason.code !== 'focusPlan' || w.reason.params.focus !== 'concordia')).toBe(true);
  });
});

describe('emergency (Lex de annona)', () => {
  it('cuts rations below 12 and 6 days and lifts them above 25 days at the edict portion', () => {
    const s = fresh(42);
    const need0 = census(s).need.grain;
    emergencyDay(s, ctx(), withForecast(s, { runout: s.day + 10, need: 20 }));
    expect(s.ordo.emergency.rations).toBe('parcae');
    expect(census(s).need.grain).toBeCloseTo(need0 * 0.85, 5);
    emergencyDay(s, ctx(), withForecast(s, { runout: s.day + 5, need: 20 }));
    expect(s.ordo.emergency.rations).toBe('arctae');
    s.res.grain = (20 / 0.7) * 24;                                 // 24 days at full portions: not yet
    emergencyDay(s, ctx(), withForecast(s, { runout: null, need: 20 }));
    expect(s.ordo.emergency.rations).toBe('arctae');
    s.res.grain = (20 / 0.7) * 26;
    emergencyDay(s, ctx(), withForecast(s, { runout: null, need: 20 }));
    expect(s.ordo.emergency.rations).toBe('none');
    const lines = s.log.filter((e) => e.kind === 'emergency');
    expect(lines.length).toBe(3);
    for (const e of lines) expect(e.tags).toContain('decided');
  });

  it('pauses the water-drawing works below 8 days under two-thirds of the lift level, and resumes above 15', () => {
    const s = fresh(42);
    s.rank = 2;
    const works = built(s, 'caementarium');
    const roomy = { cap: 40 * view(s).f.water.need };                // stores that hold 40 days: the 15-day level stands
    expect(B.emergency.WATER_START * B.emergency.WATER_RESUME).toBeCloseTo(10, 9);
    // falling fast, but above two-thirds of the 15 days that lift it: a pause here would lift tomorrow
    emergencyDay(s, ctx(), withForecast(s, {}, { ...roomy, runout: s.day + 7, doh: 10.5 }));
    expect(s.ordo.emergency.waterPause).toBe(false);
    emergencyDay(s, ctx(), withForecast(s, {}, { ...roomy, runout: s.day + 7, doh: 9.5 }));
    expect(s.ordo.emergency.waterPause).toBe(true);
    expect(planLabour(s, view(s)).perBuilding[works.id] ?? 0).toBe(0);
    emergencyDay(s, ctx(), withForecast(s, {}, { ...roomy, runout: null, doh: 14 }));
    expect(s.ordo.emergency.waterPause).toBe(true);
    emergencyDay(s, ctx(), withForecast(s, {}, { ...roomy, runout: null, doh: 16 }));
    expect(s.ordo.emergency.waterPause).toBe(false);
  });

  it('stores that hold under 15 days lift the water pause at three-quarters full, so a full store always lifts it', () => {
    const s = fresh(42);
    s.rank = 2;
    built(s, 'caementarium');
    s.ordo.on.build = false;                                         // no cistern raised meanwhile: the stores stay as they are
    const houses = s.buildings.filter((h) => h.house);              // one more adult in every tent: 30 souls drink more
    houses.forEach((h, k) => s.people.push({ ...s.people[2], id: 10_000 + k, spouse: null, work: null, home: h.id, skills: {} }));
    s.nextId = 20_000;
    touchPeople(s);
    const full = caps(s).water / census(s).need.water;
    expect(full).toBeLessThan(B.emergency.WATER_RESUME);            // the playtest colony's 14 days: 15 could never be met
    s.ordo.emergency.waterPause = true;
    s.res.water = 2 * census(s).need.water;
    run(s, 120);                                                     // the wells refill the stores
    expect(s.res.water).toBeGreaterThan(B.economy.RESERVE_ROOM * caps(s).water);
    expect(caps(s).water / census(s).need.water).toBeLessThan(B.emergency.WATER_RESUME);
    expect(s.ordo.emergency.waterPause).toBe(false);
    const line = s.log.filter((e) => e.kind === 'emergency').at(-1);
    expect(line?.text).toMatch(/^Lex de annona: water is back to \d+ days; the works draw again\.$/);
    expect(Number(/back to (\d+)/.exec(line?.text ?? '')?.[1])).toBeLessThan(B.emergency.WATER_RESUME);
  });

  /** A small store's colony: 41 souls whose stores hold about 10 days, a concrete works and two baths that draw more than
   *  the wells' surplus, the Ordo building nothing; `aquae` the edict. A year's run: the days the forecast ran out
   *  within 8 days (the works drawing), the pauses (start day, length) and the Lex de annona's water lines. */
  function thirstyWorks(aquae: 'populo' | 'aequa'): { fast: number; pauses: { day: number; len: number }[]; lines: number; bath: number; thirst: number } {
    const s = fresh(42);
    s.rank = 2;
    built(s, 'caementarium'); built(s, 'balneum'); built(s, 'balneum');
    s.ordo.on.build = false;
    s.decisions.edicts.aquae = aquae;
    const houses = s.buildings.filter((h) => h.house);
    let id = 10_000;
    for (let k = 0; k < 3; k++) houses.forEach((h) => s.people.push({ ...s.people[2], id: id++, spouse: null, work: null, home: h.id, skills: {} }));
    s.nextId = 20_000;
    touchPeople(s);
    expect(caps(s).water / census(s).need.water).toBeLessThan(11);
    let fast = 0, bath = 0, thirst = 0;
    const pauses: { day: number; len: number }[] = [];
    run(s, 365, (st, c) => {
      const f = view(st).f.water;
      if (f.runout !== null && f.runout - st.day < B.emergency.WATER_PAUSE) fast++;
      bath += c.rates.cons.water.baths ?? 0;
      thirst = Math.max(thirst, ...st.needs.thirst);
      const last = pauses.at(-1);
      if (st.ordo.emergency.waterPause && (!last || last.len >= 0)) pauses.push({ day: st.day, len: -1 });
      else if (!st.ordo.emergency.waterPause && last && last.len < 0) last.len = st.day - last.day;
    });
    const lines = s.log.filter((e) => e.kind === 'emergency' && /^Lex de annona: water (would run out|is back)/.test(e.text)).length;
    return { fast, pauses, lines, bath, thirst };
  }

  it('works that draw more than the wells\' surplus: under Populo prius their floor keeps the stores at the lift level, so no pause', () => {
    // the pause starts on a rate and lifts on a level: started at any level, it lifted the next day and started again
    // the day after (180 lines in two years). The works' floor is the level that lifts it, and a pause starts only
    // under two-thirds of that level
    const r = thirstyWorks('populo');
    expect(r.fast).toBeGreaterThan(30);                              // the rate alone would pause them on many days
    expect(r.bath).toBeGreaterThan(0);                               // the baths draw the wells' surplus above the floor
    expect(r.lines).toBeLessThanOrEqual(2);
    expect(r.thirst).toBe(0);
  });

  it('works that draw more than the wells\' surplus: under Aequa each pause refills a third of the stores\' lift level first', () => {
    const r = thirstyWorks('aequa');
    expect(r.pauses.length).toBeGreaterThan(0);                      // no floor: the works drain the stores
    expect(Math.min(...r.pauses.filter((p) => p.len >= 0).map((p) => p.len))).toBeGreaterThanOrEqual(4);   // never a day
    expect(r.pauses.length).toBeLessThanOrEqual(26);                 // at most one a fortnight
    expect(r.lines).toBeLessThanOrEqual(2 * r.pauses.length);       // a line when each starts and when it lifts
    expect(r.thirst).toBe(0);
  });

  it('imports grain below 8 days once per cooldown, and asks the Legate when that cannot save us', () => {
    const s = fresh(42);
    s.rank = 1;
    s.res.denarii = 2000;
    invalidate(s);
    // the stub honours WP-D's contract: a successful emergencyImport records lastImport itself (set once, in trade.ts)
    vi.mocked(emergencyImport).mockImplementation((st) => { st.ordo.emergency.lastImport = st.day; return true; });
    emergencyDay(s, ctx(), withForecast(s, { runout: s.day + 7, need: 20 }));
    expect(emergencyImport).toHaveBeenCalledWith(s, expect.anything(), 400);
    expect(s.ordo.emergency.lastImport).toBe(s.day);
    s.day += 1;
    emergencyDay(s, ctx(), withForecast(s, { runout: s.day + 6, need: 20 }));
    expect(emergencyImport).toHaveBeenCalledTimes(1);
    vi.mocked(triggerRelief).mockImplementation((st) => {
      st.choice = { event: 'mutuum', kicker: '', title: '', text: '', options: [], defaultIndex: 0, created: st.day, expires: st.day + 15 };
    });
    emergencyDay(s, ctx(), withForecast(s, { runout: s.day + 9, structural: true, need: 20 }));
    expect(triggerRelief).toHaveBeenCalledTimes(1);
    expect(s.ordo.emergency.lastRelief).toBe(s.day);
    s.choice = null;
    s.day += 30;
    emergencyDay(s, ctx(), withForecast(s, { runout: s.day + 3, structural: true, need: 20 }));
    expect(triggerRelief).toHaveBeenCalledTimes(1);                // once per 365 days
    expect(s.log.filter((e) => e.kind === 'emergency' && e.text.includes('Legate')).length).toBe(1);
  });

  it('lifts every measure when the switch is turned off', () => {
    const s = fresh(42);
    s.ordo.emergency.rations = 'parcae';
    s.ordo.emergency.waterPause = true;
    s.decisions.switches.emergency = false;
    emergencyDay(s, ctx(), view(s));
    expect(s.ordo.emergency).toMatchObject({ rations: 'none', waterPause: false });
  });
});

describe('toggles and govern-while-away', () => {
  it('with every area manual the Ordo idles, except offline with Govern while away', () => {
    const s = fresh(42);
    s.decisions.switches.emergency = false;
    for (const a of ['labour', 'build', 'trade'] as const) setOrdo(s, a, false);
    const ids = s.buildings.map((b) => b.id);
    run(s, 60, (st, c) => {
      expect(c.fx.some((e) => e.kind === 'ordoPlaced')).toBe(false);
      expect(councilReport(st).labour.every((l) => l.reason.code === 'priority')).toBe(true);
    });
    expect(s.buildings.map((b) => b.id)).toEqual(ids);
    expect(s.trade.contracts).toEqual([]);
    const other = structuredClone(s);
    other.decisions.switches.governAway = false;
    away(other, 30);
    expect(other.buildings.some((b) => b.owner === 'ordo')).toBe(false);
    away(s, 30);
    expect(s.buildings.some((b) => b.owner === 'ordo')).toBe(true);
    expect(s.log.some((e) => e.kind === 'ordo' && e.tags?.includes('decided'))).toBe(true);
  });
});

describe('trade', () => {
  it('sells surplus to the best hub, imports grain in a famine, and leaves player contracts alone', () => {
    const s = fresh(42);
    s.rank = 1;
    invalidate(s);
    s.res.timber = 300;
    expect(createContract(s, { hub: 'metellianus', mode: 'import', res: 'stone', qty: 10, repeat: true }, 'player').ok).toBe(true);
    const player = structuredClone(s.trade.contracts[0]);
    // DESIGN §10.7: the Ordo sells what passes 95% of the cap (full sheds of 300 timber leave 15, too few for a caravan),
    // and from 60% under Mercatura
    expect(ordoTradeWould(s, view(s))).toBeNull();
    s.decisions.focus = 'mercatura';
    expect(ordoTradeWould(s, view(s))?.code).toBe('surplusExport');
    ordoTrade(s, ctx(), view(s));
    const mine = s.trade.contracts.find((c) => c.owner === 'ordo');
    expect(mine).toMatchObject({ mode: 'export', res: 'timber', qty: 80, reason: { code: 'surplusExport' } });
    expect(s.trade.contracts[0]).toEqual(player);
    const famine = tradeMoves(s, withForecast(s, { doh: 10, structural: true, stock: 200, need: 20, crunch: null }));
    expect(famine).toEqual([]);                                    // two caravan slots, both in use
    s.trade.contracts = [];
    const moves = tradeMoves(s, withForecast(s, { doh: 10, structural: true, stock: 200, need: 20, crunch: null }));
    expect(moves[0]).toMatchObject({ spec: { mode: 'import', res: 'grain', hub: 'silvanum', qty: 80 }, reason: { code: 'deficitImport' } });
    setOrdo(s, 'trade', false);
    expect(s.trade.contracts.every((c) => c.owner === 'player')).toBe(true);
  });
  // the merchant's grain on his last council day, with an urgent advisory standing (the quaestor's wanted goods)
  const lastDay = (rank: 0 | 1, rule: 'annonae.grain.runout' | 'annonae.storage'): GameState => {
    const s = fresh(42);
    s.rank = rank;
    s.res.denarii = 50_000;
    s.res.grain = 100;
    invalidate(s);
    s.trade.merchant = { name: 'Syrian spice traders', arrived: s.day - 5, until: s.day + 3, offers: [{ id: 1, kind: 'buy', res: 'grain', qty: 40, price: 2, taken: false }] };
    s.guidance.advisories[rule] = { rule, active: true, sev: 2, since: s.day, lowerSince: null, params: {}, flips: [s.day] };
    ordoTrade(s, ctx(), view(s));
    return s;
  };
  it('deals with the merchant only once Commercium is open to the player (R28), and buys grain only when it is wanted', () => {
    expect(lastDay(1, 'annonae.grain.runout').res.grain).toBe(140);   // bought (and the merchant, sold out, departs)
    expect(lastDay(0, 'annonae.grain.runout').res.grain).toBe(100);   // Castra: no trade yet
    expect(lastDay(1, 'annonae.storage').res.grain).toBe(100);        // full sheds want room, not grain
  });
});

describe('water for Aestas (DESIGN §10.5 row 2, §11.11)', () => {
  // the wish's choice on chosen figures: need 100 a day, the reserve 15 days; a full store must hold the Aestas deficit
  // and the reserve, plus the sun's share (hold = (deficit × 92 + 1,500) / 0.816 ≈ 1,840 with no deficit)
  const setup = () => { const s = fresh(42); run(s, 1); return { s, v: view(s), pot: maxPotential(s, 'water', 1) }; };
  const w = (cons: number, cap: number): EssentialForecast => ({ ...view(fresh(42)).f.water, need: 100, cons, cap });
  const at = (s: GameState, startsIn: number, lowIn: number) => ({ season: 1 as const, startsIn, lowestDoh: 10, lowestDay: s.day + lowIn, emptyDay: null, needInStore: 0 });
  it('a cistern while room is what is short and Aestas is still ahead', () => {
    const { s, v, pot } = setup();
    expect(aestasWork(s, v, w(pot, 1500), at(s, 30, 120), 15)).toBe('cisterna');    // one cistern short
    expect(aestasWork(s, v, w(pot, 500), at(s, 30, 120), 15)).toBe('cisterna');     // several short, but the wells carry Aestas
  });
  it('a well when the wells fall short by more than a cistern\'s room, or the room already suffices', () => {
    const { s, v, pot } = setup();
    expect(aestasWork(s, v, w(pot + 50, 1500), at(s, 30, 120), 15)).toBe('puteus');
    expect(aestasWork(s, v, w(pot + 5, 5000), at(s, 30, 120), 15)).toBe('puteus');
  });
  it('never a cistern once Aestas has come (its room could not fill), and nothing when no well could lift the low', () => {
    const { s, v, pot } = setup();
    expect(aestasWork(s, v, w(pot, 1500), at(s, 0, 40), 15)).toBe('puteus');
    expect(aestasWork(s, v, w(pot, 1500), at(s, 0, 0), 15)).toBeNull();               // the low is today
    expect(aestasWork(s, v, w(pot, 5000), at(s, 30, 30), 15)).toBeNull();             // the low is Aestas's first day
  });
  it('the forecast mans the wells for what the works draw as well as for the need: a full store does not drain in Ver', () => {
    const s = fresh(42);
    run(s, 1);
    s.rank = 2;
    invalidate(s);
    for (let k = 0; k < 3; k++) built(s, 'puteus');
    const bath = built(s, 'balneum');                                              // draws 20 a day while manned
    setJobs(s, { perBuilding: { [bath.id]: 2 } });
    invalidate(s);
    const f = projectEssential(s, 'water');
    expect(f.cons - f.need).toBeGreaterThanOrEqual(BUILDING_DEFS.balneum.waterDraw ?? 20);
    expect(maxPotential(s, 'water', 0)).toBeGreaterThan(f.need * B.forecast.WATER + (f.cons - f.need));
    s.res.water = f.cap;
    const g = projectEssential(s, 'water');
    expect(g.months[0].season).toBe(0);
    expect(g.months[0].endStock).toBeGreaterThanOrEqual(g.cap - 1);
  });
  it.runIf(INTEGRATED)('a growing city raises water as its need grows, not a cistern every build day, and keeps its summer runway', () => {
    const cisterns: number[] = [];
    let low = Infinity;
    const r = play(42, 'decision', {
      days: 6000,
      onDay: (st) => {
        for (const b of st.buildings) if (b.type === 'cisterna' && b.placed === st.day && b.owner === 'ordo') cisterns.push(st.day);
        const need = census(st).need.water;
        if (st.day > 30 && need > 0) low = Math.min(low, st.res.water / need);
      },
    });
    const s = r.s;
    const wells = s.buildings.filter((b) => b.type === 'puteus').length, tanks = s.buildings.filter((b) => b.type === 'cisterna').length;
    for (const d of cisterns) expect(cisterns.filter((x) => x > d - 365 && x <= d).length, `cisterns in the year to day ${d}`).toBeLessThanOrEqual(3);
    expect(tanks).toBeLessThanOrEqual(wells);                                      // yield grows with the need; room follows it
    expect((wells * 17.6 + tanks * 2.4) / census(s).need.water).toBeGreaterThan(0.8); // Aestas yield tracks the need
    expect(low).toBeGreaterThanOrEqual(10);                                        // the realised runway never fell below 10 days
    expect(s.stats.deathsBy.thirst).toBe(0);
  }, 120_000);
});

describe('the Ordo\'s gardens (DESIGN §10.3 make room, §10.5 row 11)', () => {
  const G = B.ordo.GARDEN;
  /** The work on the other plot of a plot's half-block (0: none). */
  const halfMate = (s: GameState, tile: number): number => {
    const m = getMap(s.seed), bi = m.survey.blockAt[tile], blk = m.survey.blocks[bi];
    const plot = (Math.floor(tile / m.W) - blk.y >= B.map.PLOT ? 2 : 0) + ((tile % m.W) - blk.x >= B.map.PLOT ? 1 : 0);
    return view(s).d.plotOwner[bi * 4 + (plot ^ 1)];
  };
  /** The gardens on a tile's block. */
  const gardensOn = (s: GameState, tile: number): number => {
    const bi = getMap(s.seed).survey.blockAt[tile];
    return [0, 1, 2, 3].filter((p) => s.buildings.find((b) => b.id === view(s).d.plotOwner[bi * 4 + p])?.type === 'hortus').length;
  };
  /** A finished garden of the Ordo's on every free plot it could take but the last `keep` (an old save flooded under Urbs). */
  const flood = (s: GameState, keep = 0): Building[] => {
    const tiles = [...validSlots(s, 'hortus', 'ordo').keys()].sort((a, b) => a - b);
    const out: Building[] = [];
    for (const tile of tiles.slice(0, tiles.length - keep)) {
      const r = placeBuilding(s, 'hortus', tile, { owner: 'ordo', ignoreCost: true, noStake: true });
      if (!r.ok || r.id === undefined) continue;
      const b = s.buildings.find((x) => x.id === r.id) as Building;
      Object.assign(b, { status: 'done', progress: 1 });
      out.push(b);
    }
    invalidate(s);
    return out;
  };

  /** The start under Urbs with every founder's home a stone house (short of a domus's street). */
  const stoneStart = (): GameState => {
    const s = fresh(42);
    s.decisions.focus = 'urbs';
    for (const id of view(s).d.houses) (s.buildings.find((b) => b.id === id) as Building).house!.tier = 'domusParva';
    invalidate(s);
    return s;
  };

  it('plants a garden under Urbs only beside the homes, one to a block, where it lifts a stone house', () => {
    const s = stoneStart();
    const g = gardenSlot(s, view(s));
    expect(g).not.toBeNull();
    expect(g!.n).toBeGreaterThan(0);
    expect(g!.k > 0 || g!.lift >= G.LIFT_MIN).toBe(true);
    expect(halfMate(s, g!.tile)).not.toBe(0);           // beside a work on its half-block: no free half or block is broken
    expect(gardensOn(s, g!.tile)).toBeLessThan(G.PER_BLOCK);
    // the council's garden goes there (the plan's first, then beauty), not to the plot nearest the forum
    for (const r of Object.keys(s.res) as (keyof typeof s.res)[]) s.res[r] = 0;
    expect(walkWishes(s, view(s), true).list.find((e) => e.wish.type === 'hortus')?.wish.tile).toBe(g!.tile);
    // once its block holds a garden, the start's other block is full and no other block has a home: no garden is worth a plot
    const r = placeBuilding(s, 'hortus', g!.tile, { owner: 'ordo', ignoreCost: true, noStake: true });
    expect(r.ok).toBe(true);
    expect(gardenSlot(s, view(s))).toBeNull();
    expect(walkWishes(s, view(s), true).list.some((e) => e.wish.type === 'hortus')).toBe(false);
  });

  it('keeps the homes\' last free plots, and a garden for every two homes at most', () => {
    const s = stoneStart();
    const sv = getMap(s.seed).survey;
    const block = sv.blockAt[gardenSlot(s, view(s))!.tile];
    // a town with a garden for every two homes plants no more (the player's gardens count)
    const away = [...validSlots(s, 'hortus', 'player').keys()].sort((a, b) => a - b).filter((tile) => sv.blockAt[tile] !== block);
    const n = Math.ceil(view(s).d.houses.length * G.PER_HOME);
    for (const tile of away.slice(0, n)) expect(placeBuilding(s, 'hortus', tile, { owner: 'player', ignoreCost: true, noStake: true }).ok).toBe(true);
    expect(gardenSlot(s, view(s))).toBeNull();
    s.buildings.pop();
    invalidate(s);
    expect(gardenSlot(s, view(s))).not.toBeNull();
    // the last KEEP_PLOTS free house plots are the homes': no garden while no more are free (blocks reserved by the player)
    const t = stoneStart();
    for (const blk of sv.blocks) {
      if (validSlots(t, 'area', 'ordo').size <= G.KEEP_PLOTS) break;
      if (blk.id === block || blk.reserved !== null || ![0, 1, 2, 3].some((p) => view(t).d.plotOwner[blk.id * 4 + p] === 0)) continue;
      const before = validSlots(t, 'area', 'ordo').size;
      t.ordo.reserved = [...t.ordo.reserved, blk.id].sort((a, b) => a - b);
      invalidate(t);
      if (validSlots(t, 'area', 'ordo').size > G.KEEP_PLOTS) expect(gardenSlot(t, view(t)), `${before} free plots`).not.toBeNull();
    }
    expect(validSlots(t, 'area', 'ordo').size).toBeLessThanOrEqual(G.KEEP_PLOTS);
    expect(gardenSlot(t, view(t))).toBeNull();
  });

  it('a flooded town: the Ordo clears its own garden for a home only where no free plot is left, never the player\'s', () => {
    const s = fresh(42);
    const mine = flood(s, 1);
    const theirs = mine.splice(0, 2);                   // two of the gardens are the player's
    for (const b of theirs) b.owner = 'player';
    invalidate(s);
    const beds = (st: GameState): Wish | undefined => walkWishes(st, view(st), true).list.map((e) => e.wish).find((w) => w.reason.code === 'beds');
    // one free plot left: the home goes there and nothing is cleared
    const free = [...validSlots(s, 'area', 'ordo').keys()];
    expect(free.length).toBe(1);
    expect(beds(s)?.tile).toBe(free[0]);
    expect(beds(s)?.clear).toBeUndefined();
    // none left: the home takes the place of one of the Ordo's own gardens, and says so
    expect(placeBuilding(s, 'hortus', free[0], { owner: 'player', ignoreCost: true, noStake: true }).ok).toBe(true);
    const w = beds(s);
    expect(w?.clear).toHaveLength(1);
    const g = s.buildings.find((b) => b.id === w!.clear![0]) as Building;
    expect(g.owner).toBe('ordo');
    expect(idx(g.x, g.y)).toBe(w!.tile);
    expect(reasonText(w!.reason)).toContain('It takes the place of one of our gardens.');
    expect(reasonShort(w!.reason)).toContain('(in place of a garden)');
    // on the real economy the Ordo raises it there: the garden is cleared, the player's gardens all stand
    const ordoGardens = mine.length;
    run(s, 60);
    const homes = s.buildings.filter((b) => b.type === 'area' && b.owner === 'ordo' && b.reason?.params.gardens === 1);
    expect(homes.length).toBeGreaterThan(0);
    expect(s.buildings.filter((b) => b.type === 'hortus' && b.owner === 'ordo').length).toBe(ordoGardens - homes.length);
    for (const b of theirs) expect(s.buildings.some((x) => x.id === b.id)).toBe(true);
    expect(s.log.some((l) => l.text.includes('It takes the place of one of our gardens.'))).toBe(true);
  });

  it('a block of its own gardens is cleared for the work the next petition names when no free block is left', () => {
    const s = fresh(42);
    s.rank = 2;
    invalidate(s);
    const mine = new Set(flood(s).map((b) => b.id));
    for (const r of Object.keys(s.res) as (keyof typeof s.res)[]) s.res[r] = 0;
    const w = walkWishes(s, view(s), true).list.map((e) => e.wish).find((x) => x.type === 'templum');
    expect(w?.reason.code).toBe('rank');
    expect(w?.clear?.length).toBeGreaterThan(0);
    // the block holds the Ordo's gardens and nothing else, every one of them cleared
    const W = getMap(s.seed).W, d = view(s).d, onBlock = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const id = d.buildingAt[w!.tile + y * W + x]; if (id) onBlock.add(id); }
    expect([...onBlock].sort((a, b) => a - b)).toEqual(w!.clear);
    for (const id of w!.clear!) expect(mine.has(id)).toBe(true);
  });

  it('counts only the free plots a home may take: those on the blocks kept for a temple or the theatre are no home\'s', () => {
    const s = stoneStart();
    s.rank = 3;                                         // the theatre is ahead, and the stone houses wait for a temple
    invalidate(s);
    expect(keptBlocks(s).length).toBeGreaterThanOrEqual(2);
    const onKept = (tile: number): boolean => keptBlocks(s).some((k) => {
      const x = tile % getMap(s.seed).W, y = Math.floor(tile / getMap(s.seed).W);
      return x < k.rect.x + k.rect.w && k.rect.x < x + B.map.PLOT && y < k.rect.y + k.rect.h && k.rect.y < y + B.map.PLOT;
    });
    const homes = (): number => [...validSlots(s, 'area', 'ordo').keys()].filter((tile) => !onKept(tile)).length;
    const sv = getMap(s.seed).survey;
    const block = sv.blockAt[gardenSlot(s, view(s))!.tile];
    // the player reserves block after block until only KEEP_PLOTS plots a home may take are left
    for (const blk of sv.blocks) {
      if (homes() <= G.KEEP_PLOTS) break;
      if (blk.id === block || blk.reserved !== null || keptBlocks(s).some((k) => k.rect.x === blk.x && k.rect.y === blk.y)) continue;
      if (![0, 1, 2, 3].some((p) => view(s).d.plotOwner[blk.id * 4 + p] === 0)) continue;
      s.ordo.reserved = [...s.ordo.reserved, blk.id].sort((a, b) => a - b);
      invalidate(s);
    }
    expect(homes()).toBeLessThanOrEqual(G.KEEP_PLOTS);
    expect(validSlots(s, 'area', 'ordo').size).toBeGreaterThan(G.KEEP_PLOTS);   // the kept blocks' plots are free still
    expect(gardenSlot(s, view(s))).toBeNull();
  });

  it('make room leaves a garden that holds a home at its tier: a domus kept at 10 by it', () => {
    const s = fresh(42);
    s.decisions.focus = 'copia';                        // more beds kept spare: a home is still wanted beside the domus's
    flood(s);
    const beds = (): Wish | undefined => walkWishes(s, view(s), true).list.map((e) => e.wish).find((w) => w.reason.code === 'beds');
    const g = s.buildings.find((b) => b.id === beds()?.clear?.[0]) as Building;
    expect(g?.owner).toBe('ordo');
    // the home that garden lifts the most is a domus now, at 10 with the garden and below it without
    const lost = (garden: Building, h: Building): number => {
      const lift = new Map(previewDesir(s, 'hortus', garden.x, garden.y).map((p) => [p.tile, p.v]));
      const fp = footprintOf(h, s);
      return fp.reduce((a, i) => a + (lift.get(i) ?? 0), 0) / fp.length;
    };
    const home = view(s).d.houses.map((id) => s.buildings.find((b) => b.id === id) as Building).sort((a, b) => lost(g, b) - lost(g, a))[0];
    home.house!.tier = 'domus';
    invalidate(s);
    expect(houseDesir(s, home.id)).toBeGreaterThanOrEqual(B.housing.DESIR_DOMUS);
    expect(houseDesir(s, home.id) - lost(g, home)).toBeLessThan(B.housing.DESIR_DOMUS);
    // the home goes where another of the Ordo's gardens is cleared, one that does not reach the domus (within 0.5 of 10,
    // it can spare none)
    const w = beds();
    expect(w?.clear).toHaveLength(1);
    expect(w!.clear).not.toContain(g.id);
    expect(houseDesir(s, home.id)).toBeLessThan(B.housing.DESIR_DOMUS + G.MARGIN);
    expect(lost(s.buildings.find((b) => b.id === w!.clear![0]) as Building, home)).toBe(0);
  });

  it('a castellum in place of a garden is routed round the gardens that stay; one it cannot stake leaves them standing', () => {
    const s = fresh(42);
    s.rank = 3;
    invalidate(s);
    for (let k = 0; k < 2; k++) built(s, 'apotheca');   // room for the aqueduct's stone and concrete
    const mine = flood(s);
    const without = (ids: ReadonlySet<number>): GameState => ({ ...s, buildings: s.buildings.filter((b) => !ids.has(b.id)) });
    const fits = (st: GameState, tile: number) => canPlace(st, 'castellum', tile, { owner: 'ordo', ignoreCost: true });
    // a garden whose plot takes the castellum with every garden of the Ordo's gone, but not with only it gone: the
    // aqueduct to it runs over another garden
    const at = view(s).d.buildingAt, all = new Set(mine.map((b) => b.id));
    let g: Building | undefined;
    let over = new Set<number>();
    for (const b of mine) {
      const c = fits(without(all), idx(b.x, b.y));
      if (!c.ok || fits(without(new Set([b.id])), idx(b.x, b.y)).ok) continue;
      g = b;
      over = new Set((c.route ?? []).map((i) => at[i]).filter((id) => id !== 0 && id !== b.id));
      break;
    }
    expect(g).toBeDefined();
    expect(over.size).toBeGreaterThan(0);
    // the Ordo's gardens are that one and those its aqueduct would cross (the rest the player's); it holds only the plan
    for (const b of mine) if (b !== g && !over.has(b.id)) b.owner = 'player';
    s.ordo.works = { water: false, food: false, homes: false, services: false, materials: false, plan: true };
    for (const r of Object.keys(s.res) as (keyof typeof s.res)[]) s.res[r] = 5000;
    invalidate(s);
    const walk = walkWishes(s, view(s));
    const w = walk.take;
    expect(w?.type).toBe('castellum');
    expect(w?.clear?.length).toBeGreaterThan(0);
    // what it clears is all it needs: the castellum fits there with only those gardens gone, at the cost the wish names
    const gone = new Set(w!.clear);
    const chk = fits(without(gone), w!.tile);
    expect(chk.ok).toBe(true);
    expect(chk.ok && chk.cost).toEqual(w!.cost);
    // the stone is spent before the council stakes it (the day's walk stands): nothing is staked, every garden stands
    const ids = s.buildings.map((b) => b.id);
    s.res.stone = 0;
    ordoBuild(s, ctx(), view(s));
    expect(s.buildings.map((b) => b.id)).toEqual(ids);
    // with the stone back it is staked there, those gardens cleared and no other
    s.res.stone = 5000;
    ordoBuild(s, ctx(), view(s));
    const c = s.buildings.find((b) => b.type === 'castellum');
    expect(c && idx(c.x, c.y)).toBe(w!.tile);
    for (const b of mine) expect(s.buildings.some((x) => x.id === b.id), `garden ${b.id}`).toBe(!gone.has(b.id));
  });

  it('a work the Ordo raises where it clears its gardens is not offered to raise by hand (Apply once, the Fabrum)', () => {
    const s = fresh(42);
    const mine = flood(s);
    for (const r of Object.keys(s.res) as (keyof typeof s.res)[]) s.res[r] = 5000;
    // the house plots and the plan are the player's: the Ordo would raise a home where it clears a garden, then the plan's
    s.ordo.works.homes = false;
    s.ordo.works.plan = false;
    const home = walkWishes(s, view(s), true).list.map((e) => e.wish).find((w) => w.reason.code === 'beds');
    expect(home?.clear).toHaveLength(1);
    // no placement by hand can take that plot: Apply once raises the next work the Ordo would, and clears nothing
    const would = wouldRaise(s, view(s));
    expect(would).not.toBeNull();
    expect(would!.reason.params.gardens).toBeUndefined();
    const r = applyOnce(s, 'build');
    expect(r.ok).toBe(true);
    const placed = s.buildings[s.buildings.length - 1];
    expect(placed.type).toBe(would!.type);
    expect(placed.owner).toBe('player');
    for (const b of mine) expect(s.buildings.some((x) => x.id === b.id)).toBe(true);
    // the Ordo holds the house plots again, and a growth work raised today paces the home: it is the only work on the
    // pace (the plan is still the player's), and the Praefectus Fabrum does not offer to place it himself; its Agenda
    // row says when the Ordo raises it, and does not ask for a hand
    s.ordo.works.homes = true;
    Object.assign(mine[mine.length - 1], { reason: { code: 'beauty', params: {} }, placed: s.day });
    invalidate(s);
    const fabrum = FABRUM_RULES.find((x) => x.id === 'fabrum.agenda')!;
    const wait = growthWait(s);
    expect(wait).toBe(B.ordo.GROWTH_EVERY);
    const paced = newWishes(s, view(s), 3).filter((w) => w.state === 'paced');
    expect(paced.map((w) => [w.type, w.reason.params.gardens, w.eta])).toEqual([['area', 1, wait]]);
    expect(fabrum.evaluate(s, view(s))).toBeNull();
    expect(wishState(game(s), paced[0])).toBe(`the Ordo raises it in ${wait} d`);
  });

  it('the Fabrum names the next work a hand can raise, a pace later for each of the Ordo\'s own ahead of it', () => {
    const s = fresh(42);
    const mine = flood(s);
    for (const r of Object.keys(s.res) as (keyof typeof s.res)[]) s.res[r] = 5000;
    Object.assign(mine[mine.length - 1], { reason: { code: 'beauty', params: {} }, placed: s.day });
    invalidate(s);
    // every duty held: the home that clears a garden comes first on the pace, then a work of the plan
    const wait = growthWait(s);
    const [home, work] = newWishes(s, view(s), 3).filter((w) => w.state === 'paced');
    expect(home.reason.params.gardens).toBe(1);
    expect(home.eta).toBe(wait);
    // the Ordo raises the home when the pace lifts, and that work a pace after it: the card says so, not the home's day
    expect(work.eta).toBe(wait + B.ordo.GROWTH_EVERY);
    expect(ordoAlone(work)).toBe(false);
    const agenda = FABRUM_RULES.find((x) => x.id === 'fabrum.agenda')!.evaluate(s, view(s));
    expect(agenda?.params).toMatchObject({ type: work.type, tile: work.tile, wait: wait + B.ordo.GROWTH_EVERY });
    expect(wishState(game(s), work)).toBe(`the Ordo raises it in ${wait + B.ordo.GROWTH_EVERY} d: raise it yourself for sooner`);
  });

  it('under Urbs a colony keeps its plots: few gardens, each beside the homes (follower, seed 42, 4,000 days)', () => {
    let beauty = 0;
    const r = play(42, 'follower', {
      days: 4000,
      onDay: (s) => {
        s.decisions.focus = 'urbs';
        const v = view(s);
        for (const b of s.buildings) {
          if (b.type !== 'hortus' || b.owner !== 'ordo' || b.placed !== s.day) continue;
          if (b.reason?.code === 'beauty') beauty++;
          const tile = idx(b.x, b.y);
          expect(halfMate(s, tile), `garden ${b.id} beside a work`).not.toBe(0);
          expect(gardensOn(s, tile), `garden ${b.id} alone on its block`).toBeLessThanOrEqual(G.PER_BLOCK);
          expect(validSlots(s, 'area', 'ordo').size).toBeGreaterThanOrEqual(G.KEEP_PLOTS);
          expect((v.d.all.hortus ?? 0) - 1).toBeLessThan(v.d.houses.length * G.PER_HOME);
        }
      },
    });
    expect(beauty).toBeGreaterThan(0);                      // the stone houses had their gardens
    const s = r.s;
    expect(s.buildings.filter((b) => b.type === 'hortus' && b.owner === 'ordo').length).toBeLessThanOrEqual(view(s).d.houses.length * G.PER_HOME + 1);
    expect(validSlots(s, 'area', 'ordo').size).toBeGreaterThan(G.KEEP_PLOTS);
  }, 120_000);
});

describe('the builders line in monument mode (playtest #7)', () => {
  it('counts the town wall\'s crew apart and says when the Capitolium has all the builders it can take', () => {
    const s = fresh(42);
    startCapitolium(s);
    s.urbs.moenia = { tiles: [], gates: [], surveyed: s.day, work: 30_000, progress: 0, matUsed: {}, done: null };
    s.res.stone = 1e5;
    s.res.denarii = 1e5;
    invalidate(s);
    const v0 = view(s);
    const v = { d: v0.d, f: v0.f, cov: v0.cov, c: { ...v0.c, workforce: 400 } } as SimView;   // hands enough for both crews
    const line = planLabour(s, v).lines.find((l) => l.cat === 'builders')!;
    expect(line.target).toBe(B.construction.CAP_CREW + B.urbs.MOENIA.CREW);
    expect(line.reason).toMatchObject({ code: 'monument', params: { n: 72, crew: 64, max: 64, full: 1, walls: 8 } });
    expect(reasonText(line.reason)).toBe('72 builders: 64 of 64 on the Capitolium (the most that can work on it) and 8 on the town wall.');
    expect(reasonShort(line.reason)).toBe('64 of 64 builders on the Capitolium (its full crew)');
    expect(reasonText({ code: 'monument', params: { n: 30, crew: 22, max: 64, full: 0 } })).toBe('30 builders, 22 of them on the Capitolium.');
  });
});

describe('reasons', () => {
  const CODES: ReasonCode[] = [
    'request', 'pin', 'survivalFood', 'survivalWater', 'aestasWater', 'hiemsStore', 'storageFull', 'beds', 'waterAccess', 'evolve',
    'rank', 'materials', 'luxury', 'focusPlan', 'beauty', 'capitolium', 'needWater', 'needFood', 'reserveTopup', 'requiredService',
    'builderShare', 'monument', 'pendingInput', 'winterStock', 'tools', 'luxuryStaff', 'serviceFull', 'focusSplit', 'leftover',
    'priority', 'deficitImport', 'luxuryImport', 'wishImport', 'surplusExport', 'merchantDeal', 'emergencyRations', 'emergencyWater',
    'emergencyHands', 'emergencyImport', 'relief', 'saving',
  ];
  const P = {
    type: 'horreum', res: 'stone', hub: 'durii', cat: 'food', focus: 'concordia', rank: 1, want: 'religion', why: 'low', level: 'parcae',
    n: 3, qty: 40, days: 12, doh: 9, keep: 45, low: 7, hold: 19, free: 2, pct: 97, eta: 9, for: 'petition', goal: 24.5, need: 20.35,
    stock: 612, target: 900, crew: 10, kits: 2, demand: 1.2, idle: 3, price: 4, reach: 4,
  };

  it('renders every code as a sentence and a ticker fragment', () => {
    for (const code of CODES) clean({ code, params: P });
    clean({ code: 'priority', params: { cat: 'water', n: 4, manual: 1 } });
    clean({ code: 'emergencyRations', params: { level: 'none', doh: 27 } });
    clean({ code: 'emergencyWater', params: { paused: 0, doh: 16 } });
    clean({ code: 'emergencyHands', params: { paused: 0, doh: 16 } });
  });

  it('speaks in the DESIGN voice', () => {
    expect(reasonShort({ code: 'hiemsStore', params: { type: 'horreum', days: 34, hold: 19, keep: 45, state: 'raising' } }))
      .toBe('Raising: Horreum — Hiems in 34 d, our stores hold 19 d, we keep 45');
    expect(reasonShort({ code: 'beds', params: { type: 'area', free: 2, keep: 8, state: 'next' } })).toBe('Next: House plot (2 free beds; we keep 8)');
    expect(reasonShort({ code: 'saving', params: { qty: 40, res: 'stone', for: 'horreum', eta: 9 } })).toBe('Saving: 40 stone (≈ 9 d)');
    expect(reasonText({ code: 'request', params: { type: 'lararium', n: 6, want: 'religion' } })).toBe('Raising the shrine you asked for: 6 homes lacked a shrine.');
    expect(reasonText({ code: 'needFood', params: { need: 31, goal: 37.2, stock: 612, target: 900 } }))
      .toBe('Hands in the fields for 37 grain a day against a need of 31, and a winter stock (612 of 900).');
    // a wish raised in Aestas itself does not say "Aestas comes in 0 days"
    expect(reasonText({ code: 'aestasWater', params: { type: 'puteus', low: 12, keep: 15 } }))
      .toBe('Aestas is upon us and our water would fall to 12 days; we keep 15, so a well is raised.');
    expect(reasonShort({ code: 'aestasWater', params: { type: 'puteus', days: 0, low: 12, keep: 15 } })).toBe('Well — Aestas: water would fall to 12 d, we keep 15');
    expect(reasonShort({ code: 'aestasWater', params: { type: 'cisterna', days: 59, low: 9, keep: 15 } })).toBe('Cistern — Aestas in 59 d, water would fall to 9 d, we keep 15');
  });
});

describe.runIf(INTEGRATED)('the Ordo on the real economy and map', () => {
  it('stakes a cistern for Aestas on the second day and finishes a horreum before Kal. Dec.', () => {
    const s = fresh(42);
    run(s, 2);
    expect(s.buildings.some((b) => b.owner === 'ordo' && b.type === 'cisterna' && b.reason?.code === 'aestasWater')).toBe(true);
    run(s, 242);
    expect(s.buildings.some((b) => b.type === 'horreum' && b.status === 'done')).toBe(true);
  });

  it('keeps an undecided colony fed: ≤ 5% hunger and thirst deaths a year, no 120-day building stall, no NaN', () => {
    const s = fresh(1);
    let deaths = 0, popSum = 0, worked = 0, idleSince = 0;
    run(s, 3 * 365, (st, _c, i) => {
      popSum += st.people.length;
      const work = st.stats.built + st.buildings.reduce((a, b) => a + (b.status === 'done' ? 0 : b.progress), 0);
      if (work > worked || st.buildings.every((b) => b.status === 'done')) idleSince = i;
      worked = work;
      expect(i - idleSince).toBeLessThan(120);
      if ((i + 1) % 365 === 0) {
        const d = st.stats.deathsBy.hunger + st.stats.deathsBy.thirst - deaths;
        expect(d).toBeLessThanOrEqual(0.05 * (popSum / 365));
        deaths += d;
        popSum = 0;
      }
    });
    expect(noNaN(s)).toEqual([]);
  });
});

// tests/ordo.test.ts — the Ordo: labour steps, wish list, stakes, saving, emergency ladder, toggles, trade, reasons. Owner: WP-C.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Building, BuildingId, EssentialForecast, GameState, Reason, ReasonCode, SimView } from '../src/game/types';
import { deserialize, serialize } from '../src/game/save';
import { newCtx, tick, view } from '../src/game/sim';
import { getMap, idx } from '../src/game/map';
import { isActiveBlock } from '../src/game/survey';
import { blockOfTile, footprintOf } from '../src/game/derived';
import { census } from '../src/game/census';
import { invalidate } from '../src/game/memo';
import { placeBuilding } from '../src/game/place';
import { createContract, emergencyImport } from '../src/game/trade';
import { triggerRelief } from '../src/game/events';
import { councilReport, runOrdo } from '../src/game/ordo/index';
import { manualPlan, manualReach, planLabour } from '../src/game/ordo/labour';
import { currentReason, maxSites, ordoSites, ordoSlot, processRequests, walkWishes, wishList } from '../src/game/ordo/build';
import { aestasWork } from '../src/game/ordo/water';
import { maxPotential } from '../src/game/economy';
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
import { INTEGRATED, ctx, fresh, noNaN, run, setJobs } from './util';

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

  it('pauses the water-drawing works below 8 days and resumes above 15', () => {
    const s = fresh(42);
    s.rank = 2;
    const works = built(s, 'caementarium');
    emergencyDay(s, ctx(), withForecast(s, {}, { runout: s.day + 7 }));
    expect(s.ordo.emergency.waterPause).toBe(true);
    expect(planLabour(s, view(s)).perBuilding[works.id] ?? 0).toBe(0);
    emergencyDay(s, ctx(), withForecast(s, {}, { runout: null, doh: 14 }));
    expect(s.ordo.emergency.waterPause).toBe(true);
    emergencyDay(s, ctx(), withForecast(s, {}, { runout: null, doh: 16 }));
    expect(s.ordo.emergency.waterPause).toBe(false);
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

// tests/placement.test.ts — the placement pipeline (ARCHITECTURE §8.2, §14.2 WP-A): every canPlace code in order with its
// exact reason; plans, stakes and sites per PlaceOpts; felling, auto-roads, block streets, the aqueduct; road, paving,
// reserve and demolish tools; validSlots agreement and speed; site multipliers; bestSlot determinism; where a placement
// the player starts puts its ghost (resolvePlaceAt).
import { describe, expect, it } from 'vitest';
import { BUILDINGS, F, T } from '../src/game/types';
import type { Building, BuildingId, GameState, Owner, PlaceFail, PlaceOpts, RankIndex } from '../src/game/types';
import { H, W, getMap, idx, tx, ty, woodAt } from '../src/game/map';
import { WALL_RING, blockStreets, isActiveBlock, isFutureBlock, plotOrigin } from '../src/game/survey';
import { classAt, derived, sizeOf } from '../src/game/derived';
import { invalidate, structEpoch } from '../src/game/memo';
import {
  buildRoad, canPlace, demolish, fellingSpill, pave, paveVia, placeBuilding, placementCost, roadPathFor, roadPreview,
  routeAqueduct, streetsForBlock, toggleReserveBlock, validSlots,
} from '../src/game/place';
import { bestSlot, resolvePlaceAt, siteMultAt, siteScore } from '../src/game/site';
import { fx } from '../src/game/fx';
import { B } from '../src/game/balance';
import { BUILDING_DEFS } from '../src/game/data/buildings';
import { askOrdo } from '../src/game/ordo/actions';
import { charterDirt, charterPaving } from '../src/game/urbs';
import { reserved } from '../src/game/ordo/saving';
import { rankUp, settingValue } from '../src/game/decisions';
import { view } from '../src/game/sim';
import { fresh, run } from './util';

const N = W * H;

function atRank(s: GameState, rank: RankIndex): GameState {
  s.rank = rank;
  invalidate(s);
  return s;
}

/** The first tile where canPlace fails with `code` (and `reason`, if given); −1 if none. */
function findFail(s: GameState, type: BuildingId, code: PlaceFail, reason?: string, opts?: PlaceOpts): number {
  for (let i = 0; i < N; i++) {
    const c = canPlace(s, type, i, { ignoreCost: true, ...opts });
    if (!c.ok && c.code === code && (reason === undefined || c.reason === reason)) return i;
  }
  return -1;
}

function expectFail(s: GameState, type: BuildingId, tile: number, code: PlaceFail, reason: string, opts?: PlaceOpts): void {
  const c = canPlace(s, type, tile, { ignoreCost: true, ...opts });
  expect(c.ok ? 'ok' : `${c.code}: ${c.reason}`).toBe(`${code}: ${reason}`);
}

/** Inserts a finished building directly (fixtures). */
function insert(s: GameState, type: BuildingId, x: number, y: number, extra?: Partial<Building>): Building {
  const id = s.nextId++;
  const b: Building = { id, type, x, y, owner: 'player', status: 'done', placed: s.day, progress: 1, work: 1, paid: true, order: id, open: true, prio: 1, ...extra };
  s.buildings.push(b);
  invalidate(s);
  return b;
}

/** BFS over built roads from `from`; true if it reaches any of `to`. */
function roadConnects(s: GameState, from: number[], to: number[]): boolean {
  const road = new Set(s.roads);
  const goal = new Set(to);
  const seen = new Set(from.filter((i) => road.has(i)));
  const q = [...seen];
  for (let k = 0; k < q.length; k++) {
    if (goal.has(q[k])) return true;
    const i = q[k];
    for (const j of [i - W, i + W, tx(i) > 0 ? i - 1 : -1, tx(i) < W - 1 ? i + 1 : -1]) if (j >= 0 && road.has(j) && !seen.has(j)) { seen.add(j); q.push(j); }
  }
  return false;
}

function sides(x: number, y: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let px = x; px < x + w; px++) out.push(idx(px, y - 1), idx(px, y + h));
  for (let py = y; py < y + h; py++) out.push(idx(x - 1, py), idx(x + w, py));
  return out.filter((i) => i >= 0 && i < N);
}

describe('canPlace: the twelve checks with their exact codes and reasons', () => {
  it('1 · offMap', () => {
    const s = fresh(42);
    expectFail(s, 'ager', -1, 'offMap', 'Beyond the surveyed land.');
    expectFail(s, 'ager', N, 'offMap', 'Beyond the surveyed land.');
    expectFail(s, 'ager', idx(W - 2, 10), 'offMap', 'Beyond the surveyed land.');
    expectFail(s, 'figlina', idx(W - 1, 5), 'offMap', 'Beyond the surveyed land.');      // off the map comes before the rank
  });

  it('2 · rankLocked', () => {
    const s = fresh(42);
    const sv = getMap(42).survey;
    const plot = plotOrigin(sv.blocks.find((b) => isActiveBlock(sv, b, 0))!, 0);
    expectFail(s, 'figlina', idx(10, 10), 'rankLocked', 'Rome grants this to a Vicus.');
    expectFail(s, 'templum', idx(plot.x, plot.y), 'rankLocked', 'Rome grants this to an Oppidum.');
    expectFail(s, 'thermae', idx(plot.x, plot.y), 'rankLocked', 'Rome grants this to a Municipium.');
  });

  it('3 · maxCount', () => {
    const s = fresh(42);
    expectFail(s, 'principia', idx(5, 5), 'maxCount', 'Only 1 may be raised.');
    atRank(s, 3);
    const c = bestSlot(s, 'castellum', { owner: 'player' })!;
    expect(placeBuilding(s, 'castellum', c.tile, { ignoreCost: true }).ok).toBe(true);
    expectFail(s, 'castellum', c.tile, 'maxCount', 'Only 1 may be raised.');
  });

  it('4 · reserved for the groma (principia, Capitolium)', () => {
    const s = atRank(fresh(42), 4);
    const cap = getMap(42).survey.capitolium;
    expectFail(s, 'capitolium', idx(cap.x, cap.y), 'reserved', 'Reserved by the groma.');
  });

  it('5 · urban slot: castrum, notInPomerium, terrain, notOnSlot', () => {
    const s = fresh(42);
    const sv = getMap(42).survey;
    const wallTile = idx(sv.ix - 1, sv.iy + 2);
    expect(sv.wall[wallTile]).toBe(1);
    expectFail(s, 'area', wallTile, 'castrum', 'The walls and ditch stay clear.');
    expectFail(s, 'area', idx(sv.ix + 2, sv.iy - 3), 'castrum', 'The walls and ditch stay clear.');            // the fossa
    const ring1 = sv.blocks.find((b) => b.ring === 1 && !b.masked)!;
    const ring2 = sv.blocks.find((b) => b.ring === 2 && !b.masked)!;
    expectFail(s, 'area', idx(ring1.x, ring1.y), 'notInPomerium', 'Outside the pomerium: become a Vicus to survey these blocks.');
    expectFail(s, 'taberna', idx(ring2.x + 3, ring2.y + 3), 'rankLocked', 'Rome grants this to a Vicus.');
    expectFail(atRank(s, 1), 'taberna', idx(ring2.x + 3, ring2.y + 3), 'notInPomerium', 'Outside the pomerium: become an Oppidum to survey these blocks.');
    expectFail(s, 'area', idx(sv.ix + 5, sv.iy + 2), 'notOnSlot', 'Choose a surveyed plot.');                   // a street
    // a masked block of an active ring
    let masked = -1;
    for (let seed = 42; seed < 60 && masked < 0; seed++) {
      const t = atRank(fresh(seed), 1);
      const b = getMap(seed).survey.blocks.find((k) => k.ring === 1 && k.masked && k.x >= 0 && k.y >= 0 && k.x + 3 < W && k.y + 3 < H);
      if (b) { masked = idx(b.x, b.y); expectFail(t, 'area', masked, 'terrain', 'The surveyors left this block to the fields.'); }
    }
    expect(masked).toBeGreaterThanOrEqual(0);
  });

  it('6 · urban: reserved blocks and taken plots', () => {
    const s = fresh(42);
    const sv = getMap(42).survey;
    expectFail(s, 'area', idx(sv.forum.x + 1, sv.forum.y + 1), 'reserved', 'Reserved by the groma.');
    expectFail(s, 'area', idx(sv.capitolium.x, sv.capitolium.y), 'reserved', 'Reserved by the groma.');
    const house = s.buildings.find((b) => b.type === 'area')!;
    expectFail(s, 'area', idx(house.x + 1, house.y + 1), 'occupied', 'That plot is taken.');
    // a block the player keeps free is closed to the Ordo only
    const blk = sv.blocks.find((b) => isActiveBlock(sv, b, 0) && b.district === 'retentura' && !s.buildings.some((x) => sv.blockAt[idx(x.x, x.y)] === b.id))!;
    expect(toggleReserveBlock(s, blk.id).ok).toBe(true);
    expectFail(s, 'area', idx(blk.x, blk.y), 'reserved', 'Reserved by the groma.', { owner: 'ordo' });
    expect(canPlace(s, 'area', idx(blk.x, blk.y), { owner: 'player' }).ok).toBe(true);
  });

  it('7 · rural land: territory, castrum, street, road, pomerium, aqueduct', () => {
    const s = fresh(42);
    const sv = getMap(42).survey;
    expectFail(s, 'ager', findFail(s, 'ager', 'outsideTerritory'), 'outsideTerritory', 'Too far for our people to walk each day.');
    expectFail(s, 'puteus', idx(sv.forum.x + 2, sv.forum.y + 2), 'castrum', 'Inside the castrum only surveyed plots.');
    expect(findFail(s, 'ager', 'street', 'The survey keeps this line for a street.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'ager', 'road', 'A road runs here.')).toBeGreaterThanOrEqual(0);
    atRank(s, 1);
    expect(findFail(s, 'ager', 'notInPomerium', 'Inside the pomerium only urban works.')).toBeGreaterThanOrEqual(0);
    // an aqueduct route under construction
    const site = [...validSlots(s, 'ager', 'player').keys()][0];
    insert(s, 'castellum', 0, 0, { status: 'building', route: [site + W + 1] });
    expectFail(s, 'ager', site, 'reserved', 'Reserved for the aqueduct.');
  });

  it('8 · the Ordo keeps the future rings clear; the player is warned', () => {
    const s = fresh(42);
    const tile = findFail(s, 'ager', 'futureRing', 'Surveyed for the canabae.', { owner: 'ordo' });
    expect(tile).toBeGreaterThanOrEqual(0);
    const p = canPlace(s, 'ager', tile, { owner: 'player', ignoreCost: true });
    expect(p.ok && p.warn).toBe('This land is surveyed for the canabae; the plots stay blocked until you move it.');
  });

  it('9 · terrain: river, crag, sacred ground, iron vein, rock', () => {
    const s = atRank(fresh(42), 4);
    expect(findFail(s, 'ager', 'water', 'The river.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'ager', 'crag', 'Too steep to build.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'ager', 'sacred', 'Sacred ground: the gods would not forgive it.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'ager', 'terrain', 'An iron vein: keep it for a mine.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'ager', 'terrain', 'Too rocky to build.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'lapicidina', 'terrain', 'Too rocky to build.')).toBe(-1);
    const map = getMap(42);
    // the springs are sacred too
    const f = map.fontes[0];
    expectFail(s, 'puteus', f, 'sacred', 'Sacred ground: the gods would not forgive it.');
    // river before crag before sacred, whichever tile comes first in the footprint
    for (let i = 0; i < N; i++) {
      const c = canPlace(s, 'lapicidina', i, { ignoreCost: true });
      if (c.ok || !['water', 'crag', 'sacred'].includes(c.code)) continue;
      const fp: number[] = [];
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) fp.push(idx(tx(i) + dx, ty(i) + dy));
      if (fp.some((j) => map.terrain[j] === T.river)) expect(c.code).toBe('water');
      else if (fp.some((j) => map.terrain[j] === T.crag)) expect(c.code).toBe('crag');
    }
  });

  it('10 · occupied', () => {
    const s = fresh(42);
    const field = s.buildings.find((b) => b.type === 'ager')!;
    expectFail(s, 'ager', idx(field.x, field.y), 'occupied', 'Something already stands here.');
  });

  it('11 · site rules: terrain, needsVia, noCastellum, noFons', () => {
    const s = fresh(42);
    expect(findFail(s, 'ager', 'terrain', 'Fields need seven fertile tiles.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'venatio', 'terrain', 'Needs ten wooded tiles nearby.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'lignarius', 'terrain', 'No standing timber within 4 tiles.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'lapicidina', 'terrain', 'Needs hills or rock.')).toBeGreaterThanOrEqual(0);
    atRank(s, 1);
    expect(findFail(s, 'figlina', 'terrain', 'Must touch a clay bank.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'olivetum', 'terrain', 'Olives need dry slopes.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'mansio', 'needsVia', 'Must touch the via.')).toBeGreaterThanOrEqual(0);
    atRank(s, 2);
    expect(findFail(s, 'fodina', 'terrain', 'Must stand on an iron vein.')).toBeGreaterThanOrEqual(0);
    atRank(s, 3);
    expect(findFail(s, 'lacus', 'noCastellum', 'No castellum within 18 paces, nor the aqueduct within 8 in the town.')).toBeGreaterThanOrEqual(0);
    expect(findFail(s, 'thermae', 'noCastellum', 'No castellum within 18 paces.')).toBeGreaterThanOrEqual(0);
    expect(validSlots(s, 'castellum', 'player').size).toBeGreaterThan(0);
    for (const f of getMap(42).fontes) insert(s, 'hortus', tx(f), ty(f));       // springs built over: nothing to draw from
    expect(validSlots(s, 'castellum', 'player').size).toBe(0);
    expect(findFail(s, 'castellum', 'noFons', 'No spring can be reached.')).toBeGreaterThanOrEqual(0);
  });

  it('12 · noRoad', () => {
    const s = atRank(fresh(42), 4);
    const tile = findFail(s, 'ager', 'noRoad', 'No road can reach it.');
    expect(tile).toBeGreaterThanOrEqual(0);
    expect(roadPathFor(s, [tile])).toBeNull();
  });

  it('prices a success: multiplier, notes, felling, cost, work, unaffordable warning', () => {
    const s = fresh(42);
    const lumber = bestSlot(s, 'lignarius')!;
    const c = canPlace(s, 'lignarius', lumber.tile, { owner: 'player' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.cost).toEqual(BUILDING_DEFS.lignarius.cost);
    expect(c.mult).toBeCloseTo(siteMultAt(s, 'lignarius', c.x, c.y).mult, 9);
    let under = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) under += getMap(42).woodMax[idx(c.x + dx, c.y + dy)];
    expect(c.work).toBeCloseTo(BUILDING_DEFS.lignarius.work + under * B.economy.WOOD.FELL_WORK, 9);
    expect(c.fell).toBeGreaterThanOrEqual(under);
    s.res.denarii = 7;
    const poor = canPlace(s, 'lignarius', lumber.tile, { owner: 'player' });
    expect(poor.ok && poor.warn).toMatch(/^Need 23 more coin/);
  });
});

describe('placeBuilding: plans, stakes and sites per PlaceOpts', () => {
  const tileFor = (s: GameState, type: BuildingId, owner: Owner = 'player'): number => bestSlot(s, type, { owner })!.tile;

  it('player: affordable → building site, paid; unaffordable → plan, unpaid', () => {
    const s = fresh(42);
    const before = { ...s.res };
    const t = tileFor(s, 'lararium');
    const r = placeBuilding(s, 'lararium', t);
    expect(r.ok).toBe(true);
    const b = s.buildings[s.buildings.length - 1];
    expect([b.status, b.paid, b.owner, b.order]).toEqual(['building', true, 'player', b.id]);
    expect(s.res.denarii).toBe(before.denarii - 25);
    expect(s.res.stone).toBe(before.stone - 8);
    s.res.stone = 0;
    const epoch = structEpoch(s);
    const r2 = placeBuilding(s, 'cisterna', tileFor(s, 'cisterna'));
    expect(r2.ok).toBe(true);
    const plan = s.buildings[s.buildings.length - 1];
    expect([plan.status, plan.paid]).toEqual(['plan', false]);
    expect(s.res.stone).toBe(0);
    expect(structEpoch(s)).not.toBe(epoch);
    expect(s.log[s.log.length - 1].text).toContain('planned');
  });

  it('Ordo: staked unless noStake; unaffordable fails; logged with its reason', () => {
    const s = fresh(42);
    const r = placeBuilding(s, 'cisterna', tileFor(s, 'cisterna', 'ordo'), { owner: 'ordo', reason: { code: 'aestasWater', params: {} } });
    expect(r.ok).toBe(true);
    const b = s.buildings[s.buildings.length - 1];
    expect([b.status, b.owner, b.reason?.code]).toEqual(['staked', 'ordo', 'aestasWater']);
    const line = s.log[s.log.length - 1];
    expect([line.kind, line.ref, line.tags]).toEqual(['ordo', b.id, undefined]);   // chronicle() tags it only when decided in our name (R18)
    const r2 = placeBuilding(s, 'lararium', tileFor(s, 'lararium', 'ordo'), { owner: 'ordo', noStake: true });
    expect(r2.ok && s.buildings[s.buildings.length - 1].status).toBe('building');
    s.res.denarii = 0;
    const r3 = placeBuilding(s, 'puteus', tileFor(s, 'puteus', 'ordo'), { owner: 'ordo' });
    expect(r3).toEqual({ ok: false, code: 'unaffordable', reason: 'The treasury cannot cover it.' });
  });

  it('moving an Ordo stake refunds it in full and raises a player site', () => {
    const s = fresh(42);
    const a = [...validSlots(s, 'cisterna', 'ordo').keys()].sort((x, y) => x - y);
    placeBuilding(s, 'cisterna', a[0], { owner: 'ordo' });
    const stake = s.buildings[s.buildings.length - 1];
    const res = { ...s.res };
    const target = a.find((t) => canPlace(s, 'cisterna', t).ok && t !== a[0])!;
    const r = placeBuilding(s, 'cisterna', target, { owner: 'player', replaceId: stake.id });
    expect(r.ok).toBe(true);
    expect(s.buildings.some((b) => b.id === stake.id)).toBe(false);
    expect(s.res.denarii).toBe(res.denarii);                      // refunded 50, paid 50
    expect(s.buildings[s.buildings.length - 1].owner).toBe('player');
    const notStake = placeBuilding(s, 'cisterna', a[a.length - 1], { replaceId: s.buildings[0].id });
    expect(notStake.ok).toBe(false);
  });

  it('placing by hand what was asked of the Ordo withdraws the request, so the work is raised once (R14)', () => {
    const s = fresh(42);
    const wells0 = s.buildings.filter((b) => b.type === 'puteus').length;
    s.res.stone = 0;
    expect(askOrdo(s, 'puteus').ok).toBe(true);
    run(s, 4);
    expect(s.ordo.requests.map((r) => r.type)).toEqual(['puteus']);
    expect(placeBuilding(s, 'puteus', tileFor(s, 'puteus')).ok).toBe(true);    // a plan: the stores lack the stone
    expect(s.ordo.requests).toEqual([]);
    expect(s.log[s.log.length - 1].text).toBe('You raise a well yourself; the Ordo lets your request go.');
    s.res.stone = 100;
    run(s, 6);
    const wells = s.buildings.filter((b) => b.type === 'puteus');
    expect(wells.length).toBe(wells0 + 1);
    expect(wells.some((b) => b.reason?.code === 'request')).toBe(false);
  });

  it('ignoreCost places without paying; ids ascend', () => {
    const s = fresh(42);
    const res = { ...s.res };
    const ids = s.buildings.map((b) => b.id);
    expect(placeBuilding(s, 'horreum', tileFor(s, 'horreum'), { ignoreCost: true }).ok).toBe(true);
    expect(s.res).toEqual(res);
    const now = s.buildings.map((b) => b.id);
    expect(now.slice(0, ids.length)).toEqual(ids);
    expect(now[now.length - 1]).toBeGreaterThan(ids[ids.length - 1]);
  });

  it('fells the woods into the stores and lays the auto-road to the network', () => {
    const s = fresh(42);
    const map = getMap(42);
    const t = tileFor(s, 'lignarius');
    const x = tx(t), y = ty(t);
    const road = roadPathFor(s, [t, t + 1, t + W, t + W + 1])!;
    expect(road).not.toBeNull();
    expect(road.length).toBeLessThanOrEqual(B.map.ROAD_MAX);
    let timber = 0;
    for (const i of [t, t + 1, t + W, t + W + 1, ...road]) timber += map.woodMax[i];
    const before = s.res.timber;
    expect(placeBuilding(s, 'lignarius', t, { ignoreCost: true }).ok).toBe(true);
    expect(s.res.timber).toBeCloseTo(before + timber, 6);
    for (const i of [t, t + 1, t + W, t + W + 1]) if (map.woodMax[i] > 0) expect(s.wood[i]).toBe(0);
    for (const i of road) expect(s.roads).toContain(i);
    expect(roadConnects(s, sides(x, y, 2, 2), getMap(42).survey.gates.map((g) => g.tile))).toBe(true);
    expect(s.roads).toEqual([...new Set(s.roads)].sort((a, b) => a - b));
  });

  it("builds a ring block's streets, connected to the castrum, with its first building", () => {
    const s = atRank(fresh(42), 1);
    const sv = getMap(42).survey;
    const blk = sv.blocks.find((b) => b.ring === 1 && isActiveBlock(sv, b, 1) && blockStreets(sv, b).every((i) => !s.roads.includes(i)))!;
    const need = streetsForBlock(s, blk.id);
    expect(need.length).toBeGreaterThanOrEqual(blockStreets(sv, blk).length);
    expect(placeBuilding(s, 'area', idx(blk.x, blk.y), { ignoreCost: true }).ok).toBe(true);
    for (const i of blockStreets(sv, blk)) expect(s.roads).toContain(i);
    expect(streetsForBlock(s, blk.id)).toEqual([]);
    expect(roadConnects(s, blockStreets(sv, blk), sv.gates.map((g) => g.tile))).toBe(true);
  });

  it('routes the aqueduct from a spring to the castellum and prices it by length', () => {
    const s = atRank(fresh(42), 3);
    const best = bestSlot(s, 'castellum', { owner: 'player' })!;
    const route = routeAqueduct(s, best.x, best.y)!;
    expect(route).not.toBeNull();
    expect(getMap(42).fontes).toContain(route.fons);
    expect(route.tiles[0]).toBe(route.fons);
    expect(route.tiles.length).toBeLessThanOrEqual(B.map.AQUEDUCT_MAX);
    for (let k = 1; k < route.tiles.length; k++) {
      const a = route.tiles[k - 1], b = route.tiles[k];
      expect(Math.abs(tx(a) - tx(b)) + Math.abs(ty(a) - ty(b))).toBe(1);
    }
    expect(sides(best.x, best.y, 2, 2)).toContain(route.tiles[route.tiles.length - 1]);
    const c = canPlace(s, 'castellum', best.tile, { ignoreCost: true });
    expect(c.ok && c.route).toEqual(route.tiles);
    const len = route.tiles.length;
    const k = fx(s, 'castellumCost');
    expect(c.ok && c.cost.denarii).toBeCloseTo((150 + 4 * len) * k, 9);
    expect(c.ok && c.work).toBeCloseTo(80 + 6 * len, 9);
    expect(placeBuilding(s, 'castellum', best.tile, { ignoreCost: true }).ok).toBe(true);
    const d = derived(s);
    for (const i of route.tiles) expect(d.reservedTile[i]).toBe(1);
    expect(placementCost(s, 'castellum', len)).toEqual(c.ok ? c.cost : {});
  });
});

describe('tools: demolish, roads, paving, reserve, ceremonies', () => {
  it('demolishes finished works for a quarter of their cost; never the principia; cancels sites', () => {
    const s = fresh(42);
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    const den = s.res.denarii;
    expect(demolish(s, well.id).ok).toBe(true);
    expect(s.res.denarii).toBeCloseTo(den + 30 * B.construction.REFUND_DEMOLISH, 9);
    expect(s.people.some((p) => p.work === well.id)).toBe(false);
    const principia = s.buildings.find((b) => b.type === 'principia')!;
    expect(demolish(s, principia.id).ok).toBe(false);
    expect(demolish(s, 99_999)).toEqual({ ok: false, code: 'notFound', reason: 'Nothing stands there.' });
    placeBuilding(s, 'lararium', bestSlot(s, 'lararium', { owner: 'player' })!.tile);
    const site = s.buildings[s.buildings.length - 1];
    expect(demolish(s, site.id).ok).toBe(true);
    expect(s.buildings.some((b) => b.id === site.id)).toBe(false);
  });

  it('lays roads on rural land only along the survey inside the pomerium', () => {
    const s = fresh(42);
    const map = getMap(42);
    const sv = map.survey;
    const field = s.buildings.find((b) => b.type === 'ager')!;
    const path = roadPathFor(s, [idx(field.x, field.y), idx(field.x + 2, field.y + 2)])!;
    expect(buildRoad(s, path).ok).toBe(true);
    for (const i of path) expect(s.roads).toContain(i);
    const blk = sv.blocks.find((b) => isActiveBlock(sv, b, 0))!;
    expect(buildRoad(s, [idx(blk.x + 1, blk.y + 1)])).toEqual({ ok: false, code: 'invalid', reason: 'The groma forbids it: streets follow the survey.' });
    expect(buildRoad(s, [idx(sv.ix - 1, sv.iy + 2)])).toEqual({ ok: false, code: 'castrum', reason: 'The walls and ditch stay clear.' });
    const river = [...Array(N).keys()].find((i) => map.terrain[i] === T.river && !sv.bridge.includes(i))!;
    expect(buildRoad(s, [river])).toEqual({ ok: false, code: 'water', reason: 'The river.' });
    const lucus = [...Array(N).keys()].find((i) => map.feature[i] === F.lucus)!;
    expect(buildRoad(s, [lucus]).ok).toBe(false);
  });

  it('fells the woods a road crosses into the stores, and says what the stores hold and what would spill (§3.7)', () => {
    const s = fresh(42);
    const d = derived(s);
    // three wooded paces in a row the road tool may lay: in the territory, outside the pomerium, nothing on them
    const free = (i: number): boolean => woodAt(s, i) > 0 && d.territory[i] === 1 && d.pomerium[i] === 0 && d.buildingAt[i] === 0 && d.road[i] === 0;
    const path = [...Array(N).keys()].map((i) => [i, i + 1, i + 2])
      .find((p) => ty(p[0]) === ty(p[2]) && p.every(free) && buildRoad(structuredClone(s), p).ok)!;
    expect(path).toBeDefined();
    const fell = path.reduce((a, i) => a + woodAt(s, i), 0);
    expect(fell).toBeGreaterThan(20);
    expect(roadPreview(s, [...path, path[0]])).toEqual({ paces: 3, fell });
    // room for it all: the drag names the stores' cap, nothing spills
    s.res.timber = 0;
    expect(fellingSpill(s, fell)).toEqual({ cap: 300, spill: 0, most: false, words: 'the stores hold 300' });
    // half of it over the cap is not yet most of it
    s.res.timber = 300 - fell / 2;
    expect(fellingSpill(s, fell)).toMatchObject({ spill: fell / 2, most: false });
    // the stores nearly full: most of it would spill, and the road's log line says so
    s.res.timber = 290;
    const f = fellingSpill(s, fell);
    expect(f).toMatchObject({ cap: 300, most: true });
    expect(f.spill).toBeCloseTo(fell - 10, 9);
    expect(f.words).toBe(`the stores hold 300: ${Math.round(fell - 10)} would spill`);
    expect(buildRoad(s, path).ok).toBe(true);
    expect(s.log.at(-1)?.text).toBe(`A road of 3 paces is laid; ${Math.round(fell)} timber cleared, but the stores hold 300: ${Math.round(fell - 10)} spills.`);
    expect(s.res.timber).toBeCloseTo(290 + fell, 9);
    for (const i of path) expect(woodAt(s, i)).toBe(0);
    expect(roadPreview(s, path)).toEqual({ paces: 0, fell: 0 });
    run(s, 1);
    expect(s.res.timber).toBeLessThanOrEqual(300);                    // the rest spilled at the day's end
  });

  it('paves dirt roads for two stone a pace', () => {
    const s = fresh(42);
    const tiles = s.roads.slice(0, 5);
    const stone = s.res.stone;
    expect(pave(s, tiles).ok).toBe(true);
    expect(s.res.stone).toBe(stone - 5 * B.map.PAVE_STONE);
    for (const i of tiles) expect(s.paved).toContain(i);
    expect(derived(s).road[tiles[0]]).toBe(2);
    expect(pave(s, tiles).ok).toBe(false);
    s.res.stone = 1;
    const r = pave(s, s.roads.slice(10, 12));
    expect(r.ok ? 'ok' : r.code).toBe('unaffordable');
  });

  it('reserves and releases a block; the Ordo leaves it alone', () => {
    const s = fresh(42);
    const sv = getMap(42).survey;
    const blk = sv.blocks.find((b) => isActiveBlock(sv, b, 0) && !s.buildings.some((x) => sv.blockAt[idx(x.x, x.y)] === b.id))!;
    const plots = [0, 1, 2, 3].map((k) => { const o = plotOrigin(blk, k as 0 | 1 | 2 | 3); return idx(o.x, o.y); });
    expect(plots.every((p) => validSlots(s, 'area', 'ordo').has(p))).toBe(true);
    expect(toggleReserveBlock(s, blk.id).ok).toBe(true);
    expect(s.ordo.reserved).toEqual([blk.id]);
    expect(plots.some((p) => validSlots(s, 'area', 'ordo').has(p))).toBe(false);
    expect(plots.every((p) => validSlots(s, 'area', 'player').has(p))).toBe(true);
    expect(toggleReserveBlock(s, blk.id).ok).toBe(true);
    expect(s.ordo.reserved).toEqual([]);
    const forum = sv.blocks.find((b) => b.reserved === 'forum')!;
    expect(toggleReserveBlock(s, forum.id).ok).toBe(false);
  });

  it('paves the charter streets as the town rises (Oppidum, Municipium, Colonia), 2 stone a pace, and the via in ceremony', () => {
    const s = fresh(42);
    const sv = getMap(42).survey;
    const inner = idx(sv.ix + 5, sv.iy + 5);
    // every Kalends until none is left, at most CHARTER.MONTH paces each
    const paveAll = (): number => {
      let n = 0;
      for (let k; (k = charterPaving(s)) > 0;) { expect(k).toBeLessThanOrEqual(B.map.CHARTER.MONTH); n += k; }
      return n;
    };
    s.res.stone = 1e5;
    expect(charterPaving(s)).toBe(0);                                      // a camp: dirt streets
    atRank(s, 2);
    const axes = paveAll();
    expect(axes).toBeGreaterThan(B.map.CHARTER.MONTH);
    expect(s.res.stone).toBe(1e5 - axes * B.map.PAVE_STONE);
    for (const g of sv.gates) expect(s.paved).toContain(g.tile);
    expect(s.paved).toContain(idx(sv.ix + 3, sv.iy + 10));
    expect(s.paved).toContain(idx(sv.ix + 15, sv.iy + 18));
    expect(s.paved).not.toContain(inner);
    // a street of Ring 1 laid at Municipium stays dirt until Colonia; every street of the inner city is paved
    atRank(s, 3);
    const ring1 = s.roads.length;
    const out = Array.from({ length: N }, (_, i) => i).find((i) => sv.street[i] === 1 && sv.streetRing[i] === 1 && derived(s).road[i] === 0
      && derived(s).buildingAt[i] === 0 && buildRoad(s, [i]).ok && s.roads.length > ring1)!;
    expect(out).toBeDefined();
    expect(paveAll()).toBeGreaterThan(0);
    expect(s.paved).toContain(inner);
    for (const i of s.roads) if (sv.street[i] === 1 && sv.streetRing[i] === 0) expect(s.paved).toContain(i);
    expect(s.paved).not.toContain(out);
    expect(charterPaving(s)).toBe(0);                                      // nothing left to pave
    atRank(s, 4);
    expect(paveAll()).toBeGreaterThan(0);
    expect(s.paved).toContain(out);
    for (const i of s.roads) if (sv.street[i] === 1 && [0, 1, WALL_RING].includes(sv.streetRing[i])) expect(s.paved).toContain(i);
    paveVia(s);
    for (const i of sv.via) expect(s.paved).toContain(i);
  });

  it('the charter streets are paved as far as the stone goes, nearest the forum first; the Kalends pave the rest', () => {
    const s = fresh(42);
    const sv = getMap(42).survey;
    const d = (): ReturnType<typeof derived> => derived(s);
    s.res.stone = 0;
    rankUp(s, 2);
    rankUp(s, 3);
    expect(s.paved).toEqual([]);                                           // the Kalends pave, as the stone allows
    const dirt = charterDirt(s);
    expect(dirt.length).toBeGreaterThan(10);
    for (let k = 1; k < dirt.length; k++) if (d().stepsToForum[dirt[k]] >= 0) expect(d().stepsToForum[dirt[k]]).toBeGreaterThanOrEqual(d().stepsToForum[dirt[k - 1]]);
    expect(s.log.some((e) => e.text.includes('streets of the inner city are to be paved'))).toBe(true);
    expect(charterPaving(s)).toBe(0);                                      // no stone, no paving
    // only the share of the unreserved stone the Renovation allowance leaves (40%); the Ordo's reservation untouched
    const keep = reserved(s, view(s)).stone ?? 0;
    const share = 1 - settingValue(s, 'renovation');
    s.res.stone = keep + (5 * B.map.PAVE_STONE + 1) / share;
    const had = s.res.stone;
    expect(charterPaving(s)).toBe(5);
    expect(s.paved).toEqual(dirt.slice(0, 5).sort((a, b) => a - b));
    expect(s.res.stone).toBeCloseTo(had - 5 * B.map.PAVE_STONE, 9);
    // the stone comes: the Kalends pave the rest, as much each month as the stores hold
    const before = charterDirt(s).length;
    run(s, 31, (st) => { st.res.stone = 1e5; });
    expect(charterDirt(s).length).toBeLessThan(before);
    run(s, 24 * 31, (st) => { st.res.stone = 1e5; });
    expect(charterDirt(s)).toEqual([]);
    for (const i of s.roads) if (sv.street[i] === 1 && sv.streetRing[i] === 0) expect(s.paved).toContain(i);
  });

  it('a player rural work on a future block blocks its plots until it moves', () => {
    const s = fresh(42);
    const sv = getMap(42).survey;
    const tile = findFail(s, 'cisterna', 'futureRing', undefined, { owner: 'ordo' });
    expect(placeBuilding(s, 'cisterna', tile, { ignoreCost: true }).ok).toBe(true);
    const blk = sv.blocks[sv.blockAt[tile]];
    expect(isFutureBlock(sv, blk, 0)).toBe(true);
    atRank(s, 2);
    expect(canPlace(s, 'area', tile).ok).toBe(false);
  });
});

/** A dense colony: every slot filled in turn with a mix of works at Municipium. */
function dense(seed: number): GameState {
  const s = atRank(fresh(seed), 3);
  const order: BuildingId[] = ['area', 'area', 'taberna', 'area', 'lararium', 'area', 'puteus', 'area', 'horreum', 'templum', 'balneum',
    'macellum', 'ager', 'ager', 'lignarius', 'lapicidina', 'figlina', 'fodina', 'officina', 'venatio', 'pabulatio', 'olivetum', 'hortus', 'cisterna'];
  for (let round = 0; round < 40; round++) {
    let any = false;
    for (const t of order) {
      const keys = [...validSlots(s, t, 'player').keys()].sort((a, b) => a - b);
      if (keys.length === 0) continue;
      if (placeBuilding(s, t, keys[(round * 7919 + s.buildings.length * 31) % keys.length], { ignoreCost: true }).ok) any = true;
    }
    if (!any || s.buildings.length > 500) break;
  }
  for (const b of s.buildings) { b.status = 'done'; b.progress = 1; }
  invalidate(s);
  return s;
}

describe('validSlots', () => {
  it('agrees with canPlace on every tile', () => {
    const s = atRank(fresh(3), 2);
    for (const type of ['area', 'ager', 'puteus', 'mansio', 'lapicidina', 'figlina', 'templum', 'horreum'] as const) {
      for (const owner of ['player', 'ordo'] as const) {
        const slots = validSlots(s, type, owner);
        const ok = new Set<number>();
        for (let i = 0; i < N; i++) {
          const c = canPlace(s, type, i, { owner, ignoreCost: true });
          if (c.ok) ok.add(idx(c.x, c.y));
        }
        expect([...slots.keys()].sort((a, b) => a - b), `${type}/${owner}`).toEqual([...ok].sort((a, b) => a - b));
        for (const [t, m] of slots) expect(m).toBeCloseTo(siteMultAt(s, type, tx(t), ty(t)).mult, 9);
      }
    }
  });

  it('takes ≤ 5 ms per type on a dense colony', () => {
    const s = dense(42);
    expect(s.buildings.length).toBeGreaterThan(300);
    const worst: number[] = [];
    for (const type of BUILDINGS) {
      let best = Infinity;
      for (let rep = 0; rep < 5; rep++) {
        invalidate(s);                                                    // a new structure: fresh memo slots
        const warm: BuildingId = type === 'lignarius' ? 'ager' : 'lignarius';
        validSlots(s, warm, 'player');                                    // the fields every type shares at this structure
        validSlots(s, warm, 'ordo');
        const t0 = performance.now();
        validSlots(s, type, 'ordo');
        best = Math.min(best, performance.now() - t0);
      }
      worst.push(best);
    }
    const slowest = Math.max(...worst);
    expect(slowest, BUILDINGS[worst.indexOf(slowest)]).toBeLessThanOrEqual(5);
  });
});

describe('site multipliers (DESIGN §5.1)', () => {
  it('fields: fertility × river/loam ring × neighbouring fields', () => {
    const s = fresh(42);
    const map = getMap(42);
    const f = s.buildings.find((b) => b.type === 'ager')!;
    let fert = 0, ring = 0;
    const fv = [1.0, 1.1, 1.25, 0.75];
    for (let dy = -1; dy <= 3; dy++) {
      for (let dx = -1; dx <= 3; dx++) {
        const t = map.terrain[idx(f.x + dx, f.y + dy)];
        const inside = dx >= 0 && dx < 3 && dy >= 0 && dy < 3;
        if (inside) fert += t <= 3 ? fv[t] : 0;
        else if (t === T.river || t === T.loam) ring++;
      }
    }
    const base = (fert / 9) * (1 + Math.min(0.2, 0.04 * ring));
    expect(siteMultAt(s, 'ager', f.x, f.y).mult).toBeCloseTo(base, 9);
    // a neighbouring field adds 5%
    const next = [...validSlots(s, 'ager', 'player').keys()].find((t) => tx(t) === f.x + 3 && ty(t) === f.y);
    if (next !== undefined) {
      const alone = siteMultAt(s, 'ager', tx(next), ty(next)).mult;
      const m = siteMultAt(s, 'ager', tx(next), ty(next));
      expect(m.notes.find((n) => n.code === 'fields')?.value).toBe(5);
      expect(m.mult).toBeCloseTo(alone, 9);
    }
  });

  it('quarry, well, mine, kiln and the workshop neighbours', () => {
    const s = atRank(fresh(42), 2);
    const map = getMap(42);
    for (const t of [...validSlots(s, 'lapicidina', 'player').keys()].slice(0, 20)) {
      let n = 0;
      for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 3; dx++) { const v = map.terrain[idx(tx(t) + dx, ty(t) + dy)]; if (v === T.hills || v === T.rock) n++; }
      expect(siteMultAt(s, 'lapicidina', tx(t), ty(t)).mult).toBeCloseTo(Math.min(1.4, Math.max(0.6, 0.6 + 0.1 * n)), 9);
    }
    const dry = [...validSlots(s, 'puteus', 'player').keys()].find((t) => [t, t + 1, t + W, t + W + 1].every((i) => map.waterTable[i] === 0));
    if (dry !== undefined) expect(siteMultAt(s, 'puteus', tx(dry), ty(dry)).mult).toBe(B.economy.OFF_TABLE);
    const mine = [...validSlots(s, 'fodina', 'player').keys()][0];
    const vein = Math.max(...[mine, mine + 1, mine + W, mine + W + 1].map((i) => map.vein[i]));
    expect(siteMultAt(s, 'fodina', tx(mine), ty(mine)).mult).toBeCloseTo(vein, 6);
    const q = bestSlot(s, 'lapicidina', { owner: 'player' })!;
    placeBuilding(s, 'lapicidina', q.tile, { ignoreCost: true });
    const near = [...validSlots(s, 'caementarium', 'player').keys()].find((t) => Math.max(Math.abs(tx(t) - q.x) - 2, Math.abs(ty(t) - q.y) - 2) <= 4);
    if (near !== undefined) expect(siteMultAt(s, 'caementarium', tx(near), ty(near)).mult).toBe(B.site.CAEMENT_NEAR[1]);
    for (const t of validSlots(s, 'figlina', 'player').keys()) {
      const river = sides(tx(t), ty(t), 2, 2).some((i) => map.terrain[i] === T.river);
      expect(siteMultAt(s, 'figlina', tx(t), ty(t)).mult).toBe(river ? B.site.FIGLINA_RIVER : 1);
    }
  });
});

describe('bestSlot', () => {
  it('is deterministic and picks the highest score, lowest tile on ties', () => {
    for (const type of ['ager', 'area', 'lararium', 'horreum', 'puteus'] as const) {
      const a = fresh(42);
      const b = structuredClone(a);
      const x = bestSlot(a, type, { owner: 'ordo' });
      const y = bestSlot(b, type, { owner: 'ordo' });
      expect(x).toEqual(y);
      let best = -Infinity, tile = -1;
      for (const t of [...validSlots(a, type, 'ordo').keys()].sort((p, q) => p - q)) {
        const sc = siteScore(a, type, tx(t), ty(t)).score;
        if (sc > best + 1e-9) { best = sc; tile = t; }
      }
      expect(x?.tile, type).toBe(tile);
      expect(x?.score).toBeCloseTo(best, 9);
    }
  });

  it("the start field is the Ordo's best ager site of the bare map", () => {
    const s = fresh(42);
    const field = s.buildings.find((b) => b.type === 'ager')!;
    s.buildings = s.buildings.filter((b) => b.id !== field.id);
    invalidate(s);
    const sc = siteScore(s, 'ager', field.x, field.y).score;
    const best = bestSlot(s, 'ager', { owner: 'ordo' })!;
    expect(sc).toBeGreaterThanOrEqual(best.score - 1e-9);
  });
});

describe('resolvePlaceAt: where a placement the player starts puts its ghost', () => {
  it('no tile given: the best slot', () => {
    const s = fresh(42);
    for (const type of ['puteus', 'area', 'ager', 'lararium'] as const) {
      expect(resolvePlaceAt(s, type), type).toBe(bestSlot(s, type, { owner: 'player' })?.tile);
    }
  });

  it('a tile that is still a valid slot is kept', () => {
    const s = fresh(42);
    const best = bestSlot(s, 'puteus', { owner: 'player' })?.tile;
    const other = [...validSlots(s, 'puteus', 'player').keys()].sort((a, b) => a - b).find((t) => t !== best);
    expect(other).toBeDefined();
    expect(resolvePlaceAt(s, 'puteus', other)).toBe(other);
  });

  it('a tile taken since (the Ordo built there): the best slot instead', () => {
    const s = fresh(42);
    const at = bestSlot(s, 'puteus', { owner: 'player' })!.tile;
    expect(placeBuilding(s, 'puteus', at, { owner: 'ordo', ignoreCost: true }).ok).toBe(true);
    expect(canPlace(s, 'puteus', at, { owner: 'player' }).ok).toBe(false);
    const next = resolvePlaceAt(s, 'puteus', at);
    expect(next).toBeDefined();
    expect(next).not.toBe(at);
    expect(next).toBe(bestSlot(s, 'puteus', { owner: 'player' })?.tile);
    expect(canPlace(s, 'puteus', next!, { owner: 'player' }).ok).toBe(true);
  });

  it('near a house: the valid slot whose centre is nearest, the lowest tile on a tie', () => {
    const s = fresh(42);
    const house = s.buildings.find((b) => b.house)!;
    const [hw, hh] = sizeOf(house.type, classAt(s, house.type, house.x, house.y));
    const near = { x: house.x, y: house.y, w: hw, h: hh };
    for (const type of ['puteus', 'lararium'] as const) {
      let pick = -1, d2 = Infinity;
      for (const t of [...validSlots(s, type, 'player').keys()].sort((a, b) => a - b)) {
        const [w, h] = sizeOf(type, classAt(s, type, tx(t), ty(t)));
        const d = (tx(t) + w / 2 - (near.x + near.w / 2)) ** 2 + (ty(t) + h / 2 - (near.y + near.h / 2)) ** 2;
        if (d < d2) { d2 = d; pick = t; }
      }
      expect(resolvePlaceAt(s, type, undefined, 'player', { near }), type).toBe(pick);
    }
  });

  it('no valid slot anywhere: undefined', () => {
    const s = fresh(42);
    expect(validSlots(s, 'thermae', 'player').size).toBe(0);
    expect(resolvePlaceAt(s, 'thermae')).toBeUndefined();
    expect(resolvePlaceAt(s, 'thermae', 0)).toBeUndefined();
  });
});

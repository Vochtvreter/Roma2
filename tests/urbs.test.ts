// tests/urbs.test.ts — the growing town (DESIGN §3.9): the footfall census, the town wall's survey, rules and
// construction, the castrum razed into the inner city, renewal (a needless well, cottages bought out and their families
// rehoused), the aqueduct's water where it matters, and the save migration that brings older colonies along.
import { describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import { F, T } from '../src/game/types';
import type { Building, BuildingId, GameState, RankIndex } from '../src/game/types';
import { getMap, idx, tx, ty } from '../src/game/map';
import { derived, footprintOf, inCamp } from '../src/game/derived';
import { invalidate, touchPeople } from '../src/game/memo';
import { buildRoad, canPlace, placeBuilding } from '../src/game/place';
import { autoRoad } from '../src/game/world/roads';
import { ruleFail } from '../src/game/world/siterules';
import { deserialize, serialize, SAVE_VERSION } from '../src/game/save';
import { newCtx, view } from '../src/game/sim';
import { census, houseBeds, peopleIndex } from '../src/game/census';
import { WALL_RING, isActiveBlock } from '../src/game/survey';
import { buyOut, commissionWalls, countFootfall, footfall, homesInOut, moeniaDue, surveyLine, surveyWalls, urbsDay, wallsDay, wearOf, wellNeedless } from '../src/game/urbs';
import { fresh, run } from './util';

const W = B.map.W, H = B.map.H, N = W * H;
const M = B.urbs.MOENIA;

function atRank(s: GameState, rank: RankIndex): GameState {
  s.rank = rank;
  invalidate(s);
  return s;
}

function insert(s: GameState, type: BuildingId, x: number, y: number, extra?: Partial<Building>): Building {
  const id = s.nextId++;
  const b: Building = { id, type, x, y, owner: 'player', status: 'done', placed: s.day, progress: 1, work: 1, paid: true, order: id, open: true, prio: 1, ...extra };
  s.buildings.push(b);
  invalidate(s);
  return b;
}

/** Chebyshev distance of a tile from the castrum interior. */
function offset(s: GameState, i: number): number {
  const I = getMap(s.seed).survey.interior;
  return Math.max(I.x - tx(i), 0, tx(i) - (I.x + I.w - 1), I.y - ty(i), 0, ty(i) - (I.y + I.h - 1));
}

/** A colony at Municipium with the town wall laid out (by the player: the Ordo would wait for the outer town). */
function walled(seed = 42): GameState {
  const s = atRank(fresh(seed), 3);
  expect(commissionWalls(s).ok).toBe(true);
  return s;
}

/** Stone and coin enough to raise the whole wall. */
function rich(s: GameState): void {
  s.res.stone = 1e6;
  s.res.denarii = 1e6;
}

describe('the footfall census (DESIGN §3.9)', () => {
  it('counts walkers on road tiles only, the via carries carts, and a month weighs half', () => {
    const s = fresh(42);
    expect(s.urbs.traffic).toEqual({});
    countFootfall(s);
    const d = derived(s);
    const tiles = Object.keys(s.urbs.traffic).map(Number);
    expect(tiles.length).toBeGreaterThan(10);
    for (const i of tiles) expect(d.road[i], `tile ${i}`).toBeGreaterThan(0);
    const via = getMap(42).survey.via[5];
    const carts = (B.urbs.TRAFFIC.VIA[0] + B.urbs.TRAFFIC.VIA[1] * s.rank) * B.urbs.TRAFFIC.ALPHA;
    expect(footfall(s, via)).toBeGreaterThanOrEqual(carts - 1e-9);
    const first = footfall(s, via);
    countFootfall(s);                                        // the same month again: halfway from the last count to it
    expect(footfall(s, via)).toBeCloseTo(first * (1 - B.urbs.TRAFFIC.ALPHA) + (first / B.urbs.TRAFFIC.ALPHA) * B.urbs.TRAFFIC.ALPHA, 1);
  });

  it('the busiest tiles are the commutes: the founders walk to the well and the field', () => {
    const s = fresh(42);
    countFootfall(s);
    const field = s.buildings.find((b) => b.type === 'ager')!;
    const d = derived(s);
    const beside = footprintOf(field, s).flatMap((i) => [i - 1, i + 1, i - W, i + W]).filter((i) => d.road[i] > 0);
    expect(beside.some((i) => footfall(s, i) > 0), 'the field\'s track is walked').toBe(true);
  });

  it('runs on the Kalends in the tick, and the wear tiers follow the thresholds', () => {
    const s = run(fresh(42), 40);
    expect(Object.keys(s.urbs.traffic).length).toBeGreaterThan(0);
    const [a, b, c] = B.urbs.TRAFFIC.WEAR;
    expect([0, a - 0.01, a, b - 0.01, b, c - 0.01, c, 1e3].map(wearOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('the town wall: survey (DESIGN §3.9)', () => {
  it('a Municipium may wall the whole town; the Ordo waits for Colonia and an outer town that outgrows the camp', () => {
    const s = fresh(42);
    expect(commissionWalls(s)).toMatchObject({ ok: false, code: 'locked' });
    atRank(s, 3);
    expect(moeniaDue(s)).toBe(false);                        // no homes beyond the camp's walls yet
    expect(surveyWalls(s, 'ordo')).toMatchObject({ ok: false, code: 'notReady' });
    expect(homesInOut(s)).toEqual({ inner: 6, outer: 0 });
    expect(commissionWalls(s).ok).toBe(true);
    expect(commissionWalls(s)).toMatchObject({ ok: false, code: 'chosen' });
  });

  for (const seed of [1, 2, 3, 42, 1337]) {
    it(`seed ${seed}: an outer ring round the pomerium, no wall on water or a work, a gate wherever a road crosses`, () => {
      const s = walled(seed);
      const mo = s.urbs.moenia!;
      const map = getMap(seed), d = derived(s);
      expect(mo.tiles.length).toBeGreaterThan(4 * M.LINE);
      expect(new Set(mo.tiles).size).toBe(mo.tiles.length);
      expect(mo.work).toBe(mo.tiles.length * M.WORK);
      const wall = new Set(mo.tiles);
      for (const i of mo.tiles) {
        expect(offset(s, i), `tile ${i}`).toBeGreaterThanOrEqual(M.LINE);
        expect(map.terrain[i] === T.river || map.terrain[i] === T.crag, `tile ${i}`).toBe(false);
        expect(d.buildingAt[i], `tile ${i}`).toBe(0);
        if (d.road[i] > 0) expect(mo.gates, `a road crosses at ${i}: a gate`).toContain(i);
      }
      for (const g of mo.gates) expect(wall.has(g)).toBe(true);
      expect(mo.gates.length).toBeGreaterThanOrEqual(4);
      // the pomerium is inside: no wall tile within the line
      for (let i = 0; i < N; i++) if (offset(s, i) < M.LINE) expect(wall.has(i)).toBe(false);
      // the via leaves the town through a gate (where it crosses the line on land)
      const via = map.survey.via.find((i) => wall.has(i));
      if (via !== undefined) expect(mo.gates).toContain(via);
      // walls are laid on the derived layer: wall 1, gate 2
      for (const i of mo.tiles) expect(d.wall[i]).toBe(mo.gates.includes(i) ? 2 : 1);
    });
  }

  it('goes round a work standing on its line (the farm is taken inside) and round sacred ground', () => {
    const s = atRank(fresh(42), 3);
    const before = surveyLine(s)!;
    // a field straddling the line beside a stretch of plain wall
    const sv = getMap(42).survey;
    const at = before.tiles.find((i) => !before.gates.includes(i) && ty(i) === sv.interior.y - M.LINE && tx(i) > sv.interior.x + 2 && tx(i) < sv.interior.x + 25
      && canPlace(s, 'ager', i - 1, { ignoreCost: true }).ok);
    if (at === undefined) return;                            // no fertile stretch on this map's north side
    const r = placeBuilding(s, 'ager', at - 1, { owner: 'player', ignoreCost: true });
    if (!r.ok) throw new Error(r.reason);
    const field = s.buildings.find((b) => b.id === r.id)!;
    const after = surveyLine(s)!;
    const fp = new Set(footprintOf(field, s));
    expect(after.tiles.some((i) => fp.has(i))).toBe(false);
    // the wall runs beyond the field now: some wall tile lies past the field's far edge on its column
    expect(after.tiles.some((i) => tx(i) === field.x + 1 && ty(i) < field.y)).toBe(true);
    for (const i of after.tiles) expect(getMap(42).feature[i] === F.lucus || getMap(42).feature[i] === F.ruins).toBe(false);
  });

  it('is laid by the Ordo on its build day once the colony is a Colonia that has outgrown its camp (the plan duty)', () => {
    const s = atRank(fresh(42), 3);
    const sv = getMap(42).survey;
    const outer = sv.blocks.filter((b) => b.ring === 1 && isActiveBlock(sv, b, 3)).slice(0, 2);
    for (const b of outer) for (const k of [0, 1, 2, 3]) insert(s, 'area', b.x + (k % 2) * 2, b.y + Math.floor(k / 2) * 2,
      { owner: 'ordo', house: { tier: 'casa', pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 } });
    expect(moeniaDue(s)).toBe(false);                        // a Municipium: the Ordo waits for the charter
    atRank(s, 4);
    expect(moeniaDue(s)).toBe(true);
    run(s, 2);
    expect(s.urbs.moenia).not.toBeNull();
    expect(s.log.some((e) => /lay out a town wall/.test(e.text))).toBe(true);
  });
});

describe('the town wall: its line is kept, and the builders raise it', () => {
  it('nothing rural, no road and no aqueduct pier stands on the line; roads pass only at a gate', () => {
    const s = walled(42);
    const mo = s.urbs.moenia!;
    const plain = mo.tiles.filter((i) => !mo.gates.includes(i));
    const tile = plain.find((i) => canPlace(atRank(fresh(42), 3), 'puteus', i, { ignoreCost: true }).ok);
    expect(tile).toBeDefined();
    expect(canPlace(s, 'puteus', tile!, { ignoreCost: true })).toMatchObject({ ok: false, code: 'castrum' });
    expect(buildRoad(s, [plain[0]])).toMatchObject({ ok: false, code: 'castrum' });
    // an auto-road from beyond the wall reaches the town only through a gate
    const wall = new Set(plain);
    for (const t of [...mo.gates].slice(0, 3)) {
      const x = tx(t), y = ty(t);
      for (const [dx, dy] of [[0, -6], [0, 6], [-6, 0], [6, 0]]) {
        const path = autoRoad(s, x + dx, y + dy, 1, 1);
        if (path) for (const i of path) expect(wall.has(i), `road through the wall at ${i}`).toBe(false);
      }
    }
  });

  it('draws stone and coin as it rises, never below the saving target, and stalls without them', () => {
    const s = walled(42);
    const mo = s.urbs.moenia!;
    s.res.stone = 0;
    expect(wallsDay(s, newCtx(), 10, 1)).toBe(0);
    expect(mo.progress).toBe(0);
    rich(s);
    const c = newCtx();
    const used = wallsDay(s, c, 100, 1);
    expect(used).toBeCloseTo(M.CREW, 6);                     // at most its crew of builders
    expect(mo.progress).toBeCloseTo(used / mo.work, 9);
    expect(c.rates.cons.stone.construction).toBeCloseTo(used * M.MAT.stone / M.WORK, 9);
    expect(mo.matUsed.denarii).toBeCloseTo(used * M.MAT.denarii / M.WORK, 9);
  });

  it('builders are staffed for it while it rises, and the tick raises it', () => {
    const s = walled(42);
    rich(s);
    run(s, 30);
    expect(s.urbs.moenia!.progress).toBeGreaterThan(0);
    expect(peopleIndex(s).builders.length).toBeGreaterThan(0);
  });
});

describe('the castrum razed: the camp becomes the inner city (DESIGN §3.9)', () => {
  function finished(seed = 42): GameState {
    const s = walled(seed);
    rich(s);
    const mo = s.urbs.moenia!;
    for (let k = 0; k < 1000 && mo.done === null; k++) wallsDay(s, newCtx(), mo.work, 100);
    expect(mo.done).not.toBeNull();
    return s;
  }

  it('finishing the wall razes the camp: rampart and ditch gone, streets across the old wall line, salvage', () => {
    const before = walled(42);
    const sv = getMap(42).survey;
    const s = finished(42);
    const d = derived(s);
    expect(s.urbs.razed).toBe(s.day);
    expect(s.urbs.moenia!.done).toBe(s.day);
    for (let i = 0; i < N; i++) if (sv.wall[i] || sv.fossa[i]) expect(d.wall[i], `tile ${i}`).toBe(0);
    for (let i = 0; i < N; i++) if (sv.street[i] && sv.streetRing[i] === WALL_RING) expect(d.road[i], `street ${i}`).toBeGreaterThan(0);
    for (const g of sv.gates) expect(d.road[g.tile]).toBeGreaterThan(0);
    expect(s.res.stone).toBeGreaterThan(before.res.stone);   // (rich() then minus the wall, plus the salvage: checked by the log)
    expect(s.log.some((e) => /torn down \(\d+ stone salvaged\)/.test(e.text))).toBe(true);
    expect(inCamp(s, sv.gates[0].tile)).toBe(false);
    expect(inCamp(s, idx(sv.interior.x + 1, sv.interior.y + 1))).toBe(true);
  });

  it('the old wall line is 24 blocks of house plots in the pomerium; the interior stays urban only', () => {
    const s = finished(42);
    const sv = getMap(42).survey;
    const d = derived(s);
    const band = sv.blocks.filter((b) => b.ring === WALL_RING);
    expect(band.length).toBe(24);
    for (const b of band) {
      expect(isActiveBlock(sv, b, s.rank, true)).toBe(true);
      expect(d.pomerium[idx(b.x, b.y)]).toBe(1);
    }
    const b = band[0];
    const r = placeBuilding(s, 'area', idx(b.x, b.y), { owner: 'player', ignoreCost: true });
    expect(r.ok).toBe(true);
    expect(canPlace(s, 'ager', idx(b.x + 2, b.y), { ignoreCost: true }).ok).toBe(false);   // no fields on the old wall line
    // the sacred way inside the camp still takes no rural work
    for (const i of sv.sacredWay) expect(canPlace(s, 'puteus', i, { ignoreCost: true }).ok).toBe(false);
  });

  it('a colony with the wall standing earns its dignitas, spirits and the watch on the roads', () => {
    const s = finished(42);
    const v = atRank(fresh(42), 3);
    expect(s.log.some((e) => /The town wall stands/.test(e.text))).toBe(true);
    // dignitas: the works group carries the wall
    // (read through civic to keep this test on the contract, not the numbers)
    return import('../src/game/civic').then(({ dignitas }) => {
      expect(dignitas(s).groups.works - dignitas(v).groups.works).toBeCloseTo(M.DIGNITAS, 6);
    });
  });
});

describe('renewal: the Ordo replans a quarter (DESIGN §3.9)', () => {
  /** Puts residents into a house until it holds `n` (moving them from other homes). */
  function crowd(s: GameState, houseId: number, n: number): void {
    const others = s.people.filter((p) => p.home !== houseId);
    for (let k = 0; k < n && k < others.length; k++) others[k].home = houseId;
    touchPeople(s);
  }

  it('buys out a block of cottages and rehouses every family in the town\'s other homes', () => {
    const s = fresh(42);
    const sv = getMap(42).survey;
    const houses = s.buildings.filter((b) => b.type === 'area');
    const blk = sv.blocks[sv.blockAt[idx(houses[0].x, houses[0].y)]];
    const mine = houses.filter((b) => sv.blockAt[idx(b.x, b.y)] === blk.id).map((b) => b.id);
    expect(mine.length).toBe(4);
    for (const b of houses) b.owner = 'ordo';
    // more homes with room elsewhere
    const free = sv.blocks.filter((b) => b.ring === 0 && isActiveBlock(sv, b, 0) && b.id !== blk.id).slice(-3);
    for (const b of free) for (const k of [0, 1, 2, 3]) insert(s, 'area', b.x + (k % 2) * 2, b.y + Math.floor(k / 2) * 2,
      { owner: 'ordo', house: { tier: 'casa', pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 } });
    const movers = s.people.filter((p) => p.home !== null && mine.includes(p.home)).map((p) => p.id);
    expect(movers.length).toBeGreaterThan(0);
    expect(buyOut(s, mine, 'templum', () => {})).toBe(true);
    expect(s.buildings.some((b) => mine.includes(b.id))).toBe(false);
    for (const id of movers) {
      const p = s.people.find((x) => x.id === id)!;
      expect(p.home, `${p.prae} ${p.gens} is rehoused`).not.toBeNull();
      expect(mine).not.toContain(p.home);
    }
    expect(census(s).homeless).toBe(0);
    for (const f of s.families) if (f.home !== null) expect(s.buildings.some((b) => b.id === f.home)).toBe(true);
    for (const id of derived(s).houses) {
      const b = s.buildings.find((x) => x.id === id)!;
      expect(peopleIndex(s).byHome.get(id)?.length ?? 0).toBeLessThanOrEqual(houseBeds(s, b));
    }
    expect(s.log.some((e) => /buys out 4 cottages and rehouses/.test(e.text))).toBe(true);
    // the block is free for the work
    expect(canPlace(atRank(s, 2), 'templum', idx(blk.x, blk.y), { owner: 'ordo', ignoreCost: true }).ok).toBe(true);
  });

  it('never buys out what the colony cannot rehouse, nor the player\'s own homes', () => {
    const s = fresh(42);
    const houses = s.buildings.filter((b) => b.type === 'area');
    const ids = houses.slice(0, 4).map((b) => b.id);
    expect(buyOut(s, ids, 'templum', () => {})).toBe(false);          // the founders' homes are the player's start
    for (const b of houses) b.owner = 'ordo';
    crowd(s, houses[5].id, houseBeds(s, houses[5]));
    const before = serialize(s);
    expect(buyOut(s, ids, 'templum', () => {})).toBe(false);          // no beds elsewhere for them
    expect(serialize(s)).toBe(before);
  });

  it('fills in an old well the fountains made needless (never a young one, one raised for the supply, or the player\'s)', () => {
    const s = atRank(fresh(42), 3);
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    const sv = getMap(42).survey;
    const blk = sv.blocks[sv.blockAt[idx(well.x, well.y)]];
    insert(s, 'castellum', 0, 0);                                     // the aqueduct flows (far off: only its water counts here)
    expect(wellNeedless(s, well)).toBe(false);                        // its homes have no fountain yet
    // a fountain on the well's own block reaches every home the well waters
    const free = [0, 1, 2, 3].map((k) => ({ x: blk.x + (k % 2) * 2, y: blk.y + Math.floor(k / 2) * 2 }))
      .find((o) => !s.buildings.some((b) => b.x === o.x && b.y === o.y))!;
    insert(s, 'lacus', free.x, free.y);
    expect(wellNeedless(s, well)).toBe(true);
    s.res.water = 5000;
    const day = (): void => { const c = newCtx(); urbsDay(s, c, view(s), true); };
    well.owner = 'player';
    day();
    expect(s.buildings.includes(well), 'the player\'s well stands').toBe(true);
    well.owner = 'ordo';
    well.reason = { code: 'aestasWater', params: {} };
    day();
    expect(s.buildings.includes(well), 'a well raised for Aestas stands').toBe(true);
    delete well.reason;
    well.doneDay = s.day - 10;
    day();
    expect(s.buildings.includes(well), 'a young well stands').toBe(true);
    well.doneDay = s.day - B.urbs.RENEW.WELL_AGE;
    day();
    expect(s.buildings.includes(well), 'the old well is filled in').toBe(false);
    expect(s.people.some((p) => p.work === well.id)).toBe(false);
    expect(s.log.some((e) => /fills in the old well/.test(e.text))).toBe(true);
    expect(canPlace(s, 'area', idx(well.x, well.y), { ignoreCost: true }).ok).toBe(true);   // the plot is free for a home
  });

  it('a fountain may draw from the aqueduct where it runs through the town, the thermae only from the castellum', () => {
    const s = atRank(fresh(42), 3);
    const sv = getMap(42).survey;
    // a finished castellum far off, its route running along a street of the inner city
    const street = [];
    for (let x = sv.interior.x + 1; x < sv.interior.x + 10; x++) street.push(idx(x, sv.interior.y));
    insert(s, 'castellum', 0, 0, { route: street });
    const blk = sv.blocks.find((b) => b.ring === 0 && isActiveBlock(sv, b, 3) && Math.abs(b.y - sv.interior.y) <= 6)!;
    expect(ruleFail(s, 'lacus', blk.x, blk.y, 2, 2)).toBeNull();
    expect(ruleFail(s, 'thermae', blk.x, blk.y, 4, 4)).toMatchObject({ code: 'noCastellum' });
  });
});

describe('saves (DESIGN §3.9, ARCHITECTURE §11)', () => {
  it('a version-1 save gains the growing town after `wood`, with the castrum standing', () => {
    const s = run(fresh(42), 35);
    const raw = JSON.parse(serialize(s));
    delete raw.urbs;
    raw.version = 1;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.urbs).toEqual({ traffic: {}, moenia: null, razed: null, renewed: back.urbs.renewed });
    const keys = Object.keys(back);
    expect(keys.indexOf('urbs')).toBe(keys.indexOf('wood') + 1);
  });

  it('the town wall, the razing and the footfall load back exactly', () => {
    const s = walled(42);
    rich(s);
    run(s, 40);
    const mo = s.urbs.moenia!;
    rich(s);                                                 // the stores' caps took the stone back in the ticks
    for (let k = 0; k < 1000 && mo.done === null; k++) wallsDay(s, newCtx(), mo.work, 100);
    expect(mo.done).not.toBeNull();
    run(s, 3);
    const back = deserialize(serialize(s))!;
    expect(back).toEqual(s);
    expect(serialize(back)).toBe(serialize(s));
    // and a razed castrum without its wall is impossible: it is put back up
    const raw = JSON.parse(serialize(s));
    raw.urbs.moenia = null;
    expect(deserialize(JSON.stringify(raw))!.urbs.razed).toBeNull();
  });

  it('a walled colony continues identically from a save', () => {
    const a = walled(42);
    rich(a);
    run(a, 20);
    const b = deserialize(serialize(a))!;
    run(a, 60);
    run(b, 60);
    expect(serialize(b)).toBe(serialize(a));
  });
});

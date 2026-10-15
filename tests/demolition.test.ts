// tests/demolition.test.ts — pulling works down by the armful (game/demolition.ts, DESIGN §5.3): what it would do before
// the second click (homes and people, workers, homes left without water, what comes back), an area at once with one
// Annales line, the council's gardens of a block, and the short undo that raises them again as they stood.
import { describe, expect, it } from 'vitest';
import type { Building, GameState, RankIndex } from '../src/game/types';
import { B } from '../src/game/balance';
import { clearGardens, councilGardens, costWords, demolishMany, demolitionImpact, undoDemolition, undoable } from '../src/game/demolition';
import * as A from '../src/game/actions';
import { canPlace, placeBuilding, placementCost, validSlots } from '../src/game/place';
import { bestSlot } from '../src/game/site';
import { blockOfTile, derived, footprintOf } from '../src/game/derived';
import { peopleIndex } from '../src/game/census';
import { invalidate } from '../src/game/memo';
import { unmetNeeds } from '../src/game/housing';
import { idx, tx, ty } from '../src/game/map';
import { commissionWalls, surveyLine } from '../src/game/urbs';
import { fresh, run } from './util';

const C = B.construction;

/** The founders' well and the homes it waters, raised to huts (a hut needs water to stay a hut, §7.3). */
function hutsByTheWell(s: GameState): { well: Building; huts: Building[] } {
  const well = s.buildings.find((b) => b.type === 'puteus')!;
  const huts = s.buildings.filter((b) => b.type === 'area' && b.house);
  for (const b of huts) b.house!.tier = 'casa';
  invalidate(s);
  return { well, huts: huts.filter((b) => !unmetNeeds(s, b, 'casa').includes('water')) };
}

/** A survey block with at least `n` free plots, and those plots' tiles (ascending). */
function freeBlock(s: GameState, n: number): { block: number; tiles: number[] } {
  const by = new Map<number, number[]>();
  for (const t of [...validSlots(s, 'hortus', 'player').keys()].sort((a, c) => a - c)) {
    const blk = blockOfTile(s, t);
    if (blk) by.set(blk.id, [...(by.get(blk.id) ?? []), t]);
  }
  const hit = [...by].find(([, ts]) => ts.length >= n);
  if (!hit) throw new Error(`no block with ${n} free plots`);
  return { block: hit[0], tiles: hit[1].slice(0, n) };
}

function garden(s: GameState, tile: number, owner: 'player' | 'ordo'): Building {
  const r = placeBuilding(s, 'hortus', tile, { owner, noStake: true, ignoreCost: true });
  if (!r.ok) throw new Error(r.reason);
  const b = s.buildings.find((x) => x.id === r.id)!;
  b.status = 'done';
  b.progress = 1;
  invalidate(s);
  return b;
}

/** A finished forage camp (2×2, rural) on fresh(`seed`) at `rank`, placed so its footprint covers a tile of `on(s)`:
 *  each origin that can take it in turn, until `fits` says the ground it frees is what the test wants. */
function campOn(seed: number, rank: RankIndex, on: (s: GameState) => readonly number[],
  fits: (s: GameState, camp: Building) => boolean): { s: GameState; camp: Building } | null {
  const probe = fresh(seed);
  probe.rank = rank;
  invalidate(probe);
  const origins = new Set<number>();
  for (const t of on(probe)) for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const x = tx(t) + dx, y = ty(t) + dy;
    if (x >= 0 && y >= 0) origins.add(idx(x, y));
  }
  for (const o of [...origins].sort((a, c) => a - c)) {
    const s = fresh(seed);
    s.rank = rank;
    invalidate(s);
    if (!canPlace(s, 'pabulatio', o, { ignoreCost: true }).ok) continue;
    const r = placeBuilding(s, 'pabulatio', o, { noStake: true, ignoreCost: true });
    if (!r.ok) continue;
    const camp = s.buildings.find((b) => b.id === r.id)!;
    camp.status = 'done';
    camp.progress = 1;
    invalidate(s);
    if (fits(s, camp)) return { s, camp };
  }
  return null;
}

describe('demolitionImpact: what the second click would do', () => {
  it('counts the homes and their people, the workers, and a quarter of the cost back', () => {
    const s = fresh(42);
    const homes = s.buildings.filter((b) => b.type === 'area' && b.house).slice(0, 2);
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    const ix = peopleIndex(s);
    const imp = demolitionImpact(s, [well.id, ...homes.map((b) => b.id)], { needs: false });
    expect(imp.ids).toEqual([well.id, ...homes.map((b) => b.id)].sort((a, c) => a - c));
    expect(imp.homes).toBe(2);
    expect(imp.people).toBe(homes.reduce((n, b) => n + (ix.byHome.get(b.id)?.length ?? 0), 0));
    expect(imp.people).toBeGreaterThan(0);
    expect(imp.workers).toBe(ix.byWork.get(well.id)?.length ?? 0);
    expect(imp.frac).toBe(C.REFUND_DEMOLISH);
    const cost = [well, ...homes].map((b) => placementCost(s, b.type, 0));
    expect(imp.refund.denarii ?? 0).toBeCloseTo(cost.reduce((n, c) => n + (c.denarii ?? 0), 0) * C.REFUND_DEMOLISH, 9);
  });

  it('names the homes that would lose water when their well comes down (and only those)', () => {
    const s = fresh(42);
    const { well, huts } = hutsByTheWell(s);
    expect(huts.length).toBeGreaterThan(0);
    const imp = demolitionImpact(s, [well.id]);
    expect(imp.losing).toEqual([{ need: 'water', homes: huts.length }]);
    // reading it changed nothing
    expect(s.buildings.some((b) => b.id === well.id)).toBe(true);
    for (const b of huts) expect(unmetNeeds(s, b, 'casa')).not.toContain('water');
    // a hut pulled down with its well is not counted as one losing water
    expect(demolitionImpact(s, [well.id, huts[0].id]).losing).toEqual([{ need: 'water', homes: huts.length - 1 }]);
  });

  it('leaves the principia out and says so; a sweep with nothing in it pulls nothing down', () => {
    const s = fresh(42);
    const pr = s.buildings.find((b) => b.type === 'principia')!;
    const imp = demolitionImpact(s, [pr.id]);
    expect(imp.ids).toEqual([]);
    expect(imp.spared).toEqual(['principia']);
    expect(costWords(imp.refund)).toEqual([]);
    expect(demolitionImpact(s, []).ids).toEqual([]);
  });
});

describe('demolishMany: an area at once (DESIGN §5.3)', () => {
  it('pulls every work down with its refund, puts out residents and workers, and logs one line', () => {
    const s = fresh(42);
    const homes = s.buildings.filter((b) => b.type === 'area' && b.house).slice(0, 3);
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    const pr = s.buildings.find((b) => b.type === 'principia')!;
    const ids = [well.id, pr.id, ...homes.map((b) => b.id)];
    const imp = demolitionImpact(s, ids);
    const den = s.res.denarii, logs = s.log.length;
    const residents = s.people.filter((p) => homes.some((b) => b.id === p.home)).map((p) => p.id);
    expect(A.demolishMany(s, ids)).toEqual({ ok: true });
    expect(s.buildings.some((b) => imp.ids.includes(b.id))).toBe(false);
    expect(s.buildings.some((b) => b.id === pr.id)).toBe(true);          // the principia stays
    expect(s.res.denarii).toBeCloseTo(den + (imp.refund.denarii ?? 0), 9);
    for (const id of residents) {
      const p = s.people.find((x) => x.id === id)!;
      expect(p.home).toBeNull();
      expect(p.homelessSince).toBe(s.day);
    }
    expect(s.people.some((p) => p.work === well.id)).toBe(false);
    expect(s.families.some((f) => homes.some((b) => b.id === f.home))).toBe(false);
    expect(s.log.length).toBe(logs + 1);
    expect(s.log[s.log.length - 1].text).toMatch(/^4 works pulled down \(3 homes\); .* salvaged\.$/);
  });

  it('refuses nothing standing, and the principia alone', () => {
    const s = fresh(42);
    const pr = s.buildings.find((b) => b.type === 'principia')!;
    expect(demolishMany(s, [99_999])).toEqual({ ok: false, code: 'notFound', reason: 'Nothing stands there.' });
    expect(demolishMany(s, [pr.id])).toEqual({ ok: false, code: 'invalid', reason: 'The Principia cannot be pulled down.' });
  });

  it('keeps the one-work line of the single tool', () => {
    const s = fresh(42);
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    expect(demolishMany(s, [well.id]).ok).toBe(true);
    expect(s.log[s.log.length - 1].text).toBe('Well pulled down; a quarter of its cost is salvaged.');
  });
});

describe("clearGardens: the council's gardens of a block in one go", () => {
  it("pulls down the Ordo's gardens of that block and leaves the player's", () => {
    const s = fresh(42);
    const { block, tiles } = freeBlock(s, 3);
    const a = garden(s, tiles[0], 'ordo'), b = garden(s, tiles[1], 'ordo'), mine = garden(s, tiles[2], 'player');
    expect(councilGardens(s, block)).toEqual([a.id, b.id]);
    const den = s.res.denarii;
    expect(A.clearGardens(s, block)).toEqual({ ok: true });
    expect(s.buildings.some((x) => x.id === a.id || x.id === b.id)).toBe(false);
    expect(s.buildings.some((x) => x.id === mine.id)).toBe(true);
    expect(s.res.denarii).toBeCloseTo(den + 2 * (placementCost(s, 'hortus', 0).denarii ?? 0) * C.REFUND_DEMOLISH, 9);
    expect(s.log[s.log.length - 1].text).toMatch(/^The council's 2 gardens in the block are cleared; /);
    expect(clearGardens(s, block)).toEqual({ ok: false, code: 'notFound', reason: 'The council has laid no garden in this block.' });
    expect(blockOfTile(s, idx(mine.x, mine.y))?.id).toBe(block);
  });
});

describe('undoDemolition: a short undo', () => {
  it('raises the works again as they stood, takes the salvage back and re-homes the people', () => {
    const s = fresh(42);
    const homes = s.buildings.filter((b) => b.type === 'area' && b.house).slice(0, 2);
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    const before = structuredClone({ buildings: s.buildings, people: s.people, families: s.families, res: s.res });
    expect(undoable(s)).toBeNull();
    expect(demolishMany(s, [well.id, ...homes.map((b) => b.id)]).ok).toBe(true);
    expect(undoable(s)).toEqual({ works: 3, until: s.day + C.UNDO_DAYS });
    expect(A.undoDemolition(s)).toEqual({ ok: true });
    expect(s.buildings).toEqual(before.buildings);
    expect(s.people).toEqual(before.people);
    expect(s.families).toEqual(before.families);
    for (const r of Object.keys(before.res) as (keyof typeof before.res)[]) expect(s.res[r]).toBeCloseTo(before.res[r], 9);
    expect(derived(s).houses).toEqual(expect.arrayContaining(homes.map((b) => b.id)));
    expect(s.log[s.log.length - 1].text).toBe('The demolition is undone: 3 works stand again and the salvage goes back.');
    expect(undoable(s)).toBeNull();
    expect(undoDemolition(s)).toEqual({ ok: false, code: 'notFound', reason: 'There is no demolition to undo.' });
  });

  it(`lasts ${C.UNDO_DAYS} days of the colony's time`, () => {
    const s = fresh(42);
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    demolishMany(s, [well.id]);
    run(s, C.UNDO_DAYS);
    expect(undoable(s)).not.toBeNull();
    run(s, 1);
    expect(undoable(s)).toBeNull();
    const r = undoDemolition(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('window');
  });

  it('refuses once something new stands on the ground, or the salvage is spent', () => {
    const s = fresh(42);
    const { tiles } = freeBlock(s, 1);
    const g1 = garden(s, tiles[0], 'player');
    demolishMany(s, [g1.id]);
    garden(s, tiles[0], 'ordo');
    const r = undoDemolition(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('occupied');

    const t = fresh(42);
    const well = t.buildings.find((b) => b.type === 'puteus')!;
    demolishMany(t, [well.id]);
    t.res.denarii = 0;
    const u = undoDemolition(t);
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.code).toBe('unaffordable');
    expect(t.buildings.some((b) => b.id === well.id)).toBe(false);
  });

  it("refuses once an aqueduct's route runs over the freed ground", () => {
    const route = (s: GameState): number[] => {
      const c = bestSlot(s, 'castellum', { owner: 'player' });
      const k = c ? canPlace(s, 'castellum', c.tile, { ignoreCost: true }) : null;
      return k?.ok && k.route ? k.route : [];
    };
    // a forage camp on the aqueduct's line, pulled down; the castellum then laid with its route over that ground (Undo
    // would put the camp back on the aqueduct, which canPlace refuses as 'reserved')
    const hit = campOn(42, 3, route, (s, camp) => {
      const fp = footprintOf(camp, s);
      if (!demolishMany(s, [camp.id]).ok) return false;
      const c = bestSlot(s, 'castellum', { owner: 'player' });
      if (!c || !placeBuilding(s, 'castellum', c.tile, { noStake: true, ignoreCost: true }).ok) return false;
      return fp.some((i) => derived(s).reservedTile[i] === 1);
    });
    expect(hit).not.toBeNull();
    const { s, camp } = hit!;
    const r = undoDemolition(s);
    expect(r).toEqual({ ok: false, code: 'occupied', reason: 'Too late: something new stands or is laid out where they stood.' });
    expect(s.buildings.some((b) => b.id === camp.id)).toBe(false);
  });

  it('refuses once the town wall is laid over the freed ground', () => {
    // a forage camp on the wall's line, pulled down; the town wall then laid out across that ground (canPlace: 'castrum')
    const line = (s: GameState): number[] => surveyLine(s)?.tiles ?? [];
    const hit = campOn(42, 3, line, (s, camp) => {
      const fp = footprintOf(camp, s);
      if (!demolishMany(s, [camp.id]).ok || !commissionWalls(s).ok) return false;
      return fp.some((i) => derived(s).wall[i] > 0);
    });
    expect(hit).not.toBeNull();
    const { s, camp } = hit!;
    const r = undoDemolition(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('occupied');
    expect(s.buildings.some((b) => b.id === camp.id)).toBe(false);
  });

  it('a family that found beds elsewhere meanwhile stays there', () => {
    const s = fresh(42);
    const [home, other] = s.buildings.filter((b) => b.type === 'area' && b.house);
    const fam = s.families.find((f) => f.home === home.id)!;
    demolishMany(s, [home.id]);
    fam.home = other.id;
    for (const p of s.people) if (p.family === fam.id) p.home = other.id;
    expect(undoDemolition(s).ok).toBe(true);
    expect(s.buildings.some((b) => b.id === home.id)).toBe(true);
    expect(s.people.filter((p) => p.family === fam.id).every((p) => p.home === other.id)).toBe(true);
  });
});

// tests/coverage.test.ts — road-BFS coverage in whole steps, the activity rule, desirability (DESIGN §5.2, §7.4, §7.5).
import { describe, expect, it } from 'vitest';
import { F, LAYERS, T } from '../src/game/types';
import type { Building, BuildingId, GameState } from '../src/game/types';
import { H, W, getMap, idx } from '../src/game/map';
import { invalidate, touchPeople } from '../src/game/memo';
import { coverage, desirability, effectiveRadius, houseDesir, houseHas, previewCoverage, previewCovered, previewDesir, previewSteps } from '../src/game/coverage';
import { canWork } from '../src/game/census';
import { bestSlot } from '../src/game/site';
import { placeBuilding, validSlots } from '../src/game/place';
import { B } from '../src/game/balance';
import { BUILDING_DEFS } from '../src/game/data/buildings';
import { TIER_DEFS } from '../src/game/data/housing';
import { RANK_DEFS } from '../src/game/data/ranks';
import { fresh } from './util';

const N = W * H;
const OX = 3, OY = 3;                                    // fixture corner, far from the castrum and the via (seed 42)

function insert(s: GameState, type: BuildingId, x: number, y: number, extra?: Partial<Building>): Building {
  const id = s.nextId++;
  const b: Building = { id, type, x, y, owner: 'player', status: 'done', placed: s.day, progress: 1, work: 1, paid: true, order: id, open: true, prio: 1, ...extra };
  s.buildings.push(b);
  invalidate(s);
  return b;
}

function house(s: GameState, x: number, y: number, tier: 'casa' | 'insula' | 'domus' = 'casa'): Building {
  return insert(s, 'area', x, y, { house: { tier, pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 } });
}

/** Puts `n` able people to work at a building (taken from the idle). */
function staff(s: GameState, b: Building, n: number): void {
  for (const p of s.people) if (p.work === b.id) p.work = null;
  let k = 0;
  for (const p of s.people) {
    if (k >= n) break;
    if (p.work === null && canWork(s, p)) { p.work = b.id; k++; }
  }
  touchPeople(s);
}

/** The lararium's full radius (R): the fixture is laid out around it, so the hand-computed steps hold for any radius. */
const R = BUILDING_DEFS.lararium.service![0].radius;

/** The fixture: an (R + 8)-tile road row with a branch up from k = R + 1, a lararium on the row, two houses below it:
 *  `near` at the edge of the radius (R steps), `far` just beyond it (R + 3 steps). */
function fixture(): { s: GameState; shrine: Building; near: Building; far: Building; row: (k: number) => number; branch: (j: number) => number } {
  const s = fresh(42);
  const row = (k: number): number => idx(OX + k, OY + 4);
  const branch = (j: number): number => idx(OX + R + 1, OY + 4 - j);
  const tiles = [...Array(R + 8).keys()].map(row).concat([1, 2, 3, 4].map(branch), [idx(OX + 5, OY + 1)]);
  for (const i of tiles) expect(s.roads.includes(i)).toBe(false);
  s.roads = [...new Set([...s.roads, ...tiles])].sort((a, b) => a - b);
  const shrine = insert(s, 'lararium', OX + 2, OY + 2);
  const near = house(s, OX + R + 3, OY + 5);
  const far = house(s, OX + R + 6, OY + 5);
  staff(s, shrine, 1);
  invalidate(s);
  return { s, shrine, near, far, row, branch };
}

describe('coverage: BFS over built roads in whole steps (DESIGN §7.4)', () => {
  it('covers road tiles within the radius in steps from the roads beside the footprint', () => {
    const { s, shrine, row, branch } = fixture();
    expect(effectiveRadius(s, shrine, 'shrine')).toBe(R);
    const layer = coverage(s).layers.shrine;
    // hand-computed steps along the row: sources at k = 2, 3
    const steps = (k: number): number => (k < 2 ? 2 - k : Math.max(0, k - 3));
    for (let k = 0; k < R + 8; k++) expect(layer[row(k)], `row ${k} (${steps(k)} steps)`).toBe(steps(k) <= R ? 1 : 0);
    // the branch turns the corner at k = R + 1 (R − 2 steps): R − 1, R, R + 1, R + 2 steps up it
    expect([1, 2, 3, 4].map((j) => layer[branch(j)])).toEqual([1, 1, 0, 0]);
    // a road tile two tiles from the shrine but not joined to its roads stays dry
    expect(layer[idx(OX + 5, OY + 1)]).toBe(0);
    // nothing but road tiles is ever covered
    const road = new Set(s.roads);
    for (let i = 0; i < N; i++) if (layer[i]) expect(road.has(i)).toBe(true);
  });

  it('covers a house when a road tile beside it is covered', () => {
    const { s, near, far } = fixture();
    expect(houseHas(s, near.id, 'shrine')).toBe(true);
    expect(houseHas(s, far.id, 'shrine')).toBe(false);
    expect(houseHas(s, near.id, 'water')).toBe(false);
    const mask = coverage(s).houseMask.get(near.id) ?? 0;
    expect(mask).toBe(1 << LAYERS.indexOf('shrine'));
  });

  it('extends the radius with path bonuses (Pietas: shrines +4)', () => {
    const { s, shrine, far, branch } = fixture();
    s.decisions.paths.path2 = 'pietas';
    invalidate(s);
    expect(effectiveRadius(s, shrine, 'shrine')).toBe(R + 4);
    expect(houseHas(s, far.id, 'shrine')).toBe(true);
    expect(coverage(s).layers.shrine[branch(4)]).toBe(1);
  });

  it('follows the activity rule: staffing, closing, unpaid upkeep, unfinished', () => {
    const s = fresh(42);
    const baths = insert(s, 'balneum', OX, OY);
    const r = BUILDING_DEFS.balneum.service![0].radius;
    expect(effectiveRadius(s, baths, 'baths')).toBe(0);
    staff(s, baths, 1);
    expect(effectiveRadius(s, baths, 'baths')).toBe(Math.floor(B.economy.SERVICE_PARTIAL * r));
    staff(s, baths, 2);
    expect(effectiveRadius(s, baths, 'baths')).toBe(r);
    baths.unpaid = true;
    expect(effectiveRadius(s, baths, 'baths')).toBe(Math.floor(r * B.economy.UNPAID));
    delete baths.unpaid;
    baths.open = false;
    expect(effectiveRadius(s, baths, 'baths')).toBe(0);
    baths.open = true;
    baths.status = 'building';
    expect(effectiveRadius(s, baths, 'baths')).toBe(0);
    const cistern = insert(s, 'cisterna', OX + 6, OY);                 // no slots: always active
    expect(effectiveRadius(s, cistern, 'water')).toBe(BUILDING_DEFS.cisterna.service![0].radius);
    expect(effectiveRadius(s, cistern, 'shrine')).toBe(0);
  });

  it('recomputes only when the structure or a radius changes', () => {
    const { s, shrine } = fixture();
    const a = coverage(s);
    expect(coverage(s)).toBe(a);
    s.day += 1;
    touchPeople(s);
    expect(coverage(s)).toBe(a);                                        // same radii: the flood is kept
    staff(s, shrine, 0);
    const b = coverage(s);
    expect(b).not.toBe(a);
    expect(b.layers.shrine.some((v) => v === 1)).toBe(true);           // the principia still covers the castrum
    expect(b.layers.shrine[idx(OX + 2, OY + 4)]).toBe(0);
  });

  it('previews a service as if built and staffed, streets included, matching the real thing', () => {
    const s = fresh(42);
    const slot = bestSlot(s, 'lararium', { owner: 'player' })!;
    const prev = previewCoverage(s, 'lararium', slot.x, slot.y);
    expect(prev.map((p) => p.layer)).toEqual(['shrine']);
    placeBuilding(s, 'lararium', slot.tile, { ignoreCost: true });
    const b = s.buildings[s.buildings.length - 1];
    b.status = 'done';
    staff(s, b, 1);
    invalidate(s);
    const real = coverage(s).layers.shrine;
    for (let i = 0; i < N; i++) if (prev[0].tiles[i]) expect(real[i]).toBe(1);
    for (const id of prev[0].houses) expect(houseHas(s, id, 'shrine')).toBe(true);
    expect(previewCoverage(s, 'horreum', slot.x, slot.y)).toEqual([]);
  });

  it('counts the road steps from a would-be service to one house, as its preview reaches it (the ghost\'s reach hint)', () => {
    const s = fresh(42);
    const r = BUILDING_DEFS.puteus.service![0].radius;
    const homes = s.buildings.filter((b) => b.house), houses = homes.map((b) => b.id);
    const near = (t: number): number => Math.min(...homes.map((b) => Math.max(Math.abs(t % W - b.x), Math.abs(Math.floor(t / W) - b.y))));
    const slots = [...validSlots(s, 'puteus', 'player').keys()].sort((a, b) => near(a) - near(b) || a - b).slice(0, 60);   // the founders' quarter
    let reached = 0;
    for (const t of slots) {
      const x = t % W, y = Math.floor(t / W);
      const served = previewCovered(s, 'puteus', x, y)[0].houses;
      for (const id of houses) {
        const steps = previewSteps(s, 'puteus', x, y, id, r);
        expect(steps !== null, `well at ${x},${y} → house ${id}`).toBe(served.includes(id));   // within reach exactly when the preview serves it
        if (steps === null) continue;
        reached++;
        expect(steps).toBeLessThanOrEqual(r);
        if (steps > 0) expect(previewSteps(s, 'puteus', x, y, id, steps - 1)).toBeNull();     // and no fewer
      }
    }
    expect(reached).toBeGreaterThan(0);
  });
});

describe('desirability (DESIGN §7.5)', () => {
  /** Brute force: Σ v · (1 − d/(r+1)) over every source with d ≤ r, clamped. */
  function brute(s: GameState): Float32Array {
    const map = getMap(s.seed);
    const out = new Float32Array(N);
    const add = (x: number, y: number, w: number, h: number, v: number, r: number): void => {
      for (let i = 0; i < N; i++) {
        const tx = i % W, ty = Math.floor(i / W);
        const d = Math.max(Math.max(x - tx, 0, tx - (x + w - 1)), Math.max(y - ty, 0, ty - (y + h - 1)));
        if (d <= r) out[i] += v * (1 - d / (r + 1));
      }
    };
    for (let i = 0; i < N; i++) {
      if (map.terrain[i] === T.river) add(i % W, Math.floor(i / W), 1, 1, 1, 2);
      if (map.feature[i] === F.lucus) add(i % W, Math.floor(i / W), 1, 1, 3, 3);
    }
    for (const i of s.paved) add(i % W, Math.floor(i / W), 1, 1, 1, 1);
    for (const b of s.buildings) {
      if (b.status !== 'done') continue;
      const [v, r] = b.type === 'area' ? TIER_DEFS[b.house!.tier].desir
        : b.type === 'principia' ? (RANK_DEFS[s.rank].forumStage >= 3 ? [6, 6] : [4, 5]) : BUILDING_DEFS[b.type].desir;
      if (v === 0) continue;
      const [w, h] = b.type === 'principia' ? [9, 9] : b.type === 'area' ? [2, 2] : BUILDING_DEFS[b.type].size;
      add(b.x, b.y, w, h, v, r);
    }
    for (let i = 0; i < N; i++) out[i] = Math.min(30, Math.max(-20, out[i]));
    return out;
  }

  it('matches the formula on every tile', () => {
    const s = fresh(42);
    insert(s, 'hortus', OX, OY);
    insert(s, 'lapicidina', OX + 8, OY);
    house(s, OX + 2, OY + 6, 'insula');
    house(s, OX + 6, OY + 6, 'domus');
    s.paved = s.roads.slice(0, 40);
    invalidate(s);
    const d = desirability(s);
    const e = brute(s);
    for (let i = 0; i < N; i++) expect(d[i], `tile ${i}`).toBeCloseTo(e[i], 4);
  });

  it('falls off linearly with Chebyshev distance and is clamped to −20..+30', () => {
    const s = fresh(42);
    const before = desirability(s).slice();
    insert(s, 'hortus', OX + 4, OY + 4);                                // +4 / r3
    const d = desirability(s);
    expect([0, 1, 2, 3, 4].map((k) => +(d[idx(OX + 5 + k, OY + 5)] - before[idx(OX + 5 + k, OY + 5)]).toFixed(5))).toEqual([4, 3, 2, 1, 0]);
    for (let k = 0; k < 10; k++) insert(s, 'hortus', OX + 4, OY + 4);
    expect(desirability(s)[idx(OX + 4, OY + 4)]).toBe(30);
    for (let k = 0; k < 8; k++) insert(s, 'lapicidina', OX + 20, OY + 20);
    expect(desirability(s)[idx(OX + 21, OY + 21)]).toBe(-20);
  });

  it('averages a house over its four tiles and previews a work\'s influence', () => {
    const s = fresh(42);
    const h = house(s, OX + 2, OY + 2);
    insert(s, 'hortus', OX + 5, OY + 2);
    const d = desirability(s);
    const avg = (d[idx(OX + 2, OY + 2)] + d[idx(OX + 3, OY + 2)] + d[idx(OX + 2, OY + 3)] + d[idx(OX + 3, OY + 3)]) / 4;
    expect(houseDesir(s, h.id)).toBeCloseTo(avg, 6);
    const p = previewDesir(s, 'templum', 50, 60);
    expect(p.length).toBe((4 + 10) * (4 + 10));
    expect(p.find((t) => t.tile === idx(50, 60))?.v).toBe(6);
    expect(p.find((t) => t.tile === idx(45, 60))?.v).toBeCloseTo(1, 9);
    expect(previewDesir(s, 'area', 50, 60)).toEqual([]);
  });

  it('follows the tiers of the insulae and domus without a structure change', () => {
    const s = fresh(42);
    const h = house(s, OX + 2, OY + 2, 'casa');
    const a = houseDesir(s, h.id);
    h.house!.tier = 'domus';
    s.day += 1;                                                        // the tier signature is read once a day
    expect(houseDesir(s, h.id)).toBeCloseTo(a + 1, 6);
  });
});

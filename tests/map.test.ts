// tests/map.test.ts — map generation: 200-seed guarantees, survey geometry, determinism, speed (ARCHITECTURE §14.2 WP-A).
import { describe, expect, it } from 'vitest';
import { F, T } from '../src/game/types';
import type { GameState, WorldMap } from '../src/game/types';
import { H, W, getMap, idx, tx, ty } from '../src/game/map';
import { activeRings, blockStreets, isActiveBlock } from '../src/game/survey';
import { validSlots } from '../src/game/place';
import { invalidate } from '../src/game/memo';
import { genTerrain } from '../src/game/world/gen';
import { B } from '../src/game/balance';
import { RANK_DEFS } from '../src/game/data/ranks';
import { fresh } from './util';

const N = W * H;

/** Greedy count of non-overlapping footprints among origin tiles (scan order). */
function packed(origins: Iterable<number>, w: number, h: number, taken = new Uint8Array(N)): number {
  let n = 0;
  for (const o of [...origins].sort((a, b) => a - b)) {
    const x = tx(o), y = ty(o);
    let free = true;
    for (let dy = 0; dy < h && free; dy++) for (let dx = 0; dx < w && free; dx++) if (taken[idx(x + dx, y + dy)]) free = false;
    if (!free) continue;
    n++;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) taken[idx(x + dx, y + dy)] = 1;
  }
  return n;
}

function atRank(s: GameState, rank: 0 | 1 | 2 | 3 | 4): GameState {
  s.rank = rank;
  invalidate(s);
  return s;
}

describe('map guarantees (DESIGN §3.3 step 8) over 200 seeds', () => {
  it('every seed has farms, a quarry, a lumber camp, clay, ore, a reachable spring and the via to the edge', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const s = fresh(seed);
      const map = getMap(seed);
      const sv = map.survey;
      const why: string[] = [];
      // ≥ 25 fields in Castra territory, off every surveyed block and street, with a road (the start field counts)
      const farms = validSlots(atRank(s, 0), 'ager', 'ordo');
      const startField = s.buildings.find((b) => b.type === 'ager');
      const taken = new Uint8Array(N);
      if (startField) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) taken[idx(startField.x + dx, startField.y + dy)] = 1;
      const nFarms = packed(farms.keys(), 3, 3, taken) + (startField ? 1 : 0);
      if (nFarms < B.map.FARM_SITES_MIN) why.push(`farms ${nFarms}`);
      if (validSlots(s, 'lapicidina', 'ordo').size === 0) why.push('quarry');
      if (validSlots(s, 'lignarius', 'ordo').size === 0) why.push('lumber');
      if (validSlots(atRank(s, 1), 'figlina', 'ordo').size === 0) why.push('clay');
      if (validSlots(atRank(s, 2), 'fodina', 'ordo').size === 0) why.push('ore');
      if (validSlots(atRank(s, 3), 'castellum', 'player').size === 0) why.push('fons');
      const last = sv.via[sv.via.length - 1];
      if (tx(last) !== 0 && tx(last) !== W - 1) why.push('via');
      for (const i of sv.bridge) if (map.terrain[i] !== T.river || !sv.via.includes(i)) why.push('bridge');
      if (why.length > 0) bad.push(`${seed}: ${why.join(', ')}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('terrain', () => {
  const seeds = [1, 2, 3, 42, 1337];

  it('is deterministic per seed (regenerated after the cache evicts it)', () => {
    const a = getMap(77);
    const copy = { terrain: a.terrain.slice(), feature: a.feature.slice(), vein: a.vein.slice(), startAger: { ...a.startAger }, ix: a.survey.ix, iy: a.survey.iy };
    for (let k = 0; k < 6; k++) getMap(500 + k);
    const b = getMap(77);
    expect(b).not.toBe(a);
    expect(Array.from(b.terrain)).toEqual(Array.from(copy.terrain));
    expect(Array.from(b.feature)).toEqual(Array.from(copy.feature));
    expect(Array.from(b.vein)).toEqual(Array.from(copy.vein));
    expect(b.startAger).toEqual(copy.startAger);
    expect([b.survey.ix, b.survey.iy]).toEqual([copy.ix, copy.iy]);
  });

  it('has every terrain class, and woods with their timber', () => {
    for (const seed of seeds) {
      const m = getMap(seed);
      const count = new Array(10).fill(0);
      for (let i = 0; i < N; i++) count[m.terrain[i]]++;
      for (let t = 0; t <= T.river; t++) expect(count[t], `seed ${seed} terrain ${t}`).toBeGreaterThan(0);
      for (let i = 0; i < N; i++) {
        const t = m.terrain[i];
        expect(m.woodMax[i]).toBe(t === T.forest ? B.map.WOOD_FOREST : t === T.dense ? B.map.WOOD_DENSE : 0);
      }
    }
  });

  it('runs one N4-connected river from edge to edge, banked with loam', () => {
    for (const seed of seeds) {
      const m = getMap(seed);
      const river: number[] = [];
      for (let i = 0; i < N; i++) if (m.terrain[i] === T.river) river.push(i);
      const seen = new Set([river[0]]);
      const q = [river[0]];
      for (let k = 0; k < q.length; k++) {
        const i = q[k];
        for (const j of [i - W, i + W, tx(i) > 0 ? i - 1 : -1, tx(i) < W - 1 ? i + 1 : -1]) {
          if (j >= 0 && j < N && m.terrain[j] === T.river && !seen.has(j)) { seen.add(j); q.push(j); }
        }
      }
      expect(seen.size, `seed ${seed}`).toBe(river.length);
      const touches = (pred: (i: number) => boolean): boolean => river.some(pred);
      const ns = touches((i) => ty(i) === 0) && touches((i) => ty(i) === H - 1);
      const ew = touches((i) => tx(i) === 0) && touches((i) => tx(i) === W - 1);
      expect(ns || ew, `seed ${seed}`).toBe(true);
      for (let i = 0; i < N; i++) {
        if (m.riverDist[i] >= 1 && m.riverDist[i] <= B.map.RIVER_LOAM && m.terrain[i] !== T.rock && m.terrain[i] !== T.crag) {
          expect(m.terrain[i], `seed ${seed} tile ${i}`).toBe(T.loam);
        }
      }
    }
  });

  it('places springs, ore veins, one lucus, ruins and clay banks by the DESIGN §3.2 rules', () => {
    for (const seed of seeds) {
      const m = getMap(seed);
      const c = m.survey.castrum;
      const dist = (i: number): number => Math.max(Math.max(c.x - tx(i), 0, tx(i) - (c.x + c.w - 1)), Math.max(c.y - ty(i), 0, ty(i) - (c.y + c.h - 1)));
      const tiles = (f: number): number[] => { const o: number[] = []; for (let i = 0; i < N; i++) if (m.feature[i] === f) o.push(i); return o; };
      expect(m.fontes.length).toBeGreaterThanOrEqual(1);
      expect(m.fontes.length).toBeLessThanOrEqual(2);
      expect(tiles(F.fons)).toEqual(m.fontes);
      for (const f of m.fontes) {
        expect(m.terrain[f]).toBe(T.hills);
        expect(dist(f)).toBeGreaterThanOrEqual(B.map.GEN.FONS_DIST[0]);
        expect(dist(f)).toBeLessThanOrEqual(B.map.GEN.FONS_DIST[1]);
      }
      const ore = tiles(F.ore);
      expect(ore.length).toBeGreaterThanOrEqual(2 * B.map.GEN.VEIN_TILES[0] - 2);
      expect(ore.length).toBeLessThanOrEqual(B.map.GEN.ORE_VEINS * B.map.GEN.VEIN_TILES[1]);
      for (const i of ore) {
        expect([T.hills, T.rock]).toContain(m.terrain[i]);
        expect(m.vein[i]).toBeGreaterThanOrEqual(B.map.GEN.VEIN_QUALITY[0]);
        expect(m.vein[i]).toBeLessThanOrEqual(B.map.GEN.VEIN_QUALITY[1]);
      }
      const lucus = tiles(F.lucus);
      expect(lucus.length).toBe(1);
      expect(dist(lucus[0])).toBeGreaterThanOrEqual(B.map.GEN.LUCUS_DIST[0]);
      expect(dist(lucus[0])).toBeLessThanOrEqual(B.map.GEN.LUCUS_DIST[1]);
      const ruins = tiles(F.ruins);
      expect(ruins.length).toBeGreaterThanOrEqual(1);
      for (const i of ruins) expect(dist(i)).toBeLessThanOrEqual(B.map.GEN.RUINS_DIST[1]);
      const clay = tiles(F.clay);
      expect(clay.length).toBeGreaterThan(0);
      for (const i of clay) expect(m.riverDist[i]).toBe(1);
      const r = m.survey.interior;
      for (let i = 0; i < N; i++) {
        const camp = i % m.W >= r.x && i % m.W < r.x + r.w && Math.floor(i / m.W) >= r.y && Math.floor(i / m.W) < r.y + r.h;   // wells inside the walls draw in full
        expect(m.waterTable[i]).toBe(camp || m.riverDist[i] <= B.map.WATER_TABLE_DIST || m.moist[i] > B.map.WATER_TABLE_MOIST ? 1 : 0);
      }
    }
  });

  it('puts the start field on fertile land off the survey and the future rings', () => {
    for (const seed of seeds) {
      const m = getMap(seed);
      const sv = m.survey;
      const { x, y } = m.startAger;
      let fertile = 0;
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const i = idx(x + dx, y + dy);
          if ([T.grass, T.meadow, T.loam, T.scrub].includes(m.terrain[i] as 0 | 1 | 2 | 3)) fertile++;
          expect(sv.street[i], `seed ${seed}`).toBe(0);
          const b = sv.blockAt[i];
          if (b >= 0) expect(sv.blocks[b].masked, `seed ${seed}`).toBe(true);
        }
      }
      expect(fertile).toBeGreaterThanOrEqual(B.site.AGER_FERTILE);
    }
  });

  it('generates a map in ≤ 40 ms (node)', () => {
    genTerrain(9999);                                    // warm up the JIT
    const times: number[] = [];
    for (let seed = 3001; seed <= 3012; seed++) {
      const t0 = performance.now();
      getMap(seed);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThanOrEqual(40);
  });
});

describe('survey geometry (ARCHITECTURE §8.2)', () => {
  const map: WorldMap = getMap(42);
  const sv = map.survey;
  const { ix, iy } = sv;

  it('lays out the castrum, forum, Area Capitolina, wall, gates and fossa', () => {
    expect(sv.castrum).toEqual({ x: ix - 4, y: iy - 4, w: 39, h: 29 });
    expect(sv.interior).toEqual({ x: ix, y: iy, w: 31, h: 21 });
    expect(sv.forum).toEqual({ x: ix + 11, y: iy + 6, w: 9, h: 9 });
    expect(sv.capitolium).toEqual({ x: ix + 11, y: iy + 1, w: 9, h: 4 });
    const gate = (id: string): number => sv.gates.find((g) => g.id === id)?.tile ?? -1;
    const [west, east] = [idx(ix - 1, iy + 10), idx(ix + 31, iy + 10)];
    expect(gate('praetoria')).toBe(sv.viaDir === 'W' ? west : east);
    expect(gate('decumana')).toBe(sv.viaDir === 'W' ? east : west);
    expect(gate('principalisN')).toBe(idx(ix + 15, iy - 1));
    expect(gate('principalisS')).toBe(idx(ix + 15, iy + 21));
    for (const g of sv.gates) expect(sv.wall[g.tile]).toBe(2);
    for (const k of [2, 3, 4]) {
      expect(sv.fossa[idx(ix - k, iy + 5)]).toBe(1);
      expect(sv.fossa[idx(ix - k, iy + 10)]).toBe(0);                         // causeway
      expect(sv.street[idx(ix - k, iy + 10)]).toBe(1);
      expect(sv.streetRing[idx(ix + 15, iy - k)]).toBe(0);
    }
    for (const i of sv.sacredWay) expect(sv.street[i]).toBe(0);
    expect(sv.sacredWay.length).toBe(4);
  });

  it('has 24 + 32 + 40 blocks; 18 interior blocks are urban at Castra', () => {
    expect(sv.blocks.length).toBe(96);
    expect(sv.blocks.filter((b) => b.ring === 0).length).toBe(24);
    expect(sv.blocks.filter((b) => b.ring === 1).length).toBe(32);
    expect(sv.blocks.filter((b) => b.ring === 2).length).toBe(40);
    expect(sv.blocks.filter((b) => isActiveBlock(sv, b, 0)).length).toBe(18);
    expect(activeRings(2)).toEqual([0, 1, 2]);
    for (const b of sv.blocks) {
      expect(sv.blocks[b.id]).toBe(b);
      if (b.ring === 0) expect(b.masked).toBe(false);
      if (!b.masked) for (const i of blockStreets(sv, b)) expect(sv.street[i]).toBe(1);
    }
    expect(sv.blocks.filter((b) => b.reserved === 'forum').length).toBe(4);
    expect(sv.blocks.filter((b) => b.reserved === 'capitolium').length).toBe(2);
  });

  it('masks blocks on river, rock, crag, the grove, ruins or more than four loam tiles', () => {
    for (const seed of [1, 2, 3, 42]) {
      const m = getMap(seed);
      for (const b of m.survey.blocks) {
        let bad = false, loam = 0;
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            const x = b.x + dx, y = b.y + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) { bad = true; continue; }
            const i = idx(x, y);
            if ([T.river, T.crag, T.rock].includes(m.terrain[i] as 7 | 8 | 9) || m.feature[i] === F.lucus || m.feature[i] === F.ruins) bad = true;
            if (m.terrain[i] === T.loam) loam++;
          }
        }
        expect(b.masked, `seed ${seed} block ${b.id}`).toBe(bad || loam > B.map.LOAM_MASK);
      }
    }
  });

  it('runs the via from the Porta Praetoria to the map edge, bridging the river', () => {
    const cy = iy + 10;
    for (const i of sv.via) expect(ty(i)).toBe(cy);
    const dir = sv.viaDir === 'W' ? -1 : 1;
    expect(tx(sv.via[0])).toBe(sv.viaDir === 'W' ? ix - 2 : ix + 32);
    for (let k = 1; k < sv.via.length; k++) expect(tx(sv.via[k]) - tx(sv.via[k - 1])).toBe(dir);
    expect(sv.bridge.every((i) => map.terrain[i] === T.river)).toBe(true);
  });

  it('widens the territory with the ranks', () => {
    expect(RANK_DEFS.map((r) => r.territory)).toEqual([20, 26, 34, 44, 999]);
  });
});

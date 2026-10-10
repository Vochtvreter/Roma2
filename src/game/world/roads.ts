// src/game/world/roads.ts — auto-roads, block streets, aqueduct routes and felling on the live state (DESIGN §3.4, §3.7,
// §3.8, §5.3). Owner: WP-A. The cost fields are memoised on the structure epoch: one Dijkstra from the road network
// (or from the free springs) serves every footprint until something is built.
import { B } from '../balance';
import { F } from '../types';
import type { GameState } from '../types';
import { getMap, woodAt } from '../map';
import { derived } from '../derived';
import { blockStreets, isFutureBlock } from '../survey';
import { memo, structEpoch } from '../memo';
import { GN, GW, forN4, onGrid } from './grid';
import { bfsField, costField, walkBack } from './search';
import type { CostField, StepField } from './search';
import { aqueductCostT, roadCostT } from './rules';

const M = B.map;
// Aqueduct steps not listed in DESIGN §3.8 (TODO(balance): move to B.map.AQUEDUCT_COST).
const AQ_WALL = 2;            // over the vallum or the fossa into the castrum
const AQ_PLOT = 3;            // across an unbuilt surveyed plot (routes keep to the streets where they can)

/** True on a lucus, ruins or spring tile: no road, no aqueduct pier, no building. */
export function isSacredTile(feature: ArrayLike<number>, i: number): boolean {
  const f = feature[i];
  return f === F.lucus || f === F.ruins || f === F.fons;
}

/** Road step cost of every tile on the live state (DESIGN §3.7); Infinity where a road may not run. */
function roadSteps(s: GameState): Float64Array {
  const map = getMap(s.seed);
  const sv = map.survey;
  const d = derived(s);
  const c = sv.castrum;
  const step = new Float64Array(GN);
  for (let i = 0; i < GN; i++) {
    const x = i % GW, y = (i - x) / GW;
    const b = sv.blockAt[i];
    const inCastrum = x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h;
    if (d.buildingAt[i] !== 0 || isSacredTile(map.feature, i) || (inCastrum && d.road[i] === 0)
      || (d.pomerium[i] === 1 && sv.street[i] === 0)) step[i] = Infinity;
    else if (sv.street[i] === 1) step[i] = M.ROAD_COST.street;
    else if (b >= 0 && isFutureBlock(sv, sv.blocks[b], s.rank)) step[i] = M.ROAD_COST.futureBlock;
    else step[i] = roadCostT(map.terrain[i]);
  }
  return step;
}

/** A cost field paired with a breadth-first field over the same tiles: the cheapest path when it fits the tile cap, else the shortest. */
export interface Reach { cost: CostField; bfs: StepField; max: number }

function reachFrom(sources: number[], step: Float64Array, max: number, steps0: number): Reach {
  const pass = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) pass[i] = step[i] < Infinity ? 1 : 0;
  return { cost: costField(sources, step, max, steps0), bfs: bfsField(sources, pass, max, steps0), max };
}

/** Best side tile of a w×h footprint: the cheapest by cost, else the nearest by steps; −1 when none is reachable. */
function bestSide(r: Reach, x: number, y: number, w: number, h: number): { tile: number; cheap: boolean } {
  let best = -1, near = -1;
  const consider = (i: number): void => {
    const c = r.cost.cost[i];
    if (c < Infinity && (best < 0 || c < r.cost.cost[best] || (c === r.cost.cost[best] && i < best))) best = i;
    const k = r.bfs.steps[i];
    if (k <= r.max && (near < 0 || k < r.bfs.steps[near] || (k === r.bfs.steps[near] && i < near))) near = i;
  };
  for (let px = x; px < x + w; px++) {
    if (onGrid(px, y - 1)) consider((y - 1) * GW + px);
    if (onGrid(px, y + h)) consider((y + h) * GW + px);
  }
  for (let py = y; py < y + h; py++) {
    if (onGrid(x - 1, py)) consider(py * GW + x - 1);
    if (onGrid(x + w, py)) consider(py * GW + x + w);
  }
  return best >= 0 ? { tile: best, cheap: true } : { tile: near, cheap: false };
}

/** Dirt-road connections of every tile to the built network, ≤ ROAD_MAX new tiles (memo on structEpoch). */
export function roadField(s: GameState): Reach {
  return memo(s, 'roadField', structEpoch(s), () => {
    const road = derived(s).road;
    const net: number[] = [];
    for (let i = 0; i < GN; i++) if (road[i] > 0) net.push(i);
    return reachFrom(net, roadSteps(s), M.ROAD_MAX, 0);
  });
}

/** True when a tile is on the network or can be joined to it by an auto-road. */
export function roadReachable(s: GameState, i: number): boolean {
  return roadField(s).bfs.steps[i] <= M.ROAD_MAX;
}

/** New road tiles joining a w×h rural footprint at (x, y) to the network from its best side tile; [] if it touches; null if cut off. */
export function autoRoad(s: GameState, x: number, y: number, w: number, h: number): number[] | null {
  const f = roadField(s);
  const side = bestSide(f, x, y, w, h);
  if (side.tile < 0) return null;
  const path = walkBack(side.cheap ? f.cost : f.bfs, side.tile);
  path.pop();                                              // the network tile it joins
  return path.sort((a, b) => a - b);
}

/** A block's unbuilt street sides plus the shortest connection along survey streets to the network (new tiles, sorted). */
export function blockStreetTiles(s: GameState, blockId: number): number[] {
  const sv = getMap(s.seed).survey;
  const blk = sv.blocks[blockId];
  if (!blk) return [];
  const road = derived(s).road;
  const sides = blockStreets(sv, blk);
  const out = new Set<number>(sides.filter((i) => road[i] === 0));
  if (!sides.some((i) => road[i] > 0)) {
    const prev = new Int32Array(GN).fill(-2);
    const q: number[] = [];
    for (const i of sides) { prev[i] = -1; q.push(i); }
    let hit = -1;
    for (let k = 0; k < q.length && hit < 0; k++) {
      forN4(q[k], (j) => {
        if (hit >= 0 || prev[j] !== -2 || sv.street[j] !== 1) return;
        prev[j] = q[k];
        if (road[j] > 0) hit = j; else q.push(j);
      });
    }
    for (let i = hit >= 0 ? prev[hit] : -1; i >= 0; i = prev[i]) if (road[i] === 0) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/** Aqueduct step cost of every tile on the live state (DESIGN §3.8). */
function aqueductSteps(s: GameState): Float64Array {
  const map = getMap(s.seed);
  const sv = map.survey;
  const d = derived(s);
  const step = new Float64Array(GN);
  for (let i = 0; i < GN; i++) {
    const b = sv.blockAt[i];
    if (d.buildingAt[i] !== 0 || d.reservedTile[i] === 1 || (isSacredTile(map.feature, i) && map.feature[i] !== F.fons)) step[i] = Infinity;
    else if (d.road[i] > 0) step[i] = M.AQUEDUCT_COST.road;
    else if (sv.wall[i] || sv.fossa[i]) step[i] = AQ_WALL;
    else if (b >= 0 && !sv.blocks[b].masked) step[i] = AQ_PLOT;
    else step[i] = aqueductCostT(map.terrain[i]);
  }
  return step;
}

/** Aqueducts from any free spring (one castellum per spring) to every tile, ≤ AQUEDUCT_MAX tiles (memo on structEpoch). */
export function aqueductField(s: GameState): Reach {
  return memo(s, 'aqueductField', structEpoch(s), () => {
    const map = getMap(s.seed);
    const used = new Set<number>();
    for (const b of s.buildings) if (b.type === 'castellum' && b.route && b.route.length > 0) used.add(b.route[0]);
    const taken = derived(s).buildingAt;
    const free = map.fontes.filter((f) => !used.has(f) && taken[f] === 0);
    return reachFrom(free, aqueductSteps(s), M.AQUEDUCT_MAX, 1);
  });
}

/** The aqueduct route (spring first) to a side tile of a 2×2 castellum at (x, y), or null when no free spring is in reach. */
export function aqueductRoute(s: GameState, x: number, y: number, w: number, h: number): { fons: number; tiles: number[] } | null {
  const f = aqueductField(s);
  const side = bestSide(f, x, y, w, h);
  if (side.tile < 0) return null;
  const tiles = walkBack(side.cheap ? f.cost : f.bfs, side.tile).reverse();
  return { fons: tiles[0], tiles };
}

/** Standing timber on the tiles (felling yield). */
export function standingTimber(s: GameState, tiles: readonly number[]): number {
  let t = 0;
  for (const i of tiles) t += woodAt(s, i);
  return t;
}

/** Fells the standing timber on the tiles into the stores (`s.wood[i] = 0`); returns the timber gained. */
export function fell(s: GameState, tiles: readonly number[]): number {
  let got = 0;
  for (const i of tiles) {
    const w = woodAt(s, i);
    if (w <= 0) continue;
    got += w;
    s.wood[i] = 0;
  }
  s.res.timber += got;
  return got;
}

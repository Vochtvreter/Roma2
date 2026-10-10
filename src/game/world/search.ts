// src/game/world/search.ts — Dijkstra cost fields over the tile grid (auto-roads, aqueduct routes). Owner: WP-A.
// One multi-source search fills the whole field, so every footprint can then read its cheapest connection in O(1)
// and walk it back to the source. Deterministic: the heap breaks priority ties by the lower tile index.
import { GN as GN$, GW as GW$ } from './grid';
import { MinHeap as MinHeap$ } from './heap';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const GN = GN$, GW = GW$, MinHeap = MinHeap$;

/** Result of a multi-source search: path cost, path length in tiles and the next tile toward the source. */
export interface CostField {
  cost: Float64Array;      // Infinity where unreachable
  steps: Uint16Array;      // tiles on the path from the tile to its source (the source's own value is `steps0`)
  prev: Int32Array;        // next tile toward the source, −1 at a source
}

/**
 * Dijkstra from `sources` (cost 0) over N4 moves; entering tile j costs `step[j]` (Infinity = impassable).
 * A path is not extended beyond `maxSteps` tiles. `steps0` is the length credited to a source tile itself.
 */
export function costField(sources: ArrayLike<number>, step: ArrayLike<number>, maxSteps: number, steps0 = 0): CostField {
  const cost = new Float64Array(GN).fill(Infinity);
  const steps = new Uint16Array(GN);
  const prev = new Int32Array(GN).fill(-1);
  const heap = new MinHeap();
  for (let k = 0; k < sources.length; k++) {
    const s = sources[k];
    if (cost[s] === 0) continue;
    cost[s] = 0;
    steps[s] = steps0;
    heap.push(s, 0);
  }
  const relax = (i: number, j: number, ns: number): void => {
    const nd = cost[i] + step[j];
    if (nd < cost[j]) {
      cost[j] = nd;
      steps[j] = ns;
      prev[j] = i;
      heap.push(j, nd);
    }
  };
  while (heap.size > 0) {
    const pri = heap.peekPri();
    const i = heap.pop();
    if (pri > cost[i]) continue;
    const ns = steps[i] + 1;
    if (ns > maxSteps) continue;
    const x = i % GW;
    if (i >= GW) relax(i, i - GW, ns);
    if (x < GW - 1) relax(i, i + 1, ns);
    if (i < GN - GW) relax(i, i + GW, ns);
    if (x > 0) relax(i, i - 1, ns);
  }
  return { cost, steps, prev };
}

/** The tiles from `start` back to its source, both included (along a cost field or a breadth-first field). */
export function walkBack(f: { prev: Int32Array }, start: number): number[] {
  const out: number[] = [];
  for (let i = start; i >= 0; i = f.prev[i]) out.push(i);
  return out;
}

/** Breadth-first result: path length in tiles (0xffff where unreached) and the next tile toward the source. */
export interface StepField { steps: Uint16Array; prev: Int32Array }

/** Breadth-first path lengths (sources count `steps0`) from `sources` over passable tiles, up to `maxSteps`. */
export function bfsField(sources: ArrayLike<number>, passable: ArrayLike<number>, maxSteps: number, steps0 = 0): StepField {
  const d = new Uint16Array(GN).fill(0xffff);
  const prev = new Int32Array(GN).fill(-1);
  const q = new Int32Array(GN);
  let head = 0, tail = 0;
  for (let k = 0; k < sources.length; k++) {
    const s = sources[k];
    if (d[s] !== 0xffff) continue;
    d[s] = steps0;
    q[tail++] = s;
  }
  const visit = (i: number, j: number, nd: number): void => {
    if (passable[j] && d[j] === 0xffff) { d[j] = nd; prev[j] = i; q[tail++] = j; }
  };
  while (head < tail) {
    const i = q[head++];
    const nd = d[i] + 1;
    if (nd > maxSteps) continue;
    const x = i % GW;
    if (i >= GW) visit(i, i - GW, nd);
    if (x < GW - 1) visit(i, i + 1, nd);
    if (i < GN - GW) visit(i, i + GW, nd);
    if (x > 0) visit(i, i - 1, nd);
  }
  return { steps: d, prev };
}

/** Breadth-first path lengths only (see bfsField). */
export function stepField(sources: ArrayLike<number>, passable: ArrayLike<number>, maxSteps: number, steps0 = 0): Uint16Array {
  return bfsField(sources, passable, maxSteps, steps0).steps;
}

// src/game/world/grid.ts — tile-grid helpers shared by generation, placement, roads and scoring. Owner: WP-A.
// Pure functions over the fixed 112 × 84 grid (B.map.W × B.map.H); no game state.
import { B } from '../balance';
import type { Rect } from '../types';

/** Grid width in tiles. */
export const GW: number = B.map.W;
/** Grid height in tiles. */
export const GH: number = B.map.H;
/** Number of tiles. */
export const GN: number = GW * GH;

/** True when (x, y) is on the grid. */
export function onGrid(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GW && y < GH;
}

/** Chebyshev distance from (x, y) to a w×h rect at (rx, ry) (0 inside). */
export function chebToRect(x: number, y: number, rx: number, ry: number, rw: number, rh: number): number {
  const dx = Math.max(rx - x, 0, x - (rx + rw - 1));
  const dy = Math.max(ry - y, 0, y - (ry + rh - 1));
  return Math.max(dx, dy);
}

/** Chebyshev gap between two rects (0 when they touch or overlap… 1 when one tile apart diagonally or orthogonally). */
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w - 1), 0, a.x - (b.x + b.w - 1));
  const dy = Math.max(b.y - (a.y + a.h - 1), 0, a.y - (b.y + b.h - 1));
  return Math.max(dx, dy);
}

/** Tiles of a rect clipped to the grid, row by row. */
export function rectTiles(x: number, y: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let ty = Math.max(0, y); ty < Math.min(GH, y + h); ty++) {
    for (let tx = Math.max(0, x); tx < Math.min(GW, x + w); tx++) out.push(ty * GW + tx);
  }
  return out;
}

/** The N4 "side" tiles around a w×h footprint (its ring without the four corners), clockwise from the top; off-grid skipped. */
export function sideTiles(x: number, y: number, w: number, h: number): number[] {
  const out: number[] = [];
  const add = (px: number, py: number): void => { if (onGrid(px, py)) out.push(py * GW + px); };
  for (let px = x; px < x + w; px++) add(px, y - 1);
  for (let py = y; py < y + h; py++) add(x + w, py);
  for (let px = x + w - 1; px >= x; px--) add(px, y + h);
  for (let py = y + h - 1; py >= y; py--) add(x - 1, py);
  return out;
}

/** True when some on-grid side tile (N4 ring, no corners) of a w×h footprint passes `pred`; allocation-free. */
export function anySide(x: number, y: number, w: number, h: number, pred: (i: number) => boolean): boolean {
  for (let px = x; px < x + w; px++) {
    if (px < 0 || px >= GW) continue;
    if (y - 1 >= 0 && pred((y - 1) * GW + px)) return true;
    if (y + h < GH && pred((y + h) * GW + px)) return true;
  }
  for (let py = y; py < y + h; py++) {
    if (py < 0 || py >= GH) continue;
    if (x - 1 >= 0 && pred(py * GW + x - 1)) return true;
    if (x + w < GW && pred(py * GW + x + w)) return true;
  }
  return false;
}

/** Chebyshev distance of every tile to a rect (0 inside), capped at 255. */
export function rectDistances(r: Rect): Uint8Array {
  const d = new Uint8Array(GN);
  for (let y = 0; y < GH; y++) {
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h - 1));
    for (let x = 0; x < GW; x++) {
      const dx = Math.max(r.x - x, 0, x - (r.x + r.w - 1));
      d[y * GW + x] = Math.min(255, Math.max(dx, dy));
    }
  }
  return d;
}

/** Calls `fn` for each on-grid N4 neighbour of tile i. */
export function forN4(i: number, fn: (j: number) => void): void {
  const x = i % GW;
  if (i >= GW) fn(i - GW);
  if (x < GW - 1) fn(i + 1);
  if (i < GN - GW) fn(i + GW);
  if (x > 0) fn(i - 1);
}

/** 2-D prefix sums over a per-tile value: O(1) sums of any rect (clipped to the grid). */
export class PrefixSum {
  private readonly s: Float64Array;

  /** Builds the table from per-tile values (any numeric array of length GN). */
  constructor(values: ArrayLike<number>) {
    const s = new Float64Array((GW + 1) * (GH + 1));
    for (let y = 0; y < GH; y++) {
      let row = 0;
      for (let x = 0; x < GW; x++) {
        row += values[y * GW + x];
        s[(y + 1) * (GW + 1) + x + 1] = s[y * (GW + 1) + x + 1] + row;
      }
    }
    this.s = s;
  }

  /** Sum over the w×h rect at (x, y), clipped to the grid. */
  sum(x: number, y: number, w: number, h: number): number {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(GW, x + w), y1 = Math.min(GH, y + h);
    if (x1 <= x0 || y1 <= y0) return 0;
    const S = this.s, R = GW + 1;
    return S[y1 * R + x1] - S[y0 * R + x1] - S[y1 * R + x0] + S[y0 * R + x0];
  }
}

/** A 0/1 mask from a per-tile predicate. */
export function maskOf(pred: (i: number) => boolean): Uint8Array {
  const m = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) if (pred(i)) m[i] = 1;
  return m;
}

/** Chebyshev distance of every tile to the nearest marked tile (multi-source BFS, capped at 255). */
export function chebDistance(marked: ArrayLike<number>): Uint8Array {
  const d = new Uint8Array(GN).fill(255);
  const q: number[] = [];
  for (let i = 0; i < GN; i++) if (marked[i]) { d[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const nd = d[i] + 1;
    if (nd >= 255) continue;
    const x = i % GW, y = (i - x) / GW;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx === 0 && dy === 0) || !onGrid(nx, ny)) continue;
        const j = ny * GW + nx;
        if (d[j] > nd) { d[j] = nd; q.push(j); }
      }
    }
  }
  return d;
}

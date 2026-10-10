// src/render/art/brush.ts — a palette-key pixel painter for the procedural sprites of WP-G2 (rural, procedural, nature).
// Owner: WP-G (art, part 2). Procedural art is painted into a grid of PAL keys (never raw colours), so every
// pixel stays inside DESIGN §16.2's palette and the grids can be checked headless. Rasterising happens lazily
// inside registerDraw (no canvas work at registration), with the §12.3 `k` outline applied on request.
import { PAL, outline, raster, registerDraw } from '../sprites';
import type { Grid } from '../sprites';

/** One PAL key ('.' = transparent); `null` in a shader means "leave the pixel as it is". */
export type Key = string;

/** A deterministic hash of two integers to [0, 1) (stable dither; no Math.random in art). */
export function noise(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A mutable grid of PAL keys with the handful of primitives the procedural art needs. */
export class Pix {
  readonly w: number;
  readonly h: number;
  private readonly px: string[];

  constructor(w: number, h: number, fill: Key = '.') {
    this.w = w;
    this.h = h;
    this.px = new Array<string>(w * h).fill(fill);
  }

  /** The key at (x, y), '.' outside. */
  get(x: number, y: number): Key {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? '.' : this.px[y * this.w + x];
  }

  /** Sets one pixel (ignored outside the grid or when `k` is null). */
  set(x: number, y: number, k: Key | null): this {
    x = Math.round(x);
    y = Math.round(y);
    if (k !== null && x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = k;
    return this;
  }

  /** A filled rectangle. */
  rect(x: number, y: number, w: number, h: number, k: Key): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, k);
    return this;
  }

  /** A filled rectangle with a 1 px border of `edge`. */
  box(x: number, y: number, w: number, h: number, fill: Key, edge: Key = 'k'): this {
    this.rect(x, y, w, h, edge);
    return w > 2 && h > 2 ? this.rect(x + 1, y + 1, w - 2, h - 2, fill) : this;
  }

  /** A horizontal run from x0 to x1 inclusive. */
  hline(x0: number, x1: number, y: number, k: Key): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, k);
    return this;
  }

  /** A vertical run from y0 to y1 inclusive. */
  vline(x: number, y0: number, y1: number, k: Key): this {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, k);
    return this;
  }

  /** A Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, k: Key): this {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, k);
      if (x0 === x1 && y0 === y1) return this;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** A filled ellipse centred on (cx, cy) (half-pixel centres allowed). */
  ellipse(cx: number, cy: number, rx: number, ry: number, k: Key): this {
    return this.shade(Math.floor(cx - rx), Math.floor(cy - ry), Math.ceil(rx * 2) + 2, Math.ceil(ry * 2) + 2, (x, y) => {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      return nx * nx + ny * ny <= 1 ? k : null;
    });
  }

  /** A filled triangle. */
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, k: Key): this {
    const x0 = Math.floor(Math.min(ax, bx, cx)), x1 = Math.ceil(Math.max(ax, bx, cx));
    const y0 = Math.floor(Math.min(ay, by, cy)), y1 = Math.ceil(Math.max(ay, by, cy));
    const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
      (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    return this.shade(x0, y0, x1 - x0 + 1, y1 - y0 + 1, (x, y) => {
      const px = x + 0.5, py = y + 0.5;
      const d1 = side(px, py, ax, ay, bx, by), d2 = side(px, py, bx, by, cx, cy), d3 = side(px, py, cx, cy, ax, ay);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      return neg && pos ? null : k;
    });
  }

  /** Runs a shader over a region (whole grid by default); it returns the new key or null to keep the pixel. */
  shade(x: number, y: number, w: number, h: number, fn: (x: number, y: number, cur: Key) => Key | null): this {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < this.w && j < this.h) this.set(i, j, fn(i, j, this.get(i, j)));
    return this;
  }

  /** Replaces keys inside a region by a map (e.g. a seasonal recolour). */
  recolor(map: Readonly<Record<string, Key>>, x = 0, y = 0, w = this.w, h = this.h): this {
    return this.shade(x, y, w, h, (_x, _y, cur) => map[cur] ?? null);
  }

  /** Stamps a grid (or another Pix) with its top-left at (x, y); '.' stays transparent. Optionally mirrored. */
  stamp(src: Grid | Pix, x: number, y: number, flip = false): this {
    const rows = src instanceof Pix ? src.rows() : src;
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const k = row[flip ? row.length - 1 - i : i];
        if (k !== '.' && k !== ' ') this.set(x + i, y + j, k);
      }
    });
    return this;
  }

  /** Paints `k` into every transparent pixel 4-adjacent to an opaque one (a hand-tinted outline, e.g. dark green on trees). */
  rim(k: Key): this {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== '.') continue;
        const o = (i: number, j: number): boolean => this.get(i, j) !== '.' && this.get(i, j) !== k;
        if (o(x - 1, y) || o(x + 1, y) || o(x, y - 1) || o(x, y + 1)) add.push(y * this.w + x);
      }
    for (const i of add) this.px[i] = k;
    return this;
  }

  /** The grid as equal-length rows of keys. */
  rows(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) out.push(this.px.slice(y * this.w, (y + 1) * this.w).join(''));
    return out;
  }
}

/** One leaf clump of a tree crown: centre and radii. */
export interface Clump { x: number; y: number; rx: number; ry: number }

/** Paints leaf clumps back to front (by y), lit from the top-left, with speckle and occlusion; keys l/L/d (highlight/body/shade). */
export function canopy(p: Pix, clumps: Clump[], seed: number, lit = 0.36, dark = -0.26): void {
  const order = [...clumps].sort((a, b) => a.y - b.y);
  const owner = new Int8Array(p.w * p.h).fill(-1);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of order) {
    x0 = Math.min(x0, c.x - c.rx); y0 = Math.min(y0, c.y - c.ry); x1 = Math.max(x1, c.x + c.rx); y1 = Math.max(y1, c.y + c.ry);
  }
  const gx = (x0 + x1) / 2, gy = (y0 + y1) / 2, gr = Math.max(x1 - x0, y1 - y0) / 2;
  order.forEach((c, ci) => {
    p.shade(Math.floor(c.x - c.rx) - 1, Math.floor(c.y - c.ry) - 1, Math.ceil(c.rx * 2) + 3, Math.ceil(c.ry * 2) + 3, (x, y) => {
      const nx = (x + 0.5 - c.x) / c.rx, ny = (y + 0.5 - c.y) / c.ry;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) return null;
      owner[y * p.w + x] = ci;
      const local = (-nx - ny * 1.15) * 0.6 + (1 - r2) * 0.2;
      const global = (-(x + 0.5 - gx) - (y + 0.5 - gy)) / gr * 0.45;
      const light = local * 0.65 + global * 0.55;
      const n = noise(x, y, seed);
      let k: Key = light > lit ? 'l' : light < dark ? 'd' : 'L';
      if (k === 'L' && n < 0.16) k = light > 0.05 ? 'l' : 'd';
      else if (k === 'l' && n < 0.1) k = 'L';
      else if (k === 'd' && n < 0.1 && light > dark - 0.2) k = 'L';
      return k;
    });
  });
  // occlusion: a back clump darkens where a front clump overlaps just below or right of it
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const o = owner[y * p.w + x];
      if (o < 0) continue;
      const below = y + 1 < p.h ? owner[(y + 1) * p.w + x] : -1;
      const right = x + 1 < p.w ? owner[y * p.w + x + 1] : -1;
      if ((below > o || right > o) && p.get(x, y) !== 'l') p.set(x, y, 'd');
    }
}

/** Recolours a grid by a key map (keys not in the map stay). */
export function recolor(rows: Grid, map: Readonly<Record<string, Key>>): string[] {
  return rows.map((r) => [...r].map((k) => map[k] ?? k).join(''));
}

const BUILDERS = new Map<string, { w: number; h: number; build: () => Grid }>();

/**
 * Registers a sprite painted as a key grid by `build` (run lazily on the first sprite() call, then rasterised and,
 * unless `outline` is false, given the 1 px `k` outline). The builder is kept for headless checks (gridBuilders()).
 */
export function registerGrid(name: string, w: number, h: number, build: () => Grid, opts: { outline?: boolean } = {}): void {
  BUILDERS.set(name, { w, h, build });
  const withOutline = opts.outline ?? true;
  registerDraw(name, w, h, (g) => {
    const c = raster(build());
    g.drawImage(withOutline ? outline(c) : c, 0, 0);
  });
}

/** Every procedural grid builder registered through registerGrid (for tests: sizes and palette keys). */
export function gridBuilders(): ReadonlyMap<string, { w: number; h: number; build: () => Grid }> {
  return BUILDERS;
}

/** Problems of one built grid: wrong size, ragged rows or keys outside PAL ([] when clean). */
export function checkGrid(name: string, w: number, h: number, rows: Grid): string[] {
  const out: string[] = [];
  if (rows.length !== h) out.push(`${name}: ${rows.length} rows, expected ${h}`);
  rows.forEach((r, y) => {
    if (r.length !== w) out.push(`${name}: row ${y} has ${r.length} px, expected ${w}`);
    for (const k of r) if (k !== '.' && k !== ' ' && PAL[k] === undefined) out.push(`${name}: unknown key ${JSON.stringify(k)} in row ${y}`);
  });
  return out;
}

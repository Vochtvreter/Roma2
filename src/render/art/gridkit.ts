// src/render/art/gridkit.ts — a canvas-free pixel builder that produces string grids for registerArt(). Owner: WP-G (G1).
// Everything here is plain string work, so art built with it registers in node (tests/art.test.ts) and stays lazy.
import type { Grid } from '../sprites';

const CLEAR = '.';
const isClear = (c: string): boolean => c === '.' || c === ' ';

/** A mutable grid of PAL keys with drawing helpers; `rows()` yields the Grid for registerArt(). */
export class Pix {
  readonly w: number;
  readonly h: number;
  private readonly px: string[];

  constructor(w: number, h: number, fill = CLEAR) {
    this.w = w;
    this.h = h;
    this.px = new Array<string>(w * h).fill(fill);
  }

  /** A Pix initialised from a grid (rows padded with '.'). */
  static from(g: Grid): Pix {
    const w = Math.max(0, ...g.map((r) => r.length));
    const p = new Pix(w, g.length);
    p.stamp(0, 0, g);
    return p;
  }

  /** The key at (x, y), '.' outside. */
  get(x: number, y: number): string {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? CLEAR : this.px[y * this.w + x];
  }

  /** Sets one pixel (ignored outside the grid). */
  set(x: number, y: number, c: string): this {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
    return this;
  }

  /** Fills a w×h rectangle. */
  rect(x: number, y: number, w: number, h: number, c: string): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }

  /** A horizontal run from x0 to x1 inclusive. */
  hline(x0: number, x1: number, y: number, c: string): this {
    for (let i = Math.min(x0, x1); i <= Math.max(x0, x1); i++) this.set(i, y, c);
    return this;
  }

  /** A vertical run from y0 to y1 inclusive. */
  vline(x: number, y0: number, y1: number, c: string): this {
    for (let j = Math.min(y0, y1); j <= Math.max(y0, y1); j++) this.set(x, j, c);
    return this;
  }

  /** A 1 px rectangle border. */
  box(x: number, y: number, w: number, h: number, c: string): this {
    this.hline(x, x + w - 1, y, c).hline(x, x + w - 1, y + h - 1, c);
    return this.vline(x, y, y + h - 1, c).vline(x + w - 1, y, y + h - 1, c);
  }

  /** A Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: string): this {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Fills a polygon (pixel centres inside, even-odd rule). */
  poly(pts: readonly (readonly [number, number])[], c: string): this {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) this.set(x, y, c);
    }
    return this;
  }

  /** A filled ellipse inside the box (x, y, w, h). */
  ellipse(x: number, y: number, w: number, h: number, c: string): this {
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const nx = (i + 0.5 - cx) / rx, ny = (j + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(i, j, c);
      }
    return this;
  }

  /** Copies a grid onto this one at (x, y); '.' and ' ' in the source are transparent. */
  stamp(x: number, y: number, g: Grid | Pix): this {
    const rows = g instanceof Pix ? g.rows() : g;
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (!isClear(r[i])) this.set(x + i, y + j, r[i]);
    });
    return this;
  }

  /** Tiles a pattern over a rectangle, anchored at (x, y) unless an origin is given ('.' leaves pixels untouched). */
  tile(x: number, y: number, w: number, h: number, pat: Grid, ox = x, oy = y): this {
    const ph = pat.length, pw = pat[0].length;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const ch = pat[(((j - oy) % ph) + ph) % ph][(((i - ox) % pw) + pw) % pw];
        if (!isClear(ch)) this.set(i, j, ch);
      }
    return this;
  }

  /** Replaces keys inside a rectangle (default: everywhere). */
  recolor(map: Readonly<Record<string, string>>, x = 0, y = 0, w = this.w, h = this.h): this {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const to = map[this.get(i, j)];
        if (to !== undefined) this.set(i, j, to);
      }
    return this;
  }

  /** Paints `c` into clear pixels 4-adjacent to opaque pixels of another key (the sprites.ts outline rule). */
  outline(c = 'k'): this {
    const paint: number[] = [];
    const solid = (x: number, y: number): boolean => {
      const v = this.get(x, y);
      return !isClear(v) && v !== c;
    };
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (isClear(this.get(x, y)) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) paint.push(y * this.w + x);
    for (const i of paint) this.px[i] = c;
    return this;
  }

  /** A horizontally mirrored copy. */
  flipX(): Pix {
    const p = new Pix(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) p.set(this.w - 1 - x, y, this.get(x, y));
    return p;
  }

  /** An independent copy. */
  clone(): Pix {
    const p = new Pix(this.w, this.h);
    p.px.splice(0, p.px.length, ...this.px);
    return p;
  }

  /** The grid rows (equal length) for registerArt(). */
  rows(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) out.push(this.px.slice(y * this.w, (y + 1) * this.w).join(''));
    return out;
  }
}

/** Mirrors a grid horizontally and swaps lit/shaded keys so the light still comes from the top-left. */
export function mirrorGrid(g: Grid, swap: Readonly<Record<string, string>> = {}): string[] {
  return g.map((r) => [...r].reverse().map((ch) => swap[ch] ?? ch).join(''));
}

// src/render/art/opus.ts — the building kit of WP-G2's procedural art: roofs, walls, openings, columns, all in PAL keys.
// Owner: WP-G (art, part 2). Light comes from the top-left (DESIGN §16.2): left faces and upper slopes are lit,
// right faces and eaves fall into shade. Every painter works on a Pix grid (brush.ts); nothing here touches a canvas.
import { Pix, noise } from './brush';
import type { Key } from './brush';

/** A five-step material ramp: highlight, light, base, shade, dark. */
export type Ramp = readonly [Key, Key, Key, Key, Key];

/** Material ramps used across the rural and civic-procedural art. */
export const RAMP = {
  tile: ['o', 's', 'u', 'v', 'R'],          // terracotta tegulae and imbrices
  thatch: ['T', 't', 'n', 'B', 'b'],
  plank: ['t', 'n', 'B', 'b', 'm'],
  ochre: ['T', 't', 's', 'n', 'B'],         // ochre plaster
  white: ['w', 'a', 'i', 'W', 'g'],         // travertine and lime plaster
  tufa: ['a', 'i', 'O', 'Q', 'X'],
  stone: ['w', 'W', 'g', 'G', 'j'],
  brick: ['s', 'u', 'v', 'R', 'm'],
  marble: ['w', 'w', 'a', 'i', 'W'],
  lead: ['z', 'g', 'G', 'j', 'x'],          // lead or concrete domes
} as const satisfies Record<string, Ramp>;

/** Row inset of a hip roof at row r of h (ridge inset `hip` at the top, 0 at the eave). */
function hipInset(r: number, h: number, hip: number): number {
  return h <= 1 ? 0 : Math.round(hip * (1 - r / (h - 1)));
}

/**
 * A tiled roof slope facing the viewer: ridge on top, vertical imbrex lines, tile courses, a dark eave.
 * `hip` > 0 narrows the ridge into a hipped roof whose side triangles are lit (left) and shaded (right).
 */
export function tiledRoof(p: Pix, x: number, y: number, w: number, h: number, hip = 0, ramp: Ramp = RAMP.tile): void {
  const [hi, li, base, sh, dk] = ramp;
  for (let r = 0; r < h; r++) {
    const ins = hipInset(r, h, hip);
    for (let c = 0; c < w; c++) {
      const X = x + c, Y = y + r;
      if (c < ins || c >= w - ins) continue;
      let k: Key;
      if (c < ins + hip && hip > 0 && c - ins < Math.max(1, hip - r)) k = li;                  // lit left hip
      else if (hip > 0 && w - 1 - c - ins < Math.max(1, hip - r)) k = sh;                      // shaded right hip
      else {
        const m = (c - ins) % 3;
        k = m === 0 ? hi : m === 1 ? base : sh;
        if (r % 3 === 2 && m !== 0) k = sh;
        if (c > w * 0.66 && k === hi) k = li;
      }
      if (r === 0) k = hi === 'o' ? li : hi;                                                     // ridge catches the light
      if (r === h - 1) k = dk;                                                                   // eave shadow
      p.set(X, Y, k);
    }
  }
}

/** A thatched roof (hip optional): straw streaks, a lighter ridge, a dark eave fringe. */
export function thatchRoof(p: Pix, x: number, y: number, w: number, h: number, hip = 0, seed = 1): void {
  const [hi, li, base, sh, dk] = RAMP.thatch;
  for (let r = 0; r < h; r++) {
    const ins = hipInset(r, h, hip);
    for (let c = ins; c < w - ins; c++) {
      const n = noise(x + c, y + r, seed), stripe = noise(x + c, 0, seed + 7);
      let k: Key = stripe < 0.3 ? li : stripe > 0.82 ? sh : base;
      if (n < 0.12) k = hi;
      if (c - ins < 2 && hip > 0) k = li;
      if (w - 1 - c - ins < 2 && hip > 0) k = sh;
      if (r === 0) k = hi;
      if (r === h - 1) k = n < 0.5 ? dk : sh;
      p.set(x + c, y + r, k);
    }
  }
}

/** A plank or shingle roof: horizontal boards with staggered joints. */
export function plankRoof(p: Pix, x: number, y: number, w: number, h: number, hip = 0): void {
  const [hi, li, base, sh, dk] = RAMP.plank;
  for (let r = 0; r < h; r++) {
    const ins = hipInset(r, h, hip);
    for (let c = ins; c < w - ins; c++) {
      let k: Key = r % 2 === 0 ? li : base;
      if ((c + (r % 4 < 2 ? 0 : 3)) % 6 === 0) k = sh;
      if (r === 0) k = hi;
      if (r === h - 1) k = dk;
      p.set(x + c, y + r, k);
    }
  }
}

/** A front-facing gable triangle (apex at cx, top y) filled with a ramp: lit left half, shaded right half. */
export function gable(p: Pix, cx: number, y: number, half: number, h: number, ramp: Ramp, stripes = true): void {
  const [hi, li, base, sh, dk] = ramp;
  for (let r = 0; r < h; r++) {
    const span = Math.round((half * (r + 1)) / h);
    for (let c = -span; c <= span; c++) {
      let k: Key = c < 0 ? li : base;
      if (stripes && (r + Math.abs(c)) % 3 === 0) k = c < 0 ? hi : sh;
      if (Math.abs(c) === span) k = c < 0 ? hi : sh;
      if (r === h - 1) k = dk;
      p.set(cx + c, y + r, k);
    }
  }
}

/** A plastered wall (lit at the left, shaded at the right edge and under the eave), with optional weathering. */
export function plasterWall(p: Pix, x: number, y: number, w: number, h: number, ramp: Ramp = RAMP.ochre, seed = 3): void {
  const [hi, li, base, sh] = ramp;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      let k: Key = c < 2 ? li : c >= w - 2 ? sh : base;
      if (r === 0) k = sh;                                    // shadow under the eave
      else if (noise(x + c, y + r, seed) < 0.06) k = c < w / 2 ? hi : sh;
      p.set(x + c, y + r, k);
    }
}

/** A wall of horizontal logs: rounded log rows with dark gaps and lit log ends at the left. */
export function logWall(p: Pix, x: number, y: number, w: number, h: number): void {
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const row = r % 3;
      let k: Key = row === 0 ? 'n' : row === 1 ? 'B' : 'b';
      if (c === 0 || c === w - 1) k = row === 2 ? 'b' : row === 0 ? 'T' : 't';   // log ends
      if (r === 0) k = 'b';
      p.set(x + c, y + r, k);
    }
}

/** Squared stone courses (opus quadratum): staggered blocks with mortar lines. */
export function stoneWall(p: Pix, x: number, y: number, w: number, h: number, ramp: Ramp = RAMP.tufa, block = 4, course = 3): void {
  const [hi, li, base, sh, dk] = ramp;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const cr = Math.floor(r / course), off = cr % 2 ? Math.floor(block / 2) : 0;
      const joint = (c + off) % block === 0 || r % course === course - 1;
      let k: Key = joint ? sh : c < 2 ? li : c >= w - 2 ? sh : base;
      if (!joint && (c + off) % block === 1 && r % course === 0) k = hi;
      if (r === 0) k = dk;
      p.set(x + c, y + r, k);
    }
}

/** A doorway: dark opening with a timber frame and a lit lintel. */
export function door(p: Pix, x: number, y: number, w: number, h: number, frame: Key = 'b'): void {
  p.rect(x - 1, y - 1, w + 2, h + 1, frame);
  p.rect(x, y, w, h, 'q');
  p.vline(x, y + 1, y + h - 1, 'x');
}

/** An arched doorway or window (round top) of width w, height h. */
export function arch(p: Pix, x: number, y: number, w: number, h: number, fill: Key = 'q', frame: Key | null = null): void {
  const r = w / 2;
  p.shade(x - 1, y - 1, w + 2, h + 2, (X, Y) => {
    const dx = X + 0.5 - (x + r), dy = Y + 0.5 - (y + r);
    const inside = Y >= y + r ? X >= x && X < x + w && Y < y + h : dx * dx + dy * dy <= r * r;
    if (inside) return fill;
    if (frame) {
      const near = Y >= y + r - 1 ? (X === x - 1 || X === x + w) && Y < y + h : dx * dx + dy * dy <= (r + 1) * (r + 1);
      return near ? frame : null;
    }
    return null;
  });
}

/** A small window: dark pane, lit sill below. */
export function windowHole(p: Pix, x: number, y: number, w = 2, h = 2, sill: Key = 'T'): void {
  p.rect(x, y, w, h, 'q');
  p.hline(x, x + w - 1, y + h, sill);
}

/** A round column (shaft lit at the left) with capital and base, from y to y+h. */
export function column(p: Pix, x: number, y: number, h: number, ramp: Ramp = RAMP.white, w = 3): void {
  const [hi, li, base, sh] = ramp;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) p.set(x + c, y + r, c === 0 ? hi : c === w - 1 ? sh : r % 4 === 0 ? li : base);
  p.hline(x - 1, x + w, y, li).hline(x - 1, x + w, y + h - 1, sh);
}

/** A soft drop shadow on the ground to the right of an object (shade keys over a region of transparent pixels only). */
export function groundShadow(p: Pix, x: number, y: number, w: number, h: number, k: Key = 'K'): void {
  p.shade(x, y, w, h, (_X, _Y, cur) => (cur === '.' ? k : null));
}

/** A little stack of stone blocks (2 courses) at (x, y), w px wide. */
export function blockStack(p: Pix, x: number, y: number, w: number, ramp: Ramp = RAMP.tufa): void {
  const [hi, li, base, sh, dk] = ramp;
  p.rect(x, y, w, 5, dk);
  for (let c = 0; c < w - 2; c++) {
    p.set(x + 1 + c, y + 1, c % 4 === 3 ? sh : hi);
    p.set(x + 1 + c, y + 2, c % 4 === 3 ? sh : li);
    p.set(x + 1 + c, y + 3, (c + 2) % 4 === 3 ? sh : base);
  }
}

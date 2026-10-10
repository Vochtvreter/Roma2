// src/render/art/civitas.ts — civic set pieces shared by the forum stages, the Capitolium, the theatrum and the thermae:
// tents, standards, the groma, statues, flagstone pavement, front porticoes and side ranges. Owner: WP-G (art, part 2).
// All painters work on Pix grids in PAL keys, lit from the top-left (DESIGN §16.2).
import { Pix, noise } from './brush';
import type { Key } from './brush';
import { RAMP, plankRoof, tiledRoof } from './opus';
import type { Ramp } from './opus';

/**
 * A ridge tent seen from the front (its ridge runs away from the viewer): lit left slope, shaded right slope and the
 * front gable with a dark door flap, inside the box (x, y, w, h). `stripe` paints vertical stripes on the cloth.
 */
export function tent(p: Pix, x: number, y: number, w: number, h: number, ramp: Ramp, stripe: Key | null): void {
  const [hi, li, base, sh, dk] = ramp;
  const half = Math.floor((w - 1) / 2), cx = x + half, bot = y + h - 1;
  const fh = Math.min(half, Math.round(h * 0.55)), d = h - 1 - fh;           // front gable height, ridge depth
  for (let Y = y; Y <= bot; Y++)
    for (let X = x; X < x + 2 * half + 1; X++) {
      const dx = Math.abs(X - cx);
      const back = Y - y >= (dx * fh) / half;                                 // below the back roof line
      const front = bot - Y < fh - (dx * fh) / half;                          // inside the front gable
      if (!back) continue;
      let k: Key;
      if (front) {
        k = stripe && dx % 4 < 2 ? stripe : base;
        if (Math.abs((bot - Y) - (fh - (dx * fh) / half)) < 1) k = dk;          // gable edges
      } else {
        k = X < cx ? li : X > cx ? sh : hi;
        if (stripe && X < cx && (X - x) % 4 < 2) k = hi;
        if (Y - y - (dx * fh) / half < 1) k = X <= cx ? hi : base;             // lit eave line of the slopes
        if (!front && bot - Y < 1 + fh - (dx * fh) / half + 1 && X !== cx) k = X < cx ? base : dk;   // shadow above the gable
      }
      p.set(X, Y, k);
    }
  p.vline(cx, y, y + d, hi);
  // door flap: a dark opening with the flap tied back
  const dh = Math.max(3, Math.round(fh * 0.6));
  for (let r = 0; r < dh; r++) {
    const span = Math.floor((r * 0.5));
    p.hline(cx - span, cx + span, bot - dh + 1 + r, 'q');
  }
  p.line(cx - 1, bot - dh + 2, cx - Math.floor(dh * 0.5) - 1, bot, li);
  p.hline(x, x + 2 * half, bot, dk);
  // pegs
  p.set(x - 1, bot, 'b').set(x + 2 * half + 1, bot, 'b').set(x, bot - d, 'b').set(x + 2 * half, bot - d, 'b');
}

/** A legion standard of one kind, pole foot at (x, y + 24): the gilded eagle, a signum with phalerae, or a red vexillum. */
export function standard(p: Pix, x: number, y: number, kind: 'aquila' | 'signum' | 'vexillum'): void {
  p.vline(x, y + 2, y + 24, 'b').vline(x + 1, y + 6, y + 24, 'm');
  if (kind === 'aquila') {
    p.stamp([
      'N.......N',
      'NN.....NN',
      'yNN.y.NNQ',
      '.NNyNNNQ.',
      '..NNNNQ..',
      '...NNQ...',
      '..NQNQN..',
    ], x - 4, y - 4);
    p.set(x, y + 3, 'N').hline(x - 2, x + 2, y + 4, 'L').set(x - 2, y + 5, 'l').set(x + 2, y + 5, 'd');   // laurel wreath
  } else if (kind === 'signum') {
    p.stamp(['.y.', 'yNy', 'NNN', '.N.'], x - 1, y - 2);
    p.hline(x - 2, x + 2, y + 3, 'b').set(x - 2, y + 4, 'r').set(x + 2, y + 4, 'r');
    for (const dy of [7, 11, 15]) p.rect(x - 1, y + dy, 3, 2, 'N').set(x - 1, y + dy, 'y').set(x + 1, y + dy + 1, 'Q');
  } else {
    p.set(x, y + 1, 'z');
    p.hline(x - 3, x + 3, y + 3, 'b');
    p.rect(x - 3, y + 4, 7, 7, 'F');
    p.shade(x - 3, y + 4, 7, 7, (X, Y) => (X === x - 3 ? 'r' : X === x + 3 ? 'R' : (X + Y) % 5 === 0 ? 'r' : null));
    p.rect(x - 1, y + 6, 3, 2, 'N');
    p.hline(x - 3, x + 3, y + 11, 'N').set(x - 2, y + 12, 'N').set(x, y + 12, 'N').set(x + 2, y + 12, 'N');
  }
}

/** The groma: a staff with a turning cross and four plumb lines, foot at (x, y + 18). */
export function groma(p: Pix, x: number, y: number): void {
  p.vline(x, y + 2, y + 18, 'b').vline(x + 1, y + 4, y + 18, 'm');
  p.line(x - 6, y + 2, x + 6, y + 2, 'B').line(x - 2, y, x + 3, y + 4, 'B');
  for (const [ax, ay] of [[x - 6, y + 2], [x + 6, y + 2], [x - 2, y], [x + 3, y + 4]]) {
    p.vline(ax, ay + 1, ay + 6, 'k');
    p.set(ax, ay + 7, 'N');
  }
  p.set(x, y + 1, 'N');
}

/** A statue on a pedestal; `mat` gives the figure's ramp (bronze, gilt or marble). Pedestal foot at (x, y + 15). */
export function statue(p: Pix, x: number, y: number, mat: 'bronze' | 'gilt' | 'marble', pedestal: Ramp = RAMP.white): void {
  const [ph, pl, pb, ps] = pedestal;
  p.rect(x - 3, y + 9, 7, 6, pb).hline(x - 3, x + 3, y + 9, ph).vline(x - 3, y + 10, y + 14, pl).vline(x + 3, y + 10, y + 14, ps);
  p.hline(x - 4, x + 4, y + 9, ph).hline(x - 4, x + 4, y + 14, ps);
  const [a, b, c] = mat === 'marble' ? ['w', 'a', 'i'] : mat === 'gilt' ? ['y', 'N', 'Y'] : ['N', 'Q', 'X'];
  p.stamp([
    '...a.',
    '..ab.',
    '.aab.b',
    'aabbc.',
    '.abbc.',
    '.abbc.',
    '.abcc.',
    '.ab.c.',
    '.a..c.',
  ].map((r) => r.replace(/a/g, a).replace(/b/g, b).replace(/c/g, c)), x - 3, y);
}

/** Squared flagstone paving (8×5 staggered slabs) in a ramp: lit slab corners, shaded joints, a few odd slabs. */
export function flagstones(p: Pix, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number, sw = 12, sh = 7): void {
  const [hi, li, base, shade] = ramp;
  p.shade(x, y, w, h, (X, Y) => {
    const ry = Y - y, row = Math.floor(ry / sh), off = row % 2 ? sw / 2 : 0;
    const cx = (X - x + off) % sw, cy = ry % sh;
    const slab = noise(Math.floor((X - x + off) / sw), row, seed);
    if (cy === 0) return noise(X, Y, seed + 1) < 0.7 ? shade : base;      // worn bed joints
    if (cx === 0) return noise(X, Y, seed + 2) < 0.55 ? shade : base;
    const n = noise(X, Y, seed + 3);
    if (n < 0.04) return shade;
    if (n > 0.96) return hi;
    return slab < 0.22 ? li : slab > 0.88 ? hi : base;
  });
}

/** Options of a front-facing colonnade (porticus). */
export interface PorticoOpts {
  roof?: 'tile' | 'plank' | 'marble';
  col?: Ramp;              // column ramp (default travertine)
  step?: number;           // column pitch in px
  back?: Key;              // the shaded back wall behind the columns
  gap?: [number, number];  // an opening (x range) without columns, e.g. a street mouth
  hip?: number;
}

/**
 * A colonnade facing the viewer at (x, y), w wide: roof slope (rh rows), entablature, columns (fh rows) over a
 * shaded back wall, and a two-step stylobate.
 */
export function portico(p: Pix, x: number, y: number, w: number, rh: number, fh: number, o: PorticoOpts = {}): void {
  const col = o.col ?? RAMP.white, step = o.step ?? 5, back = o.back ?? 'Q';
  if (o.roof === 'plank') plankRoof(p, x, y, w, rh, o.hip ?? 0);
  else tiledRoof(p, x, y, w, rh, o.hip ?? 0, o.roof === 'marble' ? RAMP.white : RAMP.tile);
  const ey = y + rh;
  p.hline(x, x + w - 1, ey, col[1]).hline(x, x + w - 1, ey + 1, col[3]);                       // architrave
  for (let r = 0; r < fh; r++)
    for (let c = 0; c < w; c++) {
      const X = x + c, Y = ey + 2 + r;
      const inGap = o.gap && X >= o.gap[0] && X <= o.gap[1];
      const m = c % step;
      if (inGap) { p.set(X, Y, r < 2 ? 'K' : null); continue; }
      p.set(X, Y, m === 1 ? col[0] : m === 2 ? col[2] : m === 3 ? col[3] : r < 2 ? 'K' : back);
    }
  const sy = ey + 2 + fh;
  for (let c = 0; c < w; c++) {
    const X = x + c;
    if (o.gap && X >= o.gap[0] && X <= o.gap[1]) continue;
    p.set(X, sy, col[1]).set(X, sy + 1, col[3]);
  }
}

/**
 * A side range running north–south (x, y, w × h): a tiled roof seen from above (lit west slope, shaded east slope),
 * a colonnade strip along the forum side and the south end's gable face (fh rows).
 */
export function sideRange(p: Pix, x: number, y: number, w: number, h: number, inner: 'E' | 'W', fh: number, roof: 'tile' | 'plank' = 'tile', col: Ramp = RAMP.white): void {
  const mid = x + Math.floor(w / 2);
  const tile = roof === 'tile';
  for (let Y = y; Y < y + h; Y++)
    for (let X = x; X < x + w; X++) {
      const left = X < mid, course = (Y - y) % 3;
      let k: Key;
      if (tile) k = left ? (course === 0 ? 's' : X === x ? 'o' : 'u') : course === 0 ? 'u' : 'v';
      else k = left ? (course === 0 ? 't' : 'n') : course === 0 ? 'B' : 'b';
      if (X === mid) k = tile ? 's' : 't';                                                    // ridge
      p.set(X, Y, k);
    }
  // colonnade strip on the forum side, shaded under the eave
  const cx = inner === 'E' ? x + w : x - 3;
  for (let Y = y + 1; Y < y + h; Y++) {
    const m = (Y - y) % 5;
    for (let i = 0; i < 3; i++) p.set(cx + i, Y, m < 3 ? (i === 0 ? col[0] : i === 1 ? col[2] : col[3]) : 'K');
  }
  if (inner === 'E') p.vline(x + w + 3, y + 1, y + h - 1, 'Q');                               // cast shadow (light from the west)
  // south end: the gable face of the range
  const ey = y + h;
  const [hi, li, base, sh] = col;
  p.rect(x, ey, w, fh, base);
  p.vline(x, ey, ey + fh - 1, hi).vline(x + w - 1, ey, ey + fh - 1, sh).hline(x, x + w - 1, ey, li);
  p.rect(mid - 1, ey + 2, 3, fh - 2, 'K');
  p.hline(x, x + w - 1, ey + fh - 1, sh);
}

/** A pediment (triangular gable with a cornice) centred on cx, top at y; tympanum shaded, raking cornices lit. */
export function pediment(p: Pix, cx: number, y: number, half: number, h: number, ramp: Ramp = RAMP.white, relief: Key | null = null): void {
  const [hi, li, base, sh, dk] = ramp;
  for (let r = 0; r < h; r++) {
    const span = Math.round((half * (r + 1)) / h);
    for (let c = -span; c <= span; c++) {
      let k: Key = r === h - 1 ? li : Math.abs(c) >= span - 1 ? (c < 0 ? hi : base) : sh;
      if (relief && r > 1 && r < h - 2 && Math.abs(c) < span - 3 && (c + r) % 3 === 0) k = relief;
      p.set(cx + c, y + r, k);
    }
  }
  p.hline(cx - half - 1, cx + half + 1, y + h, dk === 'g' ? sh : li).hline(cx - half - 1, cx + half + 1, y + h + 1, sh);
}

/** A monumental archway (pier faces lit left, shaded right) leaving the passage open below the arch. */
export function archway(p: Pix, x: number, y: number, w: number, h: number, ow: number, ramp: Ramp, inside: Key = 'K'): void {
  const [hi, li, base, sh] = ramp;
  p.rect(x, y, w, h, base);
  p.vline(x, y, y + h - 1, hi).vline(x + w - 1, y, y + h - 1, sh).hline(x, x + w - 1, y, li);
  const ox = x + Math.floor((w - ow) / 2), r = ow / 2, top = y + Math.max(4, Math.round(h * 0.3));
  p.shade(ox, top, ow, y + h - top, (X, Y) => {
    const dx = X + 0.5 - (ox + r), dy = Y + 0.5 - (top + r);
    if (Y >= top + r || dx * dx + dy * dy <= r * r) {
      if (Y < top + r + 2) return inside;                                   // the vault's shadow
      return X === ox ? inside : (Y - top) % 3 === 0 ? 'O' : 'i';           // the paved passage beyond
    }
    return null;
  });
  // voussoirs: a lit ring around the opening
  p.shade(ox - 1, top - 1, ow + 2, Math.ceil(r) + 2, (X, Y, k) => {
    const dx = X + 0.5 - (ox + r), dy = Y + 0.5 - (top + r);
    const d = Math.sqrt(dx * dx + dy * dy);
    return k !== '.' && k !== inside && d > r && d <= r + 1.2 && Y < top + r ? li : null;
  });
}

/** A gilded rider on a tall pedestal (equestrian statue), pedestal foot at (x, y + 19). */
export function equestrian(p: Pix, x: number, y: number, pedestal: Ramp = RAMP.marble): void {
  const [ph, pl, pb, ps] = pedestal;
  p.rect(x - 6, y + 10, 13, 10, pb).hline(x - 7, x + 7, y + 10, ph).hline(x - 7, x + 7, y + 19, ps);
  p.vline(x - 6, y + 11, y + 18, pl).vline(x + 6, y + 11, y + 18, ps).rect(x - 3, y + 13, 7, 3, 'N');
  p.stamp([
    '.....y......',
    '....yN......',
    '....NN.y....',
    '...NNNNNy.N.',
    '..yNNNNNNNN.',
    '.yNNNNNNNYQ.',
    '.N.yNNNNNQ..',
    '.N.N.N..NQ..',
    '...N.N..N...',
  ], x - 6, y + 1);
}

/** A round fountain basin with a jet, centred on (cx, cy). */
export function fountain(p: Pix, cx: number, cy: number, r = 5): void {
  p.ellipse(cx, cy, r + 1, (r + 1) * 0.6, 'i').ellipse(cx, cy, r, r * 0.6, 'M').ellipse(cx - 1, cy - 0.5, r - 2, (r - 2) * 0.55, 'c');
  p.vline(cx, cy - 4, cy, 'a').set(cx, cy - 5, 'w').set(cx - 1, cy - 4, 'c').set(cx + 1, cy - 4, 'c');
  p.hline(cx - r, cx + r, Math.round(cy + r * 0.6), 'Q');
}

/** A hanging banner (purple with a gilt hem), 3 wide, 7 tall, top at (x, y). */
export function banner(p: Pix, x: number, y: number, cloth: Key = 'I'): void {
  p.hline(x - 1, x + 3, y, 'N');
  p.rect(x, y + 1, 3, 6, cloth).vline(x, y + 1, y + 6, cloth === 'I' ? 'F' : 'r').set(x + 1, y + 3, 'N');
  p.set(x, y + 7, 'N').set(x + 2, y + 7, 'N');
}

/** A cypress in a stone planter, foot at (x, y + 14). */
export function plantedCypress(p: Pix, x: number, y: number): void {
  p.stamp([
    '..DD..',
    '.DLdD.',
    '.DLZD.',
    'DLdZZD',
    'DLZdZD',
    'DLdZZD',
    'DLZZZD',
    'DdZdZD',
    '.DZZD.',
    '..DD..',
  ], x - 3, y);
  p.rect(x - 2, y + 10, 5, 4, 'O').hline(x - 2, x + 2, y + 10, 'a').vline(x + 2, y + 11, y + 13, 'Q');
}

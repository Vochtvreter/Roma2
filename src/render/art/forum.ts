// src/render/art/forum.ts — the forum stages p_forum_0..4 (144×152: the 9×9 principia footprint plus an 8 px overhang)
// from tents and standards to marble and statues (DESIGN §1.1, §16.3–16.4). Owner: WP-G (art, part 2).
// The cardo enters at the middle of the north and south sides (footprint x 64..79) and the decumanus at the middle
// of the west and east sides (footprint y 64..79); every stage keeps those four mouths open.
import type { Grid } from '../sprites';
import { Pix, noise } from './brush';
import type { Ramp } from './opus';
import { groma, standard, tent } from './civitas';

/** Sprite size and the footprint's top row inside the sprite. */
export const FORUM_W = 144, FORUM_H = 152, TOP = 8;
/** Street mouths (sprite coordinates). */
const CX0 = 64, CX1 = 79, DY0 = TOP + 64, DY1 = TOP + 79;

/** Beaten earth: khaki with dust and a little scrub. */
function earth(p: Pix, x: number, y: number, w: number, h: number, seed: number): void {
  p.shade(x, y, w, h, (X, Y) => {
    const n = noise(X, Y, seed);
    return n < 0.07 ? 'O' : n < 0.16 ? 'e' : n > 0.995 ? 'L' : 'E';
  });
}

/** Worn ruts of the cardo and decumanus across beaten ground. */
function ruts(p: Pix, seed: number): void {
  p.shade(CX0 + 2, TOP, CX1 - CX0 - 3, FORUM_H - TOP, (X, Y) => (noise(X, Y, seed) < 0.35 ? 'O' : null));
  p.shade(0, DY0 + 2, FORUM_W, DY1 - DY0 - 3, (X, Y) => (noise(X, Y, seed + 1) < 0.35 ? 'O' : null));
}

/** Stage 0 — tents and standards: the praetorium tent, standards and the groma on a dusty parade ground. */
function stage0(): Grid {
  const p = new Pix(FORUM_W, FORUM_H);
  earth(p, 0, TOP, FORUM_W, FORUM_H - TOP, 201);
  ruts(p, 202);
  // a low turf bank around the parade ground, open at the four mouths
  const turf = (X: number, Y: number): void => { p.set(X, Y, noise(X, Y, 203) < 0.4 ? 'd' : 'L'); };
  for (let X = 0; X < FORUM_W; X++) if (X < CX0 || X > CX1) { turf(X, TOP); turf(X, FORUM_H - 1); }
  for (let Y = TOP; Y < FORUM_H; Y++) if (Y < DY0 || Y > DY1) { turf(0, Y); turf(FORUM_W - 1, Y); }
  // contubernium tents along the sides (leather), the praetorium tent at the head (red and white)
  const leather: Ramp = ['T', 't', 'n', 'B', 'b'];
  for (const [x, y] of [[6, 20], [6, 44], [6, 96], [6, 120], [116, 20], [116, 44], [116, 96], [116, 120]]) tent(p, x, y, 22, 18, leather, null);
  for (const [x, y] of [[32, 104], [90, 104]]) tent(p, x, y, 22, 18, leather, null);
  tent(p, 48, 12, 48, 40, ['w', 'a', 'r', 'F', 'R'], 'w');
  // standards before the praetorium: signa, vexilla, and the aquila in the middle
  standard(p, 58, 50, 'signum');
  standard(p, 64, 52, 'vexillum');
  standard(p, 71, 48, 'aquila');
  standard(p, 78, 52, 'vexillum');
  standard(p, 85, 50, 'signum');
  // the groma at the crossing of cardo and decumanus
  groma(p, 71, 64);
  // tribunal (turf platform) and supplies
  p.rect(12, 70, 22, 14, 'L');
  p.shade(12, 70, 22, 14, (X, Y) => (Y === 70 ? 'l' : Y >= 82 ? 'd' : X >= 32 ? 'd' : noise(X, Y, 204) < 0.2 ? 'd' : null));
  p.rect(18, 67, 10, 3, 'B').hline(18, 27, 67, 'n');            // a camp chair (sella) on it
  for (const [x, y] of [[100, 72], [106, 74], [112, 71]]) {
    p.box(x, y, 6, 6, 'n', 'b');
    p.hline(x + 1, x + 4, y + 1, 't').line(x + 1, y + 1, x + 4, y + 4, 'B');
  }
  for (const [x, y] of [[96, 80], [99, 82]]) p.rect(x, y, 3, 4, 'u').set(x + 1, y - 1, 'v').set(x, y, 's');
  // campfire with a ring of stones
  p.ellipse(110, 128, 4, 2.5, 'G').ellipse(110, 128, 2.5, 1.5, 'x');
  p.set(110, 126, 'y').set(109, 127, 'o').set(111, 127, 'Y');
  return p.rows();
}

/** Registers the five forum stages (lazily painted). */
export function forumStages(): Record<string, () => Grid> {
  return { p_forum_0: stage0 };
}

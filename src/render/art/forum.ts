// src/render/art/forum.ts — the forum stages p_forum_0..4 (144×152: the 9×9 principia footprint plus an 8 px overhang)
// from tents and standards to marble and statues (DESIGN §1.1, §16.3–16.4). Owner: WP-G (art, part 2).
// The cardo enters at the middle of the north and south sides (footprint x 64..79) and the decumanus at the middle
// of the west and east sides (footprint y 64..79); every stage keeps those four mouths open.
import type { Grid } from '../sprites';
import { Pix, noise } from './brush';
import { RAMP, plankRoof, tiledRoof, windowHole } from './opus';
import type { Ramp } from './opus';
import {
  archway, banner, equestrian, flagstones, fountain, groma, pediment, plantedCypress, portico, sideRange, standard, statue, tent,
} from './civitas';

/** Sprite size and the footprint's top row inside the sprite. */
export const FORUM_W = 144, FORUM_H = 152, TOP = 8;
/** Street mouths (sprite coordinates). */
const CX0 = 64, CX1 = 79, DY0 = TOP + 64, DY1 = TOP + 79;

/** Beaten earth: khaki with dust and a little scrub. */
function earth(p: Pix, x: number, y: number, w: number, h: number, seed: number): void {
  p.shade(x, y, w, h, (X, Y) => {
    const n = noise(X, Y, seed);
    return n < 0.07 ? 'O' : n < 0.16 ? 'e' : 'E';
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
  // the tribunal: a timber dais with the commander's chair, and supplies
  tribunal(p, 14, 68);
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

/** A timber tribunal (dais with steps and a curule chair), top-left at (x, y): 22×14. */
function tribunal(p: Pix, x: number, y: number): void {
  plankRoof(p, x, y + 3, 22, 7);
  p.rect(x, y + 10, 22, 4, 'B').hline(x, x + 21, y + 10, 'n').hline(x, x + 21, y + 13, 'b');
  for (let i = x + 1; i < x + 22; i += 4) p.vline(i, y + 11, y + 12, 'b');
  p.rect(x + 8, y + 14, 6, 1, 'n');                                         // step
  p.rect(x + 8, y, 6, 4, 'N').hline(x + 8, x + 13, y, 'y').vline(x + 13, y + 1, y + 3, 'Q');   // sella curulis
}

/** Gravel courtyard: pale with pebbles. */
function gravel(p: Pix, x: number, y: number, w: number, h: number, seed: number): void {
  p.shade(x, y, w, h, (X, Y) => {
    const n = noise(X, Y, seed);
    return n < 0.1 ? 'E' : n < 0.16 ? 'O' : n > 0.94 ? 'a' : 'e';
  });
}

/** The two side ranges (west and east), each split at the decumanus mouth. */
function sideRanges(p: Pix, roof: 'tile' | 'plank', col: Ramp, top: number): void {
  for (const [x, inner] of [[2, 'E'], [130, 'W']] as const) {
    sideRange(p, x, top, 12, DY0 - 6 - top, inner, 6, roof, col);
    sideRange(p, x, DY1 + 4, 12, 128 - (DY1 + 4), inner, 6, roof, col);
  }
}

/** A square well-head (puteal) with a bucket frame. */
function puteal(p: Pix, x: number, y: number, ramp: Ramp): void {
  p.rect(x, y + 3, 8, 5, ramp[2]).hline(x, x + 7, y + 3, ramp[0]).vline(x + 7, y + 4, y + 7, ramp[3]);
  p.rect(x + 2, y + 3, 4, 1, 'q');
  p.vline(x, y - 3, y + 2, 'b').vline(x + 7, y - 3, y + 2, 'b').hline(x, x + 7, y - 3, 'B').vline(x + 4, y - 2, y, 'k');
}

/** Stage 1 — the timber principia: a plank-roofed hall with the shrine of the standards, timber porticoes, gate towers. */
function stage1(): Grid {
  const p = new Pix(FORUM_W, FORUM_H);
  gravel(p, 0, TOP, FORUM_W, FORUM_H - TOP, 211);
  ruts(p, 212);
  // north hall: plank roof, board facade, gabled porch of the aedes signorum in the middle
  plankRoof(p, 6, 2, 132, 14, 6);
  p.rect(8, 16, 128, 16, 'B');
  p.shade(8, 16, 128, 16, (X, Y) => (Y === 16 ? 'b' : X % 4 === 0 ? 'b' : X % 4 === 1 ? 'n' : null));
  for (let x = 14; x < 132; x += 12) if (x < 56 || x > 86) windowHole(p, x, 21, 3, 3, 'n');
  pediment(p, 72, 0, 18, 12, RAMP.plank);
  p.rect(56, 14, 33, 18, 'q');
  for (const x of [56, 64, 79, 87]) p.rect(x, 14, 2, 18, 'n').vline(x + 1, 14, 31, 'B');
  p.hline(54, 90, 32, 'n').hline(54, 90, 33, 'b');
  standard(p, 68, 6, 'aquila');
  standard(p, 75, 8, 'signum');
  // porticoes and the south front with two gate towers
  sideRanges(p, 'plank', RAMP.plank, 38);
  portico(p, 2, 134, 140, 6, 7, { roof: 'plank', col: RAMP.plank, step: 6, gap: [CX0 - 2, CX1 + 2] });
  for (const tx of [52, 82]) {
    plankRoof(p, tx, 116, 11, 6, 2);
    p.rect(tx + 1, 122, 9, 28, 'B');
    p.shade(tx + 1, 122, 9, 28, (X, Y) => (Y === 122 ? 'b' : X === tx + 1 ? 'n' : X === tx + 9 ? 'b' : Y % 6 === 0 ? 'b' : null));
    windowHole(p, tx + 4, 127, 3, 2, 'n');
  }
  p.rect(CX0 - 2, 118, CX1 - CX0 + 5, 4, 'B').hline(CX0 - 2, CX1 + 2, 118, 'n').hline(CX0 - 2, CX1 + 2, 121, 'b');   // walkway over the gate
  // courtyard: tribunal, well, altar, standards
  tribunal(p, 26, 88);
  puteal(p, 104, 98, RAMP.tufa);
  p.box(69, 76, 7, 6, 'i', 'k').hline(70, 74, 77, 'a').set(72, 75, 'o').set(72, 74, 'y');
  standard(p, 40, 44, 'vexillum');
  standard(p, 104, 44, 'vexillum');
  return p.rows();
}

/** The stone ranges shared by stages 2–4 (roofs tiled; facades and columns in `col`). */
function stoneSouth(p: Pix, col: Ramp, roof: 'tile' | 'marble'): void {
  portico(p, 2, 132, 140, 7, 8, { roof: roof === 'marble' ? 'tile' : 'tile', col, step: 5, gap: [CX0 - 1, CX1 + 1] });
  for (const x of [CX0 - 4, CX1 + 2]) p.rect(x, 139, 3, 11, col[1]).vline(x, 139, 149, col[0]).vline(x + 2, 139, 149, col[3]);
}

/** Stage 2 — the stone forum: travertine paving, a stone principia with a colonnaded front, stone porticoes. */
function stage2(): Grid {
  const p = new Pix(FORUM_W, FORUM_H);
  flagstones(p, 0, TOP, FORUM_W, FORUM_H - TOP, ['a', 'a', 'i', 'O', 'Q'], 221);
  // north: the stone principia (tiled roof, ochre walls, a white colonnade, the central gateway to the sacred way)
  portico(p, 6, 1, 132, 14, 16, { roof: 'tile', hip: 6, col: RAMP.white, step: 6, back: 's', gap: [CX0 - 2, CX1 + 2] });
  archway(p, CX0 - 3, 14, CX1 - CX0 + 7, 21, 12, RAMP.white);
  pediment(p, 72, 2, 14, 9, RAMP.white);
  sideRanges(p, 'tile', RAMP.white, 40);
  stoneSouth(p, RAMP.white, 'tile');
  // gutters along the porticoes
  p.hline(18, 125, 37, 'X');
  // statue, puteal, cypresses and benches
  statue(p, 72, 46, 'bronze', RAMP.tufa);
  puteal(p, 100, 100, RAMP.white);
  for (const x of [30, 114]) plantedCypress(p, x, 40);
  for (const [x, y] of [[26, 100], [42, 100]]) p.rect(x, y, 10, 3, 'i').hline(x, x + 9, y, 'a').hline(x, x + 9, y + 3, 'Q');
  return p.rows();
}

/** The north range of stages 3–4: the curia (west) and the basilica with clerestory and a central gateway. */
function basilicaCuria(p: Pix, wall: Ramp, col: Ramp, gilt: boolean): void {
  // basilica: high roof, clerestory, aisle roof, colonnade
  tiledRoof(p, 34, 0, 108, 11, 8);
  p.rect(36, 11, 104, 7, wall[1]);
  p.shade(36, 11, 104, 7, (X, Y) => (Y === 11 ? wall[3] : X % 7 === 3 && Y > 12 && Y < 17 ? 'q' : X === 139 ? wall[3] : null));
  portico(p, 32, 18, 110, 6, 14, { roof: 'tile', col, step: 5, back: wall[2], gap: [CX0 - 2, CX1 + 2] });
  archway(p, CX0 - 4, 16, CX1 - CX0 + 9, 24, 12, col);
  pediment(p, 72, 4, 15, 10, col, gilt ? 'N' : null);
  if (gilt) for (const x of [36, 56, 88, 108, 138]) p.set(x, 0, 'y').set(x, 1, 'N');
  // curia: a tall gabled hall with bronze doors
  tiledRoof(p, 2, 0, 28, 6, 0);
  pediment(p, 15, 2, 13, 9, wall);
  p.rect(3, 13, 25, 24, wall[2]);
  p.shade(3, 13, 25, 24, (X, Y) => (X <= 4 ? wall[1] : X >= 26 ? wall[3] : Y === 13 ? wall[3] : null));
  p.rect(11, 22, 9, 13, 'N').shade(11, 22, 9, 13, (X, Y) => (X === 15 ? 'Q' : (X + Y) % 3 === 0 ? 'y' : null));
  p.hline(10, 20, 21, wall[0]);
  for (const x of [6, 23]) windowHole(p, x, 16, 2, 4, wall[0]);
  p.rect(2, 37, 27, 2, col[1]).hline(2, 28, 39, col[3]);
  if (gilt) statue(p, 15, -6, 'gilt', wall);
}

/** The rostra: a speakers' platform with bronze ship-beaks, top-left at (x, y), 32×10. */
function rostra(p: Pix, x: number, y: number, ramp: Ramp): void {
  p.rect(x, y, 32, 3, ramp[0]).rect(x, y + 3, 32, 7, ramp[2]).hline(x, x + 31, y + 9, ramp[3]).vline(x + 31, y + 3, y + 9, ramp[3]);
  for (let i = x + 3; i < x + 30; i += 7) p.stamp(['NNy.', '.NNN', '.QN.'], i, y + 4);
}

/** Stage 3 — basilica and curia: a travertine forum framed by basalt bands, the rostra and bronze statues. */
function stage3(): Grid {
  const p = new Pix(FORUM_W, FORUM_H);
  flagstones(p, 0, TOP, FORUM_W, FORUM_H - TOP, ['a', 'a', 'i', 'O', 'Q'], 231);
  p.shade(18, 44, 108, 88, (X, Y) => (X === 18 || X === 125 || Y === 44 || Y === 131 ? 'X' : X === 19 || Y === 45 ? 'G' : null));
  basilicaCuria(p, RAMP.ochre, RAMP.white, false);
  sideRanges(p, 'tile', RAMP.white, 44);
  stoneSouth(p, RAMP.white, 'tile');
  rostra(p, 56, 50, RAMP.white);
  statue(p, 62, 36, 'bronze', RAMP.white);
  statue(p, 82, 36, 'bronze', RAMP.white);
  for (const [x, y] of [[30, 56], [114, 56], [30, 108], [114, 108]]) statue(p, x, y, 'bronze', RAMP.white);
  for (const x of [46, 98]) plantedCypress(p, x, 92);
  return p.rows();
}

/** Stage 4 — marble and statues: marble paving with porphyry bands, gilded acroteria, the triumphal arch, the rider. */
function stage4(): Grid {
  const p = new Pix(FORUM_W, FORUM_H);
  flagstones(p, 0, TOP, FORUM_W, FORUM_H - TOP, ['w', 'a', 'a', 'i', 'i'], 241);
  // porphyry bands along the axes and a framed square
  p.shade(18, 44, 108, 88, (X, Y) => (X === 18 || X === 125 || Y === 44 || Y === 131 ? 'F' : (X === 19 || Y === 45) ? 'I' : null));
  p.shade(CX0 + 3, 46, CX1 - CX0 - 5, 84, (X, Y) => ((X === CX0 + 3 || X === CX1 - 3) ? 'I' : (Y + X) % 8 === 0 ? 'i' : null));
  basilicaCuria(p, RAMP.marble, RAMP.marble, true);
  sideRanges(p, 'tile', RAMP.marble, 44);
  stoneSouth(p, RAMP.marble, 'tile');
  for (let x = 8; x < 136; x += 15) if (x < CX0 - 6 || x > CX1 + 4) banner(p, x, 143);
  for (let x = 40; x < 136; x += 20) if (x < CX0 - 6 || x > CX1 + 4) banner(p, x, 34);
  // the triumphal arch over the south mouth, crowned by a gilded group
  archway(p, CX0 - 9, 108, CX1 - CX0 + 19, 40, 14, RAMP.marble);
  p.rect(CX0 - 9, 108, CX1 - CX0 + 19, 7, 'a').hline(CX0 - 9, CX1 + 9, 108, 'w').hline(CX0 - 9, CX1 + 9, 114, 'i');
  for (let x = CX0 - 4; x < CX1 + 5; x += 3) p.set(x, 111, 'N');                          // the inscription
  for (const x of [CX0 - 7, CX1 + 6]) p.vline(x, 117, 146, 'W').vline(x + 1, 117, 146, 'w');   // engaged columns
  equestrian(p, 72, 66);
  p.stamp(['..y..y..', '.yNNNNy.', 'NNNNNNNN', 'N.N..N.N'], CX0 + 4, 104);
  // the rostra, gilded statues, fountains and cypresses
  rostra(p, 56, 50, RAMP.marble);
  for (const x of [62, 82]) statue(p, x, 36, 'gilt', RAMP.marble);
  for (const [x, y] of [[30, 56], [114, 56], [30, 108], [114, 108]]) statue(p, x, y, 'marble', RAMP.marble);
  fountain(p, 40, 80);
  fountain(p, 104, 80);
  for (const x of [46, 98]) plantedCypress(p, x, 92);
  return p.rows();
}

/** The five forum stages by sprite name (lazily painted by registerGrid). */
export function forumStages(): Record<string, () => Grid> {
  return { p_forum_0: stage0, p_forum_1: stage1, p_forum_2: stage2, p_forum_3: stage3, p_forum_4: stage4 };
}

// src/render/art/frames.ts — meander border tile, the Ordo's wax seal, the aquila logo (DESIGN §16.3). Owner: WP-G (G1).
import { registerArt } from '../sprites';
import { Pix } from './gridkit';

/**
 * The meander (Greek key) border tile, 12×12, built for a 4 px 9-slice (`border-image-slice: 4`): gold key bands
 * on umber in the four 4 px edges, square key corners, a transparent centre. The edge cells repeat seamlessly.
 */
function meander(): string[] {
  const corner = ['yyyy', 'yKKK', 'yKyy', 'yKyK'];
  const edge = ['yyyy', 'KNKK', 'KNNN', 'NNKN'];     // one key unit; repeats every 4 px
  const p = new Pix(12, 12);
  const put = (cx: number, cy: number, cell: string[], rot: number): void => {
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 4; i++) {
        // rotate the cell so its outer rule faces the tile edge
        const [a, b] = rot === 0 ? [i, j] : rot === 1 ? [j, 3 - i] : rot === 2 ? [3 - i, 3 - j] : [3 - j, i];
        p.set(cx + i, cy + j, cell[b][a]);
      }
  };
  put(0, 0, corner, 0); put(8, 0, corner, 1); put(8, 8, corner, 2); put(0, 8, corner, 3);
  put(4, 0, edge, 0); put(8, 4, edge, 1); put(4, 8, edge, 2); put(0, 4, edge, 3);
  return p.rows();
}

/** The Ordo's wax seal: a red disc with a pressed rim, an embossed laurel ring and a raised star. */
function seal(): string[] {
  const p = new Pix(16, 16);
  p.ellipse(1, 1, 14, 14, 'r');
  p.set(1, 5, 'r').set(14, 9, 'r').set(5, 14, 'r').set(10, 1, 'r');           // drips of wax at the edge
  p.ellipse(3, 3, 10, 10, 'F');
  p.ellipse(4, 4, 8, 8, 'r');
  for (const [x, y] of [[5, 4], [4, 6], [4, 9], [6, 11], [10, 4], [11, 6], [11, 9], [9, 11]]) p.set(x, y, 'R');
  p.set(7, 5, 'o').set(8, 5, 'o').vline(7, 6, 9, 'o').set(6, 7, 'o').set(9, 7, 'o').set(8, 6, 'r').set(8, 10, 'F');
  p.set(5, 7, 'R').set(10, 7, 'R').set(7, 10, 'R');
  p.set(3, 3, 'o').set(4, 2, 'o').set(2, 4, 'o');                              // highlight from the top-left
  p.set(12, 12, 'R').set(13, 11, 'R').set(11, 13, 'R');
  return p.outline().rows();
}

/** The aquila: a gilt eagle with raised wings on a thunderbolt, over a laurel wreath on the standard's pole. */
function aquila(): string[] {
  const p = new Pix(32, 32);
  // wings (left lit, right in shade), feather rows and tips
  p.poly([[13, 12], [9, 7], [5, 3], [2, 1], [1, 5], [3, 10], [6, 14], [10, 17], [14, 17]], 'y');
  p.poly([[19, 12], [23, 7], [27, 3], [30, 1], [31, 5], [29, 10], [26, 14], [22, 17], [18, 17]], 'Y');
  for (let k = 0; k < 4; k++) {
    p.line(3 + k, 4 + 3 * k, 11 + k, 10 + 2 * k, 'N');
    p.line(28 - k, 4 + 3 * k, 20 - k, 10 + 2 * k, 'n');
  }
  for (const [x, y] of [[1, 6], [2, 10], [4, 13], [8, 16]]) p.set(x, y, '.').set(x + 1, y, 'N');
  for (const [x, y] of [[30, 6], [29, 10], [27, 13], [23, 16]]) p.set(x, y, '.').set(x - 1, y, 'n');
  p.line(3, 2, 8, 6, 'w');
  // body with breast feathers, fanned tail, head turned to the left with a hooked beak
  p.ellipse(12, 11, 8, 10, 'y');
  for (let j = 12; j < 21; j++) p.set(18, j, 'N').set(19, j, 'N');
  for (const [x, y] of [[14, 14], [16, 14], [13, 16], [15, 16], [17, 16], [14, 18], [16, 18]]) p.set(x, y, 'Y');
  p.poly([[13, 19], [19, 19], [21, 23], [11, 23]], 'Y');
  for (let i = 12; i <= 20; i += 2) p.vline(i, 20, 22, 'N');
  p.rect(13, 8, 4, 4, 'y').set(16, 9, 'N').set(16, 10, 'N');                // neck
  p.ellipse(11, 4, 6, 5, 'y').set(16, 6, 'N').set(15, 7, 'N');
  p.hline(8, 10, 6, 'Y').set(8, 7, 'Y').set(9, 7, 'n').set(8, 8, 'n');      // hooked beak
  p.set(12, 6, 'k').set(12, 5, 'w').set(13, 5, 'w');
  // thunderbolt perch with zigzag ends
  p.hline(8, 23, 24, 'N').hline(8, 23, 23, 'y');
  p.line(7, 23, 5, 21, 'Y').line(5, 21, 6, 25, 'Y').line(24, 24, 26, 26, 'N').line(26, 26, 25, 22, 'N');
  p.set(13, 22, 'n').set(18, 22, 'n');                                       // talons
  // the pole and a laurel wreath
  p.vline(15, 25, 31, 'n').vline(16, 25, 31, 'B');
  for (let a = 0; a < 20; a++) {
    const t = (a / 20) * Math.PI * 2;
    const x = Math.round(15.5 + 6 * Math.cos(t)), y = Math.round(28 + 3 * Math.sin(t));
    if (y <= 25 && x > 11 && x < 20) continue;
    p.set(x, y, a % 2 ? 'L' : 'd');
    p.set(x + (x < 16 ? -1 : 1), y - 1, 'l');
  }
  p.set(15, 31, 'r').set(16, 31, 'r').set(14, 30, 'r').set(17, 30, 'r');
  return p.outline().rows();
}

/** Registers this group's sprites with registerArt()/registerDraw() (no canvas work at registration). */
export function registerFrames(): void {
  registerArt('f_meander', meander());
  registerArt('f_seal', seal());
  registerArt('f_aquila', aquila());
}

// src/render/art/rural.ts — rural buildings (DESIGN §16.3 "Rural"): venatio, pabulatio, lignarius + log pile, lapicidina,
// figlina, caementarium, fodina, officina. The seasonal fields (ager) and olive groves (olivetum) are procedural and
// live in fields.ts (ARCHITECTURE §3 puts fields and olive rows with the procedural art). Owner: WP-G (art, part 2).
// Sprites are bottom-aligned on their footprint (2×2 → 32 wide, lapicidina 3×3 → 48 wide); 1 px `k` outline added.
import { Pix, noise, registerGrid } from './brush';
import { RAMP, blockStack, door, logWall, plankRoof, plasterWall, thatchRoof, tiledRoof, windowHole } from './opus';

/** Venatores: a log lodge under thatch, a stag's antlers on the ridge, a hide stretched on a frame. 32×26. */
function venatio(): string[] {
  const p = new Pix(32, 26);
  // hide frame (behind the lodge's right end)
  p.vline(24, 9, 24, 'b').vline(30, 9, 24, 'b').hline(24, 30, 9, 'B').hline(24, 30, 23, 'B');
  p.ellipse(27.5, 16, 2.6, 6.2, 'n');
  p.shade(25, 10, 6, 13, (x, y, k) => (k === 'n' ? (x < 27 ? 't' : x > 28 ? 'B' : noise(x, y, 4) < 0.2 ? 'B' : 'n') : null));
  for (const y of [11, 14, 17, 20]) p.set(25, y, 'e').set(29, y, 'e');
  // lodge
  thatchRoof(p, 1, 7, 23, 9, 4, 11);
  logWall(p, 2, 16, 21, 8);
  door(p, 11, 18, 3, 6);
  windowHole(p, 5, 18, 2, 2, 't');
  windowHole(p, 17, 18, 2, 2, 't');
  // antlers and skull on the ridge
  const A = [
    'e.e.....e.e',
    '.e.e...e.e.',
    '.eee...eee.',
    '..eEe.eEe..',
    '....eWe....',
    '....WwW....',
    '.....W.....',
  ];
  p.stamp(A, 7, 1);
  // a spear leaning on the wall, a hound's bowl
  p.line(22, 13, 20, 24, 'b').set(22, 12, 'z').set(22, 11, 'z');
  return p.rows();
}

/** Pabulatio: an open thatched lean-to over baskets of berries, mushrooms and greens. 32×22. */
function pabulatio(): string[] {
  const p = new Pix(32, 22);
  // wattle back wall and poles
  p.rect(4, 10, 21, 8, 'B');
  p.shade(4, 10, 21, 8, (x, y) => ((x + y) % 3 === 0 ? 'n' : (x - y) % 4 === 0 ? 'b' : null));
  p.vline(3, 8, 20, 'b').vline(25, 8, 20, 'b').vline(14, 8, 18, 'b');
  thatchRoof(p, 1, 4, 27, 6, 0, 5);
  // baskets: berries, mushrooms, greens; sacks
  const basket = (x: number, y: number, fill: string, hi: string): void => {
    p.ellipse(x + 2.5, y + 1, 3, 1.4, fill);
    p.set(x + 1, y, hi).set(x + 3, y + 1, hi);
    p.rect(x, y + 2, 6, 3, 'n');
    p.hline(x, x + 5, y + 3, 't').set(x + 5, y + 2, 'B').set(x + 5, y + 4, 'B');
    p.hline(x + 1, x + 4, y + 5, 'B');
  };
  basket(5, 13, 'r', 'f');
  basket(12, 14, 'P', 'p');
  basket(19, 13, 'L', 'l');
  // a sack and a basket of mushrooms outside
  p.ellipse(28, 17, 2.6, 3, 'E');
  p.set(27, 15, 'e').set(27, 16, 'e').hline(27, 29, 14, 'B');
  basket(24, 16, 'T', 'w');
  return p.rows();
}

/** Lignarius: an open plank shed with stacked boards, a sawhorse with a log and an axe in the chopping block. 32×26. */
function lignarius(): string[] {
  const p = new Pix(32, 26);
  // shed
  plankRoof(p, 1, 6, 20, 6, 0);
  p.rect(2, 12, 18, 11, 'm');
  for (let y = 14; y <= 21; y += 2) p.hline(4, 17, y, y % 4 === 0 ? 'n' : 't');          // stacked boards inside
  p.shade(4, 14, 14, 8, (x, y, k) => (k !== 'm' && (x + y) % 7 === 0 ? 'B' : null));
  p.vline(2, 12, 23, 'b').vline(19, 12, 23, 'b').vline(10, 12, 23, 'B');
  // sawhorse with a log
  p.line(22, 23, 24, 18, 'b').line(26, 23, 24, 18, 'b');
  p.rect(21, 16, 9, 3, 'B');
  p.hline(21, 29, 16, 'n').set(29, 16, 'T').set(29, 17, 't').set(29, 18, 'n');
  // chopping block with an axe
  p.rect(26, 21, 4, 3, 'B').hline(26, 29, 21, 'T');
  p.line(27, 20, 29, 18, 'b').set(30, 18, 'z').set(30, 19, 'z').set(29, 17, 'z');
  p.set(23, 24, 't').set(25, 24, 'T').set(21, 24, 't');                                       // wood chips
  return p.rows();
}

/** The lignarius log pile (scales with stock): log ends stacked in a pyramid. 16×10. */
function logPile(): string[] {
  const p = new Pix(16, 10);
  const end = (x: number, y: number): void => {
    p.rect(x, y, 3, 3, 'B');
    p.set(x + 1, y + 1, 'n').set(x, y, 'T').set(x + 1, y, 't').set(x, y + 1, 't');
    p.set(x + 2, y + 2, 'b');
  };
  for (let i = 0; i < 4; i++) end(1 + i * 3 + (i > 1 ? 1 : 0), 6);
  for (let i = 0; i < 3; i++) end(2 + i * 3 + 1, 3);
  end(6, 0);
  p.rect(12, 7, 3, 2, 'b');
  return p.rows();
}

/** Lapicidina: terraces cut into pale limestone, squared blocks, shear-legs crane and a tool hut. 48×40. */
function lapicidina(): string[] {
  const p = new Pix(48, 40);
  // the rock mass with three cut steps (back to front)
  p.ellipse(24, 16, 22, 14, 'O');
  p.rect(2, 16, 44, 16, 'O');
  p.shade(0, 0, 48, 40, (x, y, k) => {
    if (k !== 'O') return null;
    const n = noise(x, y, 31);
    const lit = x + y < 40 ? 'i' : x > 34 ? 'Q' : 'O';
    return n < 0.08 ? 'X' : n < 0.18 ? 'Q' : n > 0.9 ? 'a' : lit;
  });
  // step faces: fresh-cut faces are pale with chisel marks; treads are lit
  const step = (x: number, y: number, w: number, h: number): void => {
    p.rect(x, y, w, 2, 'a');                                    // tread
    p.rect(x, y + 2, w, h, 'i');                                // cut face
    for (let i = x + 2; i < x + w; i += 4) p.vline(i, y + 3, y + h, 'O');
    p.hline(x, x + w - 1, y + h + 1, 'Q');                      // shadow line at the foot
    p.vline(x + w - 1, y + 2, y + h, 'Q');
  };
  step(8, 8, 30, 5);
  step(5, 16, 34, 5);
  step(3, 24, 30, 5);
  // the quarry floor and block stacks
  p.rect(2, 31, 30, 6, 'E');
  p.shade(2, 31, 30, 6, (x, y) => (noise(x, y, 8) < 0.2 ? 'O' : noise(x, y, 9) < 0.1 ? 'e' : null));
  blockStack(p, 5, 32, 8);
  blockStack(p, 14, 33, 6);
  blockStack(p, 8, 28, 6);
  // shear-legs crane lifting a block
  p.line(36, 36, 41, 10, 'b').line(44, 36, 41, 10, 'b').line(37, 36, 41, 10, 'B');
  p.vline(41, 11, 22, 'k');
  p.box(39, 22, 5, 4, 'i', 'k');
  p.hline(40, 42, 23, 'a');
  // tool hut with a tiled roof
  tiledRoof(p, 33, 26, 13, 4, 2);
  plasterWall(p, 34, 30, 11, 7, RAMP.ochre);
  door(p, 38, 32, 3, 5);
  return p.rows();
}

/** Figlina: a beehive brick kiln with a glowing stoke-hole, a drying shed and stacks of tegulae. 32×28. */
function figlina(): string[] {
  const p = new Pix(32, 28);
  // drying shed behind, right
  tiledRoof(p, 15, 7, 16, 5, 2);
  p.rect(16, 12, 14, 9, 'm');
  p.vline(16, 12, 25, 'b').vline(29, 12, 25, 'b');
  for (let y = 13; y <= 19; y += 3) p.hline(18, 27, y, 'u').hline(18, 27, y + 1, 'v');   // tiles drying on racks
  // tile stacks in front of the shed
  for (const [x, y] of [[18, 21], [23, 21]]) {
    p.rect(x, y, 5, 5, 'u');
    for (let j = y; j < y + 5; j += 2) p.hline(x, x + 4, j, 's');
    p.vline(x + 4, y, y + 4, 'v');
  }
  // the kiln dome
  p.ellipse(9.5, 15, 8.5, 9.5, 'u');
  p.rect(1, 15, 18, 10, 'u');
  p.shade(0, 4, 20, 22, (x, y, k) => {
    if (k !== 'u') return null;
    const course = y % 2 === 0, joint = (x + (course ? 0 : 2)) % 4 === 0;
    const lit = x + y * 0.6 < 15 ? 's' : x > 13 ? 'v' : 'u';
    return joint ? (lit === 'v' ? 'R' : 'v') : lit;
  });
  p.rect(7, 5, 5, 2, 'q').hline(7, 11, 4, 'v');                                               // vent
  // stoke-hole with fire glow
  p.ellipse(9.5, 22, 3.5, 3.5, 'q');
  p.rect(6, 22, 7, 4, 'q');
  p.rect(8, 23, 3, 3, 'o').set(9, 24, 'y').set(9, 23, 'Y').set(8, 25, 'Y').set(10, 25, 'Y');
  // clay heap and fuel
  p.ellipse(3, 24.5, 2.5, 1.6, 'n');
  p.set(2, 24, 't');
  return p.rows();
}

/** Caementarium: a lime shed, two mixing pits of grey mortar, sacks of pozzolana and a water butt. 32×26. */
function caementarium(): string[] {
  const p = new Pix(32, 26);
  tiledRoof(p, 1, 3, 20, 5, 3);
  plasterWall(p, 2, 8, 18, 7, RAMP.white);
  door(p, 9, 10, 4, 5);
  windowHole(p, 4, 10, 2, 2, 'a');
  windowHole(p, 16, 10, 2, 2, 'a');
  // mixing pits (stone rim, mortar inside)
  const pit = (x: number, y: number, w: number): void => {
    p.box(x, y, w, 6, 'W', 'Q');
    p.hline(x, x + w - 1, y, 'O');
    p.rect(x + 1, y + 1, w - 2, 1, 'G');
    p.shade(x + 1, y + 2, w - 2, 3, (X, Y) => (noise(X, Y, 12) < 0.25 ? 'g' : noise(X, Y, 13) < 0.1 ? 'w' : 'W'));
  };
  pit(2, 18, 11);
  pit(14, 18, 10);
  // hoe in the mortar
  p.line(20, 15, 17, 20, 'b').hline(15, 17, 21, 'G');
  // sacks and the water butt
  p.ellipse(27, 12.5, 2.5, 3, 'E').set(26, 11, 'e').set(26, 12, 'e').hline(26, 28, 9, 'B');
  p.ellipse(29, 16, 2.2, 2.8, 'E').set(28, 15, 'e');
  p.rect(25, 18, 5, 6, 'B').hline(25, 29, 18, 'C').hline(26, 28, 18, 'c').hline(25, 29, 20, 'b').hline(25, 29, 23, 'b');
  p.vline(25, 19, 23, 'n');
  return p.rows();
}

/** Fodina: a timbered adit in a rust-streaked hillside, rails, an ore cart and the spoil heap. 32×28. */
function fodina(): string[] {
  const p = new Pix(32, 28);
  // hillside
  p.ellipse(14, 17, 13.5, 11, 'G');
  p.rect(1, 17, 26, 9, 'G');
  p.shade(0, 4, 30, 23, (x, y, k) => {
    if (k !== 'G') return null;
    const n = noise(x, y, 41);
    if (n < 0.1) return 'v';
    if (n < 0.16) return 'R';
    if (n > 0.9) return 'W';
    return x + y < 20 ? 'g' : x > 20 ? 'j' : 'G';
  });
  p.shade(0, 4, 30, 6, (x, y, k) => (k === 'g' && noise(x, y, 42) < 0.4 ? 'L' : k === 'G' && noise(x, y, 43) < 0.3 ? 'd' : null));  // scrub on top
  // adit: timber frame and dark mouth
  p.rect(7, 13, 10, 12, 'b');
  p.rect(9, 15, 6, 10, 'q');
  p.hline(7, 16, 13, 'n').hline(7, 16, 14, 'B');
  p.vline(8, 15, 24, 'B').vline(15, 15, 24, 'B').vline(7, 14, 24, 'n');
  p.set(12, 17, 'Y').set(12, 18, 'o');                                                       // a lamp inside
  // rails out of the adit
  p.hline(9, 24, 25, 'X').hline(9, 24, 24, 'b');
  for (let x = 10; x <= 24; x += 3) p.set(x, 24, 'n');
  // ore cart
  p.rect(18, 19, 7, 4, 'x').hline(18, 24, 19, 'z').vline(24, 20, 22, 'j');
  p.set(19, 18, 'R').set(20, 18, 'v').set(21, 18, 'R').set(22, 18, 'X').set(20, 17, 'v');
  p.set(19, 23, 'k').set(23, 23, 'k');
  // spoil heap
  p.ellipse(27.5, 23, 3.8, 3.2, 'X');
  p.shade(23, 19, 9, 8, (x, y, k) => (k === 'X' ? (noise(x, y, 44) < 0.3 ? 'v' : noise(x, y, 45) < 0.3 ? 'G' : y < 22 ? 'g' : 'X') : null));
  return p.rows();
}

/** Officina ferraria: a clay shaft furnace glowing at the tapping arch, bellows, a smithing shed, charcoal. 32×30. */
function officina(): string[] {
  const p = new Pix(32, 30);
  // shed (right)
  tiledRoof(p, 14, 10, 17, 5, 2);
  plankWallShed(p, 15, 15, 15, 10);
  // charcoal heap
  p.ellipse(26, 26, 4, 2.2, 'x');
  p.shade(22, 23, 9, 5, (x, y, k) => (k === 'x' ? (noise(x, y, 51) < 0.25 ? 'j' : noise(x, y, 52) < 0.15 ? 'q' : 'x') : null));
  // shaft furnace: tapering clay stack
  for (let y = 3; y <= 26; y++) {
    const half = 3 + Math.round(((y - 3) / 23) * 3.5);
    for (let x = 8 - half; x <= 8 + half; x++) {
      const rel = x - (8 - half);
      p.set(x, y, rel <= 1 ? 't' : rel >= half * 2 - 1 ? 'B' : (y + rel) % 5 === 0 ? 'n' : 's');
    }
  }
  p.rect(6, 2, 5, 2, 'v').hline(7, 9, 2, 'o').set(8, 1, 'y');                               // glowing throat
  p.hline(5, 11, 3, 'n');
  // tapping arch at the foot, glowing slag
  p.rect(6, 21, 5, 6, 'q');
  p.rect(7, 23, 3, 4, 'o').set(8, 24, 'y').set(8, 25, 'Y').set(7, 26, 'Y').set(9, 26, 'Y');
  p.hline(5, 12, 20, 'n');
  // bellows (leather) and an anvil
  p.ellipse(14, 24, 2.4, 1.6, 'b').set(13, 23, 'B').hline(11, 12, 24, 'm');
  p.rect(19, 24, 4, 1, 'G').rect(20, 25, 2, 2, 'x').hline(19, 22, 23, 'z');
  return p.rows();
}

/** A board-walled shed front with a wide door (used by the officina). */
function plankWallShed(p: Pix, x: number, y: number, w: number, h: number): void {
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) p.set(x + c, y + r, r === 0 ? 'b' : c % 3 === 0 ? 'B' : c % 3 === 1 ? 'n' : 'B');
  door(p, x + 5, y + 3, 5, h - 3);
  p.rect(x + 6, y + h - 3, 2, 2, 'o');                                                       // forge glow inside
}

/** Registers this group's sprites with registerArt()/registerDraw() (no canvas work at registration). */
export function registerRural(): void {
  registerGrid('b_venatio', 32, 26, venatio);
  registerGrid('b_pabulatio', 32, 22, pabulatio);
  registerGrid('b_lignarius', 32, 26, lignarius);
  registerGrid('b_lignarius_logs', 16, 10, logPile);
  registerGrid('b_lapicidina', 48, 40, lapicidina);
  registerGrid('b_figlina', 32, 28, figlina);
  registerGrid('b_caementarium', 32, 26, caementarium);
  registerGrid('b_fodina', 32, 28, fodina);
  registerGrid('b_officina', 32, 30, officina);
}

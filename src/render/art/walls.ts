// src/render/art/walls.ts — linear set pieces (ARCHITECTURE §12.3 "Linear"): the vallum (earth bank and palisade) and
// the murus (tufa with crenels) autotiles l_<vallum|murus>_<h|v|c> 16×24, gatehouses l_gate_<timber|stone>_<h|v> 48×40,
// the aqueduct l_aqua_<ew|ns|pier> 16×28, the via bridge l_bridge 16×16 and the milestone n_milestone 6×10.
// Owner: WP-G (art, part 2). Tiles repeat with periods dividing 16 so neighbouring pieces join seamlessly; vertical
// pieces repeat every 16 rows so the overhang of the tile below continues the tile above.
import type { Grid } from '../sprites';
import { Pix, noise } from './brush';
import { RAMP, plankRoof } from './opus';
import type { Ramp } from './opus';

/** One palisade stake column at x (2 px log, lit left), tip at y0, foot at y1. */
function stake(p: Pix, x: number, y0: number, y1: number): void {
  p.set(x, y0, 'n');
  p.vline(x, y0 + 1, y1, 'n').vline(x + 1, y0 + 1, y1, 'B').set(x, y0 + 1, 'T');
  p.vline(x + 2, y0 + 2, y1, 'b');
}

/** The earth bank: a turfed crest over a sloped earthen face (lit left). */
function bank(p: Pix, x0: number, x1: number, y0: number, y1: number): void {
  p.shade(x0, y0, x1 - x0 + 1, y1 - y0 + 1, (X, Y) => {
    if (Y === y0) return noise(X, Y, 5) < 0.5 ? 'L' : 'd';
    if (Y === y1) return 'b';
    const n = noise(X, Y, 6);
    return n < 0.12 ? 'b' : n < 0.3 ? 'n' : 'B';
  });
}

/** l_vallum_h: palisade on an earth bank, running east–west. */
function vallumH(): Grid {
  const p = new Pix(16, 24);
  bank(p, 0, 15, 15, 23);
  for (let x = 0; x < 16; x += 4) stake(p, x, 3 + ((x / 4) % 2), 15);
  p.hline(0, 15, 9, 'b').hline(0, 15, 10, 'm');                                   // binding rail
  return p.rows();
}

/** l_vallum_v: the same rampart running north–south: stake tips seen from above along the bank's crest. */
function vallumV(): Grid {
  const p = new Pix(16, 24);
  for (let y = 0; y < 24; y++) {
    p.hline(3, 12, y, 'B');
    p.set(3, y, 'n').set(4, y, noise(3, y % 16, 7) < 0.5 ? 'L' : 'n').set(12, y, 'b').set(11, y, 'm');
    const m = y % 4;
    p.set(7, y, m === 0 ? 'T' : m === 3 ? 'b' : 'n').set(8, y, m === 0 ? 't' : m === 3 ? 'b' : 'B');
    p.set(6, y, m === 1 ? 'b' : null).set(9, y, m === 2 ? 'b' : null);
  }
  // the south foot of the bank
  p.rect(3, 20, 10, 4, 'B').hline(3, 12, 23, 'b').vline(3, 20, 22, 'n');
  return p.rows();
}

/** l_vallum_c: a timber corner tower (posts, platform, a little plank roof). */
function vallumC(): Grid {
  const p = new Pix(16, 24);
  bank(p, 0, 15, 17, 23);
  for (const x of [2, 12]) p.vline(x, 8, 19, 'n').vline(x + 1, 8, 19, 'b');
  p.line(3, 18, 12, 10, 'b');
  p.rect(1, 7, 14, 3, 'B').hline(1, 14, 7, 'n').hline(1, 14, 9, 'b');            // platform
  for (let x = 2; x < 14; x += 3) p.vline(x, 4, 6, 'n');
  plankRoof(p, 0, 0, 16, 4, 2);
  return p.rows();
}

/** l_murus_h: a tufa wall with crenels, running east–west. */
function murusH(): Grid {
  const p = new Pix(16, 24);
  // merlons (period 4)
  for (let x = 0; x < 16; x += 4) p.rect(x, 2, 2, 4, 'O').set(x, 2, 'a').vline(x + 1, 3, 5, 'Q');
  p.rect(0, 6, 16, 2, 'a').hline(0, 15, 7, 'i');                                 // wall walk coping
  for (let y = 8; y < 23; y++)
    for (let x = 0; x < 16; x++) {
      const course = (y - 8) % 3 === 2, joint = (x + (((y - 8) / 3) | 0) % 2 * 2) % 4 === 3;
      p.set(x, y, course || joint ? 'Q' : noise(x, y, 11) < 0.12 ? 'i' : 'O');
    }
  p.hline(0, 15, 8, 'Q').hline(0, 15, 23, 'X');
  return p.rows();
}

/** l_murus_v: the wall walk seen from above between two crenellated parapets, running north–south. */
function murusV(): Grid {
  const p = new Pix(16, 24);
  for (let y = 0; y < 24; y++) {
    const m = y % 4;
    p.hline(5, 10, y, (y % 3 === 0) ? 'i' : 'a');                                 // paved walk
    p.set(3, y, m < 2 ? 'a' : 'O').set(4, y, m < 2 ? 'i' : 'Q');                   // west parapet (lit)
    p.set(11, y, m < 2 ? 'O' : 'Q').set(12, y, m < 2 ? 'Q' : 'X');                 // east parapet (shade)
  }
  p.rect(3, 17, 10, 7, 'O').hline(3, 12, 17, 'a').vline(12, 18, 23, 'Q').hline(3, 12, 20, 'Q');   // south face
  return p.rows();
}

/** l_murus_c: a square stone tower with crenels and an arrow slit. */
function murusC(): Grid {
  const p = new Pix(16, 24);
  for (let x = 1; x < 15; x += 3) p.rect(x, 0, 2, 3, 'O').set(x, 0, 'a');
  p.rect(1, 3, 14, 5, 'i').rect(3, 4, 10, 3, 'Q').hline(1, 14, 3, 'a');           // top platform with hatch shadow
  for (let y = 8; y < 23; y++)
    for (let x = 1; x < 15; x++) p.set(x, y, (y - 8) % 3 === 2 || (x + ((y - 8) / 3 | 0) % 2 * 2) % 4 === 0 ? 'Q' : x < 3 ? 'i' : x > 12 ? 'Q' : 'O');
  p.hline(1, 14, 8, 'a').rect(7, 12, 2, 5, 'q').hline(1, 14, 23, 'X');
  return p.rows();
}

/** A tower block (top platform with battlement or railing, then the front face) at (x, y), w wide, face of fh rows. */
function tower(p: Pix, x: number, y: number, w: number, fh: number, stone: boolean): void {
  const ramp: Ramp = stone ? RAMP.tufa : RAMP.plank;
  const [hi, li, base, sh, dk] = ramp;
  if (stone) {
    for (let c = 0; c < w; c += 3) p.rect(x + c, y, 2, 3, base).set(x + c, y, hi);
    p.rect(x, y + 3, w, 5, li).rect(x + 2, y + 4, w - 4, 3, sh).hline(x, x + w - 1, y + 3, hi);
  } else {
    plankRoof(p, x - 1, y, w + 2, 5, 3);
    p.rect(x, y + 5, w, 3, 'q');
    for (let c = 1; c < w; c += 3) p.vline(x + c, y + 5, y + 7, 'n');
  }
  for (let r = 0; r < fh; r++)
    for (let c = 0; c < w; c++) {
      let k = c < 2 ? li : c >= w - 2 ? sh : base;
      if (stone ? (r % 3 === 2 || (c + ((r / 3) | 0) % 2 * 2) % 4 === 0) : c % 3 === 0) k = stone ? sh : dk;
      p.set(x + c, y + 8 + r, r === 0 ? dk : k);
    }
  p.rect(x + Math.floor(w / 2) - 1, y + 11, 2, 4, 'q');
}

/** l_gate_<m>_h: two towers flanking the gate passage in an east–west wall, a walkway over the open gate. */
function gateH(stone: boolean): Grid {
  const p = new Pix(48, 40);
  const wall = stone ? murusH() : vallumH();
  for (const x of [0, 32]) p.stamp(wall, x, 16);
  p.rect(16, 16, 16, 24, '.');
  tower(p, 3, 4, 13, 28, stone);
  tower(p, 32, 4, 13, 28, stone);
  // the walkway over the passage and the shadowed gateway (the road shows below)
  const [hi, li, base, sh] = stone ? RAMP.tufa : RAMP.plank;
  p.rect(16, 12, 16, 8, base).hline(16, 31, 12, hi).hline(16, 31, 19, sh).hline(16, 31, 13, li);
  if (stone) {
    for (let x = 16; x < 32; x += 3) p.rect(x, 9, 2, 3, base).set(x, 9, hi);
    p.shade(16, 20, 16, 8, (X, Y) => {
      const dx = X + 0.5 - 24, dy = Y + 0.5 - 28;
      return dx * dx + dy * dy <= 64 && Y < 28 ? 'K' : Y < 28 ? sh : null;
    });
  } else {
    for (let x = 17; x < 32; x += 3) p.vline(x, 9, 11, 'n');
    p.rect(16, 20, 16, 3, 'K');
    p.vline(16, 20, 39, 'b').vline(31, 20, 39, 'b');                            // gate posts
    p.rect(17, 23, 3, 16, 'B').rect(28, 23, 3, 16, 'B');                         // open leaves
  }
  p.vline(16, 20, 39, sh).vline(31, 20, 39, li);
  return p.rows();
}

/** l_gate_<m>_v: a gate in a north–south wall: towers north and south of the passage joined by a walkway. */
function gateV(stone: boolean): Grid {
  const p = new Pix(48, 40);
  const [hi, li, base, sh] = stone ? RAMP.tufa : RAMP.plank;
  tower(p, 16, 0, 16, 14, stone);
  // the walkway bridging the road (seen from above), shadow on the road at both sides
  p.rect(18, 22, 12, 7, base);
  for (let y = 22; y < 29; y++) p.set(18, y, hi).set(29, y, sh);
  if (!stone) for (let y = 23; y < 29; y += 2) p.hline(19, 28, y, 'b');
  else p.shade(19, 22, 10, 7, (X, Y) => ((X + Y) % 4 === 0 ? li : null));
  p.hline(18, 29, 29, 'K').hline(18, 29, 30, 'K');
  // south tower: its top and a short front face
  tower(p, 16, 28, 16, 4, stone);
  return p.rows();
}

/** l_aqua_ew: one arch of the aqueduct running east–west, channel on top. */
function aquaEW(): Grid {
  const p = new Pix(16, 28);
  p.rect(0, 0, 16, 2, 'a').hline(0, 15, 1, 'M').hline(0, 15, 0, 'c');             // the water channel seen from above
  p.hline(0, 15, 2, 'w').hline(0, 15, 3, 'i');                                     // coping
  for (let y = 4; y < 28; y++)
    for (let x = 0; x < 16; x++) p.set(x, y, (y - 4) % 4 === 3 || (x + ((y - 4) >> 2) % 2 * 2) % 4 === 0 ? 'Q' : x < 3 ? 'a' : 'O');
  // the arch opening between the piers (the ground shows through)
  p.shade(3, 9, 10, 19, (X, Y) => {
    const dx = X + 0.5 - 8, dy = Y + 0.5 - 14;
    const inside = Y >= 14 ? true : dx * dx + dy * dy <= 25;
    if (!inside) return dx * dx + dy * dy <= 36 && Y < 14 ? 'i' : null;           // voussoirs
    return Y < 15 ? 'K' : '.';
  });
  p.vline(3, 14, 27, 'i').vline(12, 14, 27, 'Q');
  return p.rows();
}

/** l_aqua_ns: the aqueduct running north–south: the channel strip on top, the pier's south face at the foot. */
function aquaNS(): Grid {
  const p = new Pix(16, 28);
  for (let y = 0; y < 16; y++) {
    p.set(4, y, 'a').set(5, y, 'w').hline(6, 9, y, y % 4 === 0 ? 'c' : 'M').set(10, y, 'i').set(11, y, 'Q');
    if (y % 8 === 0) p.set(7, y, 'w');
  }
  for (let y = 16; y < 28; y++)
    for (let x = 4; x < 12; x++) p.set(x, y, y === 16 ? 'i' : (y - 16) % 4 === 3 ? 'Q' : x === 4 ? 'a' : x === 11 ? 'Q' : 'O');
  return p.rows();
}

/** l_aqua_pier: a junction pier with a settling basin. */
function aquaPier(): Grid {
  const p = new Pix(16, 28);
  p.rect(2, 0, 12, 8, 'a').rect(4, 2, 8, 4, 'M').hline(4, 11, 2, 'C').set(6, 3, 'c').set(9, 4, 'c').vline(13, 1, 7, 'i');
  for (let y = 8; y < 28; y++)
    for (let x = 3; x < 13; x++) p.set(x, y, y === 8 ? 'w' : (y - 8) % 4 === 3 || (x + ((y - 8) >> 2) % 2 * 2) % 4 === 0 ? 'Q' : x < 5 ? 'a' : x > 10 ? 'Q' : 'O');
  return p.rows();
}

/** l_bridge: a timber deck over the river, railings and piles, repeating east–west. */
function bridge(): Grid {
  const p = new Pix(16, 16);
  for (let y = 4; y < 12; y++) for (let x = 0; x < 16; x++) p.set(x, y, x % 4 === 3 ? 'b' : x % 4 === 0 ? 'n' : 'B');
  p.hline(0, 15, 4, 'n');
  for (const y of [2, 12]) p.hline(0, 15, y, 'n').hline(0, 15, y + 1, 'b');       // railings
  for (const x of [1, 9]) { p.vline(x, 1, 3, 'B').set(x, 1, 'n'); p.vline(x, 12, 15, 'b').vline(x + 1, 14, 15, 'm'); }
  return p.rows();
}

const MILESTONE: Grid = [
  '.kkkk.',
  'kawiik',
  'kaiiOk',
  'kiQQOk',
  'kaiiOk',
  'kiQQOk',
  'kaiiOk',
  'kaiiQk',
  'kOOQQk',
  '.kkkk.',
];

/** The linear sprites by name with their sizes (outline: walls and gates get the umber rim, the aqueduct too). */
export function linearSprites(): { name: string; w: number; h: number; build: () => Grid }[] {
  const out: { name: string; w: number; h: number; build: () => Grid }[] = [
    { name: 'l_vallum_h', w: 16, h: 24, build: vallumH },
    { name: 'l_vallum_v', w: 16, h: 24, build: vallumV },
    { name: 'l_vallum_c', w: 16, h: 24, build: vallumC },
    { name: 'l_murus_h', w: 16, h: 24, build: murusH },
    { name: 'l_murus_v', w: 16, h: 24, build: murusV },
    { name: 'l_murus_c', w: 16, h: 24, build: murusC },
    { name: 'l_aqua_ew', w: 16, h: 28, build: aquaEW },
    { name: 'l_aqua_ns', w: 16, h: 28, build: aquaNS },
    { name: 'l_aqua_pier', w: 16, h: 28, build: aquaPier },
    { name: 'l_bridge', w: 16, h: 16, build: bridge },
    { name: 'n_milestone', w: 6, h: 10, build: () => MILESTONE },
  ];
  for (const m of ['timber', 'stone'] as const) {
    out.push({ name: `l_gate_${m}_h`, w: 48, h: 40, build: () => gateH(m === 'stone') });
    out.push({ name: `l_gate_${m}_v`, w: 48, h: 40, build: () => gateV(m === 'stone') });
  }
  return out;
}

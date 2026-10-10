// src/render/art/capitolium.ts — the Capitolium p_capitolium_1..4 (144×96: the 9×4 Area Capitolina plus a 32 px
// overhang) in its four cumulative stages (DESIGN §9.5: Podium, Cella, Columnae, Fastigium) and the three crowning
// groups p_crown_* (32×24) of the Colonia path. Owner: WP-G (art, part 2).
// Crown anchor: WP-F draws the crown with its top-left at CROWN_AT (56, −10) relative to p_capitolium_4's top-left, so
// the group's plinth stands on the pediment's apex (y 12); it overhangs the sprite's top edge by 10 px.
import type { Grid } from '../sprites';
import { Pix, noise } from './brush';
import { RAMP } from './opus';
import { flagstones, pediment } from './civitas';

export const CAP_W = 144, CAP_H = 96;
/** Where the crowning group sits on p_capitolium_4 (top-left of the 32×24 crown sprite). */
export const CROWN_AT = { x: 56, y: -10 } as const;

const CX = 72;                         // the temple's axis
const POD_TOP = 58, POD_FACE = 80;     // podium top surface (y) and the top of its front face

/** Stage I — the podium: a travertine-faced platform with a broad front stair (open to the sacred way). */
function podium(p: Pix): void {
  // top surface and front face
  flagstones(p, 6, POD_TOP, 132, POD_FACE - POD_TOP, ['a', 'a', 'i', 'O', 'Q'], 301, 10, 6);
  p.hline(6, 137, POD_TOP, 'w');
  for (let y = POD_FACE; y < 95; y++)
    for (let x = 6; x < 138; x++) {
      const course = (y - POD_FACE) % 4 === 3, joint = (x + ((y - POD_FACE) >> 2) % 2 * 4) % 8 === 0;
      p.set(x, y, y === POD_FACE ? 'a' : course || joint ? 'Q' : x < 10 ? 'i' : x > 133 ? 'Q' : 'O');
    }
  p.hline(6, 137, 94, 'X');
  // the front stair, cut into the face
  for (let y = POD_FACE - 4; y < 95; y++) {
    const step = (y - (POD_FACE - 4)) % 2 === 0;
    p.hline(CX - 26, CX + 25, y, step ? 'a' : 'i');
  }
  p.vline(CX - 27, POD_FACE - 4, 94, 'O').vline(CX + 26, POD_FACE - 4, 94, 'Q');
  // altar in front of the stair
  p.rect(CX - 5, 88, 10, 6, 'a').hline(CX - 5, CX + 4, 88, 'w').vline(CX + 4, 89, 93, 'i').set(CX, 87, 'o').set(CX, 86, 'y');
}

/** Stage II — the cella walls of the three shrines (Iuppiter, Iuno, Minerva), roofless, with three bronze doors. */
function cella(p: Pix, roofed: boolean): void {
  const x0 = 22, x1 = 121, top = 34, face = 46;
  // wall tops seen from above, enclosing the shadowed interior
  p.rect(x0, top, x1 - x0 + 1, face - top, 'a');
  p.rect(x0 + 3, top + 2, x1 - x0 - 5, face - top - 2, 'Q');
  for (const x of [55, 88]) p.rect(x, top + 2, 3, face - top - 2, 'a');                 // walls between the three cellae
  p.shade(x0 + 3, top + 2, x1 - x0 - 5, 3, (_X, _Y, k) => (k === 'Q' ? 'X' : null));     // inner shadow under the north wall
  if (roofed) {
    // under the finished roof: the porch's shaded back wall and coffered ceiling instead of the open cellae
    p.rect(x0 - 12, top - 4, x1 - x0 + 25, face - top + 4, 'i');
    p.shade(x0 - 12, top - 4, x1 - x0 + 25, face - top + 4, (X, Y) => (Y < top ? 'O' : (X + Y) % 6 === 0 && Y < top + 4 ? 'O' : null));
  }
  // the front wall face
  for (let y = face; y < POD_TOP + 4; y++)
    for (let x = x0; x <= x1; x++) {
      const course = (y - face) % 4 === 3;
      p.set(x, y, y === face ? 'w' : course ? 'i' : x < x0 + 3 ? 'w' : x > x1 - 3 ? 'i' : 'a');
    }
  for (const dx of [-33, 0, 33]) {
    const w = dx === 0 ? 12 : 9, x = CX + dx - Math.floor(w / 2);
    p.rect(x, POD_TOP - 8, w, 12, 'N');
    p.shade(x, POD_TOP - 8, w, 12, (X, Y) => (X === x + Math.floor(w / 2) ? 'Q' : (X + Y) % 4 === 0 ? 'y' : null));
    p.hline(x - 1, x + w, POD_TOP - 9, 'w');
  }
}

/** Stage III — the colonnade: six tall columns across the front porch and pilasters along the flanks, with architrave. */
function columns(p: Pix): void {
  const top = 30, foot = POD_TOP + 6;
  const shaft = (x: number, w: number): void => {
    for (let y = top + 3; y < foot; y++)
      for (let c = 0; c < w; c++) p.set(x + c, y, c === 0 ? 'w' : c === w - 1 ? 'i' : c === w - 2 ? 'a' : (y % 3 === 0 ? 'a' : 'w'));
    p.rect(x - 1, top + 1, w + 2, 2, 'a').hline(x - 1, x + w, top + 1, 'w');          // capital
    p.rect(x - 1, foot - 1, w + 2, 2, 'i').hline(x - 1, x + w, foot, 'O');             // base
  };
  for (let i = 0; i < 6; i++) shaft(16 + i * 22, 6);
  for (const x of [10, 132]) shaft(x, 3);
  // architrave and frieze
  p.rect(8, top - 4, 128, 5, 'a');
  p.hline(8, 135, top - 4, 'w').hline(8, 135, top, 'i');
  for (let x = 12; x < 134; x += 6) p.rect(x, top - 2, 2, 2, 'O');                       // triglyph rhythm
}

/** Stage IV — the fastigium: the tiled roof running back from a carved pediment, gilded acroteria at the corners. */
function fastigium(p: Pix): void {
  const apex = 12, base = 26, half = 64, depth = 10;
  // the roof's two slopes recede from the pediment towards the north (parallelograms)
  for (let y = apex - depth; y <= base; y++)
    for (let x = CX - half; x <= CX + half; x++) {
      const dx = Math.abs(x - CX);
      const eave = apex + (dx * (base - apex)) / half;                  // the front (pediment) edge at this x
      if (y < eave - depth || y > eave) continue;
      const left = x <= CX, t = Math.round(eave - y);
      let k = left ? (dx % 3 === 0 ? 'o' : 'u') : dx % 3 === 0 ? 'u' : 'v';
      if (t % 3 === 0) k = left ? 's' : 'R';
      if (y <= Math.ceil(eave - depth)) k = left ? 's' : 'v';
      p.set(x, y, k);
    }
  p.vline(CX, apex - depth, apex, 'o');
  pediment(p, CX, apex, half, base - apex, RAMP.marble, 'i');
  // relief figures in the tympanum
  for (const dx of [-30, -18, -6, 6, 18, 30]) p.stamp(['.w.', 'wiw', '.i.', 'w.i'], CX + dx - 1, 18 + Math.round(Math.abs(dx) / 12));
  // gilded acroteria at the corners and the apex
  for (const x of [CX - half, CX + half]) p.stamp(['.y.', 'yNy', 'NNN'], x - 1, base - 3);
}

/** One Capitolium stage (1..4), cumulative. */
export function capitolium(stage: 1 | 2 | 3 | 4): Grid {
  const p = new Pix(CAP_W, CAP_H);
  podium(p);
  if (stage >= 2) cella(p, stage >= 4);
  if (stage >= 3) columns(p);
  if (stage >= 4) fastigium(p);
  // a few pale specks of marble dust on the work
  if (stage < 4) p.shade(8, POD_TOP, 128, 6, (X, Y, k) => (k !== '.' && noise(X, Y, 309) < 0.04 ? 'w' : null));
  return p.rows();
}

/** p_crown_iuppiter: a gilded quadriga — four horses abreast, rearing, the god behind them with the thunderbolt raised. */
function crownIuppiter(): Grid {
  const p = new Pix(32, 24);
  // the god in the chariot
  p.stamp([
    '.....y',
    '....yN',
    '..NyN.',
    '.yNN..',
    'yNNNNQ',
    'NNNNNQ',
  ], 12, 1);
  p.rect(8, 7, 17, 2, 'N').hline(8, 24, 7, 'y').set(24, 8, 'Q');                         // chariot rim
  // four horses abreast: ears, heads, chests, forelegs (the outer pair rearing)
  for (let i = 0; i < 4; i++) {
    const x = 6 + i * 5, rear = i === 0 || i === 3 ? -1 : 0;
    p.set(x, 9 + rear, 'N').set(x + 2, 9 + rear, 'N');
    p.hline(x, x + 2, 10 + rear, 'N').set(x + 1, 10 + rear, 'y');
    p.hline(x, x + 2, 11 + rear, 'N').hline(x, x + 2, 12 + rear, 'N').set(x + 2, 12 + rear, 'Q');
    p.rect(x - 1, 13, 5, 3, 'N').set(x - 1, 13, 'y').set(x, 13, 'y').vline(x + 3, 13, 15, 'Q');
    if (rear) { p.line(x - 1, 16, x - 2, 14, 'N').vline(x + 2, 16, 20, 'N'); }
    else { p.vline(x, 16, 20, 'N').vline(x + 2, 16, 20, 'N'); }
  }
  p.rect(5, 21, 23, 2, 'a').hline(5, 27, 21, 'w');                                       // plinth
  return p.rows();
}

/** p_crown_aeternitas: a gilded eagle, wings spread, on a globe. */
function crownAeternitas(): Grid {
  return [
    '................................',
    '..y........................y....',
    '..Ny......................yN....',
    '..NNy....................yNN....',
    '...NNy.......y..........yNN.....',
    '...NNNy.....yNy........yNNN.....',
    '....NNNy....NNN.......yNNN......',
    '....NNNNy..yNNNy.....yNNNN......',
    '.....NNNNyyNNNNNyy..yNNNN.......',
    '.....yNNNNNNNNNNNNNyNNNNQ.......',
    '......yNNNNNNNNNNNNNNNNQ........',
    '.......NNNNNNNNNNNNNNNQ.........',
    '........QNNNNNNNNNNNQQ..........',
    '..........QNNNNNNNQQ............',
    '...........NyN.NyN..............',
    '..........NNyNNNNNN.............',
    '..........NyyyNNNNQ.............',
    '.........NyyNNNNNNQQ............',
    '.........NyNNNNNNNNQ............',
    '..........NNNNNNNQQ.............',
    '...........QNNNNQQ..............',
    '.........aaaaaaaaaaa............',
    '.........wwwwwwwwwwi............',
    '................................',
  ].map((r) => r.slice(0, 32));
}

/** p_crown_imperium: the bronze she-wolf with the twins between two imperial standards. */
function crownImperium(): Grid {
  const p = new Pix(32, 24);
  // standards
  for (const x of [3, 28]) {
    p.vline(x, 2, 22, 'b');
    p.stamp(['.y.', 'yNy', '.N.'], x - 1, 0);
    p.rect(x - 2, 4, 5, 5, 'I').hline(x - 2, x + 2, 9, 'N').set(x, 6, 'N');
    for (const dy of [12, 16]) p.rect(x - 1, dy, 3, 2, 'N').set(x - 1, dy, 'y');
  }
  p.stamp([
    '...NN...............',
    '..NNyN..............',
    '.NNNNNNNNNNNNNNNy...',
    'NNNyNNNNNNNNNNNNNNy.',
    '.N.NNNNNNNNNNNNNNNNN',
    '...QNNNyyNNNNNNNNNQN',
    '...QN.NhhN.hhN..NQ.N',
    '...Q..NhHN.hHN..N...',
    '...Q..N.......N.Q...',
    '...QQ.QQ......QQQ...',
  ].map((r) => r.replace(/Q/g, 'Q')), 7, 9);
  p.rect(6, 19, 21, 3, 'a').hline(6, 26, 19, 'w').hline(6, 26, 21, 'i');
  return p.rows();
}

/** The Capitolium stages and the crowns by sprite name, with their sizes. */
export function capitoliumSprites(): { name: string; w: number; h: number; build: () => Grid }[] {
  return [
    ...([1, 2, 3, 4] as const).map((k) => ({ name: `p_capitolium_${k}`, w: CAP_W, h: CAP_H, build: () => capitolium(k) })),
    { name: 'p_crown_iuppiter', w: 32, h: 24, build: crownIuppiter },
    { name: 'p_crown_aeternitas', w: 32, h: 24, build: crownAeternitas },
    { name: 'p_crown_imperium', w: 32, h: 24, build: crownImperium },
  ];
}

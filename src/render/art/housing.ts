// src/render/art/housing.ts — 6 tiers × 2 variants, aquae variants, building overlays (DESIGN §16.3). Owner: WP-G (G1).
// Every house is 32 px wide, bottom-aligned to its 2×2 plot; roofs mature from red tents → thatch → terracotta.
import { registerArt } from '../sprites';
import { Pix } from './gridkit';
import { door, gableRoof, hipRoof, stoneWall, wall, windowAt } from './facade';

// ───────────────────────────── T0 tentoria ─────────────────────────────

/**
 * A legion ridge tent (papilio) in 3/4 view, ridge running away from the viewer: the lit left plane, the shaded right
 * plane, and the front panel (low side walls + gable) with its door flaps pinned back.
 */
function tent(p: Pix, x: number, ground: number, half: number, depth: number, walls = 2): void {
  const m = x + half;
  for (let k = 0; k <= half; k++) {
    const edge = ground - walls - k;
    for (let j = edge - depth; j < edge; j++) { p.set(x + k, j, 'o'); p.set(x + 2 * half - k, j, 'F'); }
    for (let j = edge; j <= ground; j++) { p.set(x + k, j, 'r'); p.set(x + 2 * half - k, j, 'r'); }
    p.set(x + k, edge, 'F');
    p.set(x + 2 * half - k, edge, 'k');
  }
  p.vline(m, ground - walls - half - depth, ground - walls - half - 1, 'Y');           // ridge pole line
  p.vline(m, ground - walls - half - depth - 1, ground - walls - half - depth - 1, 'n');
  // door: dark opening, flaps pinned back showing the pale lining
  for (let r = 0; r < 5; r++) p.hline(m - (r >> 1), m + (r >> 1), ground - 4 + r, 'q');
  p.set(m - 2, ground - 1, 'T').set(m - 3, ground, 'T').set(m + 2, ground - 1, 't').set(m + 3, ground, 't');
}

/** Guy rope from a tent's back corner out to a peg on the ground. */
function guy(p: Pix, x0: number, y0: number, x1: number, y1: number): void {
  p.line(x0, y0, x1, y1, 'E');
  p.set(x1, y1 + 1, 'b');
}

function tentoria(v: 0 | 1): string[] {
  const p = new Pix(32, 20);
  if (v === 0) {
    guy(p, 2, 10, 1, 16);
    guy(p, 29, 10, 30, 16);
    tent(p, 2, 18, 6, 6);
    tent(p, 17, 18, 6, 6);
  } else {
    guy(p, 1, 9, 0, 16);
    tent(p, 1, 18, 7, 7);
    tent(p, 19, 16, 5, 5);
    // a scutum and a pilum leaning by the small tent
    p.vline(29, 5, 18, 'n').set(29, 4, 'z');
    p.rect(25, 13, 4, 6, 'r').vline(28, 13, 18, 'F').hline(25, 28, 13, 'o');
    p.set(26, 15, 'N').set(27, 15, 'N').set(26, 16, 'N').set(27, 16, 'Y');
  }
  return p.outline().rows();
}

// ───────────────────────────── T1 casa ─────────────────────────────

/** A thatched hip roof: rounded corners, combed straw strands (lit left, shaded right), bound ridge, ragged eave. */
function thatch(p: Pix, x: number, y: number, w: number, h: number): void {
  const round = [3, 2, 1, 1];
  for (let j = 0; j < h; j++) {
    const ins = round[j] ?? 0;
    for (let i = x + ins; i < x + w - ins; i++) {
      const rel = (i - x) / (w - 1);
      const strand = (i * 7 + (j >> 1) * 3) % 5 === 0;
      let c = rel < 0.28 ? 'T' : rel > 0.72 ? 'E' : 'e';
      if (strand) c = rel < 0.28 ? 'e' : rel > 0.72 ? 'n' : 'E';
      p.set(i, y + j, c);
    }
  }
  p.hline(x + 4, x + w - 5, y + 1, 'n');               // bound ridge bundle
  p.hline(x + 4, x + w - 5, y + 2, 'E');
  for (let i = x + 5; i < x + w - 5; i += 4) p.set(i, y + 1, 'b');
  for (let i = x; i < x + w; i++) {                      // ragged eave
    p.set(i, y + h - 2, i % 3 === 0 ? 'n' : 'E');
    p.set(i, y + h - 1, i % 2 === 0 ? 'E' : '.');
  }
}

/** Wattle-and-daub wall: daub with darker patches, timber posts at the ends and the middle. */
function daub(p: Pix, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, h, 't');
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if ((i * 5 + j * 3) % 11 === 0) p.set(i, j, 'n');
  p.hline(x, x + w - 1, y, 'k');
  for (const px of [x, x + w - 1]) p.vline(px, y + 1, y + h - 1, 'B');
  p.vline(x + w - 1, y + 1, y + h - 1, 'b');
}

function casa(v: 0 | 1): string[] {
  const p = new Pix(32, 24);
  if (v === 0) {
    daub(p, 4, 14, 24, 9);
    door(p, 8, 16, 5, 7, false);
    windowAt(p, 18, 17, 3, 2);
    p.vline(25, 18, 22, 'n').set(25, 17, 'b');                     // a hoe leaning on the wall
    thatch(p, 1, 1, 30, 15);
  } else {
    // a round casa (after the Casa Romuli): curved daub wall, conical thatch with a smoke hole
    p.ellipse(5, 10, 22, 13, 't');
    for (let j = 10; j < 23; j++) for (let i = 5; i < 27; i++) {
      if (p.get(i, j) !== 't') continue;
      if (i > 21) p.set(i, j, 'n');
      else if ((i * 5 + j * 3) % 11 === 0) p.set(i, j, 'n');
    }
    door(p, 13, 15, 5, 7, false);
    for (let j = 0; j < 14; j++) {
      const half = Math.min(14, 2 + Math.round(j * 1.05));
      for (let i = 16 - half; i <= 15 + half; i++) {
        const rel = (i - (16 - half)) / (2 * half);
        const strand = (i * 7 + j * 2) % 5 === 0;
        p.set(i, j + 1, strand ? (rel > 0.65 ? 'n' : 'E') : rel < 0.3 ? 'T' : rel > 0.65 ? 'E' : 'e');
      }
    }
    for (let i = 2; i < 30; i++) p.set(i, 14, i % 2 ? 'E' : '.');
    p.hline(14, 17, 1, 'b').hline(15, 16, 0, 'K');
    // a little woodpile
    p.rect(26, 19, 4, 3, 'B').hline(26, 29, 19, 'n').set(27, 20, 't').set(29, 21, 't');
  }
  return p.outline().rows();
}

// ───────────────────────────── T2 casa tegulata ─────────────────────────────

/** A vine pergola: two posts under a leafy canopy with drooping tendrils and grape clusters. */
function pergola(p: Pix, x0: number, x1: number, top: number, ground: number): void {
  p.vline(x0, top + 3, ground, 'B').vline(x1, top + 3, ground, 'b');
  for (let j = top; j < top + 4; j++)
    for (let i = x0 - 2; i <= x1 + 1; i++) {
      if ((j === top && (i < x0 || i > x1)) || (j === top + 3 && (i + j) % 3 === 0)) continue;
      const k = (i * 5 + j * 3) % 7;
      p.set(i, j, j === top ? (k < 3 ? 'l' : 'L') : k === 0 ? 'd' : k < 3 ? 'V' : 'L');
    }
  for (const [x, y] of [[x0 - 1, top + 4], [x0 + 2, top + 4], [x1, top + 5]]) p.set(x, y, 'L');
  p.set(x0 + 1, top + 4, 'P').set(x0 + 1, top + 5, 'p').set(x1 - 1, top + 4, 'P').set(x1 - 1, top + 5, 'P');
}

function tegulata(v: 0 | 1): string[] {
  const p = new Pix(32, 26);
  if (v === 0) {
    hipRoof(p, 1, 1, 30, 13, 4, 9);
    wall(p, 3, 14, 26, 10, 's', 't', 2);
    p.hline(3, 28, 14, 'k');
    door(p, 7, 16, 6, 8, true);
    windowAt(p, 17, 17, 3, 2, true);
    windowAt(p, 23, 17, 3, 2, true);
    p.set(5, 22, 'u').set(5, 21, 'L').set(4, 21, 'l');                // a pot of herbs by the door
  } else {
    wall(p, 4, 12, 19, 12, 'a', 'i', 2);
    const apex = gableRoof(p, 3, 23, 14, 9);
    for (let k = 1; k < 10; k++) p.hline(3 + k + 1, 23 - k - 1, apex + 10 - k, 'a');  // gable wall under the verge
    p.set(13, apex + 4, 'q').set(13, apex + 5, 'q');                                      // vent slot
    door(p, 10, 16, 6, 8, true);
    windowAt(p, 18, 17, 2, 3);
    pergola(p, 26, 30, 12, 24);
  }
  return p.outline().rows();
}

// ───────────────────────────── T3 domus parva ─────────────────────────────

function domusParva(v: 0 | 1): string[] {
  const p = new Pix(32, 30);
  if (v === 0) {
    hipRoof(p, 1, 1, 30, 11, 3, 8);
    wall(p, 3, 12, 26, 8, 's', 't');
    p.hline(3, 28, 12, 'k');
    windowAt(p, 6, 14, 3, 3, true);
    windowAt(p, 14, 14, 3, 3, true);
    windowAt(p, 23, 14, 3, 3, true);
    p.hline(3, 28, 19, 'a').hline(3, 28, 20, 'i');                     // string course
    stoneWall(p, 3, 21, 26, 7);
    door(p, 18, 21, 6, 7, true);
    p.rect(7, 23, 3, 2, 'k').set(8, 23, 'X').set(8, 24, 'X');          // barred window
    p.hline(3, 28, 28, 'Q');
  } else {
    // main block with a balcony + a low annex with a lean-to roof
    hipRoof(p, 1, 1, 22, 11, 3, 6);
    wall(p, 3, 12, 18, 8, 's', 't');
    p.hline(3, 20, 12, 'k');
    windowAt(p, 6, 14, 3, 2);
    windowAt(p, 14, 14, 3, 2);
    p.hline(2, 21, 16, 'n');                                           // balcony rail, balusters, deck
    for (let i = 2; i <= 21; i += 2) p.set(i, 17, 'B');
    p.hline(2, 21, 18, 'B').hline(2, 21, 19, 'b');
    stoneWall(p, 3, 20, 18, 8);
    door(p, 9, 21, 5, 7, true);
    p.rect(22, 13, 9, 3, 'u').hline(22, 30, 13, 'o').hline(22, 30, 15, 'v');
    for (let i = 24; i <= 30; i += 3) p.vline(i, 13, 14, 'v');
    p.hline(22, 29, 16, 'k');
    wall(p, 22, 17, 8, 11, 'a', 'i', 2);
    windowAt(p, 24, 19, 3, 2);
    p.hline(3, 29, 28, 'Q');
  }
  return p.outline().rows();
}

// ───────────────────────────── T4 insula ─────────────────────────────

/** Brick facing (opus testaceum): tan brick courses, pale mortar beds every third row, staggered joints. */
function brick(p: Pix, x: number, y: number, w: number, h: number): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      const r = j - y;
      p.set(i, j, r % 3 === 2 || (i + (r % 6 < 3 ? 0 : 2)) % 5 === 4 ? 't' : 'n');
    }
  p.vline(x + w - 1, y, y + h - 1, 'B');
}

/** A row of four windows with sills; `pots` puts flower pots on alternate sills; `arches` adds brick relieving arches. */
function windowRow(p: Pix, y: number, pots: boolean, arches: boolean): void {
  for (let k = 0; k < 4; k++) {
    const x = 5 + k * 6;
    windowAt(p, x, y, 3, 3);
    if (arches) p.hline(x, x + 2, y - 1, 'u').set(x - 1, y, 'u').set(x + 3, y, 'u');
    if (pots && k % 2 === 1) p.set(x, y + 2, 'L').set(x + 1, y + 2, 'f').set(x + 2, y + 2, 'L');
  }
}

/** A wooden balcony (maenianum) across the facade with its top rail on row y. */
function balcony(p: Pix, y: number): void {
  p.hline(2, 29, y, 'n');
  for (let i = 2; i <= 29; i += 2) p.set(i, y + 1, 'B');
  p.hline(2, 29, y + 2, 'B').hline(2, 29, y + 3, 'b');
  for (let i = 5; i <= 27; i += 7) p.set(i, y + 4, 'b');
}

function insula(v: 0 | 1, storeys: number, h: number): string[] {
  const p = new Pix(32, h);
  const roofH = 8, floorH = 10;
  hipRoof(p, 1, 1, 30, roofH, 2, 6);
  const top = roofH + 1;
  const isBrick = v === 0;
  if (isBrick) brick(p, 3, top, 26, h - top - 1);
  else wall(p, 3, top, 26, h - top - 1, 's', 't');
  p.hline(3, 28, top, 'k');
  const upper = storeys - 1;
  for (let f = 0; f < upper; f++) {
    const fy = top + f * floorH;
    windowRow(p, fy + 2, f % 2 === 0, isBrick);
    if (!isBrick) p.hline(3, 28, fy + floorH - 1, 'F');                  // painted band at each floor
    else p.hline(3, 28, fy + floorH - 1, 'B');
    if (f === upper - 1 || (!isBrick && f === upper - 2)) balcony(p, fy + 6);
  }
  // ground floor: tiled pent roof over the tabernae, wide shop openings either side of the stair door
  const gy = top + upper * floorH;
  p.hline(2, 29, gy, 'o').hline(2, 29, gy + 1, 'u').hline(2, 29, gy + 2, 'v');
  for (let i = 3; i < 29; i += 3) p.set(i, gy + 1, 'v');
  const sh = h - gy - 5;
  door(p, 4, gy + 3, 8, sh, false, 'q');
  door(p, 20, gy + 3, 8, sh, false, 'q');
  p.hline(5, 10, h - 5, 'n').hline(21, 26, h - 5, 'n').rect(5, h - 4, 6, 2, 'B').rect(21, h - 4, 6, 2, 'B');
  p.set(6, h - 6, 'u').set(8, h - 6, 'Y').set(23, h - 6, 'V').set(25, h - 6, 'u');   // goods on the counters
  door(p, 14, gy + 4, 4, h - gy - 6, true);
  p.hline(3, 28, h - 2, 'Q');
  if (storeys > 3) {                                                    // aquae: a lead-fed basin at the corner
    p.rect(26, h - 5, 4, 3, 'a').hline(27, 28, h - 5, 'M').set(27, h - 6, 'c').vline(29, h - 9, h - 6, 'X');
  }
  return p.outline().rows();
}

// ───────────────────────────── T4 domus ─────────────────────────────

/** The roof opening over the atrium (compluvium) and what shows through it: red far wall, floor, basin or garden. */
function compluvium(p: Pix, x: number, y: number, w: number, h: number, aquae: boolean): void {
  p.hline(x - 1, x + w, y + h, 'v').vline(x - 1, y, y + h, 'v').vline(x + w, y, y + h, 'o');   // tiles turned inward
  p.hline(x, x + w - 1, y, 'k');                                       // shadow under the far eave
  p.hline(x, x + w - 1, y + 1, 'F');                                   // red-painted far wall
  const fy = y + 2, fh = h - 2;
  for (let j = fy; j < fy + fh; j++) for (let i = x; i < x + w; i++) p.set(i, j, aquae ? ((i + j) % 3 ? 'L' : 'l') : (i + j) % 2 ? 'a' : 'i');
  p.vline(x, y + 1, y + h - 1, aquae ? 'd' : 'Q');                     // the shaded west side
  const cx = x + (w >> 1);
  if (aquae) {                                                          // peristyle garden with a fountain
    p.rect(cx - 3, fy + 1, 6, 3, 'a').rect(cx - 2, fy + 2, 4, 1, 'M').hline(cx - 2, cx + 1, fy + 3, 'i');
    p.set(cx - 1, fy, 'c').set(cx - 1, fy - 1, 'w').set(cx - 1, fy + 1, 'c');
  } else {                                                              // the impluvium basin
    p.rect(cx - 4, fy + 1, 8, fh - 2, 'w');
    p.rect(cx - 3, fy + 2, 6, fh - 4, 'M').hline(cx - 3, cx - 1, fy + 2, 'c');
  }
}

function domus(v: 0 | 1, aquae: boolean): string[] {
  const p = new Pix(32, 30);
  if (v === 0) {
    hipRoof(p, 1, 1, 30, 17, 3, 7);
    compluvium(p, 9, 5, 14, 9, aquae);
  } else {
    // a lower atrium roof with a little upper room (cenaculum) at the back-left
    hipRoof(p, 1, 5, 30, 13, 3, 7);
    compluvium(p, 13, 8, 13, 8, aquae);
    wall(p, 3, 5, 9, 4, 'a', 'i');
    windowAt(p, 6, 6, 2, 1);
    p.hline(3, 11, 8, 'k');
    hipRoof(p, 2, 1, 11, 4, 1, 3);
  }
  // facade: white plaster, Pompeian red dado, pilastered doorway with a gilt lintel
  wall(p, 3, 18, 26, 10, 'a', 'i', 3);
  p.hline(3, 28, 18, 'k');
  door(p, 13, 20, 6, 8, false, 'b');
  p.hline(12, 19, 19, 'N').vline(12, 20, 27, 'w').vline(19, 20, 27, 'i');
  p.set(14, 23, 'N').set(17, 23, 'N');
  if (v === 0) {
    windowAt(p, 6, 21, 2, 1);
    windowAt(p, 24, 21, 2, 1);
  } else {
    door(p, 4, 21, 6, 7, false, 'q');                                 // a taberna either side of the fauces
    door(p, 22, 21, 6, 7, false, 'q');
    p.hline(5, 8, 25, 'n').hline(23, 26, 25, 'n');
  }
  p.hline(3, 28, 28, 'Q');
  return p.outline().rows();
}

// ───────────────────────────── overlays ─────────────────────────────

/** Renovation scaffold: lashed timber poles, plank decks, braces and a ladder (transparent between). */
function scaffold(): string[] {
  const p = new Pix(32, 32);
  for (const x of [1, 15, 29]) { p.vline(x, 1, 31, 'n'); p.vline(x + 1, 1, 31, 'B'); }
  for (const y of [9, 19, 29]) {
    p.hline(0, 31, y, 't').hline(0, 31, y + 1, 'B');
    for (const x of [1, 15, 29]) p.set(x, y - 1, 'T').set(x + 1, y - 1, 'E');
  }
  for (const [x0, y0] of [[3, 18], [17, 8], [3, 28]]) p.line(x0, y0, x0 + 10, y0 - 7, 'b');
  for (let y = 21; y <= 28; y++) { p.set(22, y, 'n'); p.set(25, y, 'B'); if (y % 2 === 0) p.hline(23, 24, y, 'n'); }
  p.vline(8, 2, 6, 'T').rect(7, 7, 3, 2, 'B').hline(7, 9, 7, 'n');                    // a hod hanging from a rope
  return p.outline().rows();
}

/** Cracked plaster: crack lines, a fallen patch showing brick, rubble and weeds at the foot (bottom-aligned). */
function cracks(): string[] {
  const p = new Pix(32, 24);
  const crack = (pts: [number, number][]): void => { for (let k = 0; k + 1 < pts.length; k++) p.line(...pts[k], ...pts[k + 1], 'k'); };
  crack([[6, 3], [8, 6], [7, 9], [9, 12], [8, 15]]);
  crack([[8, 6], [11, 7]]);
  crack([[25, 2], [23, 5], [24, 8], [23, 11]]);
  crack([[13, 9], [15, 12], [14, 15], [16, 18]]);
  p.rect(21, 13, 6, 3, 'u').box(20, 12, 8, 5, 'K');                     // fallen plaster showing brick
  for (let i = 21; i < 27; i += 3) p.set(i, 13, 'v');
  p.hline(21, 26, 14, 'v');
  p.set(21, 18, 'O').set(22, 19, 'Q').set(25, 19, 'i');
  for (const [x, y] of [[2, 22], [10, 22], [27, 22], [29, 22]]) p.set(x, y, 'O').set(x + 1, y, 'Q');
  p.set(4, 22, 'L').set(4, 21, 'l').set(5, 22, 'd').set(28, 21, 'L').set(28, 20, 'L');
  return p.rows();
}

/** Saturnalia garland: a drooping rope of greenery with ribbons and three glowing lanterns. */
function lanterns(): string[] {
  const p = new Pix(32, 12);
  for (let x = 0; x < 32; x++) {
    const y = 1 + Math.round(3 * Math.sin((Math.PI * x) / 31));
    p.set(x, y, x % 3 === 0 ? 'd' : 'L');
    if (x % 4 === 2) p.set(x, y + 1, 'L');
    if (x % 7 === 3) p.set(x, y + 1, 'r');
  }
  for (const x of [5, 16, 26]) {
    const y = 2 + Math.round(3 * Math.sin((Math.PI * x) / 31));
    p.set(x, y, 'k').hline(x - 1, x + 1, y + 1, 'k');
    p.rect(x - 1, y + 2, 3, 3, 'y').set(x + 1, y + 3, 'Y').set(x + 1, y + 4, 'o').set(x - 1, y + 2, 'w');
    p.hline(x - 1, x + 1, y + 5, 'k');
  }
  return p.outline().rows();
}

/** A groma peg: a stake with a red rag on a chalk mark. */
function pegs(): string[] {
  const p = new Pix(16, 16);
  p.hline(4, 11, 13, 'a').vline(8, 11, 15, 'a');
  p.vline(7, 4, 13, 'n').vline(8, 4, 12, 'B').set(7, 14, 'b');
  p.rect(9, 4, 3, 2, 'r').set(11, 6, 'r').set(9, 5, 'R');
  p.set(5, 14, 'n').set(10, 14, 'n');
  return p.outline().rows();
}

/** A foundation-trench tile: a dug channel along each edge (adjacent tiles join into a grid) with spoil. */
function trench(): string[] {
  const p = new Pix(16, 16);
  for (let i = 0; i < 16; i++) {
    for (const [x, y, c] of [[i, 0, 'm'], [i, 1, 'b'], [0, i, 'm'], [1, i, 'b'], [i, 14, 'b'], [i, 15, 'm'], [14, i, 'b'], [15, i, 'm']] as const)
      p.set(x, y, c);
  }
  for (const [x, y] of [[3, 3], [5, 2], [12, 3], [2, 11], [11, 12], [13, 9], [7, 12], [3, 7]]) p.set(x, y, (x + y) % 2 ? 'n' : 't');
  p.set(6, 3, 'O').set(12, 11, 'Q');
  return p.rows();
}

/** Registers this group's sprites with registerArt()/registerDraw() (no canvas work at registration). */
export function registerHousing(): void {
  for (const v of [0, 1] as const) {
    registerArt(`h_tentoria_${v}`, tentoria(v));
    registerArt(`h_casa_${v}`, casa(v));
    registerArt(`h_tegulata_${v}`, tegulata(v));
    registerArt(`h_domusParva_${v}`, domusParva(v));
    registerArt(`h_insula_${v}`, insula(v, 3, 44));
    registerArt(`h_domus_${v}`, domus(v, false));
  }
  registerArt('h_insula_aquae', insula(1, 4, 52));
  registerArt('h_domus_aquae', domus(0, true));
  registerArt('ov_scaffold', scaffold());
  registerArt('ov_cracks', cracks());
  registerArt('ov_lanterns', lanterns());
  registerArt('ov_pegs', pegs());
  registerArt('ov_trench', trench());
}

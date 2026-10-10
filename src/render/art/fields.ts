// src/render/art/fields.ts — the seasonal ager (furrows by season + farmhouse) and olivetum (olive rows + press house).
// Owner: WP-G (art, part 2). Both are 48×48 (3×3 rural footprint) and drawn by WP-F on the ground layer before
// y-sorting (ARCHITECTURE §12.2). Seasons: 0 Ver, 1 Aestas, 2 Autumnus, 3 Hiems (DESIGN §16.2/§8.2).
import type { Grid } from '../sprites';
import { Pix, canopy, noise } from './brush';
import { RAMP, door, plasterWall, tiledRoof, windowHole } from './opus';

type Season = 0 | 1 | 2 | 3;

/** The little farmhouse (casa rustica) with a straw stack, in the field's top-left yard. */
function farmhouse(p: Pix, season: Season): void {
  // beaten-earth yard
  p.rect(1, 1, 17, 17, 'E');
  p.shade(1, 1, 17, 17, (x, y) => (noise(x, y, 61) < 0.18 ? 'e' : noise(x, y, 62) < 0.1 ? 'O' : null));
  tiledRoof(p, 2, 2, 13, 5, 2);
  plasterWall(p, 3, 7, 11, 6, RAMP.ochre);
  door(p, 7, 9, 2, 4);
  windowHole(p, 11, 9, 1, 2, 't');
  // straw stack (golden after harvest, grey-brown in Hiems, small in Ver)
  const straw = season === 3 ? 'E' : 'Y';
  const r = season === 0 ? 2 : 3;
  p.ellipse(15, 14 - r / 2, r, r + 0.5, straw);
  p.set(14, 12, season === 3 ? 'e' : 'T').set(14, 13, season === 3 ? 'e' : 'y');
  p.vline(15, 9, 10, 'b');
}

/** One field season: soil and crop rows (east–west furrows, 2 px pitch). */
function furrows(p: Pix, season: Season): void {
  const x0 = 1, y0 = 1, x1 = 46, y1 = 46;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (x <= 18 && y <= 18) continue;                                   // the farm yard
      const n = noise(x, y, 70 + season), row = (y - y0) % 2 === 0;
      let k: string;
      if (season === 0) k = row ? (n < 0.3 ? 'l' : 'L') : n < 0.25 ? 'L' : 'n';           // young green wheat
      else if (season === 1) k = row ? (n < 0.22 ? 'T' : n < 0.7 ? 'y' : 'Y') : n < 0.75 ? 'Y' : 't';  // golden wheat
      else if (season === 2) k = row ? (n < 0.4 ? 'e' : 'E') : n < 0.3 ? 'E' : 'n';        // stubble on brown soil
      else k = row ? (n < 0.12 ? 'd' : 'B') : n < 0.5 ? 'b' : 'm';                        // ploughed winter soil
      p.set(x, y, k);
    }
  // field margins: a darker earth border and a path between the halves
  for (let x = 0; x < 48; x++) { p.set(x, 0, 'b'); p.set(x, 47, 'b'); }
  for (let y = 0; y < 48; y++) { p.set(0, y, 'b'); p.set(47, y, 'b'); }
  p.vline(19, 1, 46, 'n').vline(18, 19, 46, 'n');
  p.hline(19, 46, 19, 'n');
  if (season === 1) {
    // poppies in the wheat and the lit edge of the standing crop
    for (let i = 0; i < 14; i++) p.set(21 + Math.floor(noise(i, 1, 81) * 25), 21 + Math.floor(noise(i, 2, 81) * 25), 'r');
    p.hline(20, 46, 20, 'T');
  }
  if (season === 2) {
    // stooks of sheaves in rows
    for (const [x, y] of [[24, 24], [32, 24], [40, 24], [28, 32], [36, 32], [24, 40], [32, 40], [40, 40], [8, 26], [8, 36], [30, 8], [40, 8], [35, 14]]) {
      p.set(x, y - 2, 'T').rect(x - 1, y - 1, 3, 1, 'y').rect(x - 1, y, 3, 1, 'Y').set(x + 1, y, 't').hline(x - 1, x + 1, y + 1, 'b');
    }
  }
  if (season === 3) {
    // puddles in the furrows
    for (const [x, y] of [[26, 29], [38, 37], [9, 41], [33, 9]]) p.hline(x, x + 2, y, 'C').set(x + 1, y, 'c');
  }
  if (season === 0) {
    // the plough's last headland strip is still bare
    p.rect(20, 44, 27, 2, 'n');
  }
}

/** The ager in one season, 48×48. */
export function ager(season: Season): Grid {
  const p = new Pix(48, 48);
  furrows(p, season);
  farmhouse(p, season);
  return p.rows();
}

/** An olive tree (gnarled grey trunk, round silver-green crown), 12×11, with seasonal blossom or fruit. */
function olive(p: Pix, x: number, y: number, season: Season, seed: number): void {
  // tilled ring of soil under the tree
  p.ellipse(x + 6, y + 10, 5, 1.5, season === 0 ? 'V' : 'E');
  p.shade(x, y + 8, 12, 4, (X, Y, k) => (k === 'E' && noise(X, Y, seed) < 0.3 ? 'O' : k === 'V' && noise(X, Y, seed) < 0.3 ? 'E' : null));
  const t = new Pix(12, 11);
  // a short, twisted, forked trunk
  t.set(5, 10, 'G').set(6, 10, 'j').set(5, 9, 'g').set(6, 9, 'G').set(4, 8, 'g').set(5, 8, 'G').set(7, 8, 'G').set(7, 9, 'j');
  canopy(t, [{ x: 3.9, y: 4, rx: 3.6, ry: 3.3 }, { x: 8, y: 3.6, rx: 3.6, ry: 3.3 }, { x: 6, y: 5.6, rx: 4.6, ry: 2.6 }, { x: 6, y: 2.4, rx: 3, ry: 2.2 }], seed, 0.32, -0.24);
  t.shade(0, 0, 12, 11, (X, Y, k) => {
    const n = noise(X + x, Y + y, seed + 1);
    if (k === 'l') return n < 0.3 ? 'g' : n < 0.65 ? 'l' : 'V';
    if (k === 'L') return n < 0.2 ? 'L' : 'V';
    if (k === 'd') return n < 0.3 ? 'Z' : 'd';
    return null;
  });
  t.rim('D');
  // seasonal blossom / fruit
  const fruit = season === 0 ? 'w' : season === 2 ? 'P' : season === 3 ? 'q' : null;
  if (fruit) t.shade(1, 1, 10, 7, (X, Y, k) => (k === 'V' || k === 'd') && noise(X + x, Y + y, seed + 2) < 0.13 ? fruit : null);
  p.stamp(t, x, y);
}

/** The olivetum in one season: a drystone-walled grove of eight olives in rows and a press house, 48×48. */
export function olivetum(season: Season): Grid {
  const p = new Pix(48, 48);
  // drystone boundary wall (tufa), open at the bottom-left gate
  const stone = (x: number, y: number): void => { p.set(x, y, noise(x, y, 90) < 0.5 ? 'O' : 'Q'); };
  for (let x = 1; x <= 46; x++) { stone(x, 1); if (x > 6) stone(x, 46); }
  for (let y = 1; y <= 46; y++) { stone(1, y); stone(46, y); }
  for (let x = 1; x <= 46; x += 3) p.set(x, 1, 'i');
  // trees in three staggered rows (back to front)
  const trees: [number, number][] = [[3, 3], [18, 3], [33, 3], [3, 16], [18, 16], [33, 16], [18, 29], [33, 29]];
  trees.forEach(([x, y], i) => olive(p, x, y, season, 100 + i * 7));
  // harvest nets and a basket under the front trees in Hiems; fallen fruit in Autumnus
  if (season === 3) {
    p.shade(17, 40, 26, 3, (X, Y) => ((X + Y) % 2 === 0 ? 'W' : 'g'));
    p.rect(38, 39, 4, 3, 'n').hline(38, 41, 39, 'q').set(39, 38, 'I');
  }
  // press house (torcularium) in the bottom-left corner with amphorae
  tiledRoof(p, 3, 31, 13, 5, 2);
  plasterWall(p, 4, 36, 11, 7, RAMP.white);
  door(p, 8, 38, 3, 5);
  windowHole(p, 5, 38, 1, 2, 'a');
  for (const [x, y] of [[3, 43], [6, 44]]) {
    p.set(x + 1, y - 2, 'v').rect(x, y - 1, 3, 3, 'u').set(x, y - 1, 's').set(x + 2, y + 1, 'v').set(x + 1, y + 2, 'v');
  }
  return p.rows();
}

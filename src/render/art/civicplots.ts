// src/render/art/civicplots.ts — the 2×2 plot buildings: lararium, taberna, puteus, cisterna, castellum, lacus, hortus,
// fabrica (DESIGN §16.3). Owner: WP-G (G1). Each is 32 px wide, bottom-aligned to its plot; outlines are in the grid.
import { Pix } from './gridkit';
import { amphora, column, cypress, door, hipRoof, paving, pedimentRoof, rakeRow, stoneWall, wall } from './facade';

/** Wayside shrine: a little marble aedicula with the Lar in its niche, an altar with a flame, a cypress. */
function lararium(): string[] {
  const p = new Pix(32, 28);
  paving(p, 2, 22, 28, 5);
  const x0 = 7, x1 = 22, eave = 9;
  const apex = pedimentRoof(p, x0, x1, eave, 5, 2);
  for (let i = x0; i <= x1; i++) {
    const e = rakeRow(x0, x1, eave, 2, i);
    p.set(i, e, 'w');
    for (let j = e + 1; j <= eave; j++) p.set(i, j, 'a');
  }
  p.set(14, apex + 2, 'N').set(15, apex + 2, 'N').rect(14, apex - 6, 2, 2, 'N');   // gilt boss and acroterion
  p.hline(x0, x1, eave + 1, 'i');
  p.rect(9, 11, 12, 8, 'F').rect(12, 12, 6, 7, 'q').hline(12, 17, 12, 'R');        // painted niche
  p.rect(14, 14, 2, 4, 'N').set(14, 14, 'y').set(14, 13, 'y');                     // the Lar
  p.set(12, 16, 'L').set(17, 16, 'L').set(13, 15, 'f').set(16, 15, 'f');            // garland
  column(p, 8, eave + 1, 9);
  column(p, 19, eave + 1, 9);
  p.rect(7, 19, 16, 3, 'a').hline(7, 22, 19, 'w').vline(22, 19, 21, 'i');           // podium
  p.rect(12, 22, 6, 4, 'a').hline(12, 17, 22, 'w').hline(12, 17, 24, 'F').vline(17, 22, 25, 'i');   // altar
  p.outline();
  p.set(14, 21, 'o').set(15, 21, 'y').set(15, 20, 'y').set(14, 19, 'o');            // the flame (unoutlined)
  cypress(p, 27, 25, 17);
  p.set(3, 23, 'u').set(3, 22, 'L').set(2, 22, 'l').set(4, 21, 'L');
  return p.outline().rows();
}

/** Shop: a tiled roof, a sign, two counters under red-and-white striped awnings, goods on display. */
function taberna(): string[] {
  const p = new Pix(32, 28);
  hipRoof(p, 1, 1, 30, 10, 3, 7);
  wall(p, 3, 11, 26, 15, 's', 't');
  p.hline(3, 28, 11, 'k');
  p.rect(10, 12, 12, 3, 'n').box(10, 12, 12, 3, 'b').hline(12, 19, 13, 'r');        // painted sign
  for (const x of [4, 18]) {
    p.rect(x, 18, 10, 7, 'q').hline(x, x + 9, 18, 'K');
    for (let i = 0; i < 10; i++) { p.set(x + i, 15, i % 2 ? 'w' : 'r'); p.set(x + i, 16, i % 2 ? 'W' : 'R'); }
    p.hline(x, x + 9, 17, 'k');
    p.rect(x, 22, 10, 3, 'n').hline(x, x + 9, 22, 't').vline(x + 9, 22, 24, 'B');   // counter
  }
  for (const [x, c] of [[5, 'y'], [6, 'r'], [7, 'y'], [9, 'V'], [10, 'V']] as const) p.set(x, 21, c);
  amphora(p, 20, 22);
  p.set(24, 21, 'n').set(25, 21, 'n').set(26, 21, 't');                              // loaves
  p.hline(3, 28, 25, 'Q');
  p.hline(3, 28, 26, 'Q');
  return p.outline().rows();
}

/** Well: a round stone puteal under a timber windlass frame with a bucket, a water trough beside it. */
function puteus(): string[] {
  const p = new Pix(32, 22);
  p.ellipse(2, 13, 28, 8, 'Q');
  p.ellipse(3, 14, 26, 6, 'O');
  // the puteal: a short drum with a dark water mouth
  p.rect(7, 10, 12, 7, 'a').vline(16, 10, 16, 'i').vline(17, 10, 16, 'i').vline(18, 10, 16, 'O').vline(7, 10, 16, 'w');
  p.ellipse(7, 7, 12, 6, 'i');
  p.ellipse(9, 8, 8, 4, 'k').set(12, 9, 'C').set(13, 9, 'M');
  p.hline(7, 18, 16, 'O');
  // windlass frame with rope and bucket
  p.vline(6, 1, 12, 'n').vline(5, 1, 12, 'B').vline(19, 1, 12, 'B').vline(20, 1, 12, 'b');
  p.hline(4, 21, 1, 'n').hline(4, 21, 2, 'B').rect(10, 1, 6, 3, 'b').hline(10, 15, 1, 'n');
  p.vline(13, 4, 6, 'T').rect(12, 6, 3, 2, 'B').hline(12, 14, 6, 'n');
  // the trough
  p.rect(21, 13, 9, 5, 'a').hline(21, 29, 13, 'w').vline(29, 13, 17, 'i').hline(22, 28, 14, 'M').set(23, 14, 'c').set(26, 14, 'c');
  return p.outline().rows();
}

/** Cistern: two barrel vaults of mortared tufa with an open hatch on the water, a rain spout and steps. */
function cisterna(): string[] {
  const p = new Pix(32, 22);
  for (const x0 of [2, 16]) {
    const w = 14;
    for (let j = 3; j < 12; j++)
      for (let i = x0; i < x0 + w; i++) {
        const t = (j - 3) / 8;
        if (j < 5 && (i === x0 || i === x0 + w - 1)) continue;
        if (j < 4 && (i === x0 + 1 || i === x0 + w - 2)) continue;
        p.set(i, j, t < 0.3 ? 'a' : t < 0.65 ? 'i' : 'O');
      }
    for (let i = x0 + 2; i < x0 + w - 2; i += 3) p.vline(i, 4, 11, 'Q');
    stoneWall(p, x0, 12, w, 8, 'O', 'Q', 3);
    p.hline(x0, x0 + w - 1, 12, 'k');
  }
  p.vline(15, 3, 19, 'k');
  p.rect(5, 5, 6, 3, 'k').rect(6, 6, 4, 1, 'M').set(6, 6, 'c');                   // hatch on the water
  p.rect(20, 14, 8, 6, 'K').rect(21, 15, 6, 5, 'C').hline(21, 26, 15, 'M').set(22, 16, 'c');   // arched opening
  p.set(20, 14, 'O').set(27, 14, 'O');
  p.hline(28, 31, 9, 'X').vline(31, 9, 13, 'X').set(31, 14, 'c').set(31, 16, 'c');    // rain spout
  for (let s = 0; s < 3; s++) p.hline(3 + s, 7, 17 + s, s % 2 ? 'i' : 'a');           // steps
  p.hline(2, 29, 20, 'Q');
  return p.outline().rows();
}

/** Castellum aquae: a tiled water tower; the aqueduct channel enters behind, three pipes leave the basin in front. */
function castellum(): string[] {
  const p = new Pix(32, 32);
  // the channel arriving from the aqueduct (behind, top-left)
  p.rect(1, 6, 8, 3, 'O').hline(1, 8, 6, 'a').hline(1, 7, 7, 'M');
  hipRoof(p, 5, 2, 22, 9, 2, 6);
  stoneWall(p, 6, 11, 20, 18, 'O', 'Q', 3);
  p.hline(6, 25, 11, 'k').hline(6, 25, 12, 'a').hline(6, 25, 13, 'i');
  for (const x of [6, 24]) p.rect(x, 12, 2, 17, 'a').vline(x + 1, 12, 28, 'i');      // marble quoins
  // the arched front showing the dividing basin
  p.rect(10, 15, 12, 11, 'k').set(10, 15, '.').set(21, 15, '.');
  p.rect(11, 16, 10, 10, 'K').rect(11, 21, 10, 4, 'a');
  p.rect(12, 18, 8, 3, 'M').hline(12, 19, 18, 'c');
  for (const x of [12, 15, 18]) p.vline(x + 1, 21, 24, 'C');
  p.vline(16, 16, 18, 'c').set(15, 17, 'w');                                         // inflow
  // three lead pipes and spills
  for (const x of [11, 15, 19]) { p.rect(x, 26, 2, 3, 'X').set(x, 26, 'g'); }
  p.rect(4, 29, 24, 2, 'a').hline(4, 27, 29, 'w').hline(6, 25, 30, 'M');
  p.set(9, 30, 'c').set(14, 30, 'c').set(21, 30, 'c');
  return p.outline().rows();
}

/** Public fountain: a marble basin fed by a spout in a carved stele (a mask), water splashing. */
function lacus(): string[] {
  const p = new Pix(32, 24);
  // stele with a gable top and a lion mask
  p.rect(12, 6, 8, 11, 'a').vline(19, 6, 16, 'i').vline(12, 6, 16, 'w');
  for (let k = 0; k < 4; k++) p.hline(12 + k, 19 - k, 5 - k, k === 0 ? 'i' : 'a');
  p.rect(14, 8, 4, 4, 'N').set(14, 8, 'y').set(15, 10, 'k').set(16, 10, 'k').set(15, 9, 'n').set(16, 9, 'n');
  // the basin
  p.rect(2, 14, 28, 8, 'a').hline(2, 29, 14, 'w').vline(29, 14, 21, 'i').hline(2, 29, 21, 'i');
  p.rect(4, 16, 24, 4, 'M').hline(4, 27, 16, 'C');
  for (const [x, y] of [[7, 17], [21, 18], [11, 19], [25, 17]]) p.hline(x, x + 1, y, 'c');
  p.outline();
  p.vline(16, 12, 16, 'c').set(17, 13, 'c').set(15, 17, 'w').set(17, 17, 'w').set(16, 16, 'w');   // the jet
  return p.rows();
}

/** Garden: box hedges round flower beds, a gravel cross path with a birdbath, cypresses and a bench. */
function hortus(): string[] {
  const p = new Pix(32, 24);
  p.rect(1, 6, 30, 17, 't');
  for (let j = 6; j < 23; j++) for (let i = 1; i < 31; i++) if ((i * 5 + j * 3) % 7 === 0) p.set(i, j, 'T');
  for (const [x, y] of [[2, 7], [18, 7], [2, 16], [18, 16]]) {
    p.rect(x, y, 12, 6, 'd').rect(x + 1, y + 1, 10, 4, 'L');
    for (let i = x + 1; i < x + 11; i++) p.set(i, y, 'l');
    for (let i = x + 2; i < x + 10; i += 2) p.set(i, y + 2 + ((i >> 1) % 2), ['f', 'y', 'p', 'r'][(i + y) % 4]);
  }
  p.rect(14, 12, 4, 4, 'a').hline(14, 17, 12, 'w').hline(15, 16, 13, 'M').vline(17, 12, 15, 'i');   // birdbath
  p.hline(14, 17, 23, 'i');
  cypress(p, 3, 14, 11);
  cypress(p, 28, 14, 11);
  p.rect(22, 20, 6, 2, 'a').hline(22, 27, 20, 'w').set(22, 22, 'i').set(27, 22, 'i');                // bench
  return p.outline().rows();
}

/** Smithy: an open-fronted forge with a glowing hearth under a brick hood, an anvil, a quench barrel, smoke. */
function fabrica(): string[] {
  const p = new Pix(32, 30);
  hipRoof(p, 1, 3, 30, 10, 3, 7);
  p.rect(22, 1, 4, 5, 'u').vline(25, 1, 5, 'v').hline(22, 25, 1, 'o').hline(23, 24, 0, 'K');   // chimney
  stoneWall(p, 3, 13, 26, 15, 'O', 'Q', 3);
  p.hline(3, 28, 13, 'k');
  // the open bay: dark workshop, tools on the back wall, the forge glow
  p.rect(5, 15, 17, 12, 'q');
  p.hline(6, 12, 16, 'G').set(7, 17, 'G').set(10, 17, 'G').set(12, 17, 'n');
  p.rect(14, 17, 7, 3, 'u').hline(14, 20, 17, 'o').vline(20, 17, 19, 'v');           // brick hood
  p.rect(14, 20, 7, 4, 'v').rect(15, 21, 5, 2, 'o').hline(16, 18, 21, 'y').set(17, 22, 'Y');
  p.set(16, 20, 'Y').set(18, 20, 'o');
  // anvil and quench barrel outside
  p.rect(7, 23, 5, 2, 'X').hline(6, 12, 23, 'G').set(6, 23, 'g').rect(8, 25, 3, 2, 'j');
  p.rect(24, 21, 4, 6, 'B').hline(24, 27, 21, 'n').hline(25, 26, 21, 'M').hline(24, 27, 23, 'b').hline(24, 27, 25, 'b');
  door(p, 23, 15, 5, 6, false);
  p.hline(3, 28, 27, 'Q');
  p.hline(3, 28, 28, 'Q');
  return p.outline().rows();
}

/** The plot buildings by sprite name, as grids that already carry their outlines. */
export function plotBuildings(): Record<string, string[]> {
  return {
    b_lararium: lararium(), b_taberna: taberna(), b_puteus: puteus(), b_cisterna: cisterna(),
    b_castellum: castellum(), b_lacus: lacus(), b_hortus: hortus(), b_fabrica: fabrica(),
  };
}


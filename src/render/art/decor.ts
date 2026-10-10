// src/render/art/decor.ts — the dressing that path choices and cosmetic rewards add to the map (DESIGN §9.2, §9.4):
// standards and statues in the forum, market stalls and a dole table, haystacks and boundary stones in the fields, shop
// awnings, garlands, the smiths' anvil sign and purple wall banners. Owner: batch C (render). All `x_*` names are
// procedural key grids, painted lazily on the first sprite() call; renderers place them (render/decor.ts).
import type { Grid } from '../sprites';
import { Pix, registerGrid } from './brush';
import { banner, standard, statue } from './civitas';
import { RAMP } from './opus';

/** A standard on its pole, foot at the bottom row (9×29). */
function std(kind: 'aquila' | 'signum' | 'vexillum', gilt = false): Grid {
  const p = new Pix(9, 29);
  standard(p, 4, 4, kind);
  if (gilt) p.recolor({ b: 'Y', m: 'N', B: 'Y', Q: 'Y', F: 'N', r: 'y', R: 'Y' });
  return p.rows();
}

/** A market stall: four poles, a striped awning, a counter with goods (16×14). */
function stall(v: 0 | 1): Grid {
  const p = new Pix(16, 14);
  const [a, b] = v === 0 ? ['F', 'w'] : ['Y', 'w'];
  // awning with a scalloped valance
  for (let x = 0; x < 16; x++) {
    const k = Math.floor(x / 2) % 2 ? a : b;
    p.set(x, 1, k).set(x, 2, k).set(x, 3, k);
    if (x % 2 === 0) p.set(x, 4, k);
  }
  p.hline(1, 14, 0, v === 0 ? 'r' : 'y');
  // poles and the counter
  for (const x of [1, 14]) p.vline(x, 5, 13, 'b');
  p.rect(1, 9, 14, 4, 'B').hline(1, 14, 9, 't').hline(1, 14, 12, 'b');
  // goods on the counter: amphorae, a basket of fruit, cloth
  if (v === 0) p.set(3, 8, 'u').set(3, 7, 'v').set(5, 8, 'u').set(5, 7, 'v').rect(8, 7, 3, 2, 'n').set(9, 6, 'o').set(8, 6, 'r').set(10, 6, 'y');
  else p.rect(3, 7, 3, 2, 'I').rect(7, 7, 3, 2, 'C').set(12, 8, 'V').set(12, 7, 'L').set(11, 8, 'V');
  return p.rows();
}

/** A haystack: a domed rick of hay with a darker base (12×10). */
function haystack(): Grid {
  const p = new Pix(12, 10);
  p.ellipse(5.5, 6, 5.4, 5, 'Y');
  p.shade(0, 0, 12, 10, (x, y, k) => (k === '.' ? null : y > 7 ? 'n' : x < 4 && y < 6 ? 'y' : x > 8 ? 't' : (x + y * 3) % 7 === 0 ? 'T' : null));
  p.hline(2, 9, 9, 'B');
  return p.rows();
}

/** A centuriation boundary stone (cippus) with its cut top (4×6). */
function cippus(): Grid {
  return ['.ai.', 'aaii', 'aaiQ', 'aiiQ', 'aiQQ', 'QQQQ'];
}

/** A shop awning over a cottage front: striped cloth on two poles (12×7). */
function awning(): Grid {
  const p = new Pix(12, 7);
  for (let x = 0; x < 12; x++) {
    const k = Math.floor(x / 2) % 2 ? 'F' : 'w';
    p.set(x, 0, k).set(x, 1, k);
    if (x % 3 !== 2) p.set(x, 2, k);
  }
  p.vline(0, 3, 6, 'b').vline(11, 3, 6, 'b');
  return p.rows();
}

/** A garland: a swag of laurel and flowers with ribbons at its ends (24×7). */
function garland(): Grid {
  const p = new Pix(24, 7);
  for (let x = 1; x < 23; x++) {
    const y = Math.round(1 + 3.2 * Math.sin((Math.PI * (x - 1)) / 21));
    p.set(x, y, 'L').set(x, y + 1, (x % 3) ? 'd' : 'L');
    if (x % 4 === 1) p.set(x, y, x % 8 === 1 ? 'f' : 'y');
  }
  p.vline(0, 0, 3, 'r').vline(23, 0, 3, 'r').set(0, 0, 'R').set(23, 0, 'R');
  return p.rows();
}

/** A smith's sign: an iron bracket with a hanging board painted with an anvil (10×10). */
function anvilSign(): Grid {
  const p = new Pix(10, 10);
  p.hline(0, 9, 0, 'x').vline(2, 1, 1, 'x').vline(7, 1, 1, 'x');
  p.box(0, 2, 10, 8, 'B', 'b');
  p.hline(2, 7, 4, 'G').hline(3, 6, 5, 'j').hline(4, 5, 6, 'j').hline(3, 6, 7, 'G').set(1, 4, 'G');
  return p.rows();
}

/** A bronze statue on a travertine pedestal (9×15, foot at the bottom row). */
function bronzeStatue(): Grid {
  const p = new Pix(9, 15);
  statue(p, 4, 0, 'bronze', RAMP.white);
  return p.rows();
}

/** A purple banner on a gilt rod (5×8). */
function purpleBanner(): Grid {
  const p = new Pix(5, 8);
  banner(p, 1, 0, 'I');
  return p.rows();
}

/** The grain dole: a trestle table with sacks of grain and a bronze modius (16×10). */
function doleTable(): Grid {
  const p = new Pix(16, 10);
  p.rect(0, 5, 16, 2, 'B').hline(0, 15, 5, 't').vline(1, 7, 9, 'b').vline(14, 7, 9, 'b');
  for (const x of [1, 5]) p.rect(x, 1, 4, 4, 'e').hline(x, x + 3, 1, 'T').set(x + 1, 0, 'E').set(x + 2, 0, 'E').vline(x + 3, 2, 4, 'E');
  p.rect(10, 2, 4, 3, 'N').hline(10, 13, 2, 'y').hline(10, 13, 1, 'Y');           // the modius, heaped
  return p.rows();
}

/** Registers the decor sprites (no canvas work at registration). */
export function registerDecor(): void {
  registerGrid('x_vexillum', 9, 29, () => std('vexillum'));
  registerGrid('x_aquila', 9, 29, () => std('aquila'));
  registerGrid('x_signum_gilt', 9, 29, () => std('signum', true));
  registerGrid('x_statue', 9, 15, bronzeStatue);
  registerGrid('x_stall_0', 16, 14, () => stall(0));
  registerGrid('x_stall_1', 16, 14, () => stall(1));
  registerGrid('x_haystack', 12, 10, haystack);
  registerGrid('x_cippus', 4, 6, cippus);
  registerGrid('x_awning', 12, 7, awning);
  registerGrid('x_garland', 24, 7, garland, { outline: false });
  registerGrid('x_anvil', 10, 10, anvilSign);
  registerGrid('x_banner', 5, 8, purpleBanner, { outline: false });
  registerGrid('x_dole', 16, 10, doleTable);
}

// src/render/art/nature.ts — trees (seasonal oaks), umbrella pine, cypress, stumps, rocks, reeds, ruins, lucus, spring, altar.
// Owner: WP-G (art, part 2). ARCHITECTURE §12.3 names, DESIGN §16.2 palette (PAL keys only), light from the top-left.
// Trees are painted from overlapping leaf clumps (each lit from the top-left) with a dark-green rim instead of the
// umber `k`, as Hearthlands does; everything else carries the `k` outline. Seasonal oak canopies follow §16.2.
import { registerArt } from '../sprites';
import type { Grid } from '../sprites';
import { Pix, canopy, noise, recolor } from './brush';

/** A trunk of width 2 (bark B, shade b) from y0 down to y1, leaning by `lean` px over its length. */
function trunk(p: Pix, x: number, y0: number, y1: number, lean = 0): void {
  for (let y = y0; y <= y1; y++) {
    const dx = Math.round(((y - y0) / Math.max(1, y1 - y0)) * lean);
    p.set(x + dx, y, 'B').set(x + dx + 1, y, 'b');
  }
}

/** The three oak shapes (summer-green keys); all 14×16 so the variants share a size (§12.3 families). */
function oak(v: 0 | 1 | 2): Pix {
  const p = new Pix(14, 16);
  if (v === 0) {
    trunk(p, 6, 10, 14);
    p.set(5, 15, 'b').set(8, 15, 'b');
    canopy(p, [{ x: 7, y: 5, rx: 5.2, ry: 4.6 }, { x: 4.4, y: 8, rx: 3.9, ry: 3.4 }, { x: 9.6, y: 8.2, rx: 3.9, ry: 3.4 }, { x: 7, y: 9.2, rx: 4, ry: 2.8 }], 11);
  } else if (v === 1) {
    trunk(p, 7, 10, 14, -1);
    p.set(5, 15, 'b').set(8, 15, 'b');
    p.line(7, 11, 10, 9, 'b');
    canopy(p, [{ x: 5.4, y: 5.2, rx: 4.6, ry: 4.2 }, { x: 9.4, y: 4.4, rx: 3.8, ry: 3.6 }, { x: 10.4, y: 8.6, rx: 3.2, ry: 2.8 }, { x: 5.6, y: 9, rx: 4.6, ry: 2.9 }], 23);
  } else {
    trunk(p, 6, 9, 14, 1);
    p.set(5, 15, 'b').set(9, 15, 'b');
    canopy(p, [{ x: 7, y: 4.2, rx: 4.2, ry: 3.8 }, { x: 4.6, y: 7.6, rx: 3.6, ry: 3.2 }, { x: 9.4, y: 7.4, rx: 3.6, ry: 3.2 }, { x: 7.2, y: 9, rx: 3, ry: 2.2 }], 37);
  }
  p.rim('D');
  // tuck the trunk base: dark roots so the tree stands on the ground
  p.set(6, 15, 'm').set(7, 15, 'm');
  return p;
}

/** Seasonal canopy maps (DESIGN §16.2 oak canopy: Ver #4f9a3a, Aestas #5b8f35, Autumnus #c0702e, Hiems #55684f). */
function seasonOak(base: Pix, season: 0 | 1 | 2 | 3, seed: number): string[] {
  const p = new Pix(base.w, base.h).stamp(base, 0, 0);
  if (season === 0) {
    // Ver: fresh leaves, a few pale catkins
    p.shade(0, 0, p.w, p.h, (x, y, k) => (k === 'L' && noise(x, y, seed + 1) < 0.08 ? 'e' : k === 'd' && noise(x, y, seed + 2) < 0.15 ? 'L' : null));
  } else if (season === 1) {
    // Aestas: a deeper, dustier green
    p.shade(0, 0, p.w, p.h, (x, y, k) => {
      if (k === 'l') return noise(x, y, seed + 4) < 0.45 ? 'V' : 'l';
      if (k === 'L') return noise(x, y, seed + 3) < 0.12 ? 'V' : 'L';
      return null;
    });
  } else if (season === 2) {
    // Autumnus: russet and amber
    p.shade(0, 0, p.w, p.h, (x, y, k) => {
      const n = noise(x, y, seed + 5);
      if (k === 'l') return n < 0.3 ? 'y' : 'Y';
      if (k === 'L') return n < 0.45 ? 'o' : 'u';
      if (k === 'd') return 'v';
      if (k === 'D') return 'm';
      return null;
    });
  } else {
    // Hiems: dull evergreen grey-green with a few dead brown leaves
    p.shade(0, 0, p.w, p.h, (x, y, k) => {
      const n = noise(x, y, seed + 6);
      if (k === 'l') return n < 0.25 ? 'E' : 'V';
      if (k === 'L') return n < 0.12 ? 'Q' : 'd';
      if (k === 'd') return 'Z';
      return null;
    });
  }
  return p.rows();
}

/** The umbrella (stone) pine: a tall bare trunk under a broad flat crown (#3d6b3a), 18×20. */
function pine(): string[] {
  const p = new Pix(18, 20);
  // a tall, slightly kinked trunk forking into the crown
  const xs = [8, 8, 8, 8, 9, 9, 9, 9, 9, 8, 8, 8];
  xs.forEach((x, i) => p.set(x, 8 + i, 'n').set(x + 1, 8 + i, 'b'));
  p.line(8, 8, 5, 6, 'b').line(9, 8, 13, 6, 'b');
  p.set(7, 19, 'b').set(10, 19, 'b');
  canopy(p, [{ x: 4.6, y: 4.4, rx: 4.2, ry: 2.4 }, { x: 9, y: 3.2, rx: 5.2, ry: 2.5 }, { x: 13.4, y: 4.4, rx: 4.2, ry: 2.4 }, { x: 9, y: 5.4, rx: 7.2, ry: 1.8 }], 51, 0.3, -0.18);
  // stone-pine greens: a darker crown than the oaks
  p.recolor({ l: 'L', L: 'd', d: 'Z' });
  p.shade(0, 0, p.w, 8, (x, y, k) => (k === 'L' && noise(x, y, 9) < 0.25 ? 'l' : null));
  p.rim('D');
  return p.rows();
}

const CYPRESS: Grid = [
  '....DD....',
  '...DlD....',
  '...DLdD...',
  '..DlLdD...',
  '..DLLZdD..',
  '..DlLdZD..',
  '.DlLLZdD..',
  '.DLLdZZD..',
  '.DlLLZdZD.',
  '.DLLdZZZD.',
  '.DlLLZdZD.',
  '.DLdLZZZD.',
  '.DlLLdZZD.',
  '..DLdZZD..',
  '..DdZZZD..',
  '...DDDD...',
  '....bm....',
  '...kbmk...',
];

/** Cypress (Z body, d/L lit edge): the clump keys of the grid above recoloured into cypress greens. */
function cypress(): string[] {
  return recolor(CYPRESS, { l: 'L', L: 'd', d: 'Z' });
}

const STUMP: Grid = [
  '.kkkkk.',
  'kTtTtTk',
  'ktTnTtk',
  'kBnBbBk',
  'kBbBbbk',
  'kkkkkkk',
];

const ROCK_0: Grid = [
  '....kkkk....',
  '..kkaiiOkk..',
  '.kaiiiOOQQk.',
  '.kiiOOOOQQk.',
  'kaiOOOOQQQXk',
  'kiOOOOQQQXXk',
  'kOOOQQQQXXXk',
  '.kkkkkkkkkk.',
  '............',
];

const ROCK_1: Grid = [
  '............',
  '.kkk........',
  'kaiOk..kkk..',
  'kiOQXkkaiOk.',
  'kOQQXkiiOQk.',
  '.kkkkaiOOQQk',
  '....kiOOQQXk',
  '....kkkkkkk.',
  '............',
];

const REEDS: Grid = [
  '.b....b.',
  '.B..b.B.',
  '.Bl.B.Bl',
  'lLl.BlLl',
  'lL.lLlL.',
  'LL.LLdL.',
  'Ld.LdLd.',
  'dL.dLdd.',
  'dd.dddd.',
];

const SPRING: Grid = [
  '....kkkkk.......',
  '..kkWggGkkkk....',
  '.kWggkkkkgGGk...',
  '.kgGkcccckGGjk..',
  'kWgkcwcccCkGjk..',
  'kgGkccccCCkjjk..',
  '.kGjkCCCCkjjk...',
  '..kkjkkkkjkk.cc.',
  '....kkkkkk..ccCc',
  '.............cc.',
];

const RUINS: Grid = [
  '....kk..................',
  '...kaik.................',
  '...kiOk.......kk........',
  '...kiOk......kaik.......',
  '...kiQk......kiOk.......',
  '...kOQk..kk..kOQk.......',
  '..kkOQkk.kik.kOQk..kk...',
  '..kiOOQk.kOk.kOQkkkaik..',
  'kkkkkkkkkkkkkkkkkkkiOQk.',
  'kaiOOkaiOkaiOkaiOkkOQQk.',
  'kiOQQkiOQkLOQkiLQkkOQQkk',
  'kkkkkkkkkkkkkkkkkkkkkkk.',
];

/** The Celtic ruins: weathered standing stones and a broken drystone ring with moss. */
function ruins(): string[] {
  const p = new Pix(24, 18);
  p.stamp(RUINS, 0, 6);
  p.shade(0, 0, p.w, p.h, (x, y, k) => ((k === 'O' || k === 'Q') && noise(x, y, 77) < 0.16 ? 'L' : null));
  return p.rows();
}

/** The sacred grove: old oaks and two cypresses around a votive post hung with red ribbons, 32×28. */
function lucus(): string[] {
  const p = new Pix(32, 28);
  p.stamp(cypress(), 0, 6);
  p.stamp(oak(1), 4, 1);
  p.stamp(oak(2), 15, 0);
  p.stamp(cypress(), 22, 7);
  // votive post with ribbons and a small stone table
  p.vline(15, 15, 25, 'b').vline(16, 15, 25, 'B');
  p.set(14, 16, 'r').set(13, 17, 'r').set(17, 16, 'F').set(18, 17, 'F').set(14, 18, 'w');
  p.box(12, 23, 8, 4, 'O').hline(13, 18, 23, 'a').hline(13, 18, 25, 'Q');
  p.set(14, 22, 'y').set(15, 21, 'Y').set(16, 22, 'y');   // a little votive flame
  p.stamp(oak(0), 18, 12);
  return p.rows();
}

const ALTAR: Grid = [
  '.........y..........',
  '........yYy.........',
  '.......yYoYy........',
  '..kk...kYoYk...kk...',
  '.kaik.kNkokNk.kaik..',
  '.kiikkkkkkkkkkkiQk..',
  'kaaaaaaaaaaaaaaiiQk.',
  'kkkkkkkkkkkkkkkkkkk.',
  '.kaaiNNiaaiNNiiiQk..',
  '.kaiNaaNaiNaaNiiQk..',
  '.kaaiNNiaaiNNiiQQk..',
  '.kaaaaaaiiiiiiQQQk..',
  'kkkkkkkkkkkkkkkkkkk.',
  'kaaaaaiiiiiiiiQQQQk.',
  'kkkkkkkkkkkkkkkkkkk.',
];

/** Registers this group's sprites with registerArt()/registerDraw() (no canvas work at registration). */
export function registerNature(): void {
  [oak(0), oak(1), oak(2)].forEach((base, v) => {
    registerArt(`n_oak_${v}`, seasonOak(base, 0, v * 13), { outline: false });
    for (const s of [0, 1, 2, 3] as const) registerArt(`n_oak_${v}@${s}`, seasonOak(base, s, v * 13), { outline: false });
  });
  registerArt('n_pine', pine(), { outline: false });
  registerArt('n_cypress', cypress(), { outline: false });
  registerArt('n_stump', STUMP, { outline: false });
  registerArt('n_rock_0', ROCK_0, { outline: false });
  registerArt('n_rock_1', ROCK_1, { outline: false });
  registerArt('n_reeds', REEDS, { outline: false });
  registerArt('n_spring', SPRING, { outline: false });
  registerArt('n_ruins', ruins(), { outline: false });
  registerArt('n_lucus', lucus(), { outline: false });
  registerArt('n_altar', ALTAR, { outline: false });
}

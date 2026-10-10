// src/render/art/civic.ts — the block and half-block civic buildings: templum, macellum, balneum, horreum, apotheca,
// mansio (DESIGN §16.3); the plot buildings live in civicplots.ts. Owner: WP-G (G1).
// Each sprite is 64 px wide, bottom-aligned to its 4×4 or 4×2 footprint and overhanging upward.
import { registerArt } from '../sprites';
import { Pix } from './gridkit';
import { amphora, column, crate, cypress, door, hipRoof, paving, pedimentRoof, rakeRow, steam, stoneWall, wall, windowAt } from './facade';
import { plotBuildings } from './civicplots';

/** Registers a sprite whose grid already carries its outline (and may hold deliberately unoutlined steam or smoke). */
function reg(name: string, rows: string[]): void {
  registerArt(name, rows, { outline: false });
}

// ───────────────────────────── templum ─────────────────────────────

/** Hexastyle temple on a podium: terracotta roof, marble pediment with gilt acroteria, steps, altar in the precinct. */
function templum(): string[] {
  const p = new Pix(64, 72);
  const x0 = 6, x1 = 57, eave = 32, run = 2;
  paving(p, 1, 62, 62, 9);
  // roof and pediment
  const apex = pedimentRoof(p, x0, x1, eave, 14, run);
  for (let i = x0; i <= x1; i++) {
    const e = rakeRow(x0, x1, eave, run, i);
    p.set(i, e, 'w').set(i, e + 1, 'i');                                 // raking cornice
    for (let j = e + 2; j <= eave; j++) p.set(i, j, 'a');               // tympanum
  }
  p.rect(28, apex + 5, 8, 4, 'i').rect(29, apex + 6, 6, 2, 'N').set(31, apex + 6, 'y').set(32, apex + 6, 'y');   // gilt shield relief
  for (const x of [16, 22, 41, 47]) p.set(x, eave - 2, 'i').set(x + 1, eave - 3, 'i');
  // acroteria
  p.rect(30, apex - 18, 4, 4, 'N').set(30, apex - 18, 'y').set(31, apex - 19, 'Y').set(32, apex - 19, 'N').set(33, apex - 15, 'n');
  for (const x of [x0, x1 - 1]) p.rect(x, eave - 17, 2, 3, 'N').set(x, eave - 17, 'y');
  // entablature
  p.hline(x0, x1, eave + 1, 'w').hline(x0, x1, eave + 2, 'i');
  for (let i = x0; i <= x1; i++) p.set(i, eave + 3, i % 2 ? 'a' : 'i');
  p.hline(x0 + 1, x1 - 1, eave + 4, 'a').hline(x0 + 1, x1 - 1, eave + 5, 'O');
  // pronaos: shadow, cella wall and bronze doors behind six columns
  const top = eave + 6, base = 52;
  p.rect(x0 + 2, top, x1 - x0 - 3, base - top, 'O');
  p.hline(x0 + 2, x1 - 2, top, 'k').hline(x0 + 2, x1 - 2, top + 1, 'K').hline(x0 + 2, x1 - 2, top + 2, 'Q');
  p.rect(27, top + 4, 10, base - top - 4, 'k').rect(28, top + 5, 8, base - top - 5, 'N');
  p.vline(31, top + 5, base - 1, 'n').vline(32, top + 5, base - 1, 'B').rect(29, top + 7, 2, 2, 'y').rect(33, top + 7, 2, 2, 'Y');
  for (const cx of [10, 18, 26, 34, 42, 50]) column(p, cx, top, base - top + 1);
  // podium and steps
  p.rect(x0, base + 1, x1 - x0 + 1, 8, 'a');
  p.hline(x0, x1, base + 1, 'w').hline(x0, x1, base + 2, 'i').hline(x0, x1, base + 8, 'i').vline(x1, base + 1, base + 8, 'i');
  for (let s = 0; s < 6; s++) {
    const y = base + 1 + s * 2;
    p.hline(15 - s, 48 + s, y, 'w').hline(15 - s, 48 + s, y + 1, 'i');
  }
  p.vline(14, base + 1, base + 12, 'O').vline(49, base + 1, base + 12, 'Q');
  // the altar in the precinct, smoking, and two cypresses
  p.rect(28, 65, 8, 5, 'a').hline(28, 35, 65, 'w').hline(28, 35, 67, 'F').vline(35, 65, 69, 'i');
  p.set(31, 64, 'o').set(32, 64, 'y').set(31, 63, 'y').set(32, 62, 'W').set(31, 61, 'W');
  cypress(p, 4, 69, 14);
  cypress(p, 59, 69, 14);
  return p.outline().rows();
}

// ───────────────────────────── macellum ─────────────────────────────

/** A terracotta strip roof over a wing, ribs running down the slope (vertical ribs for a front-facing slope). */
function wingRoof(p: Pix, x: number, y: number, w: number, h: number, face: 'front' | 'left' | 'right'): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      if (face === 'front') p.set(i, j, (i - x) % 3 === 2 ? 'v' : j === y ? 'o' : 'u');
      else if (face === 'left') p.set(i, j, (j - y) % 3 === 2 ? 'u' : 'o');
      else p.set(i, j, (j - y) % 3 === 2 ? 'R' : 'v');
    }
  if (face === 'front') p.hline(x, x + w - 1, y + h - 1, 'v');
}

/** A conical terracotta roof from the apex (cx, top) down to an elliptical eave of half-width `rx` on row `eave`. */
function cone(p: Pix, cx: number, top: number, eave: number, rx: number): void {
  const h = eave - top;
  for (let j = 0; j <= h; j++) {
    const half = Math.round((rx * j) / h);
    for (let i = -half; i <= half; i++) {
      const rib = half > 2 && (i + half) % 3 === 0;
      const rel = i / Math.max(1, half);
      p.set(cx + i, top + j, rel < -0.35 ? (rib ? 'u' : 'o') : rel > 0.35 ? (rib ? 'R' : 'v') : rib ? 'v' : 'u');
    }
  }
  for (let i = -rx; i <= rx; i++) p.set(cx + i, eave + 1, Math.abs(i) < rx - 1 ? 'v' : '.');
}

/** Market hall: shops round a paved court with a domed tholos; a pedimented entrance between shop arches. */
function macellum(): string[] {
  const p = new Pix(64, 56);
  // back wing: roof and the inner portico with shop doors
  wingRoof(p, 2, 2, 60, 8, 'front');
  p.rect(10, 10, 44, 7, 'a').hline(10, 53, 10, 'k');
  for (let i = 12; i < 52; i += 6) p.rect(i + 1, 12, 4, 5, 'q').hline(i + 1, i + 4, 12, 'K');
  for (let i = 10; i < 54; i += 6) p.vline(i, 11, 16, 'w');
  // side wings
  wingRoof(p, 2, 10, 8, 30, 'left');
  wingRoof(p, 54, 10, 8, 30, 'right');
  p.vline(10, 10, 40, 'k').vline(53, 10, 40, 'k');
  // the court
  paving(p, 11, 17, 42, 22, 'i', 'O');
  p.hline(11, 52, 17, 'Q');
  // tholos: platform, columns, conical roof with a gilt finial; a fountain inside
  p.ellipse(19, 31, 26, 7, 'i');
  p.ellipse(20, 31, 24, 5, 'a');
  p.rect(23, 26, 18, 7, 'K').ellipse(28, 28, 8, 4, 'M').set(30, 28, 'c').set(31, 27, 'w');
  for (const cx of [21, 26, 31, 36, 41]) { p.vline(cx, 24, 33, 'w'); p.vline(cx + 1, 24, 33, 'i'); }
  cone(p, 31, 10, 23, 13);
  p.vline(31, 7, 9, 'N').set(31, 6, 'y');
  // front wing: roof, facade with shops and the entrance
  wingRoof(p, 2, 40, 60, 5, 'front');
  p.rect(3, 45, 58, 9, 'a').vline(60, 45, 53, 'i').hline(3, 60, 45, 'k').rect(3, 52, 58, 2, 'F').hline(3, 60, 52, 'R');
  for (const x of [6, 14, 43, 51]) {
    p.rect(x, 47, 6, 6, 'q').hline(x, x + 5, 47, 'K');
    p.hline(x, x + 5, 46, 'r').set(x + 1, 46, 'w').set(x + 3, 46, 'w').set(x + 5, 46, 'w');   // striped awnings
    p.hline(x + 1, x + 4, 51, 'n').set(x + 2, 50, 'u').set(x + 3, 50, 'V');
  }
  p.rect(25, 46, 14, 8, 'K').rect(27, 47, 10, 7, 'i');
  p.rect(29, 48, 6, 6, 'k');
  for (const cx of [25, 36]) column(p, cx, 45, 9);
  for (let k = 0; k < 8; k++) p.hline(24 + k, 39 - k, 44 - Math.floor(k / 2), k === 0 ? 'w' : 'a');   // small pediment
  p.hline(26, 37, 44, 'i');
  p.hline(3, 60, 54, 'Q');
  return p.outline().rows();
}

// ───────────────────────────── balneum ─────────────────────────────

/**
 * A masonry dome (upper half-ellipse) centred on cx with its base on row `base`: lit from the top-left, course rings,
 * and a dark oculus at the crown.
 */
function dome(p: Pix, cx: number, base: number, rx: number, ry: number, oculus = true): void {
  for (let j = base - ry; j <= base; j++)
    for (let i = cx - rx; i <= cx + rx; i++) {
      const nx = (i + 0.5 - (cx + 0.5)) / (rx + 0.5), ny = (j + 0.5 - (base + 0.5)) / (ry + 0.5);
      if (nx * nx + ny * ny > 1) continue;
      const light = -nx * 0.8 - ny * 0.6;                 // towards the top-left
      p.set(i, j, light > 0.6 ? 'w' : light > 0.1 ? 'a' : light > -0.35 ? 'i' : 'O');
    }
  if (oculus) p.hline(cx - 1, cx + 1, base - ry, 'K').set(cx, base - ry + 1, 'K');
}

/** Bathhouse: a domed caldarium and a small laconicum, a portico over the open-air pool, arched glazed windows. */
function balneum(): string[] {
  const p = new Pix(64, 52);
  // left wing: hip roof over the portico of the natatio
  p.rect(2, 22, 22, 6, 'u');
  for (let i = 2; i < 24; i++) { p.set(i, 22, 'o'); if ((i - 2) % 3 === 2) p.vline(i, 23, 27, 'v'); }
  p.hline(2, 23, 27, 'v');
  p.rect(3, 28, 20, 8, 'K').hline(3, 22, 28, 'k');
  for (const cx of [3, 9, 15, 20]) { p.vline(cx, 29, 35, 'w'); p.vline(cx + 1, 29, 35, 'i'); }
  // the pool
  p.rect(2, 36, 22, 14, 'a').hline(2, 23, 36, 'w').vline(23, 36, 49, 'i');
  p.rect(4, 38, 18, 10, 'M');
  for (const [x, y] of [[6, 40], [12, 42], [17, 39], [9, 45], [16, 46]]) p.hline(x, x + 2, y, 'c');
  p.hline(4, 21, 38, 'C');
  // main block: brick, a drum and the big dome, glazed arched windows
  for (let j = 30; j < 50; j++) for (let i = 24; i < 62; i++) p.set(i, j, (j - 30) % 3 === 2 || (i + ((j - 30) % 6 < 3 ? 0 : 2)) % 5 === 4 ? 't' : 'n');
  p.vline(61, 30, 49, 'B');
  p.rect(24, 26, 26, 4, 'i').hline(24, 49, 26, 'a').vline(49, 26, 29, 'O');
  dome(p, 37, 26, 13, 13);
  p.rect(50, 24, 12, 6, 'i').hline(50, 61, 24, 'a').vline(61, 24, 29, 'O');
  dome(p, 56, 24, 6, 6);
  for (const x of [27, 34, 41]) {
    p.rect(x, 33, 5, 9, 'k').rect(x + 1, 34, 3, 8, 'C').set(x + 1, 35, 'c').set(x + 2, 34, 'c');
    p.vline(x + 2, 34, 41, 'k');
  }
  p.rect(50, 36, 9, 14, 'k').rect(51, 37, 7, 13, 'q').vline(51, 38, 49, 'K');      // entrance arch
  p.set(50, 36, '.').set(58, 36, '.');
  p.hline(24, 61, 43, 'B').hline(24, 49, 44, 't');
  p.hline(2, 61, 50, 'Q');
  p.outline();
  steam(p, 37, 11, 10);                                                // steam from the oculi (unoutlined)
  steam(p, 56, 16, 9);
  steam(p, 10, 34, 4);
  return p.rows();
}

// ───────────────────────────── horreum, apotheca, mansio ─────────────────────────────

/** A stack of grain sacks on the ground at (x, ground). */
function sacks(p: Pix, x: number, ground: number): void {
  for (const [dx, dy] of [[0, 0], [4, 0], [2, -3]]) {
    p.rect(x + dx, ground - 3 + dy, 4, 3, 'e').hline(x + dx, x + dx + 3, ground - 1 + dy, 'E').set(x + dx + 3, ground - 2 + dy, 'E');
    p.set(x + dx + 1, ground - 3 + dy, 'T');
  }
}

/** Granary: a long tufa store under a great hip roof, buttresses with vent slits, a raised floor, sacks at the door. */
function horreum(): string[] {
  const p = new Pix(64, 40);
  hipRoof(p, 1, 1, 62, 16, 4, 12);
  stoneWall(p, 3, 17, 58, 20, 'O', 'Q', 4);
  p.hline(3, 60, 17, 'k');
  for (const x of [3, 12, 21, 40, 49, 58]) {
    p.rect(x, 18, 3, 19, 'a').vline(x + 2, 18, 36, 'i').hline(x, x + 2, 18, 'w').hline(x - 1, x + 3, 36, 'i');
  }
  for (const x of [8, 17, 45, 54]) p.rect(x, 21, 1, 6, 'q').set(x, 21, 'K');
  for (let x = 6; x < 60; x += 4) if (x < 25 || x > 38) p.set(x, 34, 'K');      // floor vents
  p.rect(25, 19, 14, 3, 'a').hline(26, 37, 20, 'G').hline(25, 38, 21, 'i');        // HORREA plaque
  door(p, 27, 22, 10, 15, false, 'b');
  p.vline(31, 23, 36, 'm').vline(32, 23, 36, 'B');
  p.hline(25, 38, 37, 'i').hline(24, 39, 38, 'a');
  sacks(p, 15, 37);
  sacks(p, 41, 37);
  return p.outline().rows();
}

/** Warehouse: stone ground floor, plank upper floor with a hoist beam, open doors and goods stacked outside. */
function apotheca(): string[] {
  const p = new Pix(64, 36);
  hipRoof(p, 3, 1, 58, 12, 3, 9);
  for (let j = 13; j < 23; j++) for (let i = 5; i < 59; i++) p.set(i, j, (j - 13) % 3 === 2 ? 'B' : (i * 7 + j) % 13 === 0 ? 'B' : 'n');
  p.hline(5, 58, 13, 'k').vline(58, 13, 22, 'b');
  for (const x of [5, 18, 31, 45, 57]) p.vline(x, 14, 22, 'b');
  stoneWall(p, 5, 23, 54, 11, 'O', 'Q', 3);
  p.hline(5, 58, 23, 'B');
  // upper loading door and the hoist beam with a hanging crate
  p.rect(28, 14, 8, 8, 'q').vline(28, 14, 21, 'b').vline(35, 14, 21, 'b');
  p.hline(29, 38, 13, 'B').hline(29, 38, 12, 'n').vline(38, 13, 17, 'T');
  crate(p, 36, 18, 4);
  // the great door, open, with crates inside
  p.rect(22, 24, 20, 10, 'k').rect(23, 25, 18, 9, 'q');
  crate(p, 24, 29, 5); crate(p, 29, 30, 4); crate(p, 34, 28, 6);
  p.rect(19, 24, 3, 10, 'b').vline(19, 24, 33, 'B').rect(42, 24, 3, 10, 'b').vline(44, 24, 33, 'm');   // door leaves
  for (const x of [10, 52]) p.rect(x, 26, 3, 2, 'k').set(x + 1, 26, 'X').set(x + 1, 27, 'X');      // barred vents
  // goods outside
  crate(p, 6, 29, 5); crate(p, 11, 30, 4); crate(p, 8, 25, 4);
  for (const x of [48, 52, 56]) amphora(p, x, 34);
  p.rect(46, 30, 3, 4, 'B').hline(46, 48, 31, 'b').hline(46, 48, 33, 'b');                            // barrel
  p.hline(5, 58, 34, 'Q');
  return p.outline().rows();
}

/** Road station: two storeys with a balcony, a gateway to the stable yard, a hanging sign, a trough by the road. */
function mansio(): string[] {
  const p = new Pix(64, 40);
  hipRoof(p, 1, 1, 62, 12, 3, 9);
  wall(p, 3, 13, 58, 25, 's', 't', 3);
  p.hline(3, 60, 13, 'k').hline(3, 60, 23, 'F').hline(3, 60, 24, 'R');
  for (const x of [6, 13, 20, 41, 48, 55]) windowAt(p, x, 15, 3, 4, true);
  p.hline(4, 27, 21, 'n'); for (let i = 4; i <= 27; i += 2) p.set(i, 22, 'B');                     // balcony
  // the gateway into the yard, a glimpse of the court and a cart wheel
  p.rect(26, 14, 12, 24, 'k').rect(27, 16, 10, 22, 'K').set(26, 14, '.').set(37, 14, '.').set(27, 15, 'k').set(36, 15, 'k');
  p.rect(28, 28, 8, 10, 'L').hline(28, 35, 28, 'd').rect(28, 32, 8, 6, 't');
  p.ellipse(30, 30, 5, 5, 'B').set(32, 32, 'n');
  p.hline(25, 38, 13, 'a').hline(25, 38, 14, 'i');
  // the inn door and its hanging sign
  door(p, 8, 27, 6, 11, true);
  p.hline(15, 21, 26, 'b').vline(17, 27, 27, 'T').vline(20, 27, 27, 'T').rect(16, 28, 6, 4, 'n').box(16, 28, 6, 4, 'b').hline(17, 20, 29, 'r');
  // the stable: wide plank doors and hay
  p.rect(42, 27, 15, 11, 'B');
  for (let i = 42; i < 57; i += 2) p.vline(i, 28, 37, 'n');
  p.line(42, 27, 49, 37, 'b').line(56, 27, 49, 37, 'b').hline(42, 56, 27, 'b');
  p.rect(57, 33, 4, 5, 'e').hline(57, 60, 33, 'T').set(59, 35, 'E');
  // trough at the roadside
  p.rect(18, 35, 7, 3, 'i').hline(19, 23, 35, 'M').set(20, 35, 'c');
  p.hline(3, 60, 38, 'Q');
  return p.outline().rows();
}

/** Registers this group's sprites with registerArt()/registerDraw() (no canvas work at registration). */
export function registerCivic(): void {
  reg('b_templum', templum());
  reg('b_macellum', macellum());
  reg('b_balneum', balneum());
  reg('b_horreum', horreum());
  reg('b_apotheca', apotheca());
  reg('b_mansio', mansio());
  for (const [name, rows] of Object.entries(plotBuildings())) reg(name, rows);
}

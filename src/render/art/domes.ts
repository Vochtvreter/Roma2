// src/render/art/domes.ts — the two procedural civic set pieces ARCHITECTURE §3 assigns to procedural art: the theatrum
// (64×56, a stepped cavea above the stage building) and the thermae (64×64, great concrete domes over the bath halls
// with a natatio in front). Owner: WP-G (art, part 2). Light from the top-left; PAL keys only.
import type { Grid } from '../sprites';
import { Pix, noise } from './brush';
import { RAMP, arch, tiledRoof } from './opus';
import type { Ramp } from './opus';

/** b_theatrum: concentric seat rows (lit treads, shaded risers) in a half-ellipse, a crowning portico, orchestra and stage. */
export function theatrum(): Grid {
  const p = new Pix(64, 56);
  const cx = 32, cy = 44, rx = 31, ry = 40;
  p.shade(0, 0, 64, 45, (X, Y) => {
    const dx = (X + 0.5 - cx) / rx, dy = (Y + 0.5 - cy) / ry;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1 || Y > cy) return null;
    const ang = Math.atan2(Y + 0.5 - cy, X + 0.5 - cx);                     // −π (west) … 0 (east)
    if (d > 0.9) {
      // the summa cavea portico: a colonnade around the rim under its roof
      const step = Math.round(((ang + Math.PI) / Math.PI) * 36);
      return d > 0.965 ? (X < cx ? 'u' : 'v') : step % 2 === 0 ? (X < cx ? 'w' : 'a') : 'Q';
    }
    if (d < 0.3) return null;                                               // orchestra (painted below)
    // vomitoria: radial aisles every 30°
    const sector = ((ang + Math.PI) / Math.PI) * 6;
    if (Math.abs(sector - Math.round(sector)) < 0.05 && d < 0.88) return 'O';
    // seat rows: lit tread, mid tread, shaded riser
    const row = Math.floor(d * 39) % 3;
    const lit = X + Y * 0.3 < cx + 6;
    if (Math.abs(d - 0.6) < 0.02) return 'O';                              // the praecinctio walkway
    return row === 0 ? (lit ? 'w' : 'a') : row === 1 ? (lit ? 'a' : 'i') : (lit ? 'O' : 'Q');
  });
  // orchestra: a paved half-disc
  p.shade(0, 30, 64, 15, (X, Y) => {
    const dx = (X + 0.5 - cx) / (rx * 0.3), dy = (Y + 0.5 - cy) / (ry * 0.3);
    return dx * dx + dy * dy <= 1 && Y <= cy ? ((X + Y) % 3 === 0 ? 'O' : 'i') : null;
  });
  // the stage (pulpitum) and the stage building's long roof and arcaded back wall
  p.rect(10, 44, 44, 2, 'n').hline(10, 53, 44, 't');
  tiledRoof(p, 2, 45, 60, 4, 0);
  for (let y = 49; y < 55; y++) for (let x = 3; x < 61; x++) p.set(x, y, x < 5 ? 'a' : x > 58 ? 'Q' : (y === 49 ? 'i' : 'O'));
  for (let x = 6; x < 58; x += 7) arch(p, x, 50, 4, 5, 'K');
  p.hline(3, 60, 55, 'Q');
  return p.rows();
}

/** A dome lit from the top-left on a drum: ribs, an oculus, arched drum windows. Centre (cx, cy) of the dome's base. */
function dome(p: Pix, cx: number, cy: number, r: number, drum: number, ramp: Ramp = RAMP.lead): void {
  const [hi, li, base, sh, dk] = ramp;
  // drum (a short cylinder)
  for (let y = cy; y < cy + drum; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const t = (x - (cx - r)) / (2 * r);
      p.set(x, y, t < 0.2 ? 'a' : t > 0.8 ? 'O' : y === cy ? 'w' : 'i');
    }
  for (let x = cx - r + 3; x < cx + r - 2; x += 5) p.rect(x, cy + 2, 2, Math.max(2, drum - 4), 'q');
  // the cupola
  const ry = r * 0.85;
  p.shade(cx - r, cy - Math.ceil(ry), 2 * r + 1, Math.ceil(ry) + 1, (X, Y) => {
    const dx = (X + 0.5 - cx) / r, dy = (Y + 0.5 - cy) / ry;
    if (dx * dx + dy * dy > 1 || Y > cy) return null;
    const light = -dx * 0.7 - dy * 0.5 + (1 - dx * dx - dy * dy) * 0.3;
    let k = light > 0.55 ? hi : light > 0.2 ? li : light > -0.25 ? base : light > -0.6 ? sh : dk;
    const rib = Math.round((Math.atan2(dy, dx) + Math.PI) * 4) % 3 === 0 && dy < -0.15;
    if (rib && k !== hi) k = k === base ? sh : base;
    return k;
  });
  p.ellipse(cx, cy - ry + 1.5, Math.max(1, r * 0.18), 1, 'q');
  p.hline(cx - r, cx + r, cy, 'w');
}

/** b_thermae: the great baths — a central dome, two lesser domes over the side halls, apsed front, the natatio. */
export function thermae(): Grid {
  const p = new Pix(64, 64);
  // halls: brick-faced concrete with tiled roofs
  tiledRoof(p, 1, 22, 62, 8, 4);
  for (let y = 30; y < 50; y++)
    for (let x = 2; x < 62; x++) {
      const n = noise(x, y, 141);
      p.set(x, y, y === 30 ? 'v' : x < 4 ? 's' : x > 59 ? 'v' : n < 0.1 ? 'v' : (y % 3 === 0 ? 'v' : 'u'));
    }
  for (let x = 6; x < 60; x += 8) if (x < 22 || x > 40) arch(p, x, 36, 4, 9, 'q', 'a');
  // the front entrance: a white columned porch
  p.rect(22, 34, 20, 16, 'a').hline(22, 41, 34, 'w');
  for (let x = 23; x < 41; x += 4) p.vline(x, 36, 49, 'w').vline(x + 1, 36, 49, 'i').vline(x + 2, 36, 49, 'K');
  p.rect(22, 49, 20, 1, 'i');
  // domes: two lesser over the side halls, the great one over the caldarium
  dome(p, 12, 26, 8, 4);
  dome(p, 52, 26, 8, 4);
  dome(p, 32, 26, 15, 6);
  // natatio (open-air pool) in front with a travertine edge
  p.rect(6, 52, 52, 10, 'a').rect(8, 54, 48, 6, 'M');
  p.shade(8, 54, 48, 6, (X, Y) => (Y === 54 ? 'C' : (X + Y * 3) % 9 === 0 ? 'c' : null));
  p.hline(6, 57, 62, 'i').vline(57, 53, 61, 'i');
  return p.rows();
}

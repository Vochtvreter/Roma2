// src/render/art/facade.ts — Roman building parts drawn into a Pix: tiled roofs, walls, doors, windows, columns. Owner: WP-G (G1).
// Light comes from the top-left: faces turned up or left are lit, faces turned right are shaded.
import type { Pix } from './gridkit';

/** Terracotta faces of a roof, lit from the top-left. */
type Face = 'back' | 'front' | 'left' | 'right';

/** The tile texture of one roof face at (i, j): imbrices run down the slope, so slopes show vertical ribs and hips horizontal ones. */
function tileAt(face: Face, i: number, j: number): string {
  const col = ((i % 3) + 3) % 3, row = ((j % 3) + 3) % 3;
  switch (face) {
    case 'front': return col === 2 ? 'v' : 'u';
    case 'back': return col === 2 ? 'u' : 'o';
    case 'left': return row === 2 ? 'u' : 'o';
    case 'right': return row === 2 ? 'R' : 'v';
  }
}

/**
 * A hipped terracotta roof seen from above-front in the box (x, y, w, h): back slope above ridge row `y + back`,
 * front slope below it, hips `a` px wide at the ridge (left hip lit, right hip shaded), eave on the last row.
 */
export function hipRoof(p: Pix, x: number, y: number, w: number, h: number, back: number, a: number): void {
  const front = h - 1 - back;
  for (let j = 0; j < h; j++) {
    const d = j <= back ? (back ? Math.round((a * j) / back) : a) : Math.round((a * (h - 1 - j)) / front);
    const xl = x + d, xr = x + w - 1 - d;
    for (let i = x; i < x + w; i++) {
      const face: Face = i < xl ? 'left' : i > xr ? 'right' : j < back ? 'back' : 'front';
      p.set(i, y + j, tileAt(face, i - x, j));
    }
  }
  p.hline(x + a, x + w - 1 - a, y + back, 'o');                     // ridge cap and its shadow
  p.hline(x + a + 1, x + w - 2 - a, y + back + 1, 'v');
  p.hline(x, x + w - 1, y + h - 1, 'v');                            // eave
}

/**
 * A gable-front roof (ridge running back, away from the viewer) over the columns x0..x1 (odd width): the left plane
 * lit, the right plane shaded, each `depth` px deep above the verge of the front gable, whose eaves sit on row
 * `eaveY`. Returns the apex row of the gable; the caller paints the gable wall below the verge.
 */
export function gableRoof(p: Pix, x0: number, x1: number, eaveY: number, depth: number, lit = 'u', dark = 'v'): number {
  const half = (x1 - x0) >> 1;
  for (let k = 0; k <= half; k++) {
    const edge = eaveY - k;                     // the verge row in this column pair
    for (let j = edge - depth; j < edge; j++) {
      const rib = (edge - j) % 3 === 0;
      p.set(x0 + k, j, rib ? 'v' : lit);
      p.set(x1 - k, j, rib ? 'R' : dark);
    }
    p.set(x0 + k, edge, 'v');
    p.set(x1 - k, edge, 'R');
    p.set(x0 + k, edge - depth, 'o');
  }
  p.vline(x0 + half, eaveY - half - depth, eaveY - half - 1, 'o');
  return eaveY - half;
}

/** A plastered wall with a darker right edge and an optional Pompeian-red dado of `dado` rows at the bottom. */
export function wall(p: Pix, x: number, y: number, w: number, h: number, plaster = 's', shade = 't', dado = 0, dadoKey = 'F'): void {
  p.rect(x, y, w, h, plaster);
  p.vline(x + w - 1, y, y + h - 1, shade);
  if (dado > 0) {
    p.rect(x, y + h - dado, w, dado, dadoKey);
    p.hline(x, x + w - 1, y + h - dado, dadoKey === 'F' ? 'R' : 'k');
  }
}

/** A stone wall of tufa blocks (running bond) with mortar lines. */
export function stoneWall(p: Pix, x: number, y: number, w: number, h: number, stone = 'O', joint = 'Q', course = 3): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      const r = j - y, row = Math.floor(r / course);
      const joinH = r % course === course - 1;
      const joinV = (i - x + (row % 2) * 3) % 6 === 5;
      p.set(i, j, joinH || joinV ? joint : stone);
    }
  p.vline(x + w - 1, y, y + h - 1, joint);
}

/** A door: dark opening with a wooden leaf and frame, optionally round-arched. */
export function door(p: Pix, x: number, y: number, w: number, h: number, arch = false, leaf = 'b'): void {
  p.rect(x, y, w, h, 'k');
  p.rect(x + 1, y + 1, w - 2, h - 1, leaf);
  p.vline(x + 1, y + 1, y + h - 1, 'B');
  if (w >= 5) p.vline(x + Math.floor(w / 2), y + 2, y + h - 1, 'm');
  if (arch) { p.set(x, y, '.'); p.set(x + w - 1, y, '.'); p.set(x + 1, y + 1, 'k'); p.set(x + w - 2, y + 1, 'k'); }
}

/** A small window: dark pane with a lit sill; `shutters` adds wooden shutters either side. */
export function windowAt(p: Pix, x: number, y: number, w: number, h: number, shutters = false, pane = 'q'): void {
  p.rect(x, y, w, h, pane);
  p.hline(x, x + w - 1, y + h, 'a');
  if (shutters) { p.vline(x - 1, y, y + h - 1, 'B'); p.vline(x + w, y, y + h - 1, 'b'); }
}

/** A marble column with a capital and base, `h` rows tall (3 px wide: lit, mid, shade). */
export function column(p: Pix, x: number, y: number, h: number, lit = 'w', mid = 'a', shade = 'i'): void {
  p.hline(x - 1, x + 3, y, mid);
  p.hline(x - 1, x + 3, y + 1, shade);
  for (let j = y + 2; j < y + h - 1; j++) { p.set(x, j, lit); p.set(x + 1, j, mid); p.set(x + 2, j, shade); }
  p.hline(x - 1, x + 3, y + h - 1, mid);
}

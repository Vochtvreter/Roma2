// src/ui/tipkit.ts — the shell's shared vocabulary (WP-H): inscription caps, tooltip blocks, the code-drawn meander
// frame and the wax seal. Tooltip blocks are plain DOM (h()), never HTML strings: names in them are game data.
import { h } from './dom';
import type { Kid } from './dom';
import { hasSprite } from '../render/sprites';
import { img } from './dom';

/** Inscription caps: upper case with V for U ('Res gestae' → 'RES GESTAE', 'Vicus' → 'VICVS'). */
export const caps = (s: string): string => s.toUpperCase().replace(/U/g, 'V');

/** A tooltip heading with an optional Latin sub-label. */
export function tipHead(title: string, latin?: string): HTMLElement {
  return h('div', { class: 'tip-h' }, title, latin ? h('span', { class: 'tip-latin' }, latin) : null);
}

/** A two-column ledger line: label left, value right ('pos' green, 'neg' red, 'total' bold with a rule). */
export function tipRow(label: Kid, value: Kid, kind: 'pos' | 'neg' | 'total' | '' = ''): HTMLElement {
  return h('div', { class: kind ? `tip-row ${kind}` : 'tip-row' }, h('span', null, label), h('span', { class: 'num' }, value));
}

/** A thin divider. */
export function tipSep(): HTMLElement {
  return h('div', { class: 'tip-sep' });
}

/** A small caps section label inside a tooltip. */
export function tipKicker(text: string): HTMLElement {
  return h('div', { class: 'tip-k' }, text);
}

/** A muted (or classed) paragraph. */
export function tipNote(text: Kid, cls = 'muted'): HTMLElement {
  return h('div', { class: `tip-note ${cls}` }, text);
}

/** A tooltip body wrapper. */
export function tipCard(...kids: Kid[]): HTMLElement {
  return h('div', { class: 'tip-card' }, ...kids);
}

// ───────────────────────────── the meander (Greek key) frame ─────────────────────────────
// One 8×8 running-key unit (base line on the inner side), a corner rosette, assembled into a 24×24 nine-slice source
// for CSS border-image (slice 8 design px). Drawn at an integer pixel scale so the border stays crisp.
const KEY: readonly string[] = [
  '.#######',
  '.#.....#',
  '.#.###.#',
  '.#.#.#.#',
  '.#...#.#',
  '.#####.#',
  '.......#',
  '########',
];
const CORNER: readonly string[] = [
  '########',
  '#......#',
  '#.####.#',
  '#.#..#.#',
  '#.#..#.#',
  '#.####.#',
  '#......#',
  '########',
];
const U = 8;
const meanderCache = new Map<string, string>();

/** A data URL of the meander nine-slice (24 × 24 design px × px); `bg` fills behind the key when given. */
export function meanderURL(fg: string, bg: string | null = null, px = 2): string {
  const key = `${fg}|${bg}|${px}`;
  const hit = meanderCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 3 * U * px;
  const g = c.getContext('2d');
  if (!g) return '';
  // (cx, cy) = cell origin in design px; map(x, y) → the source grid cell for that cell's orientation.
  const paint = (cx: number, cy: number, grid: readonly string[], map: (x: number, y: number) => [number, number]): void => {
    for (let y = 0; y < U; y++) for (let x = 0; x < U; x++) {
      const [sx, sy] = map(x, y);
      const on = grid[sy][sx] === '#';
      if (!on && !bg) continue;
      g.fillStyle = on ? fg : (bg ?? fg);
      g.fillRect((cx + x) * px, (cy + y) * px, px, px);
    }
  };
  const id = (x: number, y: number): [number, number] => [x, y];
  paint(0, 0, CORNER, id); paint(2 * U, 0, CORNER, id); paint(0, 2 * U, CORNER, id); paint(2 * U, 2 * U, CORNER, id);
  paint(U, 0, KEY, id);                                         // top: base line inward (bottom)
  paint(U, 2 * U, KEY, (x, y) => [x, U - 1 - y]);               // bottom: flipped, base on top
  paint(0, U, KEY, (x, y) => [U - 1 - y, x]);                   // left: rotated, base on the right (inward)
  paint(2 * U, U, KEY, (x, y) => [y, U - 1 - x]);               // right: rotated, base on the left (inward)
  const url = c.toDataURL('image/png');
  meanderCache.set(key, url);
  return url;
}

/** Sets the CSS variables the frames use: --meander (gold on dark), --meander-ink (umber on parchment), --meander-px. */
export function installMeander(root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--meander', `url(${meanderURL('#c99a3b', null, 2)})`);
  root.style.setProperty('--meander-ink', `url(${meanderURL('#8a3d2b', null, 2)})`);
  root.style.setProperty('--meander-px', `${U * 2}px`);
}

/** The red wax seal: the f_seal sprite once the art lands, else a CSS-drawn seal with the colony's initials. */
export function waxSeal(initials = 'CV'): HTMLElement {
  if (hasSprite('f_seal')) return h('span', { class: 'disp-seal' }, img('f_seal', 4));
  return h('span', { class: 'disp-seal css' }, h('span', null, initials));
}

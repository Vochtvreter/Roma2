// src/render/buildings.ts — building and house draw dispatch, rise(), states (ARCHITECTURE §12.2 steps 5–6). Owner: WP-F.
// SCAFFOLD (debug): footprints as rectangles coloured by category (houses by tier), with status styling.
import type { BuildCat, Building, GameState, HouseTierId, Rect } from '../game/types';
import { BUILDING_DEFS } from '../game/data/buildings';
import { W } from '../game/map';
import { footprintOf } from '../game/derived';
import { structEpoch } from '../game/memo';
import { TILE } from './camera';

/** Debug fill colour per building category. */
export const CAT_COLOR: Readonly<Record<BuildCat, string>> = {
  domus: '#c0623f', annona: '#d9c27a', aqua: '#62b0d6', materia: '#8a6b4a', officinae: '#55565e',
  mercatus: '#d9a35b', religio: '#efe8d8', salus: '#9fd4f0', ornamenta: '#9ccc5a', civitas: '#d8ceb6',
};

/** Debug fill colour per house tier (tents red → thatch → terracotta → stone → plaster → marble). */
export const TIER_COLOR: Readonly<Record<HouseTierId, string>> = {
  tentoria: '#9e2f25', casa: '#b07a45', tegulata: '#c0623f', domusParva: '#d2c7b2', insula: '#d9a35b', domus: '#efe8d8',
};

let rectEpoch = -1;
let rectState: GameState | null = null;
const rects = new Map<number, Rect>();

/** The tile bounding rectangle of a building's footprint (cached per structure epoch). */
export function footprintRect(s: GameState, b: Building): Rect {
  const ep = structEpoch(s);
  if (ep !== rectEpoch || s !== rectState) {
    rects.clear();
    rectEpoch = ep;
    rectState = s;
  }
  let r = rects.get(b.id);
  if (r) return r;
  const tiles = footprintOf(b, s);
  let x0 = b.x, y0 = b.y, x1 = b.x, y1 = b.y;
  for (const i of tiles) {
    const x = i % W, y = Math.floor(i / W);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  r = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  rects.set(b.id, r);
  return r;
}

/** The debug fill colour of a building. */
export function buildingColor(b: Building): string {
  if (b.type === 'area') return TIER_COLOR[b.house?.tier ?? 'tentoria'];
  return CAT_COLOR[BUILDING_DEFS[b.type].cat];
}

/** Draw options for one frame. */
export interface BuildingDrawOpts { vis: Rect; selected: number | null; hover: number | null; doomed: number | null; time: number }

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Draws every building in view (world-px transform already applied), y-sorted by footprint bottom then x. */
export function drawBuildings(g: CanvasRenderingContext2D, s: GameState, o: BuildingDrawOpts): void {
  const list: { b: Building; r: Rect }[] = [];
  for (const b of s.buildings) {
    const r = footprintRect(s, b);
    if (overlaps(r, o.vis)) list.push({ b, r });
  }
  list.sort((p, q) => p.r.y + p.r.h - (q.r.y + q.r.h) || p.r.x - q.r.x);
  for (const { b, r } of list) drawOne(g, b, r, o);
}

function drawOne(g: CanvasRenderingContext2D, b: Building, r: Rect, o: BuildingDrawOpts): void {
  const x = r.x * TILE, y = r.y * TILE, w = r.w * TILE, h = r.h * TILE;
  const col = buildingColor(b);
  g.save();
  if (b.status === 'done') {
    g.fillStyle = col;
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.strokeStyle = '#1d1410';
    g.lineWidth = 1;
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    if (!b.open) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 1, y + 1, w - 2, h - 2); }
    if (b.house?.declining) { g.fillStyle = 'rgba(128,107,87,.5)'; g.fillRect(x + 1, y + 1, w - 2, h - 2); }
  } else {
    // plan: dashed outline; staked: outline + pegs; building: translucent fill + progress bar
    g.globalAlpha = b.status === 'building' ? 0.55 : 0.9;
    if (b.status === 'building') { g.fillStyle = col; g.fillRect(x + 1, y + 1, w - 2, h - 2); }
    g.strokeStyle = b.status === 'plan' ? '#f2c94c' : '#efe8d8';
    g.lineWidth = 1;
    g.setLineDash(b.status === 'plan' ? [3, 2] : []);
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    g.setLineDash([]);
    g.globalAlpha = 1;
    if (b.status === 'staked') {
      g.fillStyle = '#efe8d8';
      for (const [px, py] of [[x + 1, y + 1], [x + w - 3, y + 1], [x + 1, y + h - 3], [x + w - 3, y + h - 3]]) g.fillRect(px, py, 2, 2);
    }
    if (b.status === 'building') {
      g.fillStyle = '#1d1410';
      g.fillRect(x + 2, y + h - 5, w - 4, 3);
      g.fillStyle = '#f2c94c';
      g.fillRect(x + 2, y + h - 5, Math.max(1, (w - 4) * b.progress), 3);
    }
  }
  if (b.id === o.doomed) {
    g.fillStyle = `rgba(229,85,74,${0.35 + 0.25 * Math.sin(o.time / 120)})`;
    g.fillRect(x, y, w, h);
  }
  if (b.id === o.selected || b.id === o.hover) {
    g.strokeStyle = b.id === o.selected ? '#f0a04b' : 'rgba(244,234,214,.85)';
    g.lineWidth = b.id === o.selected ? 2 : 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  g.restore();
}

/**
 * The rise of a site: the finished sprite clipped from the bottom to `h × progress` (ARCHITECTURE §12.2).
 * (x, y) is the sprite's top-left in world px; the scaffold overlay and trench are WP-F's.
 */
export function rise(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, progress: number): void {
  const p = Math.max(0, Math.min(1, progress));
  const sh = Math.round(img.height * p);
  if (sh <= 0) return;
  g.drawImage(img, 0, img.height - sh, img.width, sh, x, y + img.height - sh, img.width, sh);
}

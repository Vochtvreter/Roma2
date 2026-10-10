// src/render/camera.ts — camera, integer zoom, screen↔world (ARCHITECTURE §12.1, DESIGN §3.1). Owner: WP-F.
// World px: 16 per tile. Screen coordinates here are DEVICE px (the canvas backing store).
import type { Rect } from '../game/types';
import { H, W } from '../game/map';
import { B } from '../game/balance';

/** CSS px per world px (DESIGN §3.1: integer levels 1–5). */
export const ZOOM_LEVELS: readonly number[] = [1, 2, 3, 4, 5];
/** World px per tile. */
export const TILE: number = B.map.TILE;
/** Map size in world px. */
export const WORLD_W: number = W * TILE;
/** Map size in world px. */
export const WORLD_H: number = H * TILE;
const MIN_VISIBLE = 0.25;          // ≥ 25% of the viewport always shows map

/** x, y = world px at the viewport centre; level = CSS px per world px; scale = device px per world px; vw, vh device px. */
export interface Camera { x: number; y: number; level: number; scale: number; vw: number; vh: number }

/** Device px per world px for a zoom level: max(1, round(level × dpr)). */
export function scaleFor(level: number, dpr: number): number {
  return Math.max(1, Math.round(level * dpr));
}

/** The default zoom level: 3 on desktop, 2 below 700 CSS px (DESIGN §3.1). */
export function defaultLevel(cssWidth: number): number {
  return cssWidth < 700 ? 2 : 3;
}

/** A camera at the map centre, default level, 1×1 viewport (resize() fills in the real size). */
export function makeCamera(): Camera {
  const level = 3;
  return { x: WORLD_W / 2, y: WORLD_H / 2, level, scale: level, vw: 1, vh: 1 };
}

/** World px → device px. */
export function worldToScreen(c: Camera, wx: number, wy: number): { sx: number; sy: number } {
  return { sx: (wx - c.x) * c.scale + c.vw / 2, sy: (wy - c.y) * c.scale + c.vh / 2 };
}

/** Device px → world px. */
export function screenToWorld(c: Camera, sx: number, sy: number): { wx: number; wy: number } {
  return { wx: (sx - c.vw / 2) / c.scale + c.x, wy: (sy - c.vh / 2) / c.scale + c.y };
}

function clampAxis(center: number, viewWorld: number, worldSize: number): number {
  const need = Math.min(viewWorld * MIN_VISIBLE, worldSize);
  const lo = need - viewWorld / 2;
  const hi = worldSize - need + viewWorld / 2;
  return lo > hi ? worldSize / 2 : Math.max(lo, Math.min(hi, center));
}

/** Keeps at least 25% of the viewport on the map. */
export function clampCamera(c: Camera): void {
  c.x = clampAxis(c.x, c.vw / c.scale, WORLD_W);
  c.y = clampAxis(c.y, c.vh / c.scale, WORLD_H);
}

/** The tile rectangle in view (plus a margin in tiles), clipped to the map. */
export function visibleTiles(c: Camera, margin = 0): Rect {
  const halfW = c.vw / c.scale / 2;
  const halfH = c.vh / c.scale / 2;
  const x0 = Math.max(0, Math.floor((c.x - halfW) / TILE) - margin);
  const y0 = Math.max(0, Math.floor((c.y - halfH) / TILE) - margin);
  const x1 = Math.min(W - 1, Math.floor((c.x + halfW) / TILE) + margin);
  const y1 = Math.min(H - 1, Math.floor((c.y + halfH) / TILE) + margin);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0 + 1), h: Math.max(0, y1 - y0 + 1) };
}

/** The nearest zoom level to a requested one. */
export function nearestLevel(level: number): number {
  let best = ZOOM_LEVELS[0];
  for (const l of ZOOM_LEVELS) if (Math.abs(l - level) < Math.abs(best - level)) best = l;
  return best;
}

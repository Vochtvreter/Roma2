// src/render/camera.ts — camera, integer zoom, screen↔world, pan inertia and zoom easing (ARCHITECTURE §12.1, DESIGN §3.1). Owner: WP-F.
// World px: 16 per tile. Screen coordinates here are DEVICE px (the canvas backing store). The camera always holds the
// settled state (integer scale); `Motion` adds the cosmetic in-between — a fling after a drag, eased keyboard glides
// and a short eased zoom — which changes only what is drawn, never what the camera reports for picking.
// Insets: the canvas stays full-bleed under the UI (the HUD, the panel, the left column). What the UI covers is given as
// device-px insets per side, and the rest is the FREE rect: centring, the zoom anchor, the clamp and ensureVisible work in
// it, while x, y stay the world px at the canvas centre, so picking, drawing and the fling never change.
import type { Rect } from '../game/types';
import { H, W } from '../game/map';
import { B } from '../game/balance';

/** CSS px per world px (DESIGN §3.1: integer levels 1–5; CONTRACT_NOTES client 1). */
export const ZOOM_LEVELS: readonly number[] = B.ui.ZOOM_LEVELS;
/** World px per tile. */
export const TILE: number = B.map.TILE;
/** Map size in world px. */
export const WORLD_W: number = W * TILE;
/** Map size in world px. */
export const WORLD_H: number = H * TILE;
const MIN_VISIBLE = 0.25;          // ≥ 25% of the viewport always shows map
const FRICTION = 5;                // fling decay per second (v *= e^(−F·dt))
const FLING_MIN = 20;              // world px/s below which a fling stops
const GLIDE_RATE = 14;             // keyboard glide: exponential approach rate per second
const ZOOM_EASE_MS = 140;

/** x, y = world px at the viewport centre; level = CSS px per world px; scale = device px per world px; vw, vh device px. */
export interface Camera { x: number; y: number; level: number; scale: number; vw: number; vh: number }

/** The draw transform of a frame: device px = world px × k + (ox, oy). */
export interface Xform { k: number; ox: number; oy: number }

/** Adds an object to the frame's y-sorted draw list (sort key: footprint bottom in world px, then x). */
export type Push = (y: number, x: number, draw: (g: CanvasRenderingContext2D) => void) => void;

/** Device px per world px for a zoom level: max(1, round(level × dpr)). */
export function scaleFor(level: number, dpr: number): number {
  return Math.max(1, Math.round(level * dpr));
}

/** The default zoom level for a free map whose shorter side is `cssSize` CSS px: 3, or 2 below 700 (DESIGN §3.1). The
 *  view passes min(free width, free height): a landscape phone (393 px tall) and a docked tablet get 2, a desktop 3. */
export function defaultLevel(cssSize: number): number {
  return cssSize < B.ui.ZOOM_SMALL_W ? B.ui.ZOOM_SMALL : B.ui.ZOOM_DEFAULT;
}

/** Device px the UI covers on each side of the canvas; the free rect is the canvas less these. */
export interface Insets { top: number; right: number; bottom: number; left: number }
/** No UI over the map (the title screen, a test). */
export const NO_INSETS: Readonly<Insets> = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** The insets a camera can use: none when they would leave no free rect (a panel over the whole map), so centring and
 *  the clamp still mean something there. */
function usable(c: Camera, i: Insets): Insets {
  return c.vw - i.left - i.right >= 1 && c.vh - i.top - i.bottom >= 1 ? i : NO_INSETS;
}

/** The device-px centre of the free rect. */
export function freeCentre(c: Camera, insets: Insets): { sx: number; sy: number } {
  const i = usable(c, insets);
  return { sx: (i.left + c.vw - i.right) / 2, sy: (i.top + c.vh - i.bottom) / 2 };
}

/** Moves the camera so world point (wx, wy) shows at the free-rect centre (unclamped: the caller clamps). */
export function centerOnFree(c: Camera, wx: number, wy: number, insets: Insets): void {
  const f = freeCentre(c, insets);
  c.x = wx - (f.sx - c.vw / 2) / c.scale;
  c.y = wy - (f.sy - c.vh / 2) / c.scale;
}

/** A camera at the map centre, default level, 1×1 viewport (resize() fills in the real size). */
export function makeCamera(): Camera {
  const level: number = B.ui.ZOOM_DEFAULT;
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

/** One axis of the clamp: the free span runs from centre + a to centre + b (world px) and must overlap the map by
 *  `need`; a span that cannot (the map smaller than the rule) is centred on the map instead. */
function clampAxis(center: number, a: number, b: number, worldSize: number): number {
  const need = Math.min((b - a) * MIN_VISIBLE, worldSize);
  const lo = need - b;
  const hi = worldSize - need - a;
  return lo > hi ? worldSize / 2 - (a + b) / 2 : Math.max(lo, Math.min(hi, center));
}

/** Keeps at least 25% of the free rect (the whole viewport without insets) on the map. */
export function clampCamera(c: Camera, insets: Insets = NO_INSETS): void {
  const i = usable(c, insets), s = c.scale;
  c.x = clampAxis(c.x, (i.left - c.vw / 2) / s, (c.vw / 2 - i.right) / s, WORLD_W);
  c.y = clampAxis(c.y, (i.top - c.vh / 2) / s, (c.vh / 2 - i.bottom) / s, WORLD_H);
}

/** One axis of ensureVisibleDelta, in device px: the span [s0, s1] inside [f0, f1] with a margin (shrunk to fit). */
function visibleAxis(s0: number, s1: number, f0: number, f1: number, margin: number): number {
  const size = s1 - s0, room = f1 - f0;
  if (size > room) return s0 > f0 ? s0 - f0 : s1 < f1 ? s1 - f1 : 0;   // too big: fill the free span, nearest edge first
  const m = Math.min(margin, (room - size) / 2);
  return s0 < f0 + m ? s0 - (f0 + m) : s1 > f1 - m ? s1 - (f1 - m) : 0;
}

/** The smallest camera move (world px, to add to x and y) that brings a world-px rect inside the free rect, `marginPx`
 *  device px clear of its edges (less when the rect barely fits); (0, 0) when it is inside already. A rect bigger than
 *  the free rect is moved only until it fills it. */
export function ensureVisibleDelta(c: Camera, r: { x: number; y: number; w: number; h: number }, insets: Insets, marginPx: number): { dx: number; dy: number } {
  const i = usable(c, insets);
  const a = worldToScreen(c, r.x, r.y), b = worldToScreen(c, r.x + r.w, r.y + r.h);
  return {
    dx: visibleAxis(a.sx, b.sx, i.left, c.vw - i.right, marginPx) / c.scale,
    dy: visibleAxis(a.sy, b.sy, i.top, c.vh - i.bottom, marginPx) / c.scale,
  };
}

/** The tile rectangle in view (plus a margin in tiles), clipped to the map. */
export function visibleTiles(c: Camera, margin = 0): Rect {
  return tilesIn({ k: c.scale, ox: c.vw / 2 - c.x * c.scale, oy: c.vh / 2 - c.y * c.scale }, c.vw, c.vh, margin);
}

/** The tile rectangle a transform shows in a vw × vh device-px viewport (plus a margin), clipped to the map. */
export function tilesIn(t: Xform, vw: number, vh: number, margin = 0): Rect {
  const x0 = Math.max(0, Math.floor(-t.ox / t.k / TILE) - margin);
  const y0 = Math.max(0, Math.floor(-t.oy / t.k / TILE) - margin);
  const x1 = Math.min(W - 1, Math.floor((vw - t.ox) / t.k / TILE) + margin);
  const y1 = Math.min(H - 1, Math.floor((vh - t.oy) / t.k / TILE) + margin);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0 + 1), h: Math.max(0, y1 - y0 + 1) };
}

/** The nearest zoom level to a requested one. */
export function nearestLevel(level: number): number {
  let best = ZOOM_LEVELS[0];
  for (const l of ZOOM_LEVELS) if (Math.abs(l - level) < Math.abs(best - level)) best = l;
  return best;
}

/** Cosmetic camera motion: drag fling (light inertia), eased keyboard glides and an eased zoom between integer scales. */
export class Motion {
  private vx = 0;
  private vy = 0;
  private gx = 0;
  private gy = 0;
  private zoom: { s0: number; ax: number; ay: number; t: number } | null = null;

  /** Starts a fling at (vx, vy) world px per second (the map keeps sliding after a drag). */
  fling(vx: number, vy: number): void {
    this.vx = vx;
    this.vy = vy;
  }

  /** Adds an eased glide of the camera centre by (dx, dy) world px (keyboard panning). */
  glide(dx: number, dy: number): void {
    this.gx += dx;
    this.gy += dy;
  }

  /** Stops any fling or glide (a new press grabs the map). */
  stop(): void {
    this.vx = this.vy = this.gx = this.gy = 0;
  }

  /** Eases the next frames from scale `s0` to the camera's scale around a device-px anchor. */
  easeZoom(s0: number, ax: number, ay: number): void {
    this.zoom = { s0, ax, ay, t: 0 };
  }

  /** Advances the motion and moves the camera (clamped to the free rect of `insets`); true while anything still moves. */
  step(c: Camera, dtMs: number, insets: Insets = NO_INSETS): boolean {
    const dt = dtMs / 1000;
    let moving = false;
    if (this.vx || this.vy) {
      c.x += this.vx * dt;
      c.y += this.vy * dt;
      const f = Math.exp(-FRICTION * dt);
      this.vx *= f;
      this.vy *= f;
      if (Math.hypot(this.vx, this.vy) < FLING_MIN) this.vx = this.vy = 0;
      moving = true;
    }
    if (this.gx || this.gy) {
      const f = 1 - Math.exp(-GLIDE_RATE * dt);
      const dx = Math.abs(this.gx) < 0.5 ? this.gx : this.gx * f;
      const dy = Math.abs(this.gy) < 0.5 ? this.gy : this.gy * f;
      c.x += dx;
      c.y += dy;
      this.gx -= dx;
      this.gy -= dy;
      moving = true;
    }
    if (moving) {
      const px = c.x, py = c.y;
      clampCamera(c, insets);
      if (px !== c.x) this.vx = this.gx = 0;
      if (py !== c.y) this.vy = this.gy = 0;
    }
    if (this.zoom && (this.zoom.t += dtMs / ZOOM_EASE_MS) >= 1) this.zoom = null;
    return moving || this.zoom !== null;
  }

  /** This frame's draw transform: the camera's, or an eased one while zooming (offsets rounded to device px). */
  xform(c: Camera): Xform {
    const z = this.zoom;
    if (!z) return { k: c.scale, ox: Math.round(c.vw / 2 - c.x * c.scale), oy: Math.round(c.vh / 2 - c.y * c.scale) };
    const e = 1 - (1 - z.t) * (1 - z.t);
    const k = z.s0 + (c.scale - z.s0) * e;
    const a = screenToWorld(c, z.ax, z.ay);
    return { k, ox: Math.round(z.ax - a.wx * k), oy: Math.round(z.ay - a.wy * k) };
  }
}

// src/render/camera.ts — camera, integer zoom, screen↔world, pan inertia and zoom easing (ARCHITECTURE §12.1, DESIGN §3.1). Owner: WP-F.
// World px: 16 per tile. Screen coordinates here are DEVICE px (the canvas backing store). The camera always holds the
// settled state (integer scale); `Motion` adds the cosmetic in-between — a fling after a drag, eased keyboard glides
// and a short eased zoom — which changes only what is drawn, never what the camera reports for picking.
import type { Rect } from '../game/types';
import { H, W } from '../game/map';
import { B } from '../game/balance';

/** CSS px per world px (DESIGN §3.1: integer levels 1–5; CONTRACT_NOTES client 1). */
export const ZOOM_LEVELS: readonly number[] = [1, 2, 3, 4, 5];
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

  /** Advances the motion and moves the camera; true while anything still moves. */
  step(c: Camera, dtMs: number): boolean {
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
      clampCamera(c);
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

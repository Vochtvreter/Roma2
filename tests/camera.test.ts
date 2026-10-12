// tests/camera.test.ts — camera insets (ARCHITECTURE §12.1): the canvas stays full-bleed under the UI, and centring, the
// clamp and ensureVisible work in the free rect (the viewport less the insets), at every device pixel ratio a phone or a
// tablet has. x, y stay the world px at the canvas centre, so screen ↔ world (picking) never changes. Headless: pure
// camera maths only.
import { describe, expect, it } from 'vitest';
import type { Camera, Insets } from '../src/render/camera';
import {
  Motion, NO_INSETS, TILE, WORLD_H, WORLD_W, centerOnFree, clampCamera, defaultLevel, ensureVisibleDelta, freeCentre, scaleFor,
  screenToWorld, worldToScreen,
} from '../src/render/camera';

const DPRS = [1, 2, 2.625, 3] as const;

/** A camera over a w × h CSS px canvas at `dpr` and zoom `level`, as view.resize() makes it. */
function cam(wCss: number, hCss: number, dpr: number, level = 2, x = WORLD_W / 2, y = WORLD_H / 2): Camera {
  return { x, y, level, scale: scaleFor(level, dpr), vw: Math.round(wCss * dpr), vh: Math.round(hCss * dpr) };
}

/** CSS px insets → device px (view.ts: × the canvas's device px per CSS px). */
function dev(i: Insets, dpr: number): Insets {
  return { top: i.top * dpr, right: i.right * dpr, bottom: i.bottom * dpr, left: i.left * dpr };
}

/** The free rect in world px. */
function freeWorld(c: Camera, i: Insets): { x0: number; y0: number; x1: number; y1: number } {
  const a = screenToWorld(c, i.left, i.top), b = screenToWorld(c, c.vw - i.right, c.vh - i.bottom);
  return { x0: a.wx, y0: a.wy, x1: b.wx, y1: b.wy };
}

// the layouts of today's CSS: a desktop's HUD, left column and panel; a phone's HUD and open sheet; a landscape drawer
const DESK = { w: 1440, h: 900, ins: { top: 64, right: 380, bottom: 0, left: 310 } };
const PHONE = { w: 393, h: 852, ins: { top: 140, right: 0, bottom: 392, left: 0 } };
const LAND = { w: 852, h: 393, ins: { top: 104, right: 340, bottom: 0, left: 0 } };

describe('screen ↔ world', () => {
  it('round-trips at every DPR, whatever the insets (they never enter the conversion)', () => {
    for (const dpr of DPRS) {
      const c = cam(393, 852, dpr, 2, 900.25, 611.5);
      for (const [wx, wy] of [[0, 0], [123.5, 77.25], [WORLD_W, WORLD_H], [900.25, 611.5]]) {
        const s = worldToScreen(c, wx, wy);
        const w = screenToWorld(c, s.sx, s.sy);
        expect(w.wx).toBeCloseTo(wx, 9);
        expect(w.wy).toBeCloseTo(wy, 9);
      }
      expect(worldToScreen(c, c.x, c.y)).toEqual({ sx: c.vw / 2, sy: c.vh / 2 });   // x, y: the canvas centre
    }
  });
});

describe('freeCentre and centerOnFree', () => {
  it('without insets the free centre is the canvas centre', () => {
    for (const dpr of DPRS) {
      const c = cam(1440, 900, dpr);
      expect(freeCentre(c, NO_INSETS)).toEqual({ sx: c.vw / 2, sy: c.vh / 2 });
    }
  });

  it('a centred tile lands at the free-rect centre at DPR 1, 2, 2.625 and 3', () => {
    for (const { w, h, ins } of [DESK, PHONE, LAND]) {
      for (const dpr of DPRS) {
        const c = cam(w, h, dpr, 2), i = dev(ins, dpr);
        const tx = 61, ty = 40, wx = (tx + 0.5) * TILE, wy = (ty + 0.5) * TILE;
        centerOnFree(c, wx, wy, i);
        const s = worldToScreen(c, wx, wy), f = freeCentre(c, i);
        expect(s.sx).toBeCloseTo(f.sx, 6);
        expect(s.sy).toBeCloseTo(f.sy, 6);
        expect(f.sx).toBeCloseTo((i.left + c.vw - i.right) / 2, 9);
        expect(f.sy).toBeCloseTo((i.top + c.vh - i.bottom) / 2, 9);
        // in CSS px: the middle of the map between the column and the panel (desktop), above the sheet (phone)
        expect(s.sx / dpr).toBeCloseTo((ins.left + w - ins.right) / 2, 0);
        expect(s.sy / dpr).toBeCloseTo((ins.top + h - ins.bottom) / 2, 0);
      }
    }
  });

  it('insets that leave no free rect fall back to the whole viewport', () => {
    const c = cam(393, 852, 3);
    const all = { top: 500 * 3, right: 0, bottom: 400 * 3, left: 0 };
    expect(freeCentre(c, all)).toEqual({ sx: c.vw / 2, sy: c.vh / 2 });
  });
});

describe('clampCamera', () => {
  /** Today's clamp (no insets): ≥ 25% of the viewport on the map. */
  function oldClamp(c: Camera): { x: number; y: number } {
    const axis = (center: number, v: number, size: number): number => {
      const need = Math.min(v * 0.25, size), lo = need - v / 2, hi = size - need + v / 2;
      return lo > hi ? size / 2 : Math.max(lo, Math.min(hi, center));
    };
    return { x: axis(c.x, c.vw / c.scale, WORLD_W), y: axis(c.y, c.vh / c.scale, WORLD_H) };
  }

  it('without insets it is today\'s clamp, exactly', () => {
    for (const dpr of DPRS) {
      for (const level of [1, 2, 3, 5]) {
        for (const [x, y] of [[-5000, -5000], [WORLD_W + 4000, 300], [WORLD_W / 2, WORLD_H + 9000], [700, 500]]) {
          const c = cam(1440, 900, dpr, level, x, y), want = oldClamp(c);
          clampCamera(c);
          expect(c.x).toBeCloseTo(want.x, 9);
          expect(c.y).toBeCloseTo(want.y, 9);
        }
      }
    }
  });

  it('keeps at least 25% of the free rect on the map, however far it is thrown', () => {
    for (const { w, h, ins } of [DESK, PHONE, LAND]) {
      for (const dpr of DPRS) {
        const i = dev(ins, dpr);
        for (const [x, y] of [[-1e5, -1e5], [1e5, 1e5], [-1e5, 1e5], [1e5, -1e5]]) {
          const c = cam(w, h, dpr, 2, x, y);
          clampCamera(c, i);
          const f = freeWorld(c, i), fw = f.x1 - f.x0, fh = f.y1 - f.y0;
          const ox = Math.min(f.x1, WORLD_W) - Math.max(f.x0, 0), oy = Math.min(f.y1, WORLD_H) - Math.max(f.y0, 0);
          expect(ox).toBeGreaterThanOrEqual(Math.min(fw * 0.25, WORLD_W) - 1e-6);
          expect(oy).toBeGreaterThanOrEqual(Math.min(fh * 0.25, WORLD_H) - 1e-6);
          // and exactly at the rule (the clamp moved it no further than it had to)
          expect(Math.min(ox, oy)).toBeLessThanOrEqual(Math.max(fw, fh) * 0.25 + 1e-6);
        }
      }
    }
  });

  it('a free rect that grows at a map edge moves the limit once (view.setInsets); a small drag then never snaps back', () => {
    for (const dpr of DPRS) {
      const open = dev(DESK.ins, dpr), shut = dev({ ...DESK.ins, right: 0 }, dpr);
      const c = cam(DESK.w, DESK.h, dpr, 3, 1e5, WORLD_H / 2);
      clampCamera(c, open);                        // dragged to the east limit with the panel open
      const was = c.x;
      clampCamera(c, shut);                        // the panel folds: 25% of a wider free rect, so the limit steps west
      const limit = c.x;
      expect(was - limit).toBeCloseTo((0.25 * 380 * dpr) / c.scale, 6);
      clampCamera(c, shut);
      expect(c.x).toBe(limit);                     // idempotent
      c.x += (20 * dpr) / c.scale;                 // a 20 CSS px drag toward the edge
      clampCamera(c, shut);
      expect(c.x).toBe(limit);                     // held at the limit, never thrown back against the drag
    }
  });

  it('leaves a camera that already shows enough map alone', () => {
    const i = dev(DESK.ins, 1), c = cam(DESK.w, DESK.h, 1, 3, 800, 600);
    clampCamera(c, i);
    expect([c.x, c.y]).toEqual([800, 600]);
  });
});

describe('ensureVisibleDelta', () => {
  it('is 0 for a rect already inside the free rect (with its margin)', () => {
    for (const dpr of DPRS) {
      const c = cam(PHONE.w, PHONE.h, dpr, 2), i = dev(PHONE.ins, dpr);
      const f = freeWorld(c, i), mid = { x: (f.x0 + f.x1) / 2 - 16, y: (f.y0 + f.y1) / 2 - 16, w: 32, h: 32 };
      expect(ensureVisibleDelta(c, mid, i, 24 * dpr)).toEqual({ dx: 0, dy: 0 });
    }
  });

  it('is the least move that brings a covered rect inside, just at the margin', () => {
    for (const { w, h, ins } of [DESK, PHONE, LAND]) {
      for (const dpr of DPRS) {
        const c = cam(w, h, dpr, 2), i = dev(ins, dpr), m = 24 * dpr;
        const s0 = screenToWorld(c, c.vw - 10, c.vh - 10);   // bottom right: under the panel or the sheet
        const r = { x: s0.wx - 32, y: s0.wy - 32, w: 32, h: 32 };
        const d = ensureVisibleDelta(c, r, i, m);
        expect(Math.abs(d.dx) + Math.abs(d.dy)).toBeGreaterThan(0);
        const moved = { ...c, x: c.x + d.dx, y: c.y + d.dy };
        const a = worldToScreen(moved, r.x, r.y), b = worldToScreen(moved, r.x + r.w, r.y + r.h);
        expect(a.sx).toBeGreaterThanOrEqual(i.left + m - 1e-6);
        expect(a.sy).toBeGreaterThanOrEqual(i.top + m - 1e-6);
        expect(b.sx).toBeLessThanOrEqual(c.vw - i.right - m + 1e-6);
        expect(b.sy).toBeLessThanOrEqual(c.vh - i.bottom - m + 1e-6);
        // minimal: on each axis that moved, the rect now touches the margin line on the side it came from
        expect(d.dx).toBeGreaterThan(0);
        expect(d.dy).toBeGreaterThan(0);
        expect(b.sx).toBeCloseTo(c.vw - i.right - m, 6);
        expect(b.sy).toBeCloseTo(c.vh - i.bottom - m, 6);
      }
    }
  });

  it('moves left and up for a rect under the left column and the HUD', () => {
    const dpr = 2, c = cam(DESK.w, DESK.h, dpr, 3), i = dev(DESK.ins, dpr);
    const s0 = screenToWorld(c, 20, 20);
    const d = ensureVisibleDelta(c, { x: s0.wx, y: s0.wy, w: 16, h: 16 }, i, 0);
    expect(d.dx).toBeLessThan(0);
    expect(d.dy).toBeLessThan(0);
    const a = worldToScreen({ ...c, x: c.x + d.dx, y: c.y + d.dy }, s0.wx, s0.wy);
    expect(a.sx).toBeCloseTo(i.left, 6);
    expect(a.sy).toBeCloseTo(i.top, 6);
  });

  it('shrinks the margin for a rect that barely fits, and only fills the free rect with one too big', () => {
    const c = cam(PHONE.w, PHONE.h, 2, 2), i = dev(PHONE.ins, 2);
    const f = freeWorld(c, i), fh = f.y1 - f.y0;
    // barely fits: centred on that axis however big the asked margin
    const tall = { x: (f.x0 + f.x1) / 2 - 8, y: f.y0 + 40, w: 16, h: fh - 10 };
    const d1 = ensureVisibleDelta(c, tall, i, 100 * 2);
    const m1 = { ...c, y: c.y + d1.dy };
    const top = worldToScreen(m1, 0, tall.y).sy, bot = worldToScreen(m1, 0, tall.y + tall.h).sy;
    expect(top - i.top).toBeCloseTo(c.vh - i.bottom - bot, 6);
    // too big: it already spans the free rect → no move; shifted off one edge → moved just enough to fill it
    expect(ensureVisibleDelta(c, { x: f.x0 - 50, y: f.y0 - 50, w: f.x1 - f.x0 + 100, h: fh + 100 }, i, 24)).toEqual({ dx: 0, dy: 0 });
    const big = { x: f.x0 + 30, y: f.y0, w: f.x1 - f.x0 + 100, h: 10 };
    const d2 = ensureVisibleDelta(c, big, i, 0);
    expect(worldToScreen({ ...c, x: c.x + d2.dx }, big.x, 0).sx).toBeCloseTo(i.left, 6);
  });
});

describe('Motion with insets', () => {
  it('a glide is clamped to the free rect, not the canvas', () => {
    const dpr = 2.625, i = dev(DESK.ins, dpr), c = cam(DESK.w, DESK.h, dpr, 2), mo = new Motion();
    mo.glide(-1e6, 0);
    for (let t = 0; t < 60; t++) mo.step(c, 16, i);
    const f = freeWorld(c, i);
    expect(Math.min(f.x1, WORLD_W) - Math.max(f.x0, 0)).toBeCloseTo((f.x1 - f.x0) * 0.25, 6);
  });
});

describe('defaultLevel', () => {
  it('reads the shorter side of the free map, with the B.ui thresholds: the same outcomes on desktop and phones', () => {
    expect(defaultLevel(Math.min(1440 - 310 - 380, 900 - 64))).toBe(3);   // desktop 1440×900 between its columns
    expect(defaultLevel(Math.min(393, 852 - 140 - 392))).toBe(2);          // a phone above its open sheet
    expect(defaultLevel(Math.min(393, 852))).toBe(2);                      // a phone behind the title
    expect(defaultLevel(Math.min(852 - 340, 393 - 104))).toBe(2);         // a landscape phone (was 3 from its width)
    expect(defaultLevel(699)).toBe(2);
    expect(defaultLevel(700)).toBe(3);
  });
});

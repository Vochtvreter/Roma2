// src/render/minimap.ts — the minimap (ARCHITECTURE §12.7). Owner: WP-F.
// CSS 224 × 168 = 2 px per tile, backing × dpr: seasonal ground with the woods as they stand, roads, walls, building
// footprints, the active overlay and the viewport rectangle (the free rect: the map the UI leaves in view, whose centre
// a pick moves to). Redrawn at most every 500 ms (and at once on demand); what the throttle held back stays owed
// (pending) until a later draw() pays it. Click or drag → onPick(world px). Hidden while placing (CSS hides it below
// 1,100 px).
import type { GameState } from '../game/types';
import { H, W, getMap } from '../game/map';
import { derived } from '../game/derived';
import type { Camera, Insets } from './camera';
import { NO_INSETS, TILE, canvasDpr, screenToWorld } from './camera';
import { buildingColor, footprintRect } from './buildings';
import { OVERLAY_ALPHA } from './overlays';
import { looks } from './decor';

const REDRAW_MS = 500;
const PX_PER_TILE = 2;
const C = {
  dirt: '#9b7a52', paved: '#5c5d66', wall: '#6f5639', murus: '#b8a582', view: '#f4ead6', shade: 'rgba(10,7,16,0.35)',
  spark: ['#e8f6ff', '#9fd4f0'],
} as const;
const FOUNTAINS: readonly string[] = ['lacus', 'castellum'];

/** The minimap canvas painter and its pointer handling. */
export class Minimap {
  private last = -Infinity;
  private down = false;
  private due = true;                       // a redraw was asked for (invalidate) or held back by the throttle

  constructor(private readonly cv: HTMLCanvasElement, private readonly onPick: (wx: number, wy: number) => void) {
    const go = (e: PointerEvent): void => {
      const r = cv.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      this.onPick(((e.clientX - r.left) / r.width) * W * TILE, ((e.clientY - r.top) / r.height) * H * TILE);
      this.last = -Infinity;
    };
    cv.addEventListener('pointerdown', (e) => {
      this.down = true;
      try { cv.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      go(e);
    });
    cv.addEventListener('pointermove', (e) => { if (this.down) go(e); });
    cv.addEventListener('pointerup', () => { this.down = false; });
    cv.addEventListener('pointercancel', () => { this.down = false; });
  }

  /** Forces a redraw on the next frame. */
  invalidate(): void {
    this.last = -Infinity;
    this.due = true;
  }

  /** A redraw is owed: asked for, or held back by the 500 ms throttle. A view that skips its idle frames still calls
   *  draw() until it is paid, so the rectangle and the footprints never stay a step behind the map. */
  get pending(): boolean {
    return this.due;
  }

  /** Redraws (throttled) from the 1 px/tile ground and overlay layers; hides itself while placing. */
  draw(s: GameState, cam: Camera, ground: HTMLCanvasElement, overlay: HTMLCanvasElement | null, placing: boolean, now: number, insets: Insets = NO_INSETS): void {
    this.cv.hidden = placing;
    if (placing) { this.due = false; return; }   // (placing ends with a redraw of the map: invalidate on its way back)
    if (now - this.last < REDRAW_MS) { this.due = true; return; }
    this.last = now;
    this.due = false;
    const dpr = canvasDpr(window.devicePixelRatio);
    const bw = Math.round(W * PX_PER_TILE * dpr), bh = Math.round(H * PX_PER_TILE * dpr);
    if (this.cv.width !== bw || this.cv.height !== bh) { this.cv.width = bw; this.cv.height = bh; }
    const g = this.cv.getContext('2d');
    if (!g) return;
    const k = bw / W;                       // device px per tile
    g.imageSmoothingEnabled = false;
    g.drawImage(ground, 0, 0, bw, bh);
    const d = derived(s), sv = getMap(s.seed).survey;
    for (let i = 0; i < W * H; i++) {
      const x = (i % W) * k, y = Math.floor(i / W) * k;
      if (d.road[i]) { g.fillStyle = d.road[i] === 2 ? C.paved : C.dirt; g.fillRect(x, y, k, k); }
      else if (sv.wall[i]) { g.fillStyle = s.rank >= 2 ? C.murus : C.wall; g.fillRect(x, y, k, k); }
    }
    for (const b of s.buildings) {
      const r = footprintRect(s, b);
      g.fillStyle = buildingColor(b);
      g.globalAlpha = b.status === 'done' ? 1 : 0.5;
      g.fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
      g.fillStyle = C.shade;
      g.fillRect(r.x * k, (r.y + r.h) * k - Math.max(1, dpr), r.w * k, Math.max(1, dpr));
    }
    g.globalAlpha = 1;
    if (looks(s).fountains) {
      // the Res Gestae reward: every running fountain and water tower twinkles (alternating every redraw)
      for (const b of s.buildings) {
        if (b.status !== 'done' || !FOUNTAINS.includes(b.type)) continue;
        const r = footprintRect(s, b), on = (Math.floor(now / REDRAW_MS) + b.id) % 2 === 0;
        const px = Math.max(1, Math.round(k * 0.75)), cx = (r.x + r.w / 2) * k, cy = (r.y + r.h / 2) * k;
        g.fillStyle = C.spark[on ? 0 : 1];
        g.fillRect(Math.round(cx - px / 2), Math.round(cy - px / 2), px, px);
        if (on) { g.fillRect(Math.round(cx - px * 1.5), Math.round(cy - px / 2), px * 3, px); g.fillRect(Math.round(cx - px / 2), Math.round(cy - px * 1.5), px, px * 3); }
      }
    }
    if (overlay) {
      g.imageSmoothingEnabled = true;
      g.globalAlpha = OVERLAY_ALPHA + 0.15;
      g.drawImage(overlay, 0, 0, bw, bh);
      g.globalAlpha = 1;
    }
    // the free rect in tiles (the whole viewport when the insets would leave none)
    const i = cam.vw - insets.left - insets.right >= 1 && cam.vh - insets.top - insets.bottom >= 1 ? insets : NO_INSETS;
    const a = screenToWorld(cam, i.left, i.top), b = screenToWorld(cam, cam.vw - i.right, cam.vh - i.bottom);
    const x0 = (a.wx / TILE) * k, y0 = (a.wy / TILE) * k, rw = ((b.wx - a.wx) / TILE) * k, rh = ((b.wy - a.wy) / TILE) * k;
    g.strokeStyle = '#0a0710';
    g.lineWidth = Math.max(1, dpr) * 3;
    g.strokeRect(x0, y0, rw, rh);
    g.strokeStyle = C.view;
    g.lineWidth = Math.max(1, dpr);
    g.strokeRect(x0, y0, rw, rh);
  }
}

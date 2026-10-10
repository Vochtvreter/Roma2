// src/render/minimap.ts — the minimap (ARCHITECTURE §12.7). Owner: WP-F.
// CSS 224 × 168 = 2 px per tile, backing × dpr; terrain, building footprints, roads, the active overlay and the viewport
// rectangle. Redrawn at most every 500 ms. Click or drag → onPick(world px). Hidden while placing (CSS hides it < 1100 px).
import type { GameState } from '../game/types';
import { H, W } from '../game/map';
import { derived } from '../game/derived';
import type { Camera } from './camera';
import { TILE } from './camera';
import { buildingColor, footprintRect } from './buildings';
import { OVERLAY_ALPHA } from './overlays';

const REDRAW_MS = 500;
const PX_PER_TILE = 2;

/** The minimap canvas painter and its pointer handling. */
export class Minimap {
  private last = -Infinity;
  private down = false;

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
  }

  /** Redraws (throttled) from the ground and overlay layers; hides itself while placing. */
  draw(s: GameState, cam: Camera, ground: HTMLCanvasElement, overlay: HTMLCanvasElement | null, placing: boolean, now: number): void {
    this.cv.hidden = placing;
    if (placing || now - this.last < REDRAW_MS) return;
    this.last = now;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const bw = Math.round(W * PX_PER_TILE * dpr), bh = Math.round(H * PX_PER_TILE * dpr);
    if (this.cv.width !== bw || this.cv.height !== bh) { this.cv.width = bw; this.cv.height = bh; }
    const g = this.cv.getContext('2d');
    if (!g) return;
    const k = bw / W;                       // device px per tile
    g.imageSmoothingEnabled = false;
    g.drawImage(ground, 0, 0, bw, bh);
    const road = derived(s).road;
    g.fillStyle = '#9b7a52';
    for (let i = 0; i < W * H; i++) if (road[i]) g.fillRect((i % W) * k, Math.floor(i / W) * k, k, k);
    for (const b of s.buildings) {
      const r = footprintRect(s, b);
      g.fillStyle = buildingColor(b);
      g.fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
    }
    if (overlay) {
      g.imageSmoothingEnabled = true;
      g.globalAlpha = OVERLAY_ALPHA;
      g.drawImage(overlay, 0, 0, bw, bh);
      g.globalAlpha = 1;
    }
    // the viewport
    const vwT = cam.vw / cam.scale / TILE, vhT = cam.vh / cam.scale / TILE;
    const cx = cam.x / TILE, cy = cam.y / TILE;
    g.strokeStyle = '#f4ead6';
    g.lineWidth = Math.max(1, dpr);
    g.strokeRect((cx - vwT / 2) * k, (cy - vhT / 2) * k, vwT * k, vhT * k);
  }
}

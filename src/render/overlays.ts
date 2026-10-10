// src/render/overlays.ts — the five map overlays as 1 px-per-tile layers (ARCHITECTURE §12.5, DESIGN §11.9). Owner: WP-F.
// Each overlay is a W×H canvas rebuilt when its key changes (structEpoch + overlay + layer + day/5 for domus), drawn by
// view.ts at 45% alpha with smoothing on, and mirrored on the minimap.
// SCAFFOLD: flat colours from the documented sources; legends, ✕ marks, want icons and contours are WP-F's.
import { F, T } from '../game/types';
import type { CoverageLayerId, GameState, OverlayId, Terrain } from '../game/types';
import { H, W, fertility, getMap, woodAt } from '../game/map';
import { derived, footprintOf } from '../game/derived';
import { coverage, desirability } from '../game/coverage';
import { getBuilding } from '../game/state';
import { nextTier, unmetNeeds } from '../game/housing';
import { structEpoch } from '../game/memo';
import { LAYER_META } from '../game/data/housing';
import { makeCanvas } from './sprites';
import { mixRgb, rgbOf } from './terrain';

/** Drawn alpha of the overlay layer on the map. */
export const OVERLAY_ALPHA = 0.45;

const C = {
  water: '#9fd4f0', fountain: '#3d7fa6', table: '#62b0d6',
  good: '#9ccc5a', one: '#f2c94c', bad: '#e5554a', dim: '#806b57',
  straw: '#d9c27a', gold: '#f2c94c', hills: '#a99a62', rock: '#9a968a', ore: '#c0623f', clay: '#b5651d', wood: '#2f6b35', spring: '#62b0d6',
} as const;

type RGB = [number, number, number];

/** Builds and caches the active overlay canvas. */
export class OverlayPainter {
  private key = '';
  private cv: HTMLCanvasElement | null = null;

  /** Forget the cache (new or loaded game). */
  reset(): void {
    this.key = '';
  }

  /** The W×H overlay canvas, or null for 'none'. */
  canvas(s: GameState, id: OverlayId, layer: CoverageLayerId): HTMLCanvasElement | null {
    if (id === 'none') return null;
    const key = `${s.seed}|${structEpoch(s)}|${id}|${layer}|${id === 'domus' || id === 'terra' ? Math.floor(s.day / 5) : 0}`;
    if (this.cv && key === this.key) return this.cv;
    this.key = key;
    this.cv ??= makeCanvas(W, H);
    const g = this.cv.getContext('2d');
    if (!g) return null;
    const img = g.createImageData(W, H);
    const px = img.data;
    const put = (i: number, c: RGB, a = 255): void => {
      const p = i * 4;
      px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = a;
    };
    switch (id) {
      case 'aqua': this.aqua(s, put); break;
      case 'domus': this.domus(s, put); break;
      case 'officia': this.officia(s, layer, put); break;
      case 'desir': this.desir(s, put); break;
      case 'terra': this.terra(s, put); break;
    }
    g.putImageData(img, 0, 0);
    return this.cv;
  }

  private aqua(s: GameState, put: (i: number, c: RGB, a?: number) => void): void {
    const map = getMap(s.seed);
    const cov = coverage(s);
    for (let i = 0; i < W * H; i++) {
      if (cov.layers.fountain[i]) put(i, rgbOf(C.fountain));
      else if (cov.layers.water[i]) put(i, rgbOf(C.water));
      else if (map.waterTable[i] && ((i % W) + Math.floor(i / W)) % 2 === 0) put(i, rgbOf(C.table), 140);
    }
  }

  private domus(s: GameState, put: (i: number, c: RGB, a?: number) => void): void {
    for (const id of derived(s).houses) {
      const b = getBuilding(s, id);
      if (!b) continue;
      let col: string;
      if (b.house?.declining) col = C.dim;
      else {
        const next = nextTier(s, b);
        const n = next ? unmetNeeds(s, b, next).length : 0;
        col = n === 0 ? C.good : n === 1 ? C.one : C.bad;
      }
      for (const t of footprintOf(b, s)) put(t, rgbOf(col));
    }
  }

  private officia(s: GameState, layer: CoverageLayerId, put: (i: number, c: RGB, a?: number) => void): void {
    const l = coverage(s).layers[layer];
    const col = rgbOf(LAYER_META[layer].color);
    for (let i = 0; i < W * H; i++) if (l[i]) put(i, col);
  }

  private desir(s: GameState, put: (i: number, c: RGB, a?: number) => void): void {
    const d = desirability(s);
    for (let i = 0; i < W * H; i++) {
      const v = d[i];
      if (Math.abs(v) < 0.5) continue;
      put(i, v < 0 ? mixRgb(C.dim, C.bad, Math.min(1, -v / 20)) : mixRgb(C.dim, C.good, Math.min(1, v / 30)));
    }
  }

  private terra(s: GameState, put: (i: number, c: RGB, a?: number) => void): void {
    const map = getMap(s.seed);
    for (let i = 0; i < W * H; i++) {
      const t = map.terrain[i] as Terrain;
      const f = map.feature[i];
      if (f === F.fons) put(i, rgbOf(C.spring));
      else if (map.vein[i] > 0) put(i, rgbOf(C.ore), Math.round(140 + 115 * Math.min(1, map.vein[i] / 1.3)));
      else if (f === F.clay) put(i, rgbOf(C.clay));
      else if (map.woodMax[i] > 0) put(i, rgbOf(C.wood), Math.round(60 + 195 * Math.min(1, woodAt(s, i) / map.woodMax[i])));
      else if (t === T.hills) put(i, rgbOf(C.hills));
      else if (t === T.rock || t === T.crag) put(i, rgbOf(C.rock));
      else {
        const fe = fertility(t);
        if (fe > 0) put(i, mixRgb(C.straw, C.gold, Math.max(0, Math.min(1, (fe - 0.75) / 0.5))));
      }
    }
  }
}

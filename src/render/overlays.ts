// src/render/overlays.ts — the five map overlays as 1 px-per-tile layers plus their world-space marks (ARCHITECTURE
// §12.5, DESIGN §11.9). Owner: WP-F.
// Each overlay is a W×H canvas rebuilt when its key changes (structEpoch + overlay + layer + day/5 for domus and terra),
// drawn by view.ts at 45% alpha with smoothing on, and mirrored on the minimap. Marks are what a 1 px layer cannot
// show: ✕ on dry houses and the castellum's 18-tile reach (aqua), want icons and the declining pulse (domus), red rings
// on unstaffed services (officia), contour lines at 0 and 10 (desir).
import { F, LAYERS, T } from '../game/types';
import type { Building, CoverageLayerId, GameState, OverlayId, Rect, Terrain } from '../game/types';
import { H, W, fertility, getMap, woodAt } from '../game/map';
import { derived } from '../game/derived';
import { coverage, desirability } from '../game/coverage';
import { getBuilding } from '../game/state';
import { census } from '../game/census';
import { nextTier, unmetNeeds } from '../game/housing';
import { structEpoch } from '../game/memo';
import { B } from '../game/balance';
import { BUILDING_DEFS } from '../game/data/buildings';
import { LAYER_META } from '../game/data/housing';
import { wantIcon } from './art/index';
import { makeCanvas, sprite } from './sprites';
import { TILE } from './camera';
import { footprintRect } from './buildings';
import { mixRgb, rgbOf } from './terrain';

/** Drawn alpha of the overlay layer on the map. */
export const OVERLAY_ALPHA = 0.45;

const C = {
  water: '#9fd4f0', fountain: '#3d7fa6', table: '#62b0d6', good: '#9ccc5a', one: '#f2c94c', bad: '#e5554a', dim: '#806b57',
  straw: '#d9c27a', gold: '#f2c94c', hills: '#a99a62', rock: '#9a968a', ore: '#c0623f', clay: '#b5651d', wood: '#2f6b35', spring: '#62b0d6',
} as const;
const CONTOURS: readonly [number, string][] = [[0, '#f4ead6'], [10, '#9ccc5a']];

type RGB = [number, number, number];
type Put = (i: number, c: RGB, a?: number) => void;
interface HouseMark { b: Building; col: string; want: string | null }

/** Builds and caches the active overlay canvas and its marks. */
export class OverlayPainter {
  private key = '';
  private cv: HTMLCanvasElement | null = null;
  private houses: HouseMark[] = [];
  private contours: { x: number; y: number; w: number; h: number; c: string }[] = [];

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
    this.houses = [];
    this.contours = [];
    this.cv ??= makeCanvas(W, H);
    const g = this.cv.getContext('2d');
    if (!g) return null;
    const img = g.createImageData(W, H);
    const put: Put = (i, c, a = 255) => { img.data.set([c[0], c[1], c[2], a], i * 4); };
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

  private aqua(s: GameState, put: Put): void {
    const map = getMap(s.seed), cov = coverage(s);
    for (let i = 0; i < W * H; i++) {
      if (cov.layers.fountain[i]) put(i, rgbOf(C.fountain));
      else if (cov.layers.water[i]) put(i, rgbOf(C.water));
      else if (map.waterTable[i] && ((i % W) + Math.floor(i / W)) % 2 === 0) put(i, rgbOf(C.table), 120);
    }
    const bit = (l: CoverageLayerId): number => 1 << LAYERS.indexOf(l);
    for (const id of derived(s).houses) {
      const b = getBuilding(s, id);
      if (!b) continue;
      const m = cov.houseMask.get(id) ?? 0;
      const col = m & bit('fountain') ? C.fountain : m & bit('water') ? C.water : null;
      if (col) this.fill(s, b, rgbOf(col), put);
      else this.houses.push({ b, col: C.bad, want: wantIcon('water') });
    }
  }

  private domus(s: GameState, put: Put): void {
    for (const id of derived(s).houses) {
      const b = getBuilding(s, id);
      if (!b?.house) continue;
      const next = nextTier(s, b);
      const miss = next ? unmetNeeds(s, b, next) : [];
      const col = b.house.declining ? C.dim : miss.length === 0 ? C.good : miss.length === 1 ? C.one : C.bad;
      this.fill(s, b, rgbOf(col), put);
      if (b.house.declining || miss.length === 1) this.houses.push({ b, col, want: miss.length === 1 && !b.house.declining ? wantIcon(miss[0]) : null });
    }
  }

  private officia(s: GameState, layer: CoverageLayerId, put: Put): void {
    const l = coverage(s).layers[layer], col = rgbOf(LAYER_META[layer].color);
    for (let i = 0; i < W * H; i++) if (l[i]) put(i, col);
    const c = census(s);
    for (const b of s.buildings) {
      const def = BUILDING_DEFS[b.type];
      if (b.status !== 'done' || !def.service?.some((x) => x.layer === layer)) continue;
      this.fill(s, b, col, put);
      if (def.slots > 0 && (!b.open || !(c.staffed[b.id] > 0))) this.houses.push({ b, col: C.bad, want: null });
    }
  }

  private desir(s: GameState, put: Put): void {
    const d = desirability(s);
    for (let i = 0; i < W * H; i++) {
      const v = d[i];
      if (Math.abs(v) >= 0.5) put(i, v < 0 ? mixRgb(C.dim, C.bad, Math.min(1, -v / 20)) : mixRgb(C.dim, C.good, Math.min(1, v / 30)));
    }
    for (const [lvl, c] of CONTOURS)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x, a = d[i] >= lvl;
          if (x + 1 < W && a !== d[i + 1] >= lvl) this.contours.push({ x: (x + 1) * TILE, y: y * TILE, w: 1, h: TILE, c });
          if (y + 1 < H && a !== d[i + W] >= lvl) this.contours.push({ x: x * TILE, y: (y + 1) * TILE, w: TILE, h: 1, c });
        }
  }

  private terra(s: GameState, put: Put): void {
    const map = getMap(s.seed), sv = map.survey;
    for (let i = 0; i < W * H; i++) {
      const t = map.terrain[i] as Terrain, f = map.feature[i];
      if (sv.fossa[i] || sv.wall[i]) continue;
      if (f === F.fons) put(i, rgbOf(C.spring));
      else if (map.vein[i] > 0) put(i, rgbOf(C.ore), Math.round(140 + 115 * Math.min(1, map.vein[i] / 1.4)));
      else if (f === F.clay) put(i, rgbOf(C.clay));
      else if (map.woodMax[i] > 0) put(i, rgbOf(C.wood), Math.round(50 + 205 * Math.min(1, woodAt(s, i) / map.woodMax[i])));
      else if (t === T.hills) put(i, rgbOf(C.hills));
      else if (t === T.rock || t === T.crag) put(i, rgbOf(C.rock));
      else {
        const fe = fertility(t);
        if (fe > 0) put(i, mixRgb(C.straw, C.gold, Math.max(0, Math.min(1, (fe - 0.75) / 0.5))));
      }
    }
  }

  private fill(s: GameState, b: Building, col: RGB, put: Put): void {
    const r = footprintRect(s, b);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) put(y * W + x, col);
  }

  /** World-space marks of the active overlay (call after canvas() for the same overlay). */
  marks(g: CanvasRenderingContext2D, s: GameState, id: OverlayId, vis: Rect, time: number): void {
    if (id === 'none') return;
    for (const m of this.houses) {
      const r = footprintRect(s, m.b);
      if (r.x > vis.x + vis.w || r.y > vis.y + vis.h || r.x + r.w < vis.x || r.y + r.h < vis.y) continue;
      const X = r.x * TILE, Y = r.y * TILE, w = r.w * TILE, h = r.h * TILE;
      if (m.col === C.dim) {
        g.globalAlpha = 0.25 + 0.25 * Math.sin(time / 250);
        g.fillStyle = C.dim;
        g.fillRect(X, Y, w, h);
        g.globalAlpha = 1;
      } else if (!m.want) {
        g.strokeStyle = C.bad;
        g.lineWidth = 2;
        g.strokeRect(X - 1, Y - 1, w + 2, h + 2);
      }
      if (m.want) g.drawImage(sprite(m.want), X + (w >> 1) - 6, Y + (h >> 1) - 6);
    }
    for (const c of this.contours) {
      if (c.x < (vis.x - 1) * TILE || c.y < (vis.y - 1) * TILE || c.x > (vis.x + vis.w + 1) * TILE || c.y > (vis.y + vis.h + 1) * TILE) continue;
      g.fillStyle = c.c;
      g.fillRect(c.x, c.y, c.w, c.h);
    }
    if (id !== 'aqua') return;
    g.strokeStyle = C.fountain;
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.lineDashOffset = -time / 120;
    const R = B.map.CASTELLUM_REACH;
    for (const b of s.buildings) {
      if (b.type !== 'castellum') continue;
      const r = footprintRect(s, b);
      g.strokeRect((r.x - R) * TILE + 0.5, (r.y - R) * TILE + 0.5, (r.w + 2 * R) * TILE - 1, (r.h + 2 * R) * TILE - 1);
    }
    g.setLineDash([]);
  }
}

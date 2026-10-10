// src/render/terrain.ts — ground painter, seasons, forest density (ARCHITECTURE §12.2 step 1; DESIGN §16.2). Owner: WP-F.
// SCAFFOLD (debug): one 1 px-per-tile canvas per (seed, season, rank, structure, wood bucket), drawn scaled up with
// smoothing off. WP-F replaces it with the 4 × 3 chunk painter (dither, ripples, chalk lines, crossfade).
import { F, T } from '../game/types';
import type { GameState, SeasonIndex, Terrain } from '../game/types';
import { H, W, getMap, woodAt } from '../game/map';
import { hash2 } from '../game/rng';
import { seasonOf } from '../game/calendar';
import { structEpoch } from '../game/memo';
import { derived } from '../game/derived';
import { makeCanvas } from './sprites';

type Quad4 = readonly [string, string, string, string];

/** Ground colours by season [Ver, Aestas, Autumnus, Hiems] (DESIGN §16.2). */
export const GROUND: Readonly<Record<'grass' | 'meadow' | 'scrub' | 'hills' | 'rock' | 'river' | 'oak', Quad4>> = {
  grass: ['#6fae4a', '#b5ab5a', '#93924a', '#6f8a62'],
  meadow: ['#5f9e3e', '#8fae48', '#8a8a44', '#62805a'],
  scrub: ['#9aa35a', '#c4b06a', '#a8975a', '#8a8a66'],
  hills: ['#8a9a5a', '#a99a62', '#94865a', '#7d8068'],
  rock: ['#9a968a', '#a8a296', '#9a948a', '#8a8a86'],
  river: ['#3f86b8', '#4a90bf', '#3f80ad', '#3a7095'],
  oak: ['#4f9a3a', '#5b8f35', '#c0702e', '#55684f'],
};

/** Other fixed map colours (DESIGN §16.2). */
export const MAP_COLORS = {
  cypress: '#24402c', pine: '#3d6b3a', dirt: '#9b7a52', dirtEdge: '#6f5639', paved: '#5c5d66', pavedEdge: '#3f4048',
  pavedSpeck: '#77787f', forum: '#d8ceb6', chalk: '#efe8d8', fossa: '#4a3a2a', foam: '#cfe6f5',
  clay: '#b5651d', ore: '#c0623f', spring: '#62b0d6', ruins: '#9a968a', stump: '#7a5a3a',
} as const;

/** '#rrggbb' → [r, g, b]. */
export function rgbOf(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Linear mix of two '#rrggbb' colours as [r, g, b]. */
export function mixRgb(a: string, b: string, t: number): [number, number, number] {
  const x = rgbOf(a), y = rgbOf(b);
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
}

/** The base ground colour of a terrain in a season. */
export function groundColor(t: Terrain, season: SeasonIndex): string {
  switch (t) {
    case T.grass: return GROUND.grass[season];
    case T.meadow: case T.loam: return GROUND.meadow[season];
    case T.scrub: return GROUND.scrub[season];
    case T.forest: case T.dense: return GROUND.grass[season];
    case T.hills: return GROUND.hills[season];
    case T.rock: case T.crag: return GROUND.rock[season];
    case T.river: return GROUND.river[season];
    default: return GROUND.grass[season];
  }
}

/** Paints the ground as a W×H canvas (1 px per tile); cached on its inputs. */
export class TerrainPainter {
  private key = '';
  private cv: HTMLCanvasElement | null = null;

  /** Forget the cache (new or loaded game). */
  reset(): void {
    this.key = '';
  }

  /** The 1 px-per-tile ground canvas for the state's current season. */
  canvas(s: GameState): HTMLCanvasElement {
    const season = seasonOf(s.day);
    const key = `${s.seed}|${season}|${s.rank}|${structEpoch(s)}|${Math.floor(s.day / 10)}`;
    if (this.cv && key === this.key) return this.cv;
    this.key = key;
    this.cv ??= makeCanvas(W, H);
    this.paint(s, season, this.cv);
    return this.cv;
  }

  private paint(s: GameState, season: SeasonIndex, cv: HTMLCanvasElement): void {
    const map = getMap(s.seed);
    const sv = map.survey;
    const d = derived(s);
    const g = cv.getContext('2d');
    if (!g) return;
    const img = g.createImageData(W, H);
    const px = img.data;
    for (let i = 0; i < W * H; i++) {
      const t = map.terrain[i] as Terrain;
      let c = rgbOf(groundColor(t, season));
      if (t === T.loam) c = [c[0] * 0.92, c[1] * 0.9, c[2] * 0.86];
      if (t === T.crag) c = [c[0] * 0.78, c[1] * 0.78, c[2] * 0.8];
      if (t === T.forest || t === T.dense) {
        const max = map.woodMax[i];
        const f = max > 0 ? Math.max(0, Math.min(1, woodAt(s, i) / max)) : 0;
        const canopy = t === T.dense ? MAP_COLORS.pine : GROUND.oak[season];
        c = f < 0.25 ? mixRgb(groundColor(t, season), MAP_COLORS.stump, 0.3) : mixRgb(groundColor(t, season), canopy, 0.4 + 0.6 * f);
      }
      const feat = map.feature[i];
      if (feat === F.clay) c = mixRgb(rgbHex(c), MAP_COLORS.clay, 0.45);
      else if (feat === F.ore) c = mixRgb(rgbHex(c), MAP_COLORS.ore, 0.55);
      else if (feat === F.fons) c = rgbOf(MAP_COLORS.spring);
      else if (feat === F.lucus) c = mixRgb(rgbHex(c), MAP_COLORS.cypress, 0.6);
      else if (feat === F.ruins) c = mixRgb(rgbHex(c), MAP_COLORS.ruins, 0.6);
      if (sv.fossa[i]) c = rgbOf(MAP_COLORS.fossa);
      else if (sv.street[i] && !d.road[i] && d.pomerium[i]) c = mixRgb(rgbHex(c), MAP_COLORS.chalk, 0.45);
      // hash dither: ±4% per tile so flat ground does not look like a spreadsheet
      const k = 1 + (hash2(i % W, Math.floor(i / W), s.seed) - 0.5) * 0.08;
      const p = i * 4;
      px[p] = Math.max(0, Math.min(255, c[0] * k));
      px[p + 1] = Math.max(0, Math.min(255, c[1] * k));
      px[p + 2] = Math.max(0, Math.min(255, c[2] * k));
      px[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
}

function rgbHex(c: [number, number, number]): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

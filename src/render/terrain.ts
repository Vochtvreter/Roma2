// src/render/terrain.ts — ground chunk painter, Mediterranean seasons with a crossfade, minimap ground (ARCHITECTURE §12.2
// step 1; DESIGN §16.2). Owner: WP-F.
// The map is 4 × 3 chunks of 28 × 28 tiles. Each chunk has a BASE per season, painted pixel by pixel through ImageData
// (hash dither ±8% on 20% of pixels, two octaves of soft value noise, dithered terrain borders, river ripples, shore
// sand and foam, clay banks, ore speckles, springs, the fossa, hashed grass tufts / flowers / stones), and a COMPOSITE
// = base + ground decals (roads, chalk survey lines, forum ground, bridge; linear.ts) rebuilt only when the chunk's
// decal signature changes. Season changes crossfade over 2 s. Trees are not baked (forest.ts).
import { F, T } from '../game/types';
import type { GameState, Rect, SeasonIndex, Terrain, WorldMap } from '../game/types';
import { H, W, getMap, idx, woodAt } from '../game/map';
import { hash2 } from '../game/rng';
import { seasonOf } from '../game/calendar';
import { structEpoch } from '../game/memo';
import { makeCanvas } from './sprites';
import { TILE } from './camera';
import { decalSig, paintDecals } from './linear';

type Quad4 = readonly [string, string, string, string];
type RGB = [number, number, number];

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
const SHORE: Quad4 = ['#b9a77a', '#c9b384', '#ad9b70', '#9d9580'];

/** Other fixed map colours (DESIGN §16.2). */
export const MAP_COLORS = {
  cypress: '#24402c', pine: '#3d6b3a', dirt: '#9b7a52', dirtEdge: '#6f5639', paved: '#5c5d66', pavedEdge: '#3f4048',
  pavedSpeck: '#77787f', forum: '#d8ceb6', chalk: '#efe8d8', fossa: '#4a3a2a', foam: '#cfe6f5',
  clay: '#b5651d', ore: '#c0623f', spring: '#62b0d6', ruins: '#9a968a', stump: '#7a5a3a',
} as const;

const CH = 28;                                   // chunk size in tiles
const NCX = Math.ceil(W / CH), NCY = Math.ceil(H / CH);
const CPX = CH * TILE;                           // chunk size in world px
const FADE_MS = 2000;                            // season crossfade
const BAKES_PER_FRAME = 2;                       // new chunk bases painted per frame (the rest wait a frame)
const FLOWERS: readonly RGB[] = [[246, 242, 234], [247, 213, 92], [196, 61, 47], [154, 120, 224]];

const rgbCache = new Map<string, RGB>();
/** '#rrggbb' → [r, g, b] (cached). */
export function rgbOf(hex: string): RGB {
  let c = rgbCache.get(hex);
  if (!c) {
    const v = parseInt(hex.slice(1), 16);
    rgbCache.set(hex, (c = [(v >> 16) & 255, (v >> 8) & 255, v & 255]));
  }
  return c;
}

/** Linear mix of two '#rrggbb' colours as [r, g, b]. */
export function mixRgb(a: string, b: string, t: number): RGB {
  return lerp(rgbOf(a), rgbOf(b), t);
}

function lerp(x: RGB, y: RGB, t: number): RGB {
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
}

/** The base ground colour of a terrain in a season. */
export function groundColor(t: Terrain, season: SeasonIndex): string {
  switch (t) {
    case T.meadow: case T.loam: return GROUND.meadow[season];
    case T.scrub: return GROUND.scrub[season];
    case T.hills: return GROUND.hills[season];
    case T.rock: case T.crag: return GROUND.rock[season];
    case T.river: return GROUND.river[season];
    default: return GROUND.grass[season];
  }
}

/** A tile's painted ground colour: the season's terrain colour with loam, woods floor, crag and lucus variants. */
function tileRgb(map: WorldMap, i: number, season: SeasonIndex): RGB {
  const t = map.terrain[i] as Terrain;
  const c = rgbOf(groundColor(t, season));
  if (map.feature[i] === F.lucus) return lerp(c, rgbOf(MAP_COLORS.cypress), 0.3);
  if (t === T.loam) return [c[0] * 0.9 + 8, c[1] * 0.86 + 4, c[2] * 0.78];
  if (t === T.forest) return [c[0] * 0.84, c[1] * 0.88, c[2] * 0.8];
  if (t === T.dense) return [c[0] * 0.72, c[1] * 0.8, c[2] * 0.72];
  if (t === T.crag) return [c[0] * 0.74, c[1] * 0.74, c[2] * 0.78];
  return c;
}

/** Paints one chunk's ground for a season (no decals, no trees). */
function paintBase(map: WorldMap, season: SeasonIndex, cx: number, cy: number): HTMLCanvasElement {
  const cv = makeCanvas(CPX, CPX);
  const g = cv.getContext('2d');
  if (!g) return cv;
  const img = g.createImageData(CPX, CPX);
  const d = img.data;
  const x0 = cx * CH, y0 = cy * CH, x1 = Math.min(W, x0 + CH), y1 = Math.min(H, y0 + CH);
  const sv = map.survey;
  const water = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && map.terrain[idx(x, y)] === T.river;
  const fos = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && sv.fossa[idx(x, y)] === 1;
  // soft value noise at tile corners (one octave per tile, one per 4 tiles) plus a little hill shade from the elevation
  const G = CH + 1, ng = new Float32Array(G * G), hg = new Float32Array(G * G);
  const e = (xx: number, yy: number): number => map.elev[idx(Math.max(0, Math.min(W - 1, xx)), Math.max(0, Math.min(H - 1, yy)))];
  for (let j = 0; j < G; j++)
    for (let k = 0; k < G; k++) {
      const x = x0 + k, y = y0 + j;
      ng[j * G + k] = valueNoise(x, y, 1, 17) * 0.06 + valueNoise(x, y, 4, 19) * 0.1
        + Math.max(-0.08, Math.min(0.08, (e(x - 1, y - 1) - e(x, y)) * 0.6));
      hg[j * G + k] = valueNoise(x, y, 6, 29) + valueNoise(x, y, 2, 31) * 0.4;     // warm/cool patches of the grass
    }
  const shore = rgbOf(SHORE[season]), foam = rgbOf(MAP_COLORS.foam), fossaC = rgbOf(MAP_COLORS.fossa);
  const put = (gx: number, gy: number, c: RGB, f = 1): void => {
    const lx = gx - x0 * TILE, ly = gy - y0 * TILE;
    if (lx < 0 || ly < 0 || lx >= CPX || ly >= CPX) return;
    const o = (ly * CPX + lx) * 4;
    d[o] = Math.min(255, c[0] * f); d[o + 1] = Math.min(255, c[1] * f); d[o + 2] = Math.min(255, c[2] * f); d[o + 3] = 255;
  };
  for (let ty = y0; ty < y1; ty++)
    for (let tx = x0; tx < x1; tx++) {
      const i = idx(tx, ty), t = map.terrain[i], feat = map.feature[i];
      const base = tileRgb(map, i, season);
      const isW = t === T.river, isF = sv.fossa[i] === 1;
      // neighbours whose land colour differs: their colour bleeds 0–2 px into this tile, dithered
      const nb = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => {
        const nx = tx + dx, ny = ty + dy;
        if (isW || isF || nx < 0 || ny < 0 || nx >= W || ny >= H) return null;
        const j = idx(nx, ny);
        if (map.terrain[j] === t || map.terrain[j] === T.river || sv.fossa[j]) return null;
        return tileRgb(map, j, season);
      });
      const deep = isW && water(tx - 1, ty) && water(tx + 1, ty) && water(tx, ty - 1) && water(tx, ty + 1);
      const fN = isF && fos(tx, ty - 1), fS = isF && fos(tx, ty + 1), fE = isF && fos(tx + 1, ty), fWd = isF && fos(tx - 1, ty);
      const it = sv.interior, odx = Math.max(it.x - tx, 0, tx - (it.x + it.w - 1)), ody = Math.max(it.y - ty, 0, ty - (it.y + it.h - 1));
      const midH = isF && ody === 3 && odx <= 3, midV = isF && odx === 3 && ody <= 3;          // the ditch's middle line
      for (let py = 0; py < TILE; py++)
        for (let px = 0; px < TILE; px++) {
          const gx = tx * TILE + px, gy = ty * TILE + py;
          const n = hash2(gx, gy, 7);
          const u = px / TILE, v = py / TILE, k = (ty - y0) * G + (tx - x0);
          const soft = ng[k] * (1 - u) * (1 - v) + ng[k + 1] * u * (1 - v) + ng[k + G] * (1 - u) * v + ng[k + G + 1] * u * v;
          const hue = hg[k] * (1 - u) * (1 - v) + hg[k + 1] * u * (1 - v) + hg[k + G] * (1 - u) * v + hg[k + G + 1] * u * v;
          let c: RGB = isW || isF ? base : [base[0] * (1 + 0.16 * hue), base[1] * (1 + 0.04 * hue), base[2] * (1 - 0.2 * hue)];
          let f = 1 + soft + (n > 0.9 ? 0.08 : n < 0.1 ? -0.08 : 0);
          if (isW) {
            const wave = Math.sin((gx + gy * 0.6) * 0.45) + Math.sin(gx * 0.17 - gy * 0.31);
            f = (deep ? 0.94 : 1) + wave * 0.025 + (n > 0.985 ? 0.14 : 0);
            const e = edgeTo(px, py, tx, ty, (x, y) => !water(x, y));
            if (e === 0) { c = foam; f = n > 0.5 ? 1 : 0.95; } else if (e === 1) f *= 1.12; else if (e === 2) f *= 1.05;
          } else if (isF) {
            c = fossaC;
            f = 1 + (n > 0.88 ? 0.07 : n < 0.12 ? -0.07 : 0);
            if ((!fN && py < 3) || (!fWd && px < 3)) f = 1.42 - (Math.min(px, py) * 0.04);       // lit bank
            else if ((!fS && py > 12) || (!fE && px > 12)) f = 0.78;                               // shaded bank
            else if ((midH && py >= 6 && py <= 9) || (midV && px >= 6 && px <= 9)) {                // muddy water at the bottom
              c = [58, 74, 72];
              f = 1 + Math.sin(gx * 0.5 + gy * 0.3) * 0.05;
            }
          } else {
            const e = edgeTo(px, py, tx, ty, water);
            if (e <= 1) { c = shore; f = n > 0.5 ? 1 : 0.94; }
            else {
              const dist = [py, 15 - px, 15 - py, px];
              for (let s = 0; s < 4; s++) if (nb[s] && dist[s] < 3 && hash2(gx, gy, 23) < (3 - dist[s]) * 0.2) c = nb[s] as RGB;
              if (feat === F.clay && hash2(gx >> 2, gy >> 2, 5) > 0.4) c = lerp(c, rgbOf(MAP_COLORS.clay), 0.35 + 0.15 * hash2(gx >> 1, gy >> 1, 6));
              else if (feat === F.ore && n > 0.72) { c = rgbOf(n > 0.93 ? '#5e2a1a' : MAP_COLORS.ore); f = 1; }
              else if (feat === F.ruins && n > 0.88) { c = rgbOf(MAP_COLORS.ruins); f = n > 0.95 ? 1.15 : 0.9; }
              else if (t === T.rock || t === T.crag) f *= 0.94 + 0.12 * hash2(gx >> 2, gy >> 2, 3) - (hash2(gx >> 1, gy, 9) > 0.93 ? 0.18 : 0);
              else if (t === T.hills) f *= 0.97 + 0.06 * hash2(gx >> 3, gy >> 3, 4);
            }
          }
          put(gx, gy, c, f);
        }
      if (!isW && !isF) decorate(map, i, tx, ty, season, base, put);
    }
  g.putImageData(img, 0, 0);
  return cv;
}

/** Bilinear value noise in [−0.5, 0.5) at tile-corner coordinates with a cell of `c` tiles. */
function valueNoise(x: number, y: number, c: number, seed: number): number {
  const fx = x / c, fy = y / c, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
  return hash2(ix, iy, seed) * (1 - u) * (1 - v) + hash2(ix + 1, iy, seed) * u * (1 - v)
    + hash2(ix, iy + 1, seed) * (1 - u) * v + hash2(ix + 1, iy + 1, seed) * u * v - 0.5;
}

/** Pixel distance (0–3, or 9 when farther) from (px, py) of tile (tx, ty) to a neighbour tile matching `other`. */
function edgeTo(px: number, py: number, tx: number, ty: number, other: (x: number, y: number) => boolean): number {
  let e = 9;
  if (py < 3 && other(tx, ty - 1)) e = Math.min(e, py);
  if (py > 12 && other(tx, ty + 1)) e = Math.min(e, 15 - py);
  if (px < 3 && other(tx - 1, ty)) e = Math.min(e, px);
  if (px > 12 && other(tx + 1, ty)) e = Math.min(e, 15 - px);
  if (e === 9 && px < 2 && py < 2 && other(tx - 1, ty - 1)) e = Math.max(px, py);
  if (e === 9 && px > 13 && py < 2 && other(tx + 1, ty - 1)) e = Math.max(15 - px, py);
  if (e === 9 && px < 2 && py > 13 && other(tx - 1, ty + 1)) e = Math.max(px, 15 - py);
  if (e === 9 && px > 13 && py > 13 && other(tx + 1, ty + 1)) e = Math.max(15 - px, 15 - py);
  return e;
}

/** Hashed ground decoration: grass tufts, spring flowers, summer straw, scrub bushes, stones, a spring pool. */
function decorate(map: WorldMap, i: number, tx: number, ty: number, season: SeasonIndex, base: RGB,
  put: (gx: number, gy: number, c: RGB, f?: number) => void): void {
  const t = map.terrain[i];
  const h = (k: number): number => hash2(tx, ty, k);
  const X = tx * TILE, Y = ty * TILE;
  if (map.feature[i] === F.fons) {
    for (let y = -6; y <= 6; y++)
      for (let x = -7; x <= 7; x++) {
        const r = Math.hypot(x / 1.2, y);
        if (r > 5.6) continue;
        const c = r > 4.4 ? rgbOf('#9fd4f0') : r > 2 ? rgbOf(MAP_COLORS.spring) : rgbOf('#3d7fa6');
        put(X + 8 + x, Y + 8 + y, c, r < 4.4 && hash2(x, y, i) > 0.9 ? 1.2 : 1);
      }
    return;
  }
  const dark: RGB = [base[0] * 0.78, base[1] * 0.8, base[2] * 0.74], light: RGB = [base[0] * 1.14, base[1] * 1.12, base[2] * 1.06];
  const lush = t === T.grass || t === T.meadow || t === T.loam || t === T.forest || t === T.dense;
  if (lush || t === T.scrub) {
    const tufts = Math.floor(h(21) * (t === T.meadow ? 4 : 3));
    for (let k = 0; k < tufts; k++) {
      const x = X + 2 + Math.floor(h(30 + k) * 12), y = Y + 3 + Math.floor(h(40 + k) * 11);
      const dry = season === 1 && t !== T.loam;
      put(x, y, dry ? light : dark); put(x + 2, y, dry ? light : dark); put(x + 1, y - 1, dry ? light : dark); put(x + 1, y, light);
    }
  }
  if (season === 0 && (t === T.meadow || t === T.grass) && h(50) < (t === T.meadow ? 0.6 : 0.22)) {
    const n = t === T.meadow ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const x = X + 2 + Math.floor(h(51 + k) * 12), y = Y + 2 + Math.floor(h(55 + k) * 12);
      put(x, y + 1, dark);
      put(x, y, FLOWERS[Math.floor(h(59 + k) * FLOWERS.length)]);
    }
  }
  if (t === T.scrub && h(60) < 0.45) {
    const x = X + 3 + Math.floor(h(61) * 9), y = Y + 4 + Math.floor(h(62) * 9);
    const bush: RGB = [96, 102, 52];
    for (let k = 0; k < 4; k++) put(x + k, y, bush, k === 0 ? 1.25 : 1);
    put(x + 1, y - 1, bush, 1.3); put(x + 2, y - 1, bush, 1.1); put(x + 1, y + 1, bush, 0.6); put(x + 2, y + 1, bush, 0.6);
  }
  if ((t === T.hills || t === T.scrub || t === T.rock) && h(70) < 0.5) {
    const x = X + 2 + Math.floor(h(71) * 11), y = Y + 3 + Math.floor(h(72) * 10);
    put(x, y, [170, 166, 154]); put(x + 1, y, [140, 136, 126]); put(x, y + 1, dark, 0.8); put(x + 1, y + 1, dark, 0.8);
  }
}

interface Chunk { cv: HTMLCanvasElement; sig: number }

/** Paints and caches the ground chunks, crossfades seasons and keeps the 1 px/tile minimap ground. */
export class TerrainPainter {
  private seed = -1;
  private bases = new Map<string, HTMLCanvasElement>();      // `${season}:${chunk}` → base
  private chunks = new Map<string, Chunk>();                 // `${season}:${chunk}` → composite
  private sigs: number[] = [];
  private sigKey = '';
  private season = -1;
  private prev = -1;
  private fade = 1;
  private mini: HTMLCanvasElement | null = null;
  private miniKey = '';

  /** Forget every cache (new or loaded game). */
  reset(): void {
    this.seed = -1;
    this.bases.clear();
    this.chunks.clear();
    this.sigKey = this.miniKey = '';
    this.season = this.prev = -1;
    this.fade = 1;
  }

  /** The season being shown, the one fading out (or −1) and the fade-in progress 0..1. */
  get seasons(): { cur: SeasonIndex; prev: SeasonIndex | -1; fade: number } {
    return { cur: Math.max(0, this.season) as SeasonIndex, prev: this.fade < 1 ? (this.prev as SeasonIndex) : -1, fade: this.fade };
  }

  /** Advances the crossfade; call once per frame before drawing. */
  update(s: GameState, dtMs: number): void {
    if (s.seed !== this.seed) { this.reset(); this.seed = s.seed; }
    const season = seasonOf(s.day);
    if (season !== this.season) {
      if (this.season >= 0) { this.prev = this.season; this.fade = 0; }
      this.season = season;
    }
    if (this.fade < 1 && (this.fade += dtMs / FADE_MS) >= 1) {
      this.fade = 1;
      for (const m of [this.bases, this.chunks]) for (const k of [...m.keys()]) if (!k.startsWith(`${season}:`)) m.delete(k);
    }
  }

  /** Draws the ground under the visible tiles (crossfading the previous season while it fades). */
  draw(g: CanvasRenderingContext2D, s: GameState, vis: Rect): void {
    const key = `${structEpoch(s)}|${s.rank}`;
    if (key !== this.sigKey) {
      this.sigKey = key;
      this.sigs = [];
      for (let c = 0; c < NCX * NCY; c++) this.sigs.push(decalSig(s, this.rectOf(c)));
    }
    const budget = { n: BAKES_PER_FRAME };
    const cx0 = Math.floor(vis.x / CH), cx1 = Math.floor((vis.x + vis.w - 1) / CH);
    const cy0 = Math.floor(vis.y / CH), cy1 = Math.floor((vis.y + vis.h - 1) / CH);
    const pass = (season: SeasonIndex, bake: boolean): void => {
      for (let cy = Math.max(0, cy0); cy <= Math.min(NCY - 1, cy1); cy++)
        for (let cx = Math.max(0, cx0); cx <= Math.min(NCX - 1, cx1); cx++) {
          const c = this.chunk(s, season, cy * NCX + cx, bake ? budget : null);
          if (c) g.drawImage(c, cx * CPX, cy * CPX);
          else if (bake) g.drawImage(this.miniCanvas(s), cx * CH, cy * CH, CH, CH, cx * CPX, cy * CPX, CPX, CPX);
        }
    };
    const { cur, prev, fade } = this.seasons;
    if (prev >= 0) {
      pass(prev as SeasonIndex, false);
      g.globalAlpha = fade;
    }
    pass(cur, true);
    g.globalAlpha = 1;
    // paint one off-screen chunk per frame in the background so panning never meets a blurry chunk
    if (budget.n > 0) for (let c = 0; c < NCX * NCY; c++) if (!this.bases.has(`${cur}:${c}`)) { this.chunk(s, cur, c, budget); break; }
  }

  /** The 1 px/tile ground colour canvas (woods by standing timber), for the minimap and chunk placeholders. */
  miniCanvas(s: GameState): HTMLCanvasElement {
    const season = seasonOf(s.day);
    const key = `${s.seed}|${season}|${Math.floor(s.day / 10)}|${structEpoch(s)}`;
    if (this.mini && key === this.miniKey) return this.mini;
    this.miniKey = key;
    this.mini ??= makeCanvas(W, H);
    const g = this.mini.getContext('2d');
    if (!g) return this.mini;
    const map = getMap(s.seed);
    const img = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      let c = tileRgb(map, i, season);
      const max = map.woodMax[i];
      if (max > 0) c = lerp(c, rgbOf(map.terrain[i] === T.dense ? MAP_COLORS.pine : GROUND.oak[season]), 0.75 * Math.min(1, woodAt(s, i) / max));
      if (map.survey.fossa[i]) c = rgbOf(MAP_COLORS.fossa);
      const f = 1 + (hash2(i % W, Math.floor(i / W), s.seed) - 0.5) * 0.06;
      img.data.set([c[0] * f, c[1] * f, c[2] * f, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    return this.mini;
  }

  private rectOf(c: number): Rect {
    const x = (c % NCX) * CH, y = Math.floor(c / NCX) * CH;
    return { x, y, w: Math.min(CH, W - x), h: Math.min(CH, H - y) };
  }

  /** The composite chunk (base + decals); null when its base is not painted and there is no budget left. */
  private chunk(s: GameState, season: SeasonIndex, c: number, budget: { n: number } | null): HTMLCanvasElement | null {
    const key = `${season}:${c}`;
    const sig = this.sigs[c] ?? 0;
    const have = this.chunks.get(key);
    if (have && have.sig === sig) return have.cv;
    let base = this.bases.get(key);
    if (!base) {
      if (!budget || budget.n <= 0) return have?.cv ?? null;
      budget.n--;
      base = paintBase(getMap(s.seed), season, c % NCX, Math.floor(c / NCX));
      this.bases.set(key, base);
    }
    const cv = have?.cv ?? makeCanvas(CPX, CPX);
    const g = cv.getContext('2d');
    if (!g) return cv;
    const r = this.rectOf(c);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(base, 0, 0);
    g.translate(-r.x * TILE, -r.y * TILE);
    g.imageSmoothingEnabled = false;
    paintDecals(g, s, r, season);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.chunks.set(key, { cv, sig });
    return cv;
  }
}

/** Chunk geometry shared with the forest layer. */
export const CHUNKS = { size: CH, nx: NCX, ny: NCY, px: CPX } as const;

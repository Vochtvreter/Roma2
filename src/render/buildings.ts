// src/render/buildings.ts — building and house draw dispatch, rise(), sites, status marks, selection (ARCHITECTURE §12.2
// steps 2, 5, 6). Owner: WP-F.
// Sprites come only from the frozen naming (`buildingSprite`, `p_capitolium_<n>`, `p_crown_<path>`, `ov_*`, `i_*`);
// a building whose sprite is not registered yet is drawn as a stand-in silhouette (fallback.ts). Anchoring (§12.3):
// centred on the footprint, bottom-aligned to its bottom edge. Every drawn building is recorded with its sprite box in
// draw order, for pixel-accurate picking and for the ambient particles.
import type { BuildCat, Building, BuildingId, GameState, HouseTierId, NeedId, Rect, SeasonIndex } from '../game/types';
import { BUILDING_DEFS } from '../game/data/buildings';
import { W, getMap } from '../game/map';
import { footprintOf } from '../game/derived';
import { structEpoch } from '../game/memo';
import { census } from '../game/census';
import { firstWant } from '../game/housing';
import { capitoliumStage } from '../game/construction';
import { B } from '../game/balance';
import { buildingSprite, wantIcon } from './art/index';
import { CROWN_AT } from './art/capitolium';
import { alphaMask, hasSprite, makeCanvas, sprite } from './sprites';
import { fallbackSprite } from './fallback';
import type { Push } from './camera';
import { TILE } from './camera';

/** Fill colour per building category (minimap, overlays). */
export const CAT_COLOR: Readonly<Record<BuildCat, string>> = {
  domus: '#c0623f', annona: '#d9c27a', aqua: '#62b0d6', materia: '#8a6b4a', officinae: '#55565e',
  mercatus: '#d9a35b', religio: '#efe8d8', salus: '#9fd4f0', ornamenta: '#9ccc5a', civitas: '#d8ceb6',
};

/** Fill colour per house tier (tents red → thatch → terracotta → stone → plaster → marble). */
export const TIER_COLOR: Readonly<Record<HouseTierId, string>> = {
  tentoria: '#9e2f25', casa: '#b07a45', tegulata: '#c0623f', domusParva: '#d2c7b2', insula: '#d9a35b', domus: '#efe8d8',
};

/** A building as drawn this frame: its visible box (world px) and the sprite origin inside it, for picking. */
export interface Drawn { b: Building; r: Rect; name: string | null; x: number; y: number; w: number; h: number; sx: number; sy: number; sw: number }

const GROUND_TYPES: readonly string[] = ['ager', 'olivetum'];            // fields lie flat: drawn before y-sorting
const CROWNS: readonly string[] = ['iuppiter', 'aeternitas', 'imperium'];
const ORDO_SEAL_DAYS = 10;                                               // an Ordo site shows its seal this long
const TRENCH_UNTIL = 0.12;
const SHADOW = { alpha: 0.2, lean: 0.45, flat: 0.32 } as const;
const C = { chalk: '#efe8d8', plan: '#f2c94c', bar: '#1d1410', gold: '#f2c94c', ember: '#f0a04b', bubble: '#f4ead6', ink: '#1d1410' } as const;

let rectEpoch = -1;
let rectState: GameState | null = null;
const rects = new Map<number, Rect>();

/** The tile bounding rectangle of a building's footprint (cached per structure epoch). */
export function footprintRect(s: GameState, b: Building): Rect {
  const ep = structEpoch(s);
  if (ep !== rectEpoch || s !== rectState) { rects.clear(); rectEpoch = ep; rectState = s; }
  let r = rects.get(b.id);
  if (r) return r;
  const tiles = footprintOf(b, s);
  let x0 = b.x, y0 = b.y, x1 = b.x, y1 = b.y;
  for (const i of tiles) {
    const x = i % W, y = Math.floor(i / W);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  r = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  rects.set(b.id, r);
  return r;
}

/** The map colour of a building (houses by tier). */
export function buildingColor(b: Building): string {
  if (b.type === 'area') return TIER_COLOR[b.house?.tier ?? 'tentoria'];
  return CAT_COLOR[BUILDING_DEFS[b.type].cat];
}

/** The rise of a site: the finished sprite clipped from the bottom to `h × progress`; (x, y) = the sprite's top-left. */
export function rise(g: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, progress: number): void {
  const sh = Math.round(img.height * Math.max(0, Math.min(1, progress)));
  if (sh > 0) g.drawImage(img, 0, img.height - sh, img.width, sh, x, y + img.height - sh, img.width, sh);
}

/** A named sprite, or the stand-in silhouette `wTiles` wide when the name is not registered (name null). */
export function lookOf(name: string, type: BuildingId, tier: HouseTierId | null, wTiles: number): { name: string | null; cv: HTMLCanvasElement } {
  if (hasSprite(name)) return { name, cv: sprite(name) };
  return { name: null, cv: fallbackSprite(type, tier, wTiles * TILE) };
}

/** Draws the scaffold overlay across a sprite box up to the risen height. */
function scaffold(g: CanvasRenderingContext2D, left: number, width: number, bottom: number, risen: number): void {
  const sc = sprite('ov_scaffold');
  for (let y = bottom - sc.height; y > bottom - Math.max(risen + 6, sc.height + 1); y -= sc.height)
    for (let x = left; x < left + width; x += sc.width) {
      const w = Math.min(sc.width, left + width - x);
      g.drawImage(sc, 0, 0, w, sc.height, x, y, w, sc.height);
    }
}

/** Paints and records the buildings of a frame. */
export class BuildingPainter {
  /** Buildings drawn this frame, in draw order (picking walks it back to front). */
  drawn: Drawn[] = [];
  private wants = new Map<number, NeedId | null>();
  private wantKey = '';

  /** Ground pass (step 2): fields and olive groves, stakes and plans in chalk, trenches, the selection and hover rings. */
  ground(g: CanvasRenderingContext2D, s: GameState, vis: Rect, season: SeasonIndex, sel: number | null, hover: number | null, time: number): void {
    for (const b of s.buildings) {
      const r = footprintRect(s, b);
      if (r.x > vis.x + vis.w || r.y > vis.y + vis.h || r.x + r.w < vis.x || r.y + r.h < vis.y) continue;
      const X = r.x * TILE, Y = r.y * TILE, w = r.w * TILE, h = r.h * TILE;
      if (b.status === 'plan' || b.status === 'staked') {
        g.globalAlpha = 0.75;
        g.fillStyle = b.status === 'plan' ? C.plan : C.chalk;
        for (let k = 0; k < w; k += 4) { g.fillRect(X + k, Y, 2, 1); g.fillRect(X + k, Y + h - 1, 2, 1); }
        for (let k = 0; k < h; k += 4) { g.fillRect(X, Y + k, 1, 2); g.fillRect(X + w - 1, Y + k, 1, 2); }
        g.globalAlpha = 1;
        if (b.status === 'staked') {
          const pg = sprite('ov_pegs');
          for (const [px, py] of [[X, Y], [X + w - TILE, Y], [X, Y + h - TILE], [X + w - TILE, Y + h - TILE]]) g.drawImage(pg, px, py);
        }
      } else if (b.status === 'building' && b.progress < TRENCH_UNTIL) {
        const tr = sprite('ov_trench');
        for (let y = Y; y < Y + h; y += TILE) for (let x = X; x < X + w; x += TILE) g.drawImage(tr, x, y);
      }
      if (b.status === 'done' || (b.status === 'building' && b.progress > 0)) {
        const look = b.type === 'capitolium' ? null : lookOf(buildingSprite(s, b, season), b.type, b.house?.tier ?? null, r.w);
        if (look && GROUND_TYPES.includes(b.type)) {
          if (b.status === 'done') g.drawImage(look.cv, X + ((w - look.cv.width) >> 1), Y + h - look.cv.height);
          else rise(g, look.cv, X + ((w - look.cv.width) >> 1), Y + h - look.cv.height, b.progress);
        } else if (look) castShadow(g, look.cv, X + ((w - look.cv.width) >> 1), Y + h, b.status === 'done' ? 1 : b.progress);
      }
      if (b.id === sel || b.id === hover) ring(g, X, Y, w, h, b.id === sel ? C.ember : 'rgba(244,234,214,0.8)', b.id === sel ? time : 0);
    }
  }

  /** Object pass (step 5): pushes every visible building (sprite, rise and scaffold) onto the y-sorted list. */
  items(s: GameState, vis: Rect, season: SeasonIndex, push: Push): void {
    this.drawn = [];
    let capitol = false;
    for (const b of s.buildings) {
      if (b.type === 'capitolium') capitol = true;
      const r = footprintRect(s, b);
      if (r.x > vis.x + vis.w || r.y > vis.y + vis.h || r.x + r.w < vis.x || r.y + r.h < vis.y) continue;
      const X = r.x * TILE, w = r.w * TILE, bottom = (r.y + r.h) * TILE;
      if (b.status === 'plan' || b.status === 'staked' || (b.status === 'building' && b.progress <= 0)) {
        this.record(b, r, null, X, r.y * TILE, w, r.h * TILE, w);
        continue;
      }
      if (b.type === 'capitolium') { this.capitolium(s, b, r, push); continue; }
      const { name, cv } = lookOf(buildingSprite(s, b, season), b.type, b.house?.tier ?? null, r.w);
      const left = X + ((w - cv.width) >> 1), top = bottom - cv.height;
      const p = b.status === 'done' ? 1 : b.progress;
      const risen = Math.round(cv.height * p);
      this.record(b, r, name, left, bottom - risen, cv.width, risen, cv.width, top);
      if (GROUND_TYPES.includes(b.type)) continue;
      push(bottom, X, (g) => {
        if (p >= 1) g.drawImage(cv, left, top);
        else rise(g, cv, left, top, p);
        if (p < 1 || b.house?.renovating) scaffold(g, left, cv.width, bottom, risen);
        if (b.type === 'lignarius' && p >= 1 && hasSprite('b_lignarius_logs')) {
          const logs = sprite('b_lignarius_logs');
          rise(g, logs, X + w - logs.width, bottom - logs.height, Math.min(1, s.res.timber / Math.max(1, census(s).caps.timber)));
        }
      });
    }
    if (!capitol) {
      const cap = getMap(s.seed).survey.capitolium;
      if (cap.x <= vis.x + vis.w && cap.y <= vis.y + vis.h && cap.x + cap.w >= vis.x && cap.y + cap.h >= vis.y) {
        const alt = sprite('n_altar'), cx = (cap.x + cap.w / 2) * TILE, by = (cap.y + cap.h) * TILE - 12;
        push(by, cx, (g) => g.drawImage(alt, Math.round(cx - alt.width / 2), by - alt.height));
      }
    }
    this.drawn.sort((a, c) => a.r.y + a.r.h - (c.r.y + c.r.h) || a.r.x - c.r.x);
  }

  /** The Capitolium: the last completed stage, the next one rising out of it, the path's crown when dedicated. */
  private capitolium(s: GameState, b: Building, r: Rect, push: Push): void {
    const T = B.construction.CAP_STAGES;
    const k = b.status === 'done' ? 4 : capitoliumStage(b);
    const next = Math.min(4, k + 1);
    const lo = k > 0 ? T[k - 1] : 0, within = b.status === 'done' ? 1 : (b.progress - lo) / Math.max(1e-6, T[next - 1] - lo);
    const done = k > 0 ? lookOf(`p_capitolium_${k}`, 'capitolium', null, r.w) : null;
    const up = lookOf(`p_capitolium_${next}`, 'capitolium', null, r.w);
    const X = r.x * TILE, w = r.w * TILE, bottom = (r.y + r.h) * TILE, left = X + ((w - up.cv.width) >> 1), top = bottom - up.cv.height;
    const chosen: string[] = Object.values(s.decisions.paths);
    const crown = b.status === 'done' ? CROWNS.find((c) => chosen.includes(c)) : undefined;
    this.record(b, r, (done ?? up).name, left, top, up.cv.width, up.cv.height, up.cv.width);
    push(bottom, X, (g) => {
      if (done) g.drawImage(done.cv, left, top);
      if (b.status !== 'done') { rise(g, up.cv, left, top, within); scaffold(g, left, up.cv.width, bottom, Math.round(up.cv.height * within)); }
      if (crown) g.drawImage(sprite(`p_crown_${crown}`), left + CROWN_AT.x, top + CROWN_AT.y);   // G2's anchor on p_capitolium_4
    });
  }

  private record(b: Building, r: Rect, name: string | null, x: number, y: number, w: number, h: number, sw: number, sy = y): void {
    this.drawn.push({ b, r, name, x, y, w, h, sx: x, sy, sw });
  }

  /** Marks pass (step 6): progress bars, cracks, closed/unpaid/unstaffed pips, Ordo seals, plans, want bubbles (zoom ≥ 2). */
  marks(g: CanvasRenderingContext2D, s: GameState, level: number, time: number, sel: number | null): void {
    const c = census(s);
    const key = `${structEpoch(s)}|${s.day}`;
    if (key !== this.wantKey) { this.wantKey = key; this.wants.clear(); }
    const saturnalia = s.modifiers.some((m) => m.source === 'saturnalia') && hasSprite('ov_lanterns');
    for (const d of this.drawn) {
      const b = d.b, def = BUILDING_DEFS[b.type];
      const cx = d.sx + d.sw / 2, top = Math.min(d.sy, d.y);
      if (b.status === 'building') {
        const bw = Math.min(d.sw - 4, 40), bx = Math.round(cx - bw / 2), by = d.sy - 5;
        g.fillStyle = C.bar; g.fillRect(bx - 1, by - 1, bw + 2, 4);
        g.fillStyle = C.gold; g.fillRect(bx, by, Math.max(1, Math.round(bw * b.progress)), 2);
      }
      const icons: string[] = [];
      if (b.status === 'plan') icons.push('i_plan');
      if (b.owner === 'ordo' && (b.status !== 'done' || s.day - b.placed < ORDO_SEAL_DAYS)) icons.push('i_seal');
      if (b.status === 'done') {
        if (b.house?.declining || (b.damagedUntil ?? 0) > s.day) g.drawImage(sprite('ov_cracks'), Math.round(cx - 16), d.sy + d.h - 24);
        if (saturnalia && b.house) g.drawImage(sprite('ov_lanterns'), Math.round(cx - 16), d.sy + d.h - 16);   // G1: hangs across the front, above the doors
        if (def.slots > 0 && !b.open) icons.push('i_closed');
        else if (def.slots > 0 && (c.staffed[b.id] ?? 0) === 0) icons.push('i_unstaffed');
        if (b.unpaid) icons.push('i_unpaid');
      }
      let y = top - 14;
      if (icons.length) {
        let x = Math.round(cx - (icons.length * 13 - 1) / 2);
        for (const n of icons) { g.drawImage(sprite(n), x, y); x += 13; }
        y -= 15;
      }
      if (b.house && b.status === 'done' && level >= 2) {
        const want = this.want(s, b);
        if (want) bubble(g, wantIcon(want), Math.round(cx), y + 12 + Math.round(Math.sin(time / 400 + b.id) * 1.2));
      }
      if (b.id === sel) {
        const bob = Math.round(Math.sin(time / 200) * 1.5), ay = top - 6 + bob - (icons.length ? 15 : 0);
        g.fillStyle = C.ink; g.fillRect(cx - 4, ay - 1, 9, 4); g.fillRect(cx - 2, ay + 3, 5, 2);
        g.fillStyle = C.ember; g.fillRect(cx - 3, ay, 7, 2); g.fillRect(cx - 1, ay + 2, 3, 2);
      }
    }
  }

  private want(s: GameState, b: Building): NeedId | null {
    if (!this.wants.has(b.id)) this.wants.set(b.id, firstWant(s, b));
    return this.wants.get(b.id) ?? null;
  }

  /** The building whose sprite is under a world point (front-most, pixel-accurate), or null. */
  pick(wx: number, wy: number): number | null {
    for (let k = this.drawn.length - 1; k >= 0; k--) {
      const d = this.drawn[k];
      if (wx < d.x || wy < d.y || wx >= d.x + d.w || wy >= d.y + d.h) continue;
      if (!d.name) return d.b.id;
      const m = alphaMask(d.name);
      if (m[Math.floor(wy - d.sy) * d.sw + Math.floor(wx - d.sx)]) return d.b.id;
    }
    return null;
  }
}

const shadows = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** A sprite's shadow on the ground: its silhouette sheared to the north-east (light from the top-left), under the objects. */
function castShadow(g: CanvasRenderingContext2D, c: HTMLCanvasElement, left: number, bottom: number, p: number): void {
  let sh = shadows.get(c);
  if (!sh) {
    sh = makeCanvas(c.width, c.height);
    const sg = sh.getContext('2d');
    if (sg) { sg.drawImage(c, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#140c08'; sg.fillRect(0, 0, c.width, c.height); }
    shadows.set(c, sh);
  }
  const h = Math.round(c.height * Math.max(0, Math.min(1, p)));
  if (h <= 0) return;
  g.save();
  g.globalAlpha = SHADOW.alpha;
  g.transform(1, 0, -SHADOW.lean, SHADOW.flat, left + SHADOW.lean * c.height, bottom - SHADOW.flat * c.height);   // (x, y) → (x + lean·(H − y), bottom − flat·(H − y))
  g.drawImage(sh, 0, c.height - h, c.width, h, 0, c.height - h, c.width, h);
  g.restore();
}

/** A footprint ring on the ground: four corner brackets and a soft edge, pulsing when `time` > 0. */
function ring(g: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, color: string, time: number): void {
  const a = time ? 0.65 + 0.35 * Math.sin(time / 180) : 1;
  g.globalAlpha = 0.35 * a;
  g.fillStyle = color;
  g.fillRect(X - 1, Y - 1, w + 2, 1); g.fillRect(X - 1, Y + h, w + 2, 1); g.fillRect(X - 1, Y, 1, h); g.fillRect(X + w, Y, 1, h);
  g.globalAlpha = a;
  const L = Math.min(6, w >> 2);
  for (const [x, y, dx, dy] of [[X - 2, Y - 2, 1, 1], [X + w + 1, Y - 2, -1, 1], [X - 2, Y + h + 1, 1, -1], [X + w + 1, Y + h + 1, -1, -1]]) {
    g.fillRect(dx > 0 ? x : x - L + 1, y, L, 1 + (time ? 1 : 0));
    g.fillRect(x, dy > 0 ? y : y - L + 1, 1 + (time ? 1 : 0), L);
  }
  g.globalAlpha = 1;
}

/** A want bubble: a parchment speech bubble with the need's icon, its tail at (cx, by). */
function bubble(g: CanvasRenderingContext2D, icon: string, cx: number, by: number): void {
  const x = cx - 8, y = by - 18;
  g.fillStyle = C.ink;
  g.fillRect(x + 1, y, 14, 16); g.fillRect(x, y + 1, 16, 14); g.fillRect(cx - 1, by - 2, 3, 3);
  g.fillStyle = C.bubble;
  g.fillRect(x + 1, y + 1, 14, 14); g.fillRect(cx, by - 3, 1, 2);
  g.drawImage(sprite(icon), x + 2, y + 2);
}

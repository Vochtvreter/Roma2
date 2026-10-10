// src/render/fallback.ts — procedural stand-in silhouettes for buildings and houses whose sprite is not registered yet
// (ARCHITECTURE §14.2 WP-F: the map must work before the art lands). Owner: WP-F.
// Each stand-in is a small parametric drawing (walls coloured by category, a roof kind, storeys, an accent) rasterised
// once per (look, size) and auto-outlined like the real art, so rise(), the ghost and picking treat it as a sprite.
import type { BuildingId, HouseTierId } from '../game/types';
import { makeCanvas, outline } from './sprites';

type Kind = 'gable' | 'flat' | 'dome' | 'temple' | 'tents' | 'field' | 'pit' | 'well';
interface Look { h: number; kind: Kind; wall: string; roof: string; storeys?: number; accent?: string }

const L = (h: number, kind: Kind, wall: string, roof: string, storeys = 1, accent?: string): Look => ({ h, kind, wall, roof, storeys, accent });
const TERRA = '#c0623f', TERRA_D = '#8a3d2b', TUFA = '#b8a582', MARBLE = '#efe8d8', OCHRE = '#d9a35b', WOOD = '#86532e';

/** Stand-in looks per house tier (DESIGN §16.3 sizes: tents → thatch → terracotta → stone → insula / atrium house). */
const HOUSE: Record<HouseTierId, Look> = {
  tentoria: L(20, 'tents', '#9e2f25', '#c43d2f'), casa: L(24, 'gable', '#b07a45', '#d6a464'),
  tegulata: L(26, 'gable', OCHRE, TERRA), domusParva: L(30, 'gable', '#d2c7b2', TERRA, 2),
  insula: L(44, 'gable', OCHRE, TERRA_D, 3, '#86532e'), domus: L(30, 'gable', MARBLE, TERRA, 1, '#3d7fa6'),
};

/** Stand-in looks per building type (heights from DESIGN §16.3). */
const BUILDING: Record<Exclude<BuildingId, 'area'>, Look> = {
  principia: L(152, 'temple', '#d8ceb6', TERRA), capitolium: L(96, 'temple', MARBLE, TERRA),
  ager: L(48, 'field', '#8a6b4a', '#d9c27a'), olivetum: L(48, 'field', '#8a6b4a', '#7d8a46'), lapicidina: L(40, 'pit', '#9a968a', '#686f7c'),
  venatio: L(26, 'gable', WOOD, '#5e3a22', 1, '#efcf95'), pabulatio: L(22, 'gable', '#b07a45', '#d6a464', 1, '#7d8a46'),
  horreum: L(40, 'gable', TUFA, TERRA, 1), apotheca: L(36, 'gable', '#d2c7b2', TERRA_D),
  puteus: L(22, 'well', '#9aa0a8', '#3d7fa6'), cisterna: L(22, 'flat', TUFA, '#3d7fa6'), castellum: L(32, 'flat', TUFA, '#62b0d6', 2),
  lacus: L(24, 'well', '#d2c7b2', '#62b0d6'),
  lignarius: L(26, 'gable', WOOD, '#5e3a22', 1, '#b07a45'), fodina: L(28, 'pit', '#686f7c', '#3a3b47'),
  figlina: L(28, 'dome', '#b07a45', TERRA, 1, '#e06c2e'), caementarium: L(26, 'pit', '#c3cad4', '#9aa0a8'),
  officina: L(30, 'flat', '#686f7c', '#3a3b47', 1, '#e06c2e'), fabrica: L(30, 'gable', '#9aa0a8', TERRA_D, 1, '#e06c2e'),
  taberna: L(28, 'gable', OCHRE, TERRA, 1, '#c43d2f'), macellum: L(56, 'dome', MARBLE, TERRA), mansio: L(40, 'gable', OCHRE, TERRA, 2),
  lararium: L(28, 'temple', MARBLE, TERRA), templum: L(72, 'temple', MARBLE, TERRA), balneum: L(52, 'dome', '#d2c7b2', '#9aa0a8'),
  thermae: L(64, 'dome', MARBLE, '#9aa0a8', 2), theatrum: L(56, 'dome', TUFA, '#d8ceb6'), hortus: L(24, 'field', '#6f5639', '#4f9a3a', 1, '#ef8fb5'),
};

const cache = new Map<string, HTMLCanvasElement>();

/** A cached stand-in silhouette `wPx` wide for a building type (and house tier), bottom-aligned like real art. */
export function fallbackSprite(type: BuildingId, tier: HouseTierId | null, wPx: number): HTMLCanvasElement {
  const look = type === 'area' ? HOUSE[tier ?? 'tentoria'] : BUILDING[type];
  const key = `${type}|${tier}|${wPx}`;
  let c = cache.get(key);
  if (c) return c;
  c = makeCanvas(wPx, look.h);
  const g = c.getContext('2d');
  if (g) paint(g, look, wPx, look.h);
  c = outline(c);
  cache.set(key, c);
  return c;
}

function paint(g: CanvasRenderingContext2D, k: Look, w: number, h: number): void {
  const R = (c: string, x: number, y: number, rw: number, rh: number): void => { g.fillStyle = c; g.fillRect(x, y, rw, rh); };
  const x0 = 1, x1 = w - 1, bw = x1 - x0;
  const shade = 'rgba(0,0,0,0.22)', light = 'rgba(255,255,255,0.22)', dark = '#2a2030';
  const gable = (top: number, base: number, inset: number): void => {     // stepped roof from `base` up to `top`, lit from the left
    const rows = base - top;
    for (let r = 0; r < rows; r++) {
      const ins = Math.round((r / rows) * inset), y = base - r - 1, x = x0 + ins - 1, rw = bw - 2 * ins + 2, half = rw >> 1;
      R(r % 3 === 1 ? TERRA_D : k.roof, x, y, rw, 1);
      R(light, x, y, half, 1);
      R(shade, x + half, y, rw - half, 1);
    }
  };
  switch (k.kind) {
    case 'tents': {
      const n = Math.max(2, Math.floor(bw / 10));
      for (let t = 0; t < n; t++) {
        const tx = x0 + Math.floor((t * bw) / n), tw = Math.floor(bw / n) - 1, th = h - 4 - (t % 2) * 3;
        for (let r = 0; r < th; r++) { const ins = Math.round((r / th) * (tw / 2 - 1)); R(r % 4 ? k.wall : k.roof, tx + ins, h - 1 - r, tw - 2 * ins, 1); }
        R(dark, tx + (tw >> 1) - 1, h - 5, 2, 4);
      }
      return;
    }
    case 'field': {
      for (let y = 4; y < h - 1; y += 3) { R(k.wall, x0, y, bw, 2); R(k.roof, x0, y + 2, bw, 1); }
      if (k.accent) for (let i = 0; i < 9; i++) R(k.accent, x0 + 2 + ((i * 7) % (bw - 4)), 5 + ((i * 11) % (h - 8)), 1, 1);
      if (k.roof === '#7d8a46') for (let y = 6; y < h - 4; y += 8) for (let x = 4; x < bw - 3; x += 8) R('#4f6b2c', x0 + x, y, 4, 3);
      R(OCHRE, x0 + 2, 1, 10, 7); R(TERRA, x0 + 1, 0, 12, 3);
      return;
    }
    case 'pit': {
      for (let r = 0; r < 4; r++) R(r % 2 ? k.roof : k.wall, x0 + r * 3, h * 0.35 + r * 3, bw - r * 6, h * 0.65 - r * 4);
      R(dark, x0 + (bw >> 1) - 3, h - 9, 6, 6); R(WOOD, x0 + 2, h * 0.3, 2, h * 0.7 - 1);
      return;
    }
    case 'well': {
      R(k.wall, x0 + 3, h - 9, bw - 6, 8); R(k.roof, x0 + 5, h - 9, bw - 10, 3); R(light, x0 + 3, h - 6, bw - 6, 1);
      R(WOOD, x0 + 6, 2, 2, h - 10); R(WOOD, x1 - 8, 2, 2, h - 10); R('#5e3a22', x0 + 4, 1, bw - 8, 2);
      return;
    }
    case 'temple': {
      const ped = Math.max(6, Math.round(h * 0.22)), pod = Math.max(3, Math.round(h * 0.08));
      R(TUFA, x0, h - pod, bw, pod);
      R(k.wall, x0 + 2, ped + 2, bw - 4, h - pod - ped - 2);
      for (let x = x0 + 4; x < x1 - 4; x += 5) { R(light, x, ped + 4, 2, h - pod - ped - 6); R(shade, x + 2, ped + 4, 1, h - pod - ped - 6); }
      R(dark, x0 + (bw >> 1) - 3, h - pod - 9, 6, 9);
      gable(1, ped + 2, (bw >> 1) - 2);
      R(k.wall, x0 + 1, ped + 1, bw - 2, 2);
      return;
    }
    default: {
      const wallTop = k.kind === 'gable' ? Math.min(14, Math.round(h * 0.42)) : k.kind === 'dome' ? Math.round(Math.min(bw * 0.4, h * 0.5)) : 3;
      const roofH = wallTop;
      R(k.wall, x0, wallTop, bw, h - wallTop);
      R(light, x0, wallTop, 2, h - wallTop); R(shade, x1 - 2, wallTop, 2, h - wallTop);
      const storeys = k.storeys ?? 1, sh = Math.floor((h - wallTop) / storeys);
      for (let s = 0; s < storeys; s++) {
        const y = wallTop + s * sh;
        if (s > 0) R(k.accent ?? shade, x0, y, bw, 1);
        for (let x = x0 + 3; x < x1 - 4; x += 6) R(s === storeys - 1 && Math.abs(x - (x0 + bw / 2)) < 4 ? k.wall : dark, x, y + 3, 2, 3);
      }
      R(dark, x0 + (bw >> 1) - 2, h - 7, 4, 6);
      if (k.kind === 'gable') gable(1, wallTop, Math.round(bw * 0.3));
      else if (k.kind === 'flat') { R(k.roof, x0, wallTop - 3, bw, 3); R(shade, x0, wallTop, bw, 1); }
      else {
        const r = roofH, cx = x0 + bw / 2;
        for (let y = 1; y < r; y++) { const hw = Math.round(Math.sqrt(r * r - (r - y) * (r - y)) * (bw / 2 / r) * 0.9); R(y < 2 ? light : k.roof, cx - hw, wallTop - r + y, hw * 2, 1); }
      }
      if (k.accent && k.kind !== 'flat' && storeys === 1) for (let x = x0 + 1; x < x1 - 1; x += 4) R(x % 8 < 4 ? k.accent : MARBLE, x, wallTop, 4, 2);
      if (k.accent && k.kind === 'flat') R(k.accent, x1 - 6, wallTop - 8, 3, 5);
    }
  }
}

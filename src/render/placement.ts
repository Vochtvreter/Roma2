// src/render/placement.ts — ghost, valid slots, verdict, road/pave drag paths, best-slot laurel (ARCHITECTURE §12.4). Owner: WP-F.
// The view never mutates state: this module only reads (validSlots, bestSlot, snapSlot, canPlace) and draws.
// SCAFFOLD (debug): rectangles instead of sprites; coverage/desirability previews are WP-F's.
import type { GameState, PlaceCheck, Rect } from '../game/types';
import { W, H, idx } from '../game/map';
import { canPlace, snapSlot, validSlots } from '../game/place';
import { bestSlot } from '../game/site';
import { blockOfTile, classAt, sizeOf } from '../game/derived';
import { structEpoch } from '../game/memo';
import type { PlacingState } from './view';
import { TILE } from './camera';

const GOLD_MULT = 1.05;

/** An L-shaped tile path from a to b: horizontal first (or vertical first), inclusive of both ends. */
export function lPath(a: number, b: number, verticalFirst: boolean): number[] {
  const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
  const out: number[] = [];
  const sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
  if (!verticalFirst) {
    for (let x = ax; x !== bx; x += sx) out.push(idx(x, ay));
    for (let y = ay; y !== by; y += sy) out.push(idx(bx, y));
  } else {
    for (let y = ay; y !== by; y += sy) out.push(idx(ax, y));
    for (let x = ax; x !== bx; x += sx) out.push(idx(x, by));
  }
  out.push(b);
  return out;
}

interface Slot { r: Rect; mult: number }

/** Placement-mode state of the view: valid slots, hover verdict, drag path. */
export class Placement {
  state: PlacingState | null = null;
  check: PlaceCheck | null = null;
  hoverTile: number | null = null;
  path: number[] | null = null;
  private slots: Slot[] = [];
  private best: Rect | null = null;
  private epoch = -1;

  /** Enters a placing mode; for buildings computes valid slots and the best slot once. */
  start(p: PlacingState, s: GameState): void {
    this.state = p;
    this.check = null;
    this.hoverTile = null;
    this.path = null;
    this.epoch = -1;
    this.refresh(s);
    if (p.kind === 'building' && p.at !== undefined) this.hover(p.at, s);
  }

  /** Leaves placing mode. */
  cancel(): void {
    this.state = null;
    this.check = null;
    this.hoverTile = null;
    this.path = null;
    this.slots = [];
    this.best = null;
  }

  /** Recomputes the slot glow when the structure changed. */
  refresh(s: GameState): void {
    const p = this.state;
    if (!p || p.kind !== 'building') { this.slots = []; this.best = null; return; }
    const ep = structEpoch(s);
    if (ep === this.epoch) return;
    this.epoch = ep;
    const type = p.type;
    this.slots = [];
    for (const [tile, mult] of validSlots(s, type, 'player')) {
      const x = tile % W, y = Math.floor(tile / W);
      const [w, h] = sizeOf(type, classAt(s, type, x, y));
      this.slots.push({ r: { x, y, w, h }, mult });
    }
    const b = bestSlot(s, type, { owner: 'player' });
    if (b) {
      const [w, h] = sizeOf(type, classAt(s, type, b.x, b.y));
      this.best = { x: b.x, y: b.y, w, h };
    } else this.best = null;
  }

  /** Hover (desktop) or tap (touch) at a tile: snaps and checks a building placement; null for other tools. */
  hover(tile: number | null, s: GameState): PlaceCheck | null {
    this.hoverTile = tile;
    const p = this.state;
    if (!p || p.kind !== 'building' || tile === null) { this.check = null; return null; }
    const snap = snapSlot(s, p.type, tile);
    const at = snap ? idx(snap.x, snap.y) : tile;
    this.check = canPlace(s, p.type, at, { owner: 'player', replaceId: p.replaceId });
    return this.check;
  }

  /** Draws the slot glow, the hover ghost and the drag path (world-px transform applied). */
  draw(g: CanvasRenderingContext2D, s: GameState, vis: Rect, time: number): void {
    const p = this.state;
    if (!p) return;
    g.save();
    if (p.kind === 'building') {
      const pulse = 0.18 + 0.08 * Math.sin(time / 300);
      for (const sl of this.slots) {
        const r = sl.r;
        if (r.x + r.w < vis.x || r.y + r.h < vis.y || r.x > vis.x + vis.w || r.y > vis.y + vis.h) continue;
        const gold = sl.mult >= GOLD_MULT;
        g.fillStyle = gold ? `rgba(242,201,76,${pulse + 0.1})` : `rgba(244,234,214,${pulse})`;
        g.fillRect(r.x * TILE + 1, r.y * TILE + 1, r.w * TILE - 2, r.h * TILE - 2);
        g.strokeStyle = gold ? 'rgba(242,201,76,.9)' : 'rgba(244,234,214,.55)';
        g.lineWidth = 1;
        g.strokeRect(r.x * TILE + 1.5, r.y * TILE + 1.5, r.w * TILE - 3, r.h * TILE - 3);
      }
      if (this.best) {
        const cx = (this.best.x + this.best.w / 2) * TILE, cy = this.best.y * TILE + 4;
        g.fillStyle = '#f2c94c';
        g.beginPath();
        g.moveTo(cx, cy - 4); g.lineTo(cx + 4, cy); g.lineTo(cx, cy + 4); g.lineTo(cx - 4, cy);
        g.closePath();
        g.fill();
      }
      this.drawGhost(g, s, p.type);
    } else if (p.kind === 'reserve' && this.hoverTile !== null) {
      const blk = blockOfTile(s, this.hoverTile);
      if (blk) {
        g.strokeStyle = '#f0a04b';
        g.lineWidth = 2;
        g.strokeRect(blk.x * TILE + 1, blk.y * TILE + 1, 4 * TILE - 2, 4 * TILE - 2);
      }
    } else if ((p.kind === 'road' || p.kind === 'pave') && this.path) {
      g.fillStyle = p.kind === 'road' ? 'rgba(155,122,82,.75)' : 'rgba(92,93,102,.8)';
      g.strokeStyle = '#f4ead6';
      g.lineWidth = 1;
      for (const t of this.path) {
        const x = (t % W) * TILE, y = Math.floor(t / W) * TILE;
        g.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        g.strokeRect(x + 2.5, y + 2.5, TILE - 5, TILE - 5);
      }
    } else if (this.hoverTile !== null) {
      const x = (this.hoverTile % W) * TILE, y = Math.floor(this.hoverTile / W) * TILE;
      g.strokeStyle = p.kind === 'demolish' ? '#e5554a' : '#f4ead6';
      g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    }
    g.restore();
  }

  private drawGhost(g: CanvasRenderingContext2D, s: GameState, type: Parameters<typeof sizeOf>[0]): void {
    const t = this.hoverTile;
    if (t === null) return;
    const c = this.check;
    const ox = c && c.ok ? c.x : t % W, oy = c && c.ok ? c.y : Math.floor(t / W);
    if (ox < 0 || oy < 0 || ox >= W || oy >= H) return;
    const [w, h] = sizeOf(type, classAt(s, type, ox, oy));
    const ok = !!c && c.ok;
    g.globalAlpha = 0.6;
    g.fillStyle = ok ? '#9ccc5a' : '#e5554a';
    g.fillRect(ox * TILE, oy * TILE, w * TILE, h * TILE);
    g.globalAlpha = 1;
    g.strokeStyle = ok ? '#f4ead6' : '#e5554a';
    g.lineWidth = 1;
    g.strokeRect(ox * TILE + 0.5, oy * TILE + 0.5, w * TILE - 1, h * TILE - 1);
    g.font = '8px monospace';
    g.textBaseline = 'bottom';
    if (c && c.ok && c.mult >= GOLD_MULT) {
      g.fillStyle = '#f2c94c';
      g.fillText(`+${Math.round((c.mult - 1) * 100)}%`, ox * TILE, oy * TILE - 1);
    } else if (!ok) {
      g.fillStyle = '#e5554a';
      g.fillText('✕', ox * TILE + 2, oy * TILE - 1);
    }
  }
}

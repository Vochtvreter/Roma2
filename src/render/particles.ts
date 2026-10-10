// src/render/particles.ts — particles, floating text and the FxEvent → burst mapping (ARCHITECTURE §12.6). Owner: WP-F.
// Cosmetic only: Math.random is allowed here (ARCHITECTURE §10.2). Capped at 600 (300 on coarse pointers).
// SCAFFOLD: square particles for built / taxes / milestone / evolved / fire; the full table is WP-F's.
import type { FxEvent, GameState, Rect } from '../game/types';
import { getMap } from '../game/map';
import { getBuilding } from '../game/state';
import { TIER_DEFS } from '../game/data/housing';
import { TILE } from './camera';
import { footprintRect } from './buildings';

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; text?: string }

const GOLD = '#f2c94c';
const DUST = '#c9b48a';
const GREY = '#9a968a';
const SMOKE = '#55565e';

/** A small particle system in world px. */
export class Particles {
  private list: P[] = [];
  private readonly cap: number;

  constructor() {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.cap = coarse ? 300 : 600;
  }

  /** Removes every particle. */
  clear(): void {
    this.list.length = 0;
  }

  /** Spawns n particles around (x, y) in world px. */
  burst(x: number, y: number, n: number, color: string, opts?: { spread?: number; up?: number; life?: number; size?: number }): void {
    const spread = opts?.spread ?? 8, up = opts?.up ?? 20, life = opts?.life ?? 900, size = opts?.size ?? 2;
    for (let k = 0; k < n && this.list.length < this.cap; k++)
      this.list.push({
        x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 30, vy: -up * (0.5 + Math.random()), life, max: life, color, size,
      });
  }

  /** A floating line of text rising from (x, y). */
  text(x: number, y: number, text: string, color = GOLD): void {
    if (this.list.length >= this.cap) return;
    this.list.push({ x, y, vx: 0, vy: -12, life: 1800, max: 1800, color, size: 0, text });
  }

  /** Maps FxEvents to bursts (§12.6). `flash` marks a footprint on the view. */
  handleFx(events: FxEvent[], s: GameState, flash: (r: Rect) => void): void {
    const forum = getMap(s.seed).survey.forum;
    const fx = (forum.x + forum.w / 2) * TILE, fy = (forum.y + forum.h / 2) * TILE;
    const at = (id: number): { r: Rect; x: number; y: number } | null => {
      const b = getBuilding(s, id);
      if (!b) return null;
      const r = footprintRect(s, b);
      return { r, x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE };
    };
    for (const e of events) {
      switch (e.kind) {
        case 'built': { const p = at(e.id); if (p) { this.burst(p.x, p.y, 10, DUST, { spread: p.r.w * TILE }); this.burst(p.x, p.y, 6, GOLD); flash(p.r); } break; }
        case 'evolved': { const p = at(e.id); if (p) this.text(p.x, p.y - 8, `+${TIER_DEFS[e.tier].name}`); break; }
        case 'declined': { const p = at(e.id); if (p) this.burst(p.x, p.y, 8, GREY); break; }
        case 'fire': { const p = at(e.id); if (p) this.burst(p.x, p.y, 30, SMOKE, { up: 30, life: 2500, size: 3 }); break; }
        case 'stage': { const p = at(e.id); if (p) { this.burst(p.x, p.y, 30, DUST, { spread: p.r.w * TILE }); flash(p.r); } break; }
        case 'taxes': case 'caravanIn': this.burst(fx, fy, 14, GOLD, { up: 30 }); break;
        case 'milestone': this.burst(fx, fy, 20, GOLD, { spread: 40 }); break;
        case 'victory': this.burst(fx, fy - 40, 80, GOLD, { spread: 120, up: 40, life: 2500 }); break;
        default: break;
      }
    }
  }

  /** Advances every particle by dtMs. */
  update(dtMs: number): void {
    const dt = dtMs / 1000;
    let w = 0;
    for (const p of this.list) {
      p.life -= dtMs;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!p.text) p.vy += 25 * dt;
      this.list[w++] = p;
    }
    this.list.length = w;
  }

  /** Draws the particles (world-px transform applied). */
  draw(g: CanvasRenderingContext2D): void {
    if (!this.list.length) return;
    g.save();
    g.font = '8px monospace';
    g.textAlign = 'center';
    for (const p of this.list) {
      g.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      g.fillStyle = p.color;
      if (p.text) g.fillText(p.text, p.x, p.y);
      else g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.restore();
  }
}

// src/render/particles.ts — particles, floating text and the FxEvent → burst mapping (ARCHITECTURE §12.6). Owner: WP-F.
// Cosmetic only: Math.random is allowed here (ARCHITECTURE §10.2). Capped at 600 (300 on coarse pointers). Ambient
// emitters read the buildings drawn this frame: kiln/bloomery/forge smoke, bath steam, temple incense, fountain
// sparkle, winter chimneys, construction dust while work is applied, and burning buildings (10 s after a fire fx).
// The paths thicken them (DESIGN §9.2): Ars fabrilis smoke plumes, Pietas incense, Aquae salutares steam and sparkle.
import type { FxEvent, GameState, Rect, SeasonIndex } from '../game/types';
import { getMap } from '../game/map';
import { getBuilding } from '../game/state';
import { census } from '../game/census';
import { TIER_DEFS } from '../game/data/housing';
import { sprite } from './sprites';
import { TILE } from './camera';
import type { Drawn } from './buildings';
import { footprintRect } from './buildings';
import { looks } from './decor';
import { labelSize } from './placement';

type Kind = 'dust' | 'star' | 'coin' | 'smoke' | 'steam' | 'spark' | 'flame' | 'petal' | 'sparkle' | 'wisp' | 'text' | 'icon' | 'pennant' | 'peg';
interface P { k: Kind; x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; size: number; color?: string; text?: string }

const FIRE_MS = 10_000;
const SITE_PUFF_MS = 2000;
const R = Math.random;
/** Ambient emitters per building type: kind, rate per second, where (fraction of the sprite box), needs staff. */
const EMIT: Partial<Record<string, { k: Kind; rate: number; fx: number; fy: number; staffed: boolean }>> = {
  figlina: { k: 'smoke', rate: 2, fx: 0.7, fy: 0.1, staffed: true }, officina: { k: 'smoke', rate: 2.2, fx: 0.75, fy: 0.05, staffed: true },
  fabrica: { k: 'smoke', rate: 1.5, fx: 0.72, fy: 0.08, staffed: true }, caementarium: { k: 'dust', rate: 1.2, fx: 0.5, fy: 0.6, staffed: true },
  balneum: { k: 'steam', rate: 3, fx: 0.5, fy: 0.12, staffed: true }, thermae: { k: 'steam', rate: 5, fx: 0.5, fy: 0.08, staffed: true },
  templum: { k: 'smoke', rate: 0.8, fx: 0.5, fy: 0.45, staffed: true }, lararium: { k: 'smoke', rate: 0.4, fx: 0.5, fy: 0.4, staffed: true },
  lacus: { k: 'sparkle', rate: 3, fx: 0.5, fy: 0.55, staffed: false }, castellum: { k: 'sparkle', rate: 1.5, fx: 0.5, fy: 0.5, staffed: false },
};
/** Which path multiplier an emitter follows. */
const PATH_EMIT: Partial<Record<string, 'smoke' | 'incense' | 'baths'>> = {
  figlina: 'smoke', officina: 'smoke', fabrica: 'smoke', templum: 'incense', lararium: 'incense',
  balneum: 'baths', thermae: 'baths', lacus: 'baths', castellum: 'baths',
};
const INCENSE = '#dcd4ec';

/** A small particle system in world px. */
export class Particles {
  private list: P[] = [];
  private readonly cap: number;
  private fires = new Map<number, number>();                       // building id → real-time ms when the flames die
  private sites = new Map<number, { p: number; t: number; puff: number }>();
  private now = 0;

  constructor() {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.cap = coarse ? 300 : 600;
  }

  /** True while any particle is in flight (the view keeps drawing until the last one fades, paused or not). */
  get busy(): boolean {
    return this.list.length > 0;
  }

  /** Removes every particle and emitter. */
  clear(): void {
    this.list.length = 0;
    this.fires.clear();
    this.sites.clear();
  }

  private add(k: Kind, x: number, y: number, vx: number, vy: number, life: number, size = 1, color?: string, g = 0, text?: string): void {
    if (this.list.length >= this.cap) return;
    this.list.push({ k, x, y, vx, vy, g, life, max: life, size, color, text });
  }

  /** A burst of n particles around (x, y) spread over ±spread px. */
  burst(k: Kind, x: number, y: number, n: number, spread = 8, speed = 20, life = 900, g = 0, color?: string): void {
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, v = speed * (0.4 + R() * 0.6);
      this.add(k, x + (R() - 0.5) * spread, y + (R() - 0.5) * spread * 0.4, Math.cos(a) * v, Math.sin(a) * v - speed * 0.5, life * (0.7 + R() * 0.5), 1 + R(), color, g);
    }
  }

  /** A floating line of text rising from (x, y). */
  text(x: number, y: number, text: string, color = '#f2c94c'): void {
    this.add('text', x, y, 0, -9, 2200, 1, color, 0, text);
  }

  /** Maps FxEvents to bursts (§12.6); `flash` marks a footprint on the view. */
  handleFx(events: FxEvent[], s: GameState, flash: (r: Rect) => void): void {
    const f = getMap(s.seed).survey.forum;
    const fx = (f.x + f.w / 2) * TILE, fy = (f.y + f.h / 2) * TILE;
    const at = (id: number | null): { r: Rect; x: number; y: number; top: number; bottom: number } | null => {
      const b = id === null ? undefined : getBuilding(s, id);
      if (!b) return null;
      const r = footprintRect(s, b);
      return { r, x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE, top: r.y * TILE - 6, bottom: (r.y + r.h) * TILE };
    };
    const coins = (x: number, y: number, n: number): void => {
      for (let i = 0; i < n; i++) this.add('coin', x + (R() - 0.5) * 40, y + (R() - 0.5) * 16, (R() - 0.5) * 8, -20 - R() * 22, 1500 + R() * 700, 1, undefined, 9);
    };
    for (const e of events) {
      switch (e.kind) {
        case 'built': {
          const p = at(e.id);
          if (!p) break;
          for (let i = 0; i < 10 * p.r.w; i++) this.add('dust', p.r.x * TILE + R() * p.r.w * TILE, p.bottom - 1, (R() - 0.5) * 22, -R() * 12, 700 + R() * 500, 1 + R() * 1.5);
          this.burst('star', p.x, p.top, 6, 6, 30, 900);
          this.add('pennant', p.x, p.top, 0, 0, 3000);
          flash(p.r);
          break;
        }
        case 'evolved': {
          const p = at(e.id);
          if (!p) break;
          this.add('icon', p.x - 16, p.bottom - 32, 0, 0, 700, 1, undefined, 0, 'ov_scaffold');
          this.burst('sparkle', p.x, p.top + 6, 10, 18, 14, 1100);
          this.text(p.x, p.top - 4, `+${TIER_DEFS[e.tier].latin}`);
          break;
        }
        case 'declined': { const p = at(e.id); if (p) this.burst('dust', p.x, p.bottom - 6, 10, 20, 10, 900, 0, '#9a968a'); break; }
        case 'birth': { const p = at(e.home); if (p) this.burst('sparkle', p.x, p.top, 5, 6, 10, 900); break; }
        case 'death': { const p = at(e.home); if (p) this.add('wisp', p.x, p.top, 0, -8, 2200); break; }
        case 'caravanIn': coins(fx, fy, Math.min(20, 6 + Math.round(e.denarii / 40))); break;
        case 'taxes': coins(fx, fy, Math.min(30, 8 + Math.round(e.amount / 10))); break;
        case 'milestone': this.burst('sparkle', fx, fy - 30, 24, 60, 20, 1600); this.burst('star', fx, fy - 30, 8, 20, 30, 1100); break;
        case 'fire': this.fires.set(e.id, this.now + FIRE_MS); break;
        case 'stage': { const p = at(e.id); if (p) { this.burst('dust', p.x, p.bottom - 8, 40, p.r.w * TILE, 26, 1300, 8); flash(p.r); } break; }
        case 'ordoPlaced': {
          const p = at(e.id);
          if (!p) break;
          for (const [x, y] of [[p.r.x, p.r.y], [p.r.x + p.r.w, p.r.y], [p.r.x, p.r.y + p.r.h], [p.r.x + p.r.w, p.r.y + p.r.h]])
            this.add('peg', x * TILE, y * TILE, (R() - 0.5) * 10, -40, 900, 1, undefined, 140);
          this.add('icon', p.x - 6, p.top - 14, 0, -4, 1600, 1, undefined, 0, 'i_seal');
          break;
        }
        case 'victory': {
          const cap = getMap(s.seed).survey.capitolium, cx = (cap.x + cap.w / 2) * TILE, cy = cap.y * TILE - 30;
          for (let k = 0; k < 4; k++) this.burst('star', cx + (k - 1.5) * 40, cy, 20, 30, 50, 1600);
          for (let k = 0; k < 60; k++) this.add('petal', cx + (R() - 0.5) * 220, cy - 60 - R() * 80, (R() - 0.5) * 10, 10 + R() * 12, 5000 + R() * 2000, 1, R() < 0.5 ? '#ef8fb5' : '#c43d2f');
          break;
        }
        default: break;
      }
    }
  }

  /** Ambient emission from the buildings drawn this frame (none while paused). */
  ambient(dtMs: number, s: GameState, drawn: readonly Drawn[], season: SeasonIndex, running: boolean): void {
    this.now += dtMs;
    if (!running) return;
    const dt = dtMs / 1000, c = census(s), L = looks(s);
    for (const d of drawn) {
      const b = d.b;
      if (b.status === 'building') {
        const st = this.sites.get(b.id) ?? { p: b.progress, t: -1e9, puff: 0 };
        if (b.progress > st.p) { st.p = b.progress; st.t = this.now; }
        if (this.now - st.t < SITE_PUFF_MS * 1.5 && this.now - st.puff > SITE_PUFF_MS) {
          st.puff = this.now;
          this.burst('dust', d.sx + d.sw / 2, d.y + d.h - 2, 6, d.sw * 0.8, 12, 800);
        }
        this.sites.set(b.id, st);
        continue;
      }
      if (b.status !== 'done') continue;
      const fire = this.fires.get(b.id);
      if (fire !== undefined) {
        if (fire < this.now) this.fires.delete(b.id);
        else if (R() < dt * 14) {
          const x = d.x + R() * d.w, y = d.y + d.h * (0.3 + R() * 0.5);
          this.add('flame', x, y, (R() - 0.5) * 4, -14 - R() * 10, 500 + R() * 300, 1, R() < 0.5 ? '#f7d55c' : '#e06c2e');
          if (R() < 0.4) this.add('smoke', x, y - 6, 3 + R() * 3, -16, 2400, 2, '#3a3b47');
        }
      }
      const em = EMIT[b.type] ?? (b.house && season === 3 && b.house.tier !== 'tentoria' ? { k: 'smoke' as Kind, rate: 0.3, fx: 0.7, fy: 0.12, staffed: false } : null);
      const path = PATH_EMIT[b.type], mult = path ? L[path] : 1;
      if (!em || (em.staffed && !(c.staffed[b.id] > 0)) || R() >= dt * em.rate * mult) continue;
      const x = d.sx + d.sw * em.fx + (R() - 0.5) * 3, y = d.sy + d.h * em.fy;
      if (em.k === 'sparkle') this.add('sparkle', d.sx + d.sw * (0.25 + R() * 0.5), y + (R() - 0.5) * 6, 0, -3, 700);
      else if (em.k === 'dust') this.add('dust', x + (R() - 0.5) * d.sw * 0.6, y, (R() - 0.5) * 6, -6, 900, 1.5);
      else if (path === 'incense' && mult > 1) this.add('smoke', x, y, 1 + R() * 2, -7, 3000, 1.5, INCENSE);
      else this.add(em.k, x, y, 2 + R() * 3, em.k === 'steam' ? -12 : -9, (em.k === 'steam' ? 1600 : 2600) * (path === 'smoke' ? mult : 1),
        (em.k === 'steam' ? 2 : 1.5) * (path === 'smoke' ? mult : 1));
    }
  }

  /** Advances every particle by dtMs. */
  update(dtMs: number): void {
    const dt = dtMs / 1000;
    let w = 0;
    for (const p of this.list) {
      if ((p.life -= dtMs) <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      if (p.k === 'smoke' || p.k === 'steam') { p.size += dt * 1.6; p.vx += (R() - 0.3) * dt * 4; }
      else if (p.k === 'petal') p.vx = Math.sin(p.life / 300 + p.y) * 12;
      else if (p.k === 'dust') { p.vx *= 1 - dt * 2; p.vy *= 1 - dt * 2; }
      this.list[w++] = p;
    }
    this.list.length = w;
  }

  /** Draws the particles inside a world-px rectangle (world-px transform applied). */
  draw(g: CanvasRenderingContext2D, view: Rect): void {
    if (!this.list.length) return;
    g.save();
    const px = labelSize(g), plate = px + 2;   // the floating words: the map labels' size (12 CSS px or more)
    g.font = `${px}px Silkscreen, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of this.list) {
      if (p.x < view.x - 40 || p.y < view.y - 40 || p.x > view.x + view.w + 40 || p.y > view.y + view.h + 40) continue;
      const a = Math.max(0, Math.min(1, p.life / p.max)), x = Math.round(p.x), y = Math.round(p.y), s = Math.max(1, Math.round(p.size));
      g.globalAlpha = 1;
      switch (p.k) {
        case 'dust': g.fillStyle = p.color ?? '#d6be96'; g.globalAlpha = 0.65 * a; g.fillRect(x, y, s, s); break;
        case 'smoke': case 'steam': {
          g.fillStyle = p.color ?? (p.k === 'steam' ? '#f4f2ee' : '#bdb6ad');
          g.globalAlpha = (p.k === 'steam' ? 0.45 : 0.4) * a * Math.min(1, (p.max - p.life) / 200);
          const z = Math.round(p.size * 1.5);
          g.fillRect(x - (z >> 1), y - (z >> 1), z, z);
          break;
        }
        case 'star': g.fillStyle = '#ffe48c'; g.globalAlpha = a; g.fillRect(x, y, 1, 1); if (a > 0.5) { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); } break;
        case 'sparkle': g.fillStyle = (p.max - p.life) % 300 < 150 ? '#ffffff' : '#f2c94c'; g.globalAlpha = a; g.fillRect(x, y, 1, 1); break;
        case 'coin': {
          const wide = Math.abs(Math.sin(p.life / 90)) > 0.4;
          g.globalAlpha = Math.min(1, a * 2);
          g.fillStyle = '#7a5a1c'; g.fillRect(x - (wide ? 1 : 0), y - 1, wide ? 3 : 1, 3);
          g.fillStyle = '#f2c94c'; g.fillRect(x - (wide ? 1 : 0), y - 1, wide ? 2 : 1, 2);
          break;
        }
        case 'flame': case 'spark': g.fillStyle = p.color ?? '#f7d55c'; g.globalAlpha = a; g.fillRect(x, y, 1, a > 0.5 ? 2 : 1); break;
        case 'petal': g.fillStyle = p.color ?? '#ef8fb5'; g.globalAlpha = Math.min(1, a * 3); g.fillRect(x, y, 2, 1); break;
        case 'wisp': { const wb = Math.round(Math.sin(p.life / 160)); g.fillStyle = '#dce6ff'; g.globalAlpha = 0.7 * a; g.fillRect(x - 1 + wb, y - 2, 3, 3); g.fillRect(x + wb, y + 1, 1, 2); break; }
        case 'peg': g.fillStyle = '#86532e'; g.fillRect(x, y - 4, 2, 4); g.fillStyle = '#efcf95'; g.fillRect(x, y - 4, 2, 1); break;
        case 'icon': g.globalAlpha = Math.min(1, a * 1.5); g.drawImage(sprite(p.text ?? 'i_star'), x, y); break;
        case 'pennant': {
          const wave = Math.round(Math.sin(p.life / 90));
          g.globalAlpha = Math.min(1, a * 4);
          g.fillStyle = '#1d1410'; g.fillRect(x, y - 12, 1, 12);
          g.fillStyle = '#9e2f25'; g.fillRect(x + 1, y - 12, 6, 3 + wave); g.fillStyle = '#f2c94c'; g.fillRect(x + 1, y - 10, 6, 1);
          break;
        }
        case 'text': {
          const t = p.text ?? '', w = Math.ceil(g.measureText(t).width) + Math.round(px * 0.75);
          g.globalAlpha = Math.min(1, a * 2);
          g.fillStyle = 'rgba(14,11,22,0.85)'; g.fillRect(Math.round(x - w / 2), y - plate / 2, w, plate);
          g.fillStyle = p.color ?? '#f2c94c'; g.fillText(t, x, y + 0.5);
          break;
        }
      }
    }
    g.restore();
  }
}

// src/render/convoys.ts — convoys along the via and the roads, the merchant's wagon, veterans' tents and animals
// (ARCHITECTURE §12.6). Owner: WP-F. Visual only.
// arrive → an ox-cart and the family walk in from the map edge to their home · leave → walkers out along the via ·
// caravanOut/In → a mule train between the Porta Praetoria and the edge · rank → a legionary column marches to the forum
// and a plough ox traces the new ring's line · a merchant's wagon drives in and parks by the gate while he stays ·
// veterans waiting at the gate camp in tents beside the via · birds cross the sky, fish leap, sheep graze.
import { T } from '../game/types';
import type { FxEvent, GameState, Rect } from '../game/types';
import { H, W, getMap } from '../game/map';
import { getBuilding } from '../game/state';
import { derived } from '../game/derived';
import { hash2 } from '../game/rng';
import { seasonOf } from '../game/calendar';
import { mirror, sprite, tinted } from './sprites';
import type { Push } from './camera';
import { TILE } from './camera';
import type { Roads } from './actors';
import { looks } from './decor';

interface Member { base: string; tint?: Record<string, string> }       // base 'a_oxcart' → a_oxcart_0/1; 'a_person' → walk frames
interface Convoy { pts: number[]; cum: number[]; t: number; speed: number; gap: number; members: Member[]; park: boolean; tag: string }
interface Bird { x: number; y: number; vx: number; life: number; phase: number }

const TUNICS = ['#d9a35b', '#8a6b4a', '#bba58b', '#9e2f25', '#62b0d6'];
const SPEED = { cart: 20, walk: 22, mules: 26, legion: 26, plough: 110, wagon: 22 } as const;
const BIRD_GAP = [12_000, 30_000] as const;
const FISH_GAP = 3500;

/** Polyline of tile centres in world px. */
function polyline(tiles: readonly number[]): number[] {
  const out: number[] = [];
  for (const t of tiles) out.push((t % W) * TILE + 8, Math.floor(t / W) * TILE + 11);
  return out;
}

/** Convoys, the merchant's wagon, veterans' tents and animals. */
export class Convoys {
  private list: Convoy[] = [];
  private birds: Bird[] = [];
  private birdT = 8000;
  private fish: { x: number; y: number; t: number } | null = null;
  private fishT = FISH_GAP;
  private merchant = false;
  private t = 0;

  constructor(private readonly roads: Roads) {}

  /** Drops everything (new or loaded game). */
  reset(): void {
    this.list = [];
    this.birds = [];
    this.merchant = false;
  }

  private add(tiles: number[] | null, members: Member[], speed: number, gap: number, tag = '', park = false): void {
    if (!tiles || tiles.length < 2) return;
    const pts = polyline(tiles), cum = [0];
    for (let k = 2; k < pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
    this.list.push({ pts, cum, t: 0, speed, gap, members, park, tag });
  }

  /** A caravan's mule train: two strings, three when the colony was founded as an emporium (DESIGN §9.2). */
  private mules(s: GameState): Member[] {
    return Array.from({ length: looks(s).mules ? 3 : 2 }, () => ({ base: 'a_mules' }));
  }

  private people(n: number, seed: number): Member[] {
    return Array.from({ length: n }, (_, k) => ({ base: 'a_person', tint: { S: TUNICS[(seed + k) % TUNICS.length], A: '#5d3b2a', U: '#6f5639' } }));
  }

  /** Spawns convoys for arrive / leave / caravan / rank events. */
  handleFx(events: FxEvent[], s: GameState): void {
    const sv = getMap(s.seed).survey;
    if (!sv.via.length) return;
    const edge = sv.via[sv.via.length - 1];
    const forum = derived(s).stepsToForum.indexOf(0);
    for (const e of events) {
      switch (e.kind) {
        case 'arrive': {
          const home = e.home === null ? undefined : getBuilding(s, e.home);
          const to = home ? this.roads.door(s, home) : forum;
          this.add(this.roads.path(edge, to), [{ base: 'a_oxcart' }, ...this.people(Math.min(4, e.n), e.family)], SPEED.cart, 14);
          break;
        }
        case 'leave': this.add(this.roads.path(forum, edge), this.people(Math.min(5, e.n), e.n), SPEED.walk, 9); break;
        case 'caravanOut': this.add([...sv.via], this.mules(s), SPEED.mules, 22); break;
        case 'caravanIn': this.add([...sv.via].reverse(), this.mules(s), SPEED.mules, 22); break;
        case 'rank': {
          this.add(this.roads.path(edge, forum), Array.from({ length: 8 }, () => ({ base: 'a_legionary' })), SPEED.legion, 9);
          if (e.rank === 1 || e.rank === 2) this.add(ringLine(s, e.rank), [{ base: 'a_ox' }], SPEED.plough, 0);
          break;
        }
        default: break;
      }
    }
  }

  /** Advances convoys and animals (sp = clamped game speed; 0 while paused). */
  update(dtMs: number, s: GameState, sp: number, vis: Rect): void {
    const sv = getMap(s.seed).survey;
    const here = !!s.trade.merchant;
    if (here !== this.merchant && sv.via.length > 3) {
      this.merchant = here;
      this.list = this.list.filter((c) => c.tag !== 'merchant');
      if (here) this.add([...sv.via].reverse().slice(0, sv.via.length - 2), [{ base: 'a_wagon' }], SPEED.wagon, 0, 'merchant', true);
      else this.add(sv.via.slice(2), [{ base: 'a_wagon' }], SPEED.wagon, 0);
    }
    if (!sp) return;
    const dt = dtMs / 1000;
    this.t += dt * sp;
    for (const c of this.list) c.t = Math.min(c.t + c.speed * sp * dt, c.park ? c.cum[c.cum.length - 1] : Infinity);
    this.list = this.list.filter((c) => c.park || c.t - (c.members.length - 1) * c.gap < c.cum[c.cum.length - 1] + 8);
    for (const b of this.birds) { b.x += b.vx * dt; b.life -= dt; b.phase += dt; }
    this.birds = this.birds.filter((b) => b.life > 0);
    if ((this.birdT -= dtMs) <= 0) {
      this.birdT = BIRD_GAP[0] + Math.random() * (BIRD_GAP[1] - BIRD_GAP[0]);
      if (seasonOf(s.day) !== 3) {
        const left = Math.random() < 0.5, n = 3 + Math.floor(Math.random() * 4), y = (vis.y + Math.random() * vis.h) * TILE;
        const x0 = left ? vis.x * TILE - 20 : (vis.x + vis.w) * TILE + 20, life = (vis.w * TILE + 80) / 38;
        for (let k = 0; k < n; k++) this.birds.push({ x: x0 + (left ? -k : k) * 9, y: y + ((k % 2) * 2 - 1) * k * 3, vx: left ? 38 : -38, life, phase: Math.random() * 3 });
      }
    }
    if (this.fish && (this.fish.t += dt) > 0.9) this.fish = null;
    if ((this.fishT -= dtMs) <= 0) {
      this.fishT = FISH_GAP * (0.5 + Math.random());
      const map = getMap(s.seed);
      for (let k = 0; k < 12 && !this.fish; k++) {
        const x = vis.x + Math.floor(Math.random() * vis.w), y = vis.y + Math.floor(Math.random() * vis.h);
        if (x < W && y < H && map.terrain[y * W + x] === T.river && !sv.bridge.includes(y * W + x)) this.fish = { x: x * TILE + 6, y: y * TILE + 10, t: 0 };
      }
    }
  }

  /** Pushes convoys, tents, sheep and the leaping fish onto the draw list. */
  items(s: GameState, vis: Rect, push: Push): void {
    const x0 = vis.x * TILE, y0 = vis.y * TILE, x1 = (vis.x + vis.w) * TILE, y1 = (vis.y + vis.h) * TILE;
    const frame = Math.floor(this.t * 4) % 2;
    for (const c of this.list) {
      const len = c.cum[c.cum.length - 1];
      c.members.forEach((m, k) => {
        const d = c.t - k * c.gap;
        if (d < 0 || d > len + 4) return;
        const p = at(c, Math.min(d, len));
        if (p.x < x0 - 30 || p.y < y0 - 30 || p.x > x1 + 30 || p.y > y1 + 30) return;
        const moving = !(c.park && d >= len);
        let spr = m.tint ? tinted(`a_person_${moving ? (frame ? 'walk0' : 'walk1') : 'idle'}`, m.tint) : sprite(`${m.base}_${moving ? frame : 0}`);
        if (p.dx < 0) spr = mirror(spr);
        const fade = Math.max(0, Math.min(1, (len + 4 - d) / 12, d / 10));
        push(p.y, p.x, (g) => {
          g.globalAlpha = c.park ? 1 : fade;
          g.fillStyle = 'rgba(16,10,6,0.28)';
          g.fillRect(Math.round(p.x) - (spr.width >> 2), Math.round(p.y) - 1, spr.width >> 1, 2);
          g.drawImage(spr, Math.round(p.x) - (spr.width >> 1), Math.round(p.y) - spr.height);
          g.globalAlpha = 1;
        });
      });
    }
    if (this.fish) {
      const f = this.fish, arc = Math.sin((f.t / 0.9) * Math.PI) * 6, fx = f.x + Math.round(f.t * 7), fy = f.y - Math.round(arc);
      push(f.y, f.x, (g) => {
        g.drawImage(sprite('a_fish'), fx, fy);
        if (f.t < 0.12 || f.t > 0.78) { g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(fx - 1, f.y + 3, 4, 1); }
      });
    }
    const sv = getMap(s.seed).survey;
    if (s.gate) {
      const n = Math.min(6, s.gate.families.length), tent = sprite('a_vettent');
      for (let k = 0; k < n && k + 1 < sv.via.length; k++) {
        const t = sv.via[k + 1], X = (t % W) * TILE + 8, Y = Math.floor(t / W) * TILE + (k % 2 ? 30 : -4);
        push(Y, X, (g) => g.drawImage(tent, X - (tent.width >> 1), Y - tent.height));
      }
    }
    for (const b of s.buildings) {
      if (b.type !== 'pabulatio' || b.status !== 'done' || b.x < vis.x - 2 || b.y < vis.y - 2 || b.x > vis.x + vis.w || b.y > vis.y + vis.h) continue;
      for (let k = 0; k < 3; k++) {
        const ph = this.t * 0.25 + hash2(b.id, k) * 6, X = b.x * TILE + 8 + k * 7 + Math.round(Math.sin(ph) * 5), Y = (b.y + 2) * TILE + 6 + ((k * 5) % 9);
        const spr = Math.cos(ph) < 0 ? mirror(sprite('a_sheep')) : sprite('a_sheep');
        push(Y, X, (g) => g.drawImage(spr, X - (spr.width >> 1), Y - spr.height));
      }
    }
  }

  /** Birds, drawn above everything with their shadows far below. */
  sky(g: CanvasRenderingContext2D, vis: Rect): void {
    void vis;
    for (const b of this.birds) {
      const spr = sprite(`a_bird_${Math.floor(b.phase * 5) % 2}`), x = Math.round(b.x), y = Math.round(b.y);
      g.fillStyle = 'rgba(16,10,6,0.15)';
      g.fillRect(x + 1, y + 26, 3, 1);
      g.drawImage(b.vx < 0 ? mirror(spr) : spr, x, y);
    }
  }
}

/** Position and heading at distance d along a convoy's polyline. */
function at(c: Convoy, d: number): { x: number; y: number; dx: number } {
  let k = 1;
  while (k < c.cum.length - 1 && c.cum[k] < d) k++;
  const a = c.cum[k - 1], b = c.cum[k] ?? a, u = b > a ? (d - a) / (b - a) : 0;
  const x0 = c.pts[(k - 1) * 2], y0 = c.pts[(k - 1) * 2 + 1], x1 = c.pts[k * 2] ?? x0, y1 = c.pts[k * 2 + 1] ?? y0;
  return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, dx: x1 - x0 };
}

/** The street line around the new ring (ring 1 at Vicus, ring 2 at Oppidum), clockwise, as tiles on the map. */
function ringLine(s: GameState, ring: number): number[] {
  const sv = getMap(s.seed).survey, o = 5 * (ring + 1);
  const x0 = Math.max(0, sv.ix - o), x1 = Math.min(W - 1, sv.ix + 30 + o), y0 = Math.max(0, sv.iy - o), y1 = Math.min(H - 1, sv.iy + 20 + o);
  const out: number[] = [];
  for (let x = x0; x <= x1; x++) out.push(y0 * W + x);
  for (let y = y0 + 1; y <= y1; y++) out.push(y * W + x1);
  for (let x = x1 - 1; x >= x0; x--) out.push(y1 * W + x);
  for (let y = y1 - 1; y >= y0; y--) out.push(y * W + x0);
  return out;
}

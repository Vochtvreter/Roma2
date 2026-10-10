// src/render/actors.ts — visual-only walkers on the road graph (ARCHITECTURE §12.6). Owner: WP-F.
// min(220, pop / 4) people (120 on touch), sampled with hash2(personId, month bucket) so a reload looks the same, walk
// home ↔ work along the roads (BFS on the built road tiles, cached per structure epoch), go inside, work outdoors on
// fields and quarries, build on sites, and carry their goods home. Tunic colour = labour category of the job;
// patricians wear white togas; children and elders by stage. They never touch the sim. Convoys and animals: convoys.ts.
import { BUILDER } from '../game/types';
import type { Building, FxEvent, GameState, LaborCat, Rect, ResId } from '../game/types';
import { H, W, idx } from '../game/map';
import { hash2 } from '../game/rng';
import { derived, roadNeighbors } from '../game/derived';
import { structEpoch } from '../game/memo';
import { stageOf, isPatrician } from '../game/census';
import { getBuilding } from '../game/state';
import { BUILDING_DEFS } from '../game/data/buildings';
import { mirror, tinted } from './sprites';
import type { Push } from './camera';
import { TILE } from './camera';
import { Convoys } from './convoys';

/** Tunic colour by labour category of the job (ARCHITECTURE §12.6). */
export const TUNIC: Readonly<Record<LaborCat | 'none', string>> = {
  water: '#62b0d6', food: '#d9a35b', materials: '#8a6b4a', industry: '#55565e', services: '#9e2f25', builders: '#c0623f', none: '#bba58b',
};
/** Colour of the goods a worker carries home, by the job's output. */
const GOODS: Partial<Record<ResId, string>> = {
  grain: '#e9c046', water: '#62b0d6', timber: '#86532e', stone: '#9aa0a8', tiles: '#c0623f', concrete: '#c3cad4', ore: '#4a4f5c',
  iron: '#686f7c', tools: '#3a3b47', oil: '#7d8a46', wine: '#6a1f4a',
};
const HAIR = ['#5d3b2a', '#2a1d18', '#a8652f', '#3b2a25', '#7a3b24'];
const LEGS = ['#6f5639', '#5a4632', '#4b3b5a', '#6b4d36'];
const MAX = 220, MAX_TOUCH = 120, PER_PERSON = 4;
const SAMPLE_DAYS = 30;                        // the sampled crowd changes once a month
const SPEED = 22;                              // world px per second at 1×
const SYNC_MS = 500;

type Kind = 'person' | 'child' | 'elder' | 'patrician';
type Mode = 'walk' | 'in' | 'work' | 'stand';
interface Walker {
  id: number; x: number; y: number; path: number[]; pi: number; mode: Mode; wait: number; phase: number; facing: 1 | -1;
  alpha: number; leaving: boolean; seen: number; kind: Kind; tint: Record<string, string>; carry: string | null;
  home: number; work: number | null; leg: 0 | 1 | 2 | 3; lane: number; frames: Map<string, HTMLCanvasElement>;
}

/** Road-graph paths for walkers: BFS over built road tiles with stamped buffers, cached per structure epoch. */
export class Roads {
  private epoch = -1;
  private road: Uint8Array = new Uint8Array(0);
  private cache = new Map<number, number[] | null>();
  private doors = new Map<number, number>();
  private prev = new Int32Array(W * H);
  private seen = new Uint32Array(W * H);
  private queue = new Int32Array(W * H);
  private stamp = 0;

  /** Drops the caches when the structure changed. */
  sync(s: GameState): void {
    const ep = structEpoch(s);
    if (ep === this.epoch) return;
    this.epoch = ep;
    this.road = derived(s).road;
    this.cache.clear();
    this.doors.clear();
  }

  /** The road tile at a building's door (its first road neighbour), or −1. */
  door(s: GameState, b: Building): number {
    let d = this.doors.get(b.id);
    if (d === undefined) this.doors.set(b.id, (d = roadNeighbors(s, b)[0] ?? -1));
    return d;
  }

  /** Breadth-first walk from `a`; `visit` returns true to stop. Returns the last tile visited. */
  private bfs(a: number, maxSteps: number, visit: (i: number, depth: number) => boolean): number {
    const s = ++this.stamp, q = this.queue, depth = new Map<number, number>([[a, 0]]);
    let head = 0, tail = 0;
    q[tail++] = a; this.seen[a] = s; this.prev[a] = -1;
    while (head < tail) {
      const i = q[head++], dd = depth.get(i) ?? 0;
      if (visit(i, dd)) return i;
      if (dd >= maxSteps) continue;
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j < 0 || !this.road[j] || this.seen[j] === s) continue;
        this.seen[j] = s; this.prev[j] = i; depth.set(j, dd + 1); q[tail++] = j;
      }
    }
    return -1;
  }

  /** Road tiles from a to b inclusive (shortest in steps), or null when they are not connected. */
  path(a: number, b: number): number[] | null {
    if (a < 0 || b < 0) return null;
    const key = a * W * H + b;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    let out: number[] | null = null;
    if (this.bfs(a, 1e9, (i) => i === b) === b) {
      out = [];
      for (let k = b; k >= 0; k = this.prev[k]) out.push(k);
      out.reverse();
    }
    if (this.cache.size > 3000) this.cache.clear();
    this.cache.set(key, out);
    return out;
  }

  /** A random road tile within `steps` of `a` (a itself when nothing else is reachable). */
  near(a: number, steps: number, r: number): number {
    const found: number[] = [];
    this.bfs(a, steps, (i, d) => { if (d >= steps >> 1) found.push(i); return false; });
    return found.length ? found[Math.floor(r * found.length)] : a;
  }
}

/** The walker and convoy layer. */
export class Actors {
  private walkers = new Map<number, Walker>();
  private readonly roads = new Roads();
  private readonly convoys = new Convoys(this.roads);
  private syncT = 0;
  private stamp = 0;
  private readonly cap = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? MAX_TOUCH : MAX;

  /** Drops every actor (new or loaded game). */
  reset(): void {
    this.walkers.clear();
    this.convoys.reset();
    this.syncT = 0;
  }

  /** Spawns convoys and columns for arrive/leave/caravan/rank events. */
  handleFx(events: FxEvent[], s: GameState): void {
    this.roads.sync(s);
    this.convoys.handleFx(events, s);
  }

  /** Advances the actors by dtMs of real time at the given game speed (0 = paused: everyone stands still). */
  update(dtMs: number, s: GameState, speed: number, vis: Rect): void {
    this.roads.sync(s);
    if ((this.syncT -= dtMs) <= 0) { this.syncT = SYNC_MS; this.sync(s); }
    const sp = speed > 0 ? Math.min(3, Math.max(1, speed)) : 0;
    for (const w of [...this.walkers.values()]) this.step(s, w, dtMs, sp);
    this.convoys.update(dtMs, s, sp, vis);
  }

  /** Pushes the walkers, convoys and animals in view onto the draw list. */
  items(s: GameState, vis: Rect, push: Push): void {
    const x0 = vis.x * TILE, y0 = vis.y * TILE, x1 = (vis.x + vis.w) * TILE, y1 = (vis.y + vis.h) * TILE;
    for (const w of this.walkers.values()) {
      if (w.mode === 'in' || w.alpha <= 0 || w.x < x0 || w.y < y0 || w.x > x1 || w.y > y1) continue;
      push(w.y, w.x, (g) => this.draw(g, w));
    }
    this.convoys.items(s, vis, push);
  }

  /** Draws what flies above everything (birds). */
  sky(g: CanvasRenderingContext2D, vis: Rect): void {
    this.convoys.sky(g, vis);
  }

  private sync(s: GameState): void {
    const stamp = ++this.stamp, pop = s.people.length, want = Math.min(this.cap, Math.floor(pop / PER_PERSON));
    const bucket = Math.floor(s.day / SAMPLE_DAYS);
    for (const p of s.people) {
      if (p.home === null || hash2(p.id, bucket) >= want / Math.max(1, pop)) continue;
      const home = getBuilding(s, p.home);
      if (!home || home.status !== 'done' || this.roads.door(s, home) < 0) continue;
      const st = stageOf(p, s.day);
      const kind: Kind = isPatrician(s, p) ? 'patrician' : st === 0 ? 'child' : st === 3 ? 'elder' : 'person';
      let w = this.walkers.get(p.id);
      if (w && (w.home !== p.home || w.kind !== kind || w.work !== p.work)) { this.walkers.delete(p.id); w = undefined; }
      if (!w) {
        const job = p.work !== null && p.work !== BUILDER ? getBuilding(s, p.work) : undefined;
        const cat: LaborCat | 'none' = p.work === BUILDER ? 'builders' : job ? BUILDING_DEFS[job.type].labor ?? 'none' : 'none';
        const tunic = kind === 'patrician' ? '#f4ead6' : kind === 'child' ? '#d9b98a' : TUNIC[cat];
        const door = this.roads.door(s, home);
        w = {
          id: p.id, x: (door % W) * TILE + 8, y: Math.floor(door / W) * TILE + 10, path: [], pi: 0, mode: 'in', wait: 400 + hash2(p.id, 3) * 4000,
          phase: hash2(p.id, 4) * 10, facing: 1, alpha: 0, leaving: false, seen: stamp, kind, carry: null, home: p.home, work: p.work, leg: 0,
          lane: (hash2(p.id, 5) - 0.5) * 6, frames: new Map(),
          tint: { S: tunic, A: kind === 'elder' ? '#e6e2da' : HAIR[p.id % HAIR.length], U: LEGS[(p.id >> 2) % LEGS.length] },
        };
        this.walkers.set(p.id, w);
      }
      w.seen = stamp;
    }
    for (const w of this.walkers.values()) if (w.seen !== stamp) { if (w.mode === 'in') this.walkers.delete(w.id); else w.leaving = true; }
  }

  /** Next leg of a walker's day: home → work → home, or a stroll for children, elders, the idle and patricians. */
  private plan(s: GameState, w: Walker): void {
    const home = getBuilding(s, w.home);
    const hd = home ? this.roads.door(s, home) : -1;
    const r = Math.random();
    const here = Math.floor(w.y / TILE) * W + Math.floor(w.x / TILE);
    let to = hd, workLeg = false;
    if (w.kind === 'person' && w.work !== null && w.leg === 0) {
      const d = derived(s);
      const site = w.work === BUILDER ? getBuilding(s, d.sites[Math.floor(r * Math.min(3, d.sites.length))] ?? -1) : getBuilding(s, w.work);
      const door = site ? this.roads.door(s, site) : -1;
      if (door >= 0) { to = door; workLeg = true; }
    } else if (w.leg === 0) {
      const f = forumDoor(s);
      to = w.kind === 'child' ? this.roads.near(hd, 6, r) : w.kind === 'elder' || r < 0.3 ? this.roads.near(f, 4, r) : this.roads.near(hd, 12, r);
    }
    const path = this.roads.path(here, to) ?? [to];
    w.path = path; w.pi = 0; w.mode = 'walk'; w.leg = workLeg ? 1 : w.leg === 0 ? 2 : 0;
    if (w.leg === 0 && w.work !== null && w.kind === 'person') {
      const job = w.work !== BUILDER ? getBuilding(s, w.work) : undefined;
      const res = job ? BUILDING_DEFS[job.type].output?.res : undefined;
      w.carry = res ? GOODS[res] ?? null : null;
    } else w.carry = null;
  }

  private step(s: GameState, w: Walker, dtMs: number, sp: number): void {
    w.alpha = Math.max(0, Math.min(1, w.alpha + (w.leaving || w.mode === 'in' ? -dtMs / 400 : dtMs / 400)));
    if (w.leaving && w.alpha <= 0) { this.walkers.delete(w.id); return; }
    if (!sp) return;
    w.phase += (dtMs / 1000) * sp;
    if (w.mode !== 'walk') {
      if ((w.wait -= dtMs * sp) > 0) return;
      if (w.mode === 'work') { w.mode = 'stand'; }
      this.plan(s, w);
      return;
    }
    const t = w.path[w.pi];
    if (t === undefined) { this.arrive(s, w); return; }
    const tx = (t % W) * TILE + 8 + w.lane, ty = Math.floor(t / W) * TILE + 10 + w.lane * 0.5;
    const dx = tx - w.x, dy = ty - w.y, dist = Math.hypot(dx, dy);
    const v = SPEED * sp * (w.kind === 'elder' ? 0.6 : w.kind === 'child' ? 1.15 : 1) * (dtMs / 1000);
    if (dist <= v) { w.x = tx; w.y = ty; w.pi++; return; }
    w.x += (dx / dist) * v;
    w.y += (dy / dist) * v;
    if (Math.abs(dx) > 0.3) w.facing = dx > 0 ? 1 : -1;
  }

  private arrive(s: GameState, w: Walker): void {
    const r = Math.random();
    if (w.leg === 1) {
      const b = w.work === BUILDER ? null : getBuilding(s, w.work ?? -1);
      const outdoor = w.work === BUILDER || (b && ['food', 'materials'].includes(BUILDING_DEFS[b.type].labor ?? '') && BUILDING_DEFS[b.type].place.includes('rural'));
      w.mode = outdoor ? 'work' : 'in';
      w.wait = 3000 + r * 5000;
      return;
    }
    w.mode = w.leg === 0 ? 'in' : 'stand';
    w.wait = w.leg === 0 ? 2500 + r * 6000 : (w.kind === 'elder' ? 5000 : 1200) + r * 3000;
    if (w.leg === 2) w.leg = 0;
  }

  private draw(g: CanvasRenderingContext2D, w: Walker): void {
    const moving = w.mode === 'walk';
    const step = Math.floor(w.phase * 6) % 2;
    const frame = moving ? (step ? 'walk0' : 'walk1') : w.mode === 'work' && w.kind === 'person' && Math.floor(w.phase * 3) % 2 ? 'work' : 'idle';
    const name = `a_${w.kind}_${frame}`;
    let spr = w.frames.get(name);
    if (!spr) w.frames.set(name, (spr = tinted(name, w.tint)));
    if (w.facing < 0) spr = mirror(spr);
    const x = Math.round(w.x), y = Math.round(w.y);
    g.globalAlpha = w.alpha;
    g.fillStyle = 'rgba(16,10,6,0.28)';
    g.fillRect(x - 3, y - 1, 6, 2);
    g.drawImage(spr, x - (spr.width >> 1), y - spr.height);
    if (w.carry && moving) {
      g.fillStyle = '#1d1410'; g.fillRect(x - 2, y - spr.height - 3, 4, 3);
      g.fillStyle = w.carry; g.fillRect(x - 1, y - spr.height - 2, 2, 1);
    }
    g.globalAlpha = 1;
  }
}

let forumKey = -1;
let forumTile = 0;
/** A road tile on the forum's ring (where elders and loungers gather), cached per structure epoch. */
function forumDoor(s: GameState): number {
  const ep = structEpoch(s);
  if (ep !== forumKey) {
    forumKey = ep;
    const steps = derived(s).stepsToForum;
    forumTile = idx(0, 0);
    for (let i = 0; i < steps.length; i++) if (steps[i] === 0) { forumTile = i; break; }
  }
  return forumTile;
}

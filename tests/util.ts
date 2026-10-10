// tests/util.ts — shared headless test helpers (ARCHITECTURE §15).
import { BUILDER } from '../src/game/types';
import type { ActionResult, BuildingId, EventId, GameState, Owner, PlaceOpts, TickContext } from '../src/game/types';
import { newGame } from '../src/game/state';
import { newCtx, tick, view } from '../src/game/sim';
import { W, idx } from '../src/game/map';
import { placeBuilding, validSlots } from '../src/game/place';
import { fireEvent } from '../src/game/events';
import { withRng } from '../src/game/rng';
import { canWork } from '../src/game/census';
import { touchPeople } from '../src/game/memo';
import { BUILDING_DEFS } from '../src/game/data/buildings';

/** False in Phase 1: tests that need another package's real behaviour use `describe.runIf(INTEGRATED)`. */
export const INTEGRATED = false;

/** A new game on `seed` (wall clock 0). */
export function fresh(seed = 42): GameState {
  return newGame({ seed, now: 0 });
}

/** Runs `days` online ticks, calling `onDay` after each; returns the same state. */
export function run(s: GameState, days: number, onDay?: (s: GameState, ctx: TickContext, i: number) => void): GameState {
  for (let i = 0; i < days; i++) {
    const c = newCtx();
    tick(s, c);
    onDay?.(s, c, i);
  }
  return s;
}

/** A fresh tick context. */
export function ctx(offline = false): TickContext {
  return newCtx(offline);
}

/** Hand-made staffing: clears every job, then fills buildings in id order (best skill first) and the builders. */
export function setJobs(s: GameState, plan: { perBuilding: Record<number, number>; builders?: number }): void {
  for (const p of s.people) p.work = null;
  const pool = s.people.filter((p) => canWork(s, p));
  const taken = new Set<number>();
  for (const b of s.buildings) {
    const n = plan.perBuilding[b.id] ?? 0;
    if (n <= 0) continue;
    const skill = BUILDING_DEFS[b.type].skill;
    const cands = pool
      .filter((p) => !taken.has(p.id))
      .sort((a, c) => (skill ? (c.skills[skill] ?? 0) - (a.skills[skill] ?? 0) : 0) || a.id - c.id);
    for (const p of cands.slice(0, n)) {
      p.work = b.id;
      taken.add(p.id);
    }
  }
  let builders = plan.builders ?? 0;
  for (const p of pool) {
    if (builders <= 0) break;
    if (taken.has(p.id)) continue;
    p.work = BUILDER;
    taken.add(p.id);
    builders--;
  }
  touchPeople(s);
}

/** Places a building at tile (x, y) as the player (unless `opts.owner` says otherwise). */
export function place(s: GameState, type: BuildingId, x: number, y: number, opts?: PlaceOpts): ActionResult {
  return placeBuilding(s, type, idx(x, y), { owner: 'player', ...opts });
}

/** The first `n` valid slots (top-left tiles, ascending) of a type on this state's real map, as (x, y): tests place
 *  through these instead of hard-coded coordinates, which only held on the scaffold's toy map. */
export function freeSlots(s: GameState, type: BuildingId, n = 1, owner: Owner = 'player'): { x: number; y: number }[] {
  const tiles = [...validSlots(s, type, owner).keys()].sort((a, b) => a - b).slice(0, n);
  if (tiles.length < n) throw new Error(`only ${tiles.length} free ${type} slots, ${n} wanted`);
  return tiles.map((i) => ({ x: i % W, y: Math.floor(i / W) }));
}

/** Paths of every non-JSON-safe value in the state: NaN/±Infinity, undefined, functions, non-plain objects. */
export function noNaN(s: GameState): string[] {
  const bad: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) bad.push(`${path} = ${v}`);
      return;
    }
    if (v === undefined) { bad.push(`${path} = undefined`); return; }
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') { bad.push(`${path}: ${typeof v}`); return; }
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], `${path}[${i}]`);
      return;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) { bad.push(`${path}: ${proto?.constructor?.name ?? 'object'}`); return; }
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${k}`);
  };
  walk(s, 's');
  return bad;
}

/** Fires one event now through the events module (with the game's RNG stream); true if it started. */
export function forceEvent(s: GameState, id: EventId): boolean {
  return withRng(s, (r) => fireEvent(s, newCtx(), r, view(s), id));
}

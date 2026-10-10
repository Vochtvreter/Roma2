// src/game/rng.ts — seeded randomness (ARCHITECTURE §8.1, §10).
import type { GameState } from './types';

/** XOR applied to the seed to start the game's RNG stream (`s.rng`). */
export const GAME_SEED_XOR = 0x9e3779b9;
/** XOR applied to the seed for map generation (`new Rng(seed ^ MAP_SEED_XOR)`). */
export const MAP_SEED_XOR = 0x51ed27;

/** Small, fast, seedable PRNG (mulberry32). Its state is a plain number so it serialises with the save. */
export class Rng {
  /** Creates a stream continuing from `state` (an int32). */
  constructor(public state: number) {}

  /** Next float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, maxIncl]. */
  int(min: number, maxIncl: number): number {
    return Math.floor(this.range(min, maxIncl + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** One element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted draw; items with w ≤ 0 are ignored; null if nothing has weight. */
  weighted<T>(items: { w: number; v: T }[]): T | null {
    let total = 0;
    for (const it of items) if (it.w > 0) total += it.w;
    if (!(total > 0)) return null;
    let r = this.next() * total;
    let last: T | null = null;
    for (const it of items) {
      if (!(it.w > 0)) continue;
      last = it.v;
      if (r < it.w) return it.v;
      r -= it.w;
    }
    return last;
  }

  /** Fisher–Yates shuffle in place; returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
}

/** Stateless hash of a tile/pair to [0, 1): terrain, sprite variants, walkers. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 0x85ebca77)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 32-bit FNV-1a hash of a string as an unsigned integer (seeds from text). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Runs `fn` with the game's RNG stream (for actions outside the tick) and writes the advanced state back to `s.rng`. */
export function withRng<T>(s: GameState, fn: (r: Rng) => T): T {
  const r = new Rng(s.rng);
  const out = fn(r);
  s.rng = r.state;
  return out;
}

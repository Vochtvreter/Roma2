// src/game/world/noise.ts — seeded value noise and fractal noise for terrain generation. Owner: WP-A.
// Built on the stateless `hash2`, so every value is a pure function of (x, y, seed). `fbmField` caches the lattice
// of each octave over a bounded domain, which makes whole-map sampling several times faster than calling `fbm`.
import { hash2 } from '../rng';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smoothly interpolated lattice noise in [0, 1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * An fBm sampler (octaves of value noise at double frequency and half amplitude, normalised to [0, 1)) for points with x in [x0, x1] and y in [y0, y1] (noise units):
 * the lattice values of every octave are hashed once into a table.
 */
export function fbmField(seed: number, octaves: number, x0: number, x1: number, y0: number, y1: number): (x: number, y: number) => number {
  const OX = new Int32Array(octaves), OY = new Int32Array(octaves), NX = new Int32Array(octaves), AT = new Int32Array(octaves);
  const cells: number[] = [];
  let freq = 1, norm = 0, amp = 1;
  for (let o = 0; o < octaves; o++) {
    OX[o] = Math.floor(x0 * freq); OY[o] = Math.floor(y0 * freq);
    NX[o] = Math.floor(x1 * freq) - OX[o] + 2;
    const ny = Math.floor(y1 * freq) - OY[o] + 2;
    AT[o] = cells.length;
    const s = seed + o * 1013;
    for (let j = 0; j < ny; j++) for (let i = 0; i < NX[o]; i++) cells.push(hash2(OX[o] + i, OY[o] + j, s));
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  const V = Float64Array.from(cells);
  const inv = 1 / norm;
  return (x: number, y: number): number => {
    let sum = 0, a = 1, px = x, py = y;
    for (let o = 0; o < octaves; o++) {
      const xi = Math.floor(px), yi = Math.floor(py);
      let fx = px - xi, fy = py - yi;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const nx = NX[o];
      const k = AT[o] + (yi - OY[o]) * nx + (xi - OX[o]);
      const va = V[k], vb = V[k + 1], vc = V[k + nx], vd = V[k + nx + 1];
      sum += (va + (vb - va) * fx + (vc - va) * fy + (va - vb - vc + vd) * fx * fy) * a;
      a *= 0.5;
      px *= 2;
      py *= 2;
    }
    return sum * inv;
  };
}

/** Stretches a noise value around 0.5 by `k` and clamps it to [0, 1] (fBm clusters near the middle). */
export function stretch(v: number, k: number): number {
  return Math.min(1, Math.max(0, 0.5 + (v - 0.5) * k));
}

/** One-dimensional smooth noise in [0, 1) (river meanders). */
export function noise1(t: number, seed: number): number {
  return valueNoise(t, 0.5, seed);
}

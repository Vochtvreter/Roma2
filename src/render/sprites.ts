// src/render/sprites.ts — the code-drawn sprite system (ARCHITECTURE §12.3; DESIGN §16.2). Owner: S (scaffold).
//
// Art is registered as string grids (one PAL key per pixel) or as procedural draw functions with a declared size.
// Registration stores data only: NO canvas work happens at import or registration time (tests/art.test.ts runs in
// node). Rasterising happens on the first `sprite()` call and is cached. An unknown name rasterises to a 16×16
// magenta/black checker (warned once) so the renderer works before the art lands.

/** The sprite palette: Hearthlands keys (outline `k` in umber) + the Roman keys of DESIGN §16.2. '.' and ' ' are transparent. */
export const PAL: Readonly<Record<string, string>> = Object.freeze({
  // outlines (umber)
  k: '#1d1410', K: '#3b2a25',
  // whites and greys
  w: '#f6f2ea', W: '#cfc8bd', g: '#9aa0a8', G: '#686f7c', j: '#4a4f5c', z: '#c3cad4', x: '#3a3b47', q: '#2a2030',
  // woods and earths
  b: '#5e3a22', B: '#86532e', n: '#b07a45', t: '#d6a464', T: '#efcf95', m: '#5d3b2a', e: '#e3cf98', E: '#bfa66b',
  // warm accents
  y: '#f7d55c', Y: '#eaa53a', o: '#e06c2e', r: '#c43d2f', R: '#842a2a', f: '#ef8fb5',
  // foliage (light → outline)
  l: '#86cf53', L: '#4f9a3a', d: '#2f6b35', D: '#1d4227',
  // water and violets
  c: '#6cc0ea', C: '#2f6fae', p: '#9a78e0', P: '#5b3f9c',
  // skin
  h: '#f0c08c', H: '#c58650',
  // Roman keys (DESIGN §16.2)
  u: '#c0623f',   // terracotta
  v: '#8a3d2b',   // dark terracotta
  a: '#efe8d8',   // travertine
  i: '#d2c7b2',   // marble shade
  s: '#d9a35b',   // ochre plaster
  F: '#9e2f25',   // Pompeian red
  I: '#6a1f4a',   // Tyrian purple
  N: '#c99a3b',   // bronze / gilt
  O: '#b8a582',   // tufa
  Q: '#8e7c5e',   // tufa shade
  M: '#3d7fa6',   // mosaic / impluvium blue
  V: '#7d8a46',   // olive leaf
  Z: '#24402c',   // cypress
  X: '#55565e',   // basalt
  // placeholders recoloured per instance by tinted(); these defaults are used for icons and untinted sprites
  S: '#c9b48a',   // tunic (undyed wool)
  A: '#5d3b2a',   // hair
  U: '#6f5639',   // trousers / leggings
});

/** A string grid: equal-length rows of PAL keys ('.' and ' ' transparent). */
export type Grid = readonly string[];

type DrawFn = (g: CanvasRenderingContext2D) => void;
type ArtEntry =
  | { kind: 'grid'; rows: Grid; outline: boolean; w: number; h: number }
  | { kind: 'draw'; w: number; h: number; draw: DrawFn };

const ART = new Map<string, ArtEntry>();
const DUPLICATES: string[] = [];
const cache = new Map<string, HTMLCanvasElement>();
const urlCache = new Map<string, string>();
const tintCache = new Map<string, HTMLCanvasElement>();
const maskCache = new Map<string, Uint8Array>();
const composeCache = new Map<string, HTMLCanvasElement>();
const mirrorCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const warned = new Set<string>();

const TRANSPARENT = new Set(['.', ' ']);
const CHECKER = 16;
const OUTLINED_PREFIXES = ['b_', 'h_', 'a_', 'p_'];   // buildings, houses, actors, forum/Capitolium: outlined by default (§12.3)

/** Fixed sizes from the frozen naming table (ARCHITECTURE §12.3), checked by validateArt(). */
const FIXED_SIZES: [RegExp, number, number][] = [
  [/^i_/, 12, 12],
  [/^pt_/, 24, 24],
  [/^f_meander$/, 12, 12],
  [/^f_seal$/, 16, 16],
  [/^f_aquila$/, 32, 32],
  [/^ov_scaffold$/, 32, 32],
  [/^ov_cracks$/, 32, 24],
  [/^ov_lanterns$/, 32, 12],
  [/^ov_(pegs|trench)$/, 16, 16],
  [/^l_(vallum|murus)_[hvc]$/, 16, 24],
  [/^l_gate_/, 48, 40],
  [/^l_aqua_/, 16, 28],
  [/^n_milestone$/, 6, 10],
  [/^p_forum_\d$/, 144, 152],
  [/^p_capitolium_\d$/, 144, 96],
  [/^p_crown_/, 32, 24],
];
/** Houses are 32 px wide (2×2 plots); heights vary by tier. */
const FIXED_WIDTHS: [RegExp, number][] = [[/^h_/, 32]];

/** A blank canvas of the given size (browser only). */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  g.imageSmoothingEnabled = false;
  return g;
}

/** Rasterises a grid with a palette (unknown keys are skipped; validateArt() reports them). */
export function raster(rows: Grid, pal: Readonly<Record<string, string>> = PAL): HTMLCanvasElement {
  const h = rows.length;
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (TRANSPARENT.has(ch)) continue;
      const col = pal[ch] ?? PAL[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** Registers a grid sprite (lazy: no canvas work). `outline` defaults to true for b_/h_/a_/p_ names. */
export function registerArt(name: string, rows: Grid, opts?: { outline?: boolean }): void {
  if (ART.has(name)) DUPLICATES.push(name);
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  const outlineDefault = OUTLINED_PREFIXES.some((p) => name.startsWith(p));
  ART.set(name, { kind: 'grid', rows, outline: opts?.outline ?? outlineDefault, w, h: rows.length });
  forget(name);
}

/** Registers a procedural sprite of a declared size (lazy: the draw function runs on the first sprite() call). */
export function registerDraw(name: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): void {
  if (ART.has(name)) DUPLICATES.push(name);
  ART.set(name, { kind: 'draw', w, h, draw });
  forget(name);
}

function forget(name: string): void {
  cache.delete(name);
  maskCache.delete(name);
  for (const k of [...urlCache.keys()]) if (k.startsWith(name + '|')) urlCache.delete(k);
  for (const k of [...tintCache.keys()]) if (k.startsWith(name + '|')) tintCache.delete(k);
}

/** The unknown-sprite checker: 16×16 magenta/black, 4 px squares. */
function checker(): HTMLCanvasElement {
  const c = makeCanvas(CHECKER, CHECKER);
  const g = ctx2d(c);
  for (let y = 0; y < CHECKER; y += 4)
    for (let x = 0; x < CHECKER; x += 4) {
      g.fillStyle = ((x + y) / 4) % 2 === 0 ? '#ff00ff' : '#000000';
      g.fillRect(x, y, 4, 4);
    }
  return c;
}

function build(e: ArtEntry, pal: Readonly<Record<string, string>> = PAL): HTMLCanvasElement {
  if (e.kind === 'grid') {
    const c = raster(e.rows, pal);
    return e.outline ? outline(c) : c;
  }
  const c = makeCanvas(e.w, e.h);
  e.draw(ctx2d(c));
  return c;
}

/** The rasterised sprite (cached); an unknown name gives the 16×16 magenta/black checker and warns once. */
export function sprite(name: string): HTMLCanvasElement {
  let c = cache.get(name);
  if (c) return c;
  const e = ART.get(name);
  if (!e) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[sprites] unknown sprite "${name}"`);
    }
    c = checker();
  } else c = build(e);
  cache.set(name, c);
  return c;
}

/** Whether a sprite of this name is registered. */
export function hasSprite(name: string): boolean {
  return ART.has(name);
}

/** The declared size of a sprite (no canvas work); 16×16 for unknown names (the checker). */
export function spriteSize(name: string): { w: number; h: number } {
  const e = ART.get(name);
  return e ? { w: e.w, h: e.h } : { w: CHECKER, h: CHECKER };
}

/** A cached PNG data URL of the sprite scaled by an integer factor (default 2), for <img>. */
export function spriteURL(name: string, scale = 2): string {
  const k = Math.max(1, Math.round(scale));
  const key = `${name}|${k}`;
  let u = urlCache.get(key);
  if (u) return u;
  const src = sprite(name);
  const c = makeCanvas(src.width * k, src.height * k);
  const g = ctx2d(c);
  g.drawImage(src, 0, 0, c.width, c.height);
  u = c.toDataURL('image/png');
  urlCache.set(key, u);
  return u;
}

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** The sprite with placeholder keys recoloured (S tunic, A hair, U trousers, or any PAL key); cached per map. */
export function tinted(name: string, map: Record<string, string>): HTMLCanvasElement {
  const keys = Object.keys(map).sort();
  const key = `${name}|${keys.map((k) => k + map[k]).join(',')}`;
  let c = tintCache.get(key);
  if (c) return c;
  const e = ART.get(name);
  if (!e) c = sprite(name);
  else if (e.kind === 'grid') c = build(e, { ...PAL, ...map });
  else {
    // procedural art: swap the default placeholder colours pixel by pixel
    c = build(e);
    const g = ctx2d(c);
    const img = g.getImageData(0, 0, c.width, c.height);
    const swaps = keys.filter((k) => PAL[k]).map((k) => ({ from: hexRgb(PAL[k]), to: hexRgb(map[k]) }));
    const d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3] === 0) continue;
      for (const sw of swaps)
        if (d[p] === sw.from[0] && d[p + 1] === sw.from[1] && d[p + 2] === sw.from[2]) {
          d[p] = sw.to[0]; d[p + 1] = sw.to[1]; d[p + 2] = sw.to[2];
          break;
        }
    }
    g.putImageData(img, 0, 0);
  }
  tintCache.set(key, c);
  return c;
}

/** A horizontally mirrored copy of a canvas (cached per source canvas). */
export function mirror(c: HTMLCanvasElement): HTMLCanvasElement {
  let m = mirrorCache.get(c);
  if (m) return m;
  m = makeCanvas(c.width, c.height);
  const g = ctx2d(m);
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(c, 0, 0);
  mirrorCache.set(c, m);
  return m;
}

/**
 * A copy with a 1 px outline (default `k`) painted into every transparent pixel that is 4-adjacent to an opaque
 * pixel of another colour. The size is unchanged (art keeps its declared size), and a hand-drawn `k` ring is left as is.
 */
export function outline(c: HTMLCanvasElement, color: string = PAL.k): HTMLCanvasElement {
  const w = c.width, h = c.height;
  const out = makeCanvas(w, h);
  const g = ctx2d(out);
  g.drawImage(c, 0, 0);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const [or, og, ob] = hexRgb(color);
  const solid = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const p = (y * w + x) * 4;
    return d[p + 3] > 0 && !(d[p] === or && d[p + 1] === og && d[p + 2] === ob);
  };
  const paint: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) paint.push(y * w + x);
    }
  for (const i of paint) {
    const p = i * 4;
    d[p] = or; d[p + 1] = og; d[p + 2] = ob; d[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}

/** A canvas of size w×h with named sprites stamped at (x, y) in order (cached per part list). */
export function compose(w: number, h: number, parts: { name: string; x: number; y: number }[]): HTMLCanvasElement {
  const key = `${w}x${h}:${parts.map((p) => `${p.name}@${p.x},${p.y}`).join(';')}`;
  let c = composeCache.get(key);
  if (c) return c;
  c = makeCanvas(w, h);
  const g = ctx2d(c);
  for (const p of parts) g.drawImage(sprite(p.name), Math.round(p.x), Math.round(p.y));
  composeCache.set(key, c);
  return c;
}

/** Per-pixel opacity (1 = opaque) of a sprite, row-major w×h, for pixel-accurate picking (cached). */
export function alphaMask(name: string): Uint8Array {
  let m = maskCache.get(name);
  if (m) return m;
  const e = ART.get(name);
  if (e && e.kind === 'grid' && !e.outline) {
    // grids without auto-outline: straight from the rows, no canvas needed
    m = new Uint8Array(e.w * e.h);
    for (let y = 0; y < e.h; y++) {
      const row = e.rows[y];
      for (let x = 0; x < row.length; x++) if (!TRANSPARENT.has(row[x]) && PAL[row[x]]) m[y * e.w + x] = 1;
    }
  } else {
    const c = sprite(name);
    const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
    m = new Uint8Array(c.width * c.height);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  }
  maskCache.set(name, m);
  return m;
}

/** Art problems without any canvas work: ragged rows, unknown keys, duplicate names, size mismatches. [] when clean. */
export function validateArt(): string[] {
  const out: string[] = [];
  for (const d of new Set(DUPLICATES)) out.push(`${d}: registered more than once`);
  const names = [...ART.keys()].sort();
  for (const name of names) {
    const e = ART.get(name);
    if (!e) continue;
    if (e.w <= 0 || e.h <= 0) out.push(`${name}: empty (${e.w}×${e.h})`);
    if (e.kind === 'grid') {
      e.rows.forEach((r, y) => {
        if (r.length !== e.w) out.push(`${name}: ragged row ${y} (${r.length} ≠ ${e.w})`);
        const bad = new Set<string>();
        for (const ch of r) if (!TRANSPARENT.has(ch) && PAL[ch] === undefined) bad.add(ch);
        if (bad.size) out.push(`${name}: unknown palette key(s) ${[...bad].map((b) => JSON.stringify(b)).join(' ')} in row ${y}`);
      });
    }
    for (const [re, w, h] of FIXED_SIZES)
      if (re.test(name) && (e.w !== w || e.h !== h)) out.push(`${name}: size ${e.w}×${e.h}, expected ${w}×${h}`);
    for (const [re, w] of FIXED_WIDTHS) if (re.test(name) && e.w !== w) out.push(`${name}: width ${e.w}, expected ${w}`);
    // seasonal variants share the size of their base sprite
    const at = name.indexOf('@');
    if (at > 0) {
      const base = ART.get(name.slice(0, at));
      if (base && (base.w !== e.w || base.h !== e.h)) out.push(`${name}: size ${e.w}×${e.h} differs from ${name.slice(0, at)} (${base.w}×${base.h})`);
    }
  }
  // numbered variants and animation frames of one family share a size (h_casa_0/1, a_ox_0/1, pt_quaestor_0..2 …)
  const families = new Map<string, { name: string; w: number; h: number }[]>();
  for (const name of names) {
    if (name.includes('@')) continue;
    const m = /^(.*)_(\d|idle|walk0|walk1|work)$/.exec(name);
    if (!m || m[1].startsWith('p_forum') || m[1].startsWith('p_capitolium')) continue;
    const e = ART.get(name);
    if (!e) continue;
    const list = families.get(m[1]) ?? [];
    list.push({ name, w: e.w, h: e.h });
    families.set(m[1], list);
  }
  for (const [fam, list] of families) {
    const first = list[0];
    for (const o of list.slice(1))
      if (o.w !== first.w || o.h !== first.h) out.push(`${o.name}: size ${o.w}×${o.h} differs from ${first.name} (${first.w}×${first.h}) in family ${fam}`);
  }
  return out;
}

/** Every registered sprite name, sorted. */
export function spriteNames(): string[] {
  return [...ART.keys()].sort();
}

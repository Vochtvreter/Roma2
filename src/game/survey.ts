// src/game/survey.ts — the groma's plan: castrum, blocks, plots, rings, streets, wall, fossa, gates, via
// (ARCHITECTURE §8.2, DESIGN §3.4–3.5). Owner: WP-A (written by the scaffold). Pure geometry over the map; no state.
// Castrum coordinates are relative to the interior origin (ix, iy): street lines every PITCH tiles, blocks of 4×4
// between them; interior blocks bx 0..5, by 0..3; rings 1–2 continue the grid outside the fossa.
// Streets: every interior pitch line (not through the forum or the sacred way), the four gate causeways across the
// fossa (built with the castrum streets), and the pitch lines around each UNMASKED ring block — land around masked
// blocks (river loam, outcrops, the grove) carries no chalk lines and stays free rural land.
// Ring 3 is the castrum's own wall and ditch (offsets 1–4 from the interior, exactly one block deep): 24 blocks and the
// pitch lines across them, latent while the camp is walled; they join the pomerium when the town wall is finished and
// the castrum razed (urbs.ts, DESIGN §3.9). They are listed after rings 1–2, so every older block keeps its id.
import { B as B$ } from './balance';
import { F as F$, T as T$ } from './types';
import type { Block, GameState, GateId, RankIndex, Rect, Survey, WorldMap } from './types';
import { RANK_DEFS as RANK_DEFS$ } from './data/ranks';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, F = F$, T = T$, RANK_DEFS = RANK_DEFS$;

const W = B.map.W;
const H = B.map.H;
const P = B.map.PITCH;                                   // 5
const BS = B.map.BLOCK;                                  // 4
const PS = B.map.PLOT;                                   // 2
const IW = B.map.INTERIOR_W;                             // 31
const IH = B.map.INTERIOR_H;                             // 21
const BX = (IW - 1) / P;                                 // 6 interior block columns
const BY = (IH - 1) / P;                                 // 4 interior block rows
const CARDO = (BX / 2) * P;                              // x = 15
const DECUMANUS = (BY / 2) * P;                          // y = 10
const FOSSA_IN = 2;                                      // fossa Chebyshev offsets 2..(1 + FOSSA)
const FOSSA_OUT = 1 + B.map.FOSSA;                       // 4
const RINGS = 2;
/** The ring of blocks on the castrum's wall and ditch (latent until the castrum is razed). */
export const WALL_RING = 3;

function inMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < W && y < H;
}

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Chebyshev distance of (x, y) from a rect (0 inside). */
function chebRect(x: number, y: number, r: Rect): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w - 1));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h - 1));
  return Math.max(dx, dy);
}

/** Rect spanning blocks bx0..bx1 × by0..by1 including the streets between them. */
function blockSpan(ix: number, iy: number, bx: readonly number[], by: readonly number[]): Rect {
  const x = ix + P * bx[0] + 1;
  const y = iy + P * by[0] + 1;
  return { x, y, w: (bx[1] - bx[0] + 1) * P - 1, h: (by[1] - by[0] + 1) * P - 1 };
}

/** Block grid coordinates in ring order (interior, ring 1, ring 2, then ring 3 — the castrum's wall and ditch), each by
 *  row then column. */
function blockCoords(): { ring: 0 | 1 | 2 | 3; bx: number; by: number }[] {
  const out: { ring: 0 | 1 | 2 | 3; bx: number; by: number }[] = [];
  for (let by = 0; by < BY; by++) for (let bx = 0; bx < BX; bx++) out.push({ ring: 0, bx, by });
  const band = (ring: 1 | 2 | 3, k: number): void => {
    const x0 = -1 - k, x1 = BX + k, y0 = -1 - k, y1 = BY + k;
    for (let by = y0; by <= y1; by++) {
      for (let bx = x0; bx <= x1; bx++) {
        const sideCol = (bx === x0 || bx === x1);
        const sideRow = (by === y0 || by === y1) && bx >= x0 + 1 && bx <= x1 - 1;
        if (sideCol || sideRow) out.push({ ring, bx, by });
      }
    }
  };
  for (let k = 1; k <= RINGS; k++) band(k as 1 | 2, k);
  band(WALL_RING, 0);
  return out;
}

/** Number of tiles two rects share. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function grow(r: Rect, n: number): Rect {
  return { x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n };
}

/** Clockwise perimeter tiles of a rect: top row →, right column ↓, bottom row ←, left column ↑. */
function perimeter(r: Rect): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
  for (let x = r.x; x <= x1; x++) out.push({ x, y: r.y });
  for (let y = r.y + 1; y <= y1; y++) out.push({ x: x1, y });
  for (let x = x1 - 1; x >= r.x; x--) out.push({ x, y: y1 });
  for (let y = y1 - 1; y > r.y; y--) out.push({ x: r.x, y });
  return out;
}

/** True when a block's 4×4 tiles hold river, crag, rock, the grove or ruins, more than LOAM_MASK loam, or leave the map. */
function isMasked(map: Omit<WorldMap, 'survey'>, x: number, y: number): boolean {
  let loam = 0;
  for (let ty = y; ty < y + BS; ty++) {
    for (let tx = x; tx < x + BS; tx++) {
      if (!inMap(tx, ty)) return true;
      const i = ty * W + tx;
      const t = map.terrain[i];
      const f = map.feature[i];
      if (t === T.river || t === T.crag || t === T.rock || f === F.lucus || f === F.ruins) return true;
      if (t === T.loam) loam++;
    }
  }
  return loam > B.map.LOAM_MASK;
}

/** Computes the full survey for an interior origin and via side (DESIGN §3.4–3.5). */
export function computeSurvey(map: Omit<WorldMap, 'survey'>, ix: number, iy: number, viaDir: 'E' | 'W'): Survey {
  const N = W * H;
  const interior: Rect = { x: ix, y: iy, w: IW, h: IH };
  const castrum: Rect = grow(interior, FOSSA_OUT);
  const forum = blockSpan(ix, iy, B.map.FORUM_BLOCKS.bx, B.map.FORUM_BLOCKS.by);
  const capitolium = blockSpan(ix, iy, B.map.CAPITOLIUM_BLOCKS.bx, B.map.CAPITOLIUM_BLOCKS.by);
  const cx = ix + CARDO;
  const cy = iy + DECUMANUS;

  // ── sacred way: cardo tiles inside the Area Capitolina (never streets)
  const sacredWay: number[] = [];
  for (let y = capitolium.y; y < capitolium.y + capitolium.h; y++) if (inMap(cx, y)) sacredWay.push(y * W + cx);
  const sacred = new Uint8Array(N);
  for (const i of sacredWay) sacred[i] = 1;

  // ── blocks
  const blocks: Block[] = [];
  const blockAt = new Int16Array(N).fill(-1);
  const forumG = grow(forum, 1);
  for (const { ring, bx, by } of blockCoords()) {
    const x = ix + P * bx + 1;
    const y = iy + P * by + 1;
    const rect: Rect = { x, y, w: BS, h: BS };
    const masked = isMasked(map, x, y);
    const reserved: Block['reserved'] = ring === 0 && inRect(x, y, forum) ? 'forum'
      : ring === 0 && inRect(x, y, capitolium) ? 'capitolium' : null;
    // touches the forum: the block's street ring shares an edge (≥ 2 tiles) with the forum's street ring
    const touchesForum = ring === 0 && overlap(grow(rect, 1), forumG) >= 2;
    const viaSide = viaDir === 'W' ? bx < 0 : bx >= BX;
    const touchesVia = (by === BY / 2 - 1 || by === BY / 2) && (ring === 0 || viaSide);
    const praetoriaSide = viaDir === 'W' ? bx < BX / 2 : bx >= BX / 2;
    const district: Block['district'] = ring === WALL_RING ? 'vallum' : ring > 0 ? 'canabae'
      : touchesForum ? 'latera' : praetoriaSide ? 'praetentura' : 'retentura';
    const id = blocks.length;
    blocks.push({ id, ring, bx, by, x, y, masked, reserved, district, touchesVia, touchesForum });
    for (let ty = y; ty < y + BS; ty++) for (let tx = x; tx < x + BS; tx++) if (inMap(tx, ty)) blockAt[ty * W + tx] = id;
  }

  // ── streets: interior lines and causeways (ring 0), then the pitch lines around unmasked ring blocks
  const street = new Uint8Array(N);
  const streetRing = new Int8Array(N).fill(-1);
  const markStreet = (x: number, y: number, ring: number): void => {
    if (!inMap(x, y)) return;
    const i = y * W + x;
    const t = map.terrain[i];
    if (t === T.river || t === T.crag || sacred[i]) return;
    street[i] = 1;
    if (streetRing[i] < 0 || ring < streetRing[i]) streetRing[i] = ring;
  };
  for (let y = 0; y < IH; y++) {
    for (let x = 0; x < IW; x++) {
      if (x % P !== 0 && y % P !== 0) continue;
      if (inRect(ix + x, iy + y, forum)) continue;
      markStreet(ix + x, iy + y, 0);
    }
  }
  for (let k = FOSSA_IN; k <= FOSSA_OUT; k++) {
    markStreet(ix - k, cy, 0);
    markStreet(ix + IW - 1 + k, cy, 0);
    markStreet(cx, iy - k, 0);
    markStreet(cx, iy + IH - 1 + k, 0);
  }
  for (const b of blocks) {
    if (b.ring === 0 || b.ring === WALL_RING || b.masked) continue;
    for (const p of perimeter({ x: b.x - 1, y: b.y - 1, w: BS + 2, h: BS + 2 })) {
      if (inRect(p.x, p.y, castrum)) continue;
      markStreet(p.x, p.y, b.ring);
    }
  }
  // the pitch lines across the wall and ditch (the causeways keep ring 0): streets once the castrum is razed
  for (let y = castrum.y; y < castrum.y + castrum.h; y++) {
    for (let x = castrum.x; x < castrum.x + castrum.w; x++) {
      if (chebRect(x, y, interior) === 0) continue;
      if (((x - ix) % P + P) % P === 0 || ((y - iy) % P + P) % P === 0) markStreet(x, y, WALL_RING);
    }
  }

  // ── wall, gates, fossa
  const wall = new Uint8Array(N);
  const fossa = new Uint8Array(N);
  for (let y = castrum.y; y < castrum.y + castrum.h; y++) {
    for (let x = castrum.x; x < castrum.x + castrum.w; x++) {
      if (!inMap(x, y)) continue;
      const d = chebRect(x, y, interior);
      const i = y * W + x;
      if (d === 1) wall[i] = 1;
      else if (d >= FOSSA_IN && d <= FOSSA_OUT) {
        const causeway = (x === cx && (y < iy || y >= iy + IH)) || (y === cy && (x < ix || x >= ix + IW));
        if (!causeway) fossa[i] = 1;
      }
    }
  }
  const west = { x: ix - 1, y: cy };
  const east = { x: ix + IW, y: cy };
  const gatePos: { id: GateId; x: number; y: number }[] = [
    { id: 'praetoria', ...(viaDir === 'W' ? west : east) },
    { id: 'decumana', ...(viaDir === 'W' ? east : west) },
    { id: 'principalisN', x: cx, y: iy - 1 },
    { id: 'principalisS', x: cx, y: iy + IH },
  ];
  const gates: { id: GateId; tile: number }[] = [];
  for (const g of gatePos) {
    if (!inMap(g.x, g.y)) continue;
    const i = g.y * W + g.x;
    wall[i] = 2;
    gates.push({ id: g.id, tile: i });
  }

  // ── the via: the decumanus line from the Porta Praetoria outward to the map edge
  const via: number[] = [];
  const bridge: number[] = [];
  const dir = viaDir === 'W' ? -1 : 1;
  const start = viaDir === 'W' ? west.x : east.x;
  for (let x = start + dir; x >= 0 && x < W; x += dir) {
    const i = cy * W + x;
    via.push(i);
    if (map.terrain[i] === T.river) bridge.push(i);
  }

  return { ix, iy, viaDir, castrum, interior, forum, capitolium, blocks, blockAt, street, streetRing, wall, fossa, gates, via, bridge, sacredWay };
}

/** Top-left tile of a plot: 0 TL, 1 TR, 2 BL, 3 BR. */
export function plotOrigin(b: Block, plot: 0 | 1 | 2 | 3): { x: number; y: number } {
  return { x: b.x + (plot % 2) * PS, y: b.y + Math.floor(plot / 2) * PS };
}

/** Top-left tile of a half block: 0 top (plots 0, 1), 1 bottom (plots 2, 3). */
export function halfOrigin(b: Block, half: 0 | 1): { x: number; y: number } {
  return { x: b.x, y: b.y + half * PS };
}

/** The block's four perimeter street sides incl. corners (clockwise from the top-left corner; survey street tiles only). */
export function blockStreets(sv: Survey, b: Block): number[] {
  const out: number[] = [];
  for (const p of perimeter({ x: b.x - 1, y: b.y - 1, w: BS + 2, h: BS + 2 })) {
    if (!inMap(p.x, p.y)) continue;
    const i = p.y * W + p.x;
    if (sv.street[i] === 1) out.push(i);
  }
  return out;
}

const RAZED_RINGS: readonly number[][] = RANK_DEFS.map((r) => [...r.rings, WALL_RING]);

/** Rings in the pomerium at a rank (from RANK_DEFS: [0], [0, 1], [0, 1, 2] …), with the castrum's wall and ditch once
 *  the castrum is razed. */
export function activeRings(rank: RankIndex, razed = false): number[] {
  return razed ? RAZED_RINGS[rank] : RANK_DEFS[rank].rings;
}

/** The rings in a colony's pomerium: its rank's, and ring 3 once the castrum is razed. */
export function ringsOf(s: Pick<GameState, 'rank' | 'urbs'>): number[] {
  return activeRings(s.rank, isRazed(s));
}

/** True once the castrum's walls have come down (the town wall stands in their place). */
export function isRazed(s: Pick<GameState, 'urbs'>): boolean {
  return (s.urbs?.razed ?? null) !== null;
}

/** True when the block is unmasked, not reserved and its ring is in the pomerium at `rank` (ring 3 only once razed). */
export function isActiveBlock(sv: Survey, b: Block, rank: RankIndex, razed = false): boolean {
  const blk = sv.blocks[b.id] ?? b;
  return !blk.masked && blk.reserved === null && activeRings(rank, razed).includes(blk.ring);
}

/** True when the block is unmasked and unreserved but its ring is not yet in the pomerium (kept for the canabae). */
export function isFutureBlock(sv: Survey, b: Block, rank: RankIndex, razed = false): boolean {
  const blk = sv.blocks[b.id] ?? b;
  return !blk.masked && blk.reserved === null && !activeRings(rank, razed).includes(blk.ring);
}

const charterCache = new WeakMap<Survey, Uint8Array[]>();

/** The charter streets of a rank (DESIGN §3.7), 1 on every survey tile the town paves as it rises: the
 *  castrum's cardo and decumanus with their gates and causeways from Oppidum, every street of the inner city (ring 0)
 *  from Municipium, and the streets of Ring 1 and across the old wall line from Colonia. Shared; callers only read it. */
export function charterStreets(sv: Survey, rank: RankIndex): Uint8Array {
  let byRank = charterCache.get(sv);
  if (!byRank) { byRank = []; charterCache.set(sv, byRank); }
  let out = byRank[rank];
  if (out) return out;
  const C = B.map.CHARTER;
  out = new Uint8Array(W * H);
  if (rank >= C.axes) {
    const c = sv.castrum;
    for (let x = c.x; x < c.x + c.w; x++) out[(sv.iy + DECUMANUS) * W + x] = 1;
    for (let y = c.y; y < c.y + c.h; y++) out[y * W + sv.ix + CARDO] = 1;
  }
  for (let i = 0; i < W * H; i++) {
    if (sv.street[i] !== 1) continue;
    const ring = sv.streetRing[i];
    if ((rank >= C.inner && ring === 0) || (rank >= C.outer && (ring === 1 || ring === WALL_RING))) out[i] = 1;
  }
  byRank[rank] = out;
  return out;
}

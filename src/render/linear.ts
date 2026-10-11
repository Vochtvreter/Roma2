// src/render/linear.ts — streets, roads, walls, gates, fossa, aqueduct, via, bridge (ARCHITECTURE §12.2, §12.3). Owner: WP-F.
// Ground decals (baked into the terrain chunk composites, rebuilt when `decalSig` changes): dirt and paved roads as a
// procedural autotile — full-width streets with ruts or basalt setts and travertine kerbs inside the survey, a narrow
// track on open land joined to neighbouring roads and doorsteps — chalk survey lines with pegs for unbuilt streets of
// the pomerium, the forum ground and the via bridge. A road shows how many feet tread it (the footfall census, urbs.ts):
// a grassy track, a track, a broad rutted road, a gravelled highway. Objects (y-sorted): the vallum/murus autotile and
// gatehouses (stone from Oppidum) until the castrum is razed, the town wall rising from the Porta Praetoria round the
// town (pegs and chalk where it is still to rise), aqueduct spans growing from the spring with the castellum's progress,
// the milestone.
import type { GameState, Moenia, Rect, SeasonIndex } from '../game/types';
import { getMap, idx, inBounds, W } from '../game/map';
import { derived } from '../game/derived';
import { isRazed, ringsOf } from '../game/survey';
import { footfall, wearOf } from '../game/urbs';
import { hash2 } from '../game/rng';
import { RANK_DEFS } from '../game/data/ranks';
import { sprite } from './sprites';
import { gateDress, wallBanner } from './decor';
import type { Push } from './camera';
import { TILE } from './camera';

const DIRT = ['#9b7a52', '#a88a5e', '#94734d', '#7f6648'] as const;        // by season: dusty in Aestas, muddy in Hiems
const DIRT_EDGE = ['#6f5639', '#7a6142', '#6a5236', '#5c4832'] as const;
const C = {
  rut: 'rgba(60,40,24,0.35)', pebble: '#c2a77a', paved: '#5c5d66', mortar: '#3f4048', speck: '#77787f', kerb: '#d2c7b2',
  kerbShade: '#8e7c5e', chalk: '#efe8d8', peg: '#86532e', pegTop: '#efcf95', earth: '#b59a6a', slab: '#d8ceb6', joint: '#bfb39a',
  rutDeep: 'rgba(50,32,18,0.5)', tuft: 'rgba(92,128,58,0.55)', gravel: '#b4a07c', ditch: 'rgba(52,64,40,0.45)',
} as const;
const STAKE_LIFT = { river: 6, loam: 3 };            // aqueduct arches stand taller over low ground (px)
const AQUA_H = 28;

let viaSeed = -1;
let viaSet = new Set<number>();
let bridgeSet = new Set<number>();
function viaOf(s: GameState): { via: Set<number>; bridge: Set<number> } {
  if (s.seed !== viaSeed) {
    const sv = getMap(s.seed).survey;
    viaSeed = s.seed;
    viaSet = new Set(sv.via);
    bridgeSet = new Set(sv.bridge);
  }
  return { via: viaSet, bridge: bridgeSet };
}

/** A survey street of the active pomerium that has no road yet (drawn as chalk). */
function chalkAt(s: GameState, i: number, rings: number[], road: Uint8Array): boolean {
  const sv = getMap(s.seed).survey;
  return sv.street[i] === 1 && road[i] === 0 && rings.includes(sv.streetRing[i]);
}

/** A hash of everything the decals of a tile rectangle depend on (roads, chalk, doorsteps, pomerium, forum stage). */
export function decalSig(s: GameState, r: Rect): number {
  const d = derived(s), rings = ringsOf(s);
  let h = (2166136261 ^ RANK_DEFS[s.rank].forumStage) >>> 0;
  for (let y = r.y - 1; y <= r.y + r.h; y++)
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      const v = d.road[i] * 16 + (chalkAt(s, i, rings, d.road) ? 1 : 0) + (d.buildingAt[i] ? 2 : 0) + (d.pomerium[i] ? 4 : 0)
        + (d.road[i] ? wearOf(footfall(s, i)) * 64 : 0) + (d.wall[i] === 2 ? 256 : 0);
      h = Math.imul(h ^ v, 16777619);
    }
  return h >>> 0;
}

/** Paints the ground decals of a tile rectangle (world-px transform applied). */
export function paintDecals(g: CanvasRenderingContext2D, s: GameState, r: Rect, season: SeasonIndex): void {
  const map = getMap(s.seed), sv = map.survey, d = derived(s), rings = ringsOf(s);
  const { via, bridge } = viaOf(s);
  paintForum(g, sv.forum, RANK_DEFS[s.rank].forumStage);
  const road = (x: number, y: number): boolean => inBounds(x, y) && d.road[idx(x, y)] > 0;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = idx(x, y), X = x * TILE, Y = y * TILE;
      if (bridge.has(i)) { g.drawImage(sprite('l_bridge'), X, Y); continue; }
      const rv = d.road[i];
      if (rv) {
        const wide = sv.street[i] === 1 || d.pomerium[i] === 1 || sv.wall[i] === 2 || d.wall[i] === 2 || via.has(i);
        const door = (nx: number, ny: number): boolean => !wide && inBounds(nx, ny) && d.buildingAt[idx(nx, ny)] > 0;
        const link = [road(x, y - 1) || door(x, y - 1), road(x + 1, y) || door(x + 1, y), road(x, y + 1) || door(x, y + 1), road(x - 1, y) || door(x - 1, y)];
        const wear = wearOf(footfall(s, i));
        if (wide) paintStreet(g, X, Y, rv, link, season, x, y, wear);
        else paintTrack(g, X, Y, rv, link, season, wear, x, y);
      } else if (chalkAt(s, i, rings, d.road)) {
        const st = (nx: number, ny: number): boolean => inBounds(nx, ny)
          && ((sv.street[idx(nx, ny)] === 1 && rings.includes(sv.streetRing[idx(nx, ny)])) || d.road[idx(nx, ny)] > 0);
        paintChalk(g, X, Y, [st(x, y - 1), st(x + 1, y), st(x, y + 1), st(x - 1, y)], hash2(x, y, 13));
      }
    }
}

/** A full-width street tile: dirt with ruts and pebbles, or basalt setts; edges or kerbs where no road continues. A dirt
 *  street few feet tread grows tufts of grass; a busy one is churned with ruts, the busiest gravelled. */
function paintStreet(g: CanvasRenderingContext2D, X: number, Y: number, rv: number, link: boolean[], season: SeasonIndex, x: number, y: number, wear: number): void {
  const [n, e, s, w] = link;
  if (rv === 2) {
    g.fillStyle = C.paved;
    g.fillRect(X, Y, TILE, TILE);
    g.fillStyle = C.mortar;
    for (let row = 0; row < 4; row++) {
      g.fillRect(X, Y + row * 4 + 3, TILE, 1);
      for (let c = (row + y + x) % 2 ? 2 : 0; c < TILE; c += 5) g.fillRect(X + c, Y + row * 4, 1, 3);
    }
    g.fillStyle = C.speck;
    for (let k = 0; k < 4; k++) g.fillRect(X + Math.floor(hash2(x, y, 60 + k) * 15), Y + Math.floor(hash2(x, y, 70 + k) * 15), 1, 1);
    const kerb = (kx: number, ky: number, kw: number, kh: number, sx: number, sy: number, sw: number, sh: number): void => {
      g.fillStyle = C.kerb; g.fillRect(kx, ky, kw, kh);
      g.fillStyle = C.kerbShade; g.fillRect(sx, sy, sw, sh);
    };
    if (!n) kerb(X, Y, TILE, 2, X, Y + 2, TILE, 1);
    if (!s) kerb(X, Y + 14, TILE, 2, X, Y + 13, TILE, 1);
    if (!w) kerb(X, Y, 2, TILE, X + 2, Y, 1, TILE);
    if (!e) kerb(X + 14, Y, 2, TILE, X + 13, Y, 1, TILE);
    return;
  }
  g.fillStyle = DIRT[season];
  g.fillRect(X, Y, TILE, TILE);
  g.fillStyle = wear >= 3 ? C.rutDeep : C.rut;
  const horiz = (e || w) && !(n || s), vert = (n || s) && !(e || w);
  const gap = wear === 0 ? 0.6 : wear === 1 ? 0.3 : 0.08;            // the more feet, the more unbroken the ruts
  for (let k = 0; k < TILE; k++) {
    if (hash2(x * TILE + k, y, 41) < gap) continue;
    if (horiz) { g.fillRect(X + k, Y + 5, 1, 1); g.fillRect(X + k, Y + 10, 1, 1); if (wear >= 3) { g.fillRect(X + k, Y + 6, 1, 1); g.fillRect(X + k, Y + 9, 1, 1); } }
    if (vert) { g.fillRect(X + 5, Y + k, 1, 1); g.fillRect(X + 10, Y + k, 1, 1); if (wear >= 3) { g.fillRect(X + 6, Y + k, 1, 1); g.fillRect(X + 9, Y + k, 1, 1); } }
  }
  g.fillStyle = C.pebble;
  const pebbles = wear >= 3 ? 9 : 3;
  for (let k = 0; k < pebbles; k++) if (hash2(x, y, 80 + k) > 0.4) g.fillRect(X + 1 + Math.floor(hash2(x, y, 90 + k) * 14), Y + 1 + Math.floor(hash2(x, y, 95 + k) * 14), 1, 1);
  if (wear === 0) {                                                   // a quiet lane: grass in the middle
    g.fillStyle = C.tuft;
    for (let k = 0; k < 4; k++) if (hash2(x, y, 110 + k) > 0.35) g.fillRect(X + 3 + Math.floor(hash2(x, y, 120 + k) * 10), Y + 3 + Math.floor(hash2(x, y, 130 + k) * 10), 2, 1);
  }
  g.fillStyle = DIRT_EDGE[season];
  if (!n) g.fillRect(X, Y, TILE, 1);
  if (!s) g.fillRect(X, Y + 15, TILE, 1);
  if (!w) g.fillRect(X, Y, 1, TILE);
  if (!e) g.fillRect(X + 15, Y, 1, TILE);
}

/** Lane half-widths of a road on open land by its wear: a grassy track, a track, a road, a highway (px either side of the
 *  tile's middle line). */
const LANE = [2, 3, 4, 6] as const;

/** A road on open land: a lane with a 1 px edge, arms toward linked neighbours and doorsteps, as wide as its footfall
 *  wore it. A grassy track is broken by turf; a road shows two ruts; a highway is gravelled, with a ditch on each side. */
function paintTrack(g: CanvasRenderingContext2D, X: number, Y: number, rv: number, link: boolean[], season: SeasonIndex, wear: number, x: number, y: number): void {
  const [n, e, s, w] = link;
  const hw = LANE[wear], a = 8 - hw, b = 8 + hw;                      // the lane spans [a, b)
  for (const pass of [0, 1]) {
    const k = pass ? 0 : 1;
    g.fillStyle = pass ? (rv === 2 ? C.paved : wear >= 3 ? C.gravel : DIRT[season]) : rv === 2 ? C.mortar : DIRT_EDGE[season];
    g.fillRect(X + a - k, Y + a - k, 2 * hw + 2 * k, 2 * hw + 2 * k);
    if (n) g.fillRect(X + a - k, Y, 2 * hw + 2 * k, a);
    if (s) g.fillRect(X + a - k, Y + b, 2 * hw + 2 * k, TILE - b);
    if (w) g.fillRect(X, Y + a - k, a, 2 * hw + 2 * k);
    if (e) g.fillRect(X + b, Y + a - k, TILE - b, 2 * hw + 2 * k);
  }
  if (rv === 2) return;
  const horiz = (e || w) && !(n || s), vert = (n || s) && !(e || w);
  if (wear === 0) {                                                   // turf breaks the little-used track
    g.fillStyle = C.tuft;
    for (let k = 0; k < 3; k++) if (hash2(x, y, 140 + k) > 0.4) g.fillRect(X + a + Math.floor(hash2(x, y, 150 + k) * (2 * hw)), Y + 2 + Math.floor(hash2(x, y, 160 + k) * 12), 1, 1);
    return;
  }
  if (wear >= 2 && (horiz || vert)) {                                 // two ruts along the lane
    g.fillStyle = C.rut;
    for (let k = 0; k < TILE; k++) {
      if (hash2(x * TILE + k, y, 43) < 0.2) continue;
      if (horiz) { g.fillRect(X + k, Y + a + 1, 1, 1); g.fillRect(X + k, Y + b - 2, 1, 1); }
      else { g.fillRect(X + a + 1, Y + k, 1, 1); g.fillRect(X + b - 2, Y + k, 1, 1); }
    }
  }
  if (wear >= 3) {                                                    // a highway: gravel and a ditch either side
    g.fillStyle = C.pebble;
    for (let k = 0; k < 6; k++) g.fillRect(X + a + Math.floor(hash2(x, y, 170 + k) * (2 * hw)), Y + a + Math.floor(hash2(x, y, 180 + k) * (2 * hw)), 1, 1);
    g.fillStyle = C.ditch;
    if (horiz) { g.fillRect(X, Y + a - 2, TILE, 1); g.fillRect(X, Y + b + 1, TILE, 1); }
    if (vert) { g.fillRect(X + a - 2, Y, 1, TILE); g.fillRect(X + b + 1, Y, 1, TILE); }
  }
}

/** A staked street: a dashed chalk line toward street neighbours and a groma peg at junctions. */
function paintChalk(g: CanvasRenderingContext2D, X: number, Y: number, link: boolean[], h: number): void {
  g.globalAlpha = 0.6;
  g.fillStyle = C.chalk;
  const [n, e, s, w] = link;
  for (let k = 0; k < 8; k += 3) {
    if (n) g.fillRect(X + 7, Y + k, 2, 2);
    if (s) g.fillRect(X + 7, Y + 14 - k, 2, 2);
    if (w) g.fillRect(X + k, Y + 7, 2, 2);
    if (e) g.fillRect(X + 14 - k, Y + 7, 2, 2);
  }
  g.globalAlpha = 1;
  if (link.filter(Boolean).length >= 3 || (n !== s) || (e !== w) || h < 0.25) {
    g.fillStyle = C.peg; g.fillRect(X + 7, Y + 6, 2, 3);
    g.fillStyle = C.pegTop; g.fillRect(X + 7, Y + 6, 2, 1);
  }
}

/** The forum ground: packed earth for the camp (stages 0–1), travertine slabs from stage 2. */
function paintForum(g: CanvasRenderingContext2D, f: Rect, stage: number): void {
  const X = f.x * TILE, Y = f.y * TILE, w = f.w * TILE, h = f.h * TILE;
  g.fillStyle = stage >= 2 ? C.kerbShade : DIRT_EDGE[0];
  g.fillRect(X, Y, w, h);
  g.fillStyle = stage >= 2 ? C.slab : C.earth;
  g.fillRect(X + 1, Y + 1, w - 2, h - 2);
  if (stage < 2) return;
  g.fillStyle = C.joint;
  for (let y = 8; y < h - 1; y += 8) {
    g.fillRect(X + 1, Y + y, w - 2, 1);
    for (let x = (y / 8) % 2 ? 6 : 12; x < w - 1; x += 12) g.fillRect(X + x, Y + y - 7, 1, 7);
  }
}

/** Pushes the walls, gatehouses, aqueduct spans and the via milestone that stand in view onto the draw list. */
export function linearItems(s: GameState, vis: Rect, push: Push): void {
  const map = getMap(s.seed), sv = map.survey;
  if (!isRazed(s)) castrumWalls(s, vis, push);
  if (s.urbs.moenia) townWall(s, s.urbs.moenia, vis, push);
  for (const b of s.buildings) if (b.type === 'castellum' && b.route?.length) aqueduct(s, b.route, b.status === 'done' ? 1 : b.progress, vis, push);
  const end = sv.via[sv.via.length - 1];
  if (end !== undefined) {
    const X = (end % W) * TILE + 9, B = Math.floor(end / W) * TILE + 1;
    const spr = sprite('n_milestone');
    push(B, X, (g) => g.drawImage(spr, X, B - spr.height));
  }
}

/** The castrum's vallum (murus from Oppidum) and its four gatehouses, while the camp stands. */
function castrumWalls(s: GameState, vis: Rect, push: Push): void {
  const sv = getMap(s.seed).survey;
  const stone = s.rank >= 2;
  const wall = (x: number, y: number): number => (inBounds(x, y) ? sv.wall[idx(x, y)] : 0);
  const c = sv.castrum;
  for (let y = Math.max(c.y, vis.y - 2); y < Math.min(c.y + c.h, vis.y + vis.h + 2); y++)
    for (let x = Math.max(c.x, vis.x - 2); x < Math.min(c.x + c.w, vis.x + vis.w + 2); x++) {
      const v = wall(x, y);
      if (!v) continue;
      const hz = wall(x - 1, y) > 0 || wall(x + 1, y) > 0, vt = wall(x, y - 1) > 0 || wall(x, y + 1) > 0;
      const X = x * TILE, B = (y + 1) * TILE;
      if (v === 2) {
        const o = hz ? 'h' : 'v';
        const spr = sprite(`l_gate_${stone ? 'stone' : 'timber'}_${o}`);
        // h: bottom-aligned on the gate tile (its wall stubs continue the wall tiles beside it). v (WP-G2): north tower
        // rows 0–21 on the tile above, the walkway (22–30) across the road on the gate tile, the south tower's top
        // (28–39) ending where the next wall tile's 8 px overhang begins — so the sprite's bottom sits half a tile low.
        const bottom = o === 'h' ? B : B + (TILE >> 1);
        push(bottom, X, (g) => {
          g.drawImage(spr, X + 8 - (spr.width >> 1), bottom - spr.height);
          gateDress(g, s, X + 8 - (spr.width >> 1), bottom - spr.height, o);
        });
        continue;
      }
      if ((hz && !vt && (wall(x - 1, y) === 2 || wall(x + 1, y) === 2)) || (vt && !hz && (wall(x, y - 1) === 2 || wall(x, y + 1) === 2))) continue;
      const spr = sprite(`l_${stone ? 'murus' : 'vallum'}_${hz && vt ? 'c' : hz ? 'h' : 'v'}`);
      const face = stone && hz && !vt;
      push(B, X, (g) => {
        g.drawImage(spr, X, B - spr.height);
        if (face) wallBanner(g, s, x, y, X, B);
      });
    }
}

let builtKey: { mo: Moenia | null; n: number; set: Map<number, number> } = { mo: null, n: -1, set: new Map() };

/** The town wall's finished tiles (the first share of its building order): tile → 1 wall, 2 gate. */
function builtWall(mo: Moenia): Map<number, number> {
  const n = mo.done !== null ? mo.tiles.length : Math.floor(mo.tiles.length * Math.max(0, Math.min(1, mo.progress)));
  if (builtKey.mo === mo && builtKey.n === n) return builtKey.set;
  const gates = new Set(mo.gates);
  const set = new Map<number, number>();
  for (let k = 0; k < n; k++) set.set(mo.tiles[k], gates.has(mo.tiles[k]) ? 2 : 1);
  builtKey = { mo, n, set };
  return set;
}

/** True on a finished tile of the town wall (the minimap). */
export function wallBuilt(s: GameState, i: number): boolean {
  const mo = s.urbs.moenia;
  return !!mo && builtWall(mo).has(i);
}

/** The town wall: murus pieces joined to their finished neighbours, a gatehouse where a road passes, a tower at a postern
 *  with no road yet; the line still to rise is staked out (a peg and a chalk mark per tile). */
function townWall(s: GameState, mo: Moenia, vis: Rect, push: Push): void {
  const d = derived(s);
  const built = builtWall(mo);
  const at = (x: number, y: number): number => (inBounds(x, y) ? built.get(idx(x, y)) ?? 0 : 0);
  const arches = new Set<number>();                                  // an aqueduct passes through the wall on its arches there
  for (const b of s.buildings) if (b.type === 'castellum' && b.route) for (const i of b.route) arches.add(i);
  const gateHouse = (x: number, y: number): boolean => at(x, y) === 2 && d.road[idx(x, y)] > 0;
  for (const i of mo.tiles) {
    const x = i % W, y = Math.floor(i / W);
    if (x < vis.x - 2 || y < vis.y - 2 || x > vis.x + vis.w + 2 || y > vis.y + vis.h + 2) continue;
    const X = x * TILE, B = (y + 1) * TILE;
    const v = at(x, y);
    if (arches.has(i)) continue;
    if (!v) {
      push(B - 4, X, (g) => {
        g.globalAlpha = 0.7;
        g.fillStyle = C.chalk; g.fillRect(X + 2, B - 8, 12, 1);
        g.globalAlpha = 1;
        g.fillStyle = C.peg; g.fillRect(X + 7, B - 12, 2, 6);
        g.fillStyle = C.pegTop; g.fillRect(X + 7, B - 12, 2, 1);
      });
      continue;
    }
    const hz = at(x - 1, y) > 0 || at(x + 1, y) > 0, vt = at(x, y - 1) > 0 || at(x, y + 1) > 0;
    if (gateHouse(x, y)) {
      const roadNS = (inBounds(x, y - 1) && d.road[idx(x, y - 1)] > 0) || (inBounds(x, y + 1) && d.road[idx(x, y + 1)] > 0);
      const o = roadNS ? 'h' : 'v';
      const spr = sprite(`l_gate_stone_${o}`);
      const bottom = o === 'h' ? B : B + (TILE >> 1);
      push(bottom, X, (g) => {
        g.drawImage(spr, X + 8 - (spr.width >> 1), bottom - spr.height);
        gateDress(g, s, X + 8 - (spr.width >> 1), bottom - spr.height, o);
      });
      continue;
    }
    // the gatehouse's own wall stubs stand on the tiles beside it
    if ((hz && !vt && (gateHouse(x - 1, y) || gateHouse(x + 1, y))) || (vt && !hz && (gateHouse(x, y - 1) || gateHouse(x, y + 1)))) continue;
    const spr = sprite(`l_murus_${v === 2 || (hz && vt) || (!hz && !vt) ? 'c' : hz ? 'h' : 'v'}`);
    const face = hz && !vt && v === 1;
    push(B, X, (g) => {
      g.drawImage(spr, X, B - spr.height);
      if (face) wallBanner(g, s, x, y, X, B);
    });
  }
}

/** Aqueduct spans from the spring: arches along E–W runs, piers on N–S runs and corners; built share = progress. The
 *  rest of the route is staked out (a peg and a chalk mark per tile), so a castellum at 0% already shows its line. */
function aqueduct(s: GameState, route: number[], progress: number, vis: Rect, push: Push): void {
  const n = Math.floor(route.length * Math.max(0, Math.min(1, progress)));
  for (let k = 0; k < route.length; k++) {
    const i = route[k], x = i % W, y = Math.floor(i / W);
    if (x < vis.x - 1 || y < vis.y - 1 || x > vis.x + vis.w || y > vis.y + vis.h + 2) continue;
    const X = x * TILE, B = (y + 1) * TILE;
    if (k < n) push(B, X, (g) => drawSpan(g, s, route, k));
    else push(B - 4, X, (g) => {
      g.globalAlpha = 0.7;
      g.fillStyle = C.chalk; g.fillRect(X + 4, B - 5, 8, 1);
      g.globalAlpha = 1;
      g.fillStyle = C.peg; g.fillRect(X + 7, B - 10, 2, 6);
      g.fillStyle = C.pegTop; g.fillRect(X + 7, B - 10, 2, 1);
    });
  }
}

/** One aqueduct span (the k-th tile of a route) with its feet on the tile's bottom edge, lifted over low ground. */
export function drawSpan(g: CanvasRenderingContext2D, s: GameState, route: readonly number[], k: number): void {
  const i = route[k], x = i % W, y = Math.floor(i / W);
  const a = route[k - 1] ?? i, b = route[k + 1] ?? i;
  const dx = (a % W !== x ? 1 : 0) + (b % W !== x ? 1 : 0), dy = (Math.floor(a / W) !== y ? 1 : 0) + (Math.floor(b / W) !== y ? 1 : 0);
  const spr = sprite(dx && dy ? 'l_aqua_pier' : dx ? 'l_aqua_ew' : 'l_aqua_ns');
  const t = getMap(s.seed).terrain[i];
  const lift = t === 9 ? STAKE_LIFT.river : t === 2 ? STAKE_LIFT.loam : 0;
  const X = x * TILE, B = (y + 1) * TILE;
  g.drawImage(spr, X, B - lift - AQUA_H);
  if (lift) g.drawImage(spr, 0, spr.height - 1, spr.width, 1, X, B - lift, spr.width, lift);
}

// src/render/decor.ts — what the path choices and the cosmetic rewards add to the map (DESIGN §9.2 "You will see …",
// §9.4 Res Gestae rewards). Owner: batch C (render). Read-only on the state; every piece is drawn by the layer it
// belongs to (forum dressing after the forum sprite, gate garlands with the gatehouse, fields' haystacks y-sorted …).
//
//  · veterani       walkers in legion-red cloaks (actors.ts); red vexilla added before the principia
//  · agricolae      centuriation boundary stones at the corners of every field
//  · mercatores     market stalls in the forum; a third mule joins each caravan (convoys.ts)
//  · canabae        striped shop awnings over the doors of the casae and tiled cottages
//  · pagus          haystacks in the fields from Aestas to Hiems
//  · arsFabrilis    denser, larger smoke plumes (particles.ts); a smith's anvil sign on every gatehouse
//  · pietas         twice the incense (particles.ts); garlands across the shrines and temples
//  · iusLatii       half the grown walkers in a citizen's plain toga (actors.ts)
//  · annonaPublica  a grain-dole table with its queue in the forum
//  · aquaeSalutares twice the steam from the baths and the sparkle of the fountains (particles.ts)
//  · gildedStandards a gilded aquila and signum before the principia · bronzeStatues two bronze statues in the forum
//  · minimapFountains fountains twinkle on the minimap (minimap.ts) · purpleBanners purple banners along the stone walls
//  · gildedQuadriga a gilded quadriga on the forum's arch · triumphalGarlands garlands on the gates
//  · festalLanterns strings of lanterns over the forum
import type { Building, GameState, PathOptionId } from '../game/types';
import { isUnlocked } from '../game/decisions';
import { hash2 } from '../game/rng';
import { hasSprite, sprite, tinted } from './sprites';
import { TILE } from './camera';

/** The visible marks of the colony's choices and rewards. */
export interface Looks {
  cloaks: boolean; togas: boolean; mules: boolean;
  standards: boolean; stalls: boolean; dole: boolean; gilded: boolean; statues: boolean; quadriga: boolean; lanterns: boolean;
  cippi: boolean; hay: boolean; awnings: boolean; shrines: boolean;
  anvil: boolean; gateGarlands: boolean; banners: boolean; fountains: boolean;
  smoke: number; incense: number; baths: number;            // ambient particle rate multipliers
}

const COSMETIC = ['gildedStandards', 'bronzeStatues', 'minimapFountains', 'purpleBanners', 'gildedQuadriga', 'triumphalGarlands', 'festalLanterns'] as const;
let lookState: GameState | null = null;
let lookPaths: Record<string, string> = {};
let lookMilestones = -1;
let lookVal: Looks | null = null;

/** The number of keys of a small record, without allocating. */
function size(o: object): number {
  let n = 0;
  for (const _ in o) n++;
  return n;
}

/** Whether two small records hold the same entries (no allocation). */
function same(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  for (const k in a) if (a[k] !== b[k]) return false;
  for (const k in b) if (!(k in a)) return false;
  return true;
}

/** The colony's looks; cached until a path is chosen or a milestone is recorded (it is read many times a frame). */
export function looks(s: GameState): Looks {
  const nm = size(s.guidance.milestoneDays);
  if (lookVal && s === lookState && nm === lookMilestones && same(lookPaths, s.decisions.paths)) return lookVal;
  const paths = Object.values(s.decisions.paths) as PathOptionId[];
  const has = (p: PathOptionId): boolean => paths.includes(p);
  const c = Object.fromEntries(COSMETIC.map((id) => [id, isUnlocked(s, { kind: 'cosmetic', id, label: '' })])) as Record<(typeof COSMETIC)[number], boolean>;
  lookState = s;
  lookPaths = { ...s.decisions.paths };
  lookMilestones = nm;
  lookVal = {
    cloaks: has('veterani'), togas: has('iusLatii'), mules: has('mercatores'),
    standards: has('veterani'), stalls: has('mercatores'), dole: has('annonaPublica'),
    gilded: c.gildedStandards, statues: c.bronzeStatues, quadriga: c.gildedQuadriga, lanterns: c.festalLanterns,
    cippi: has('agricolae'), hay: has('pagus'), awnings: has('canabae'), shrines: has('pietas'),
    anvil: has('arsFabrilis'), gateGarlands: c.triumphalGarlands, banners: c.purpleBanners, fountains: c.minimapFountains,
    smoke: has('arsFabrilis') ? 1.6 : 1, incense: has('pietas') ? 2 : 1, baths: has('aquaeSalutares') ? 2 : 1,
  };
  return lookVal;
}

// ───────────────────────────── the forum ─────────────────────────────
type At = readonly [number, number];          // a foot point in p_forum_* sprite px (x centre, y bottom)
interface ForumSlots {
  std: { y: number; outer: readonly [number, number]; inner: readonly [number, number] };
  stalls: readonly At[]; statues: readonly At[];
  dole: { table: At; queue: readonly At[] } | null;
  quadriga: At | null; lanterns: readonly number[];
}
/** Free ground of each forum stage (art/forum.ts), so the dressing never stands on the baked statues, wells or tents. */
const FORUM: readonly ForumSlots[] = [
  { std: { y: 74, outer: [40, 104], inner: [48, 96] }, stalls: [[50, 100], [71, 100], [92, 100]], statues: [[58, 130], [86, 130]],
    dole: { table: [40, 130], queue: [[54, 131], [60, 132], [66, 131]] }, quadriga: null, lanterns: [58, 94] },
  { std: { y: 68, outer: [28, 116], inner: [52, 92] }, stalls: [[56, 112], [74, 112], [92, 112]], statues: [[40, 128], [104, 128]],
    dole: { table: [58, 128], queue: [[72, 129], [78, 130], [84, 129]] }, quadriga: null, lanterns: [52, 92] },
  { std: { y: 64, outer: [42, 102], inner: [56, 88] }, stalls: [[50, 90], [72, 90], [94, 90]], statues: [[40, 126], [110, 126]],
    dole: { table: [64, 126], queue: [[78, 127], [84, 128], [90, 127], [96, 128]] }, quadriga: [72, 40], lanterns: [72, 104] },
  { std: { y: 64, outer: [42, 102], inner: [50, 94] }, stalls: [[56, 88], [72, 88], [88, 88]], statues: [[56, 120], [88, 120]],
    dole: { table: [100, 130], queue: [[86, 130], [79, 131], [72, 130], [65, 131]] }, quadriga: [72, 46], lanterns: [72, 104] },
  { std: { y: 64, outer: [44, 100], inner: [52, 92] }, stalls: [[46, 130], [98, 130]], statues: [[20, 96], [124, 96]],
    dole: { table: [24, 106], queue: [[36, 106], [40, 112], [44, 117]] }, quadriga: [72, 110], lanterns: [56, 82] },
];

/** Draws the forum's dressing over its sprite (top-left at left, top) for a forum stage 0–4. */
export function forumDress(g: CanvasRenderingContext2D, s: GameState, left: number, top: number, stage: number): void {
  const L = looks(s), f = FORUM[Math.max(0, Math.min(FORUM.length - 1, stage))];
  const items: { x: number; y: number; name: string; flip?: boolean }[] = [];
  const add = (name: string, [x, y]: At, flip = false): void => { if (hasSprite(name)) items.push({ x, y, name, flip }); };
  if (L.standards) for (const x of f.std.outer) add('x_vexillum', [x, f.std.y]);
  if (L.gilded) { add('x_aquila', [f.std.inner[0], f.std.y]); add('x_signum_gilt', [f.std.inner[1], f.std.y]); }
  if (L.stalls) f.stalls.forEach((p, k) => add(`x_stall_${k % 2}`, p));
  if (L.statues) for (const p of f.statues) add('x_statue', p);
  if (L.dole && f.dole) {
    add('x_dole', f.dole.table);
    f.dole.queue.forEach((p) => add('a_person_idle', p, p[0] > f.dole!.table[0]));
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of items) {
    const spr = it.name === 'a_person_idle' ? queuer(it.x + it.y) : sprite(it.name);
    const x = Math.round(left + it.x - spr.width / 2), y = top + it.y - spr.height;
    if (it.flip) { g.save(); g.translate(x + spr.width, y); g.scale(-1, 1); g.drawImage(spr, 0, 0); g.restore(); }
    else g.drawImage(spr, x, y);
  }
  if (L.lanterns && hasSprite('ov_lanterns')) {
    const ln = sprite('ov_lanterns');
    for (const y of f.lanterns) for (let x = 16; x + ln.width <= 128 + 1; x += ln.width) g.drawImage(ln, left + x, top + y - ln.height);
  }
  if (L.quadriga && f.quadriga && hasSprite('p_crown_iuppiter')) {         // on the arch, above the lantern strings
    const q = sprite('p_crown_iuppiter');
    g.drawImage(q, Math.round(left + f.quadriga[0] - q.width / 2), top + f.quadriga[1] - q.height);
  }
}

const QUEUE_TUNICS = ['#d9a35b', '#8a6b4a', '#bba58b', '#62b0d6', '#55565e', '#c0623f'];
/** A person waiting for the dole (tunic by a stable hash of the spot). */
function queuer(seed: number): HTMLCanvasElement {
  return tinted('a_person_idle', { S: QUEUE_TUNICS[Math.floor(hash2(seed, 91) * QUEUE_TUNICS.length)], A: '#5d3b2a', U: '#6f5639' });
}

// ───────────────────────────── houses, shrines, fields ─────────────────────────────
const AWNING_TIERS: readonly string[] = ['casa', 'tegulata'];
/** Canabae: a shop awning over the door of most casae and tiled cottages (sprite top-left left, bottom). */
export function houseDress(g: CanvasRenderingContext2D, s: GameState, b: Building, left: number, bottom: number): void {
  if (!b.house || !AWNING_TIERS.includes(b.house.tier) || !looks(s).awnings || hash2(b.id, 17) >= 0.7) return;
  const a = sprite('x_awning');
  g.drawImage(a, left + 5, bottom - a.height - 2);
}

const SHRINE_GARLAND: Partial<Record<string, { x: number; y: number; n: number }>> = {
  lararium: { x: 3, y: 10, n: 1 },     // across the aedicula's front, under its pediment (32×28 sprite)
  templum: { x: 8, y: 30, n: 2 },      // across the pronaos under the pediment (64×72 sprite)
};
/** Pietas: garlands across the fronts of the shrines and temples (sprite top-left left, top). */
export function shrineDress(g: CanvasRenderingContext2D, s: GameState, b: Building, left: number, top: number): void {
  const at = SHRINE_GARLAND[b.type];
  if (!at || !looks(s).shrines) return;
  const gl = sprite('x_garland');
  for (let k = 0; k < at.n; k++) g.drawImage(gl, left + at.x + k * gl.width, top + at.y);
}

/** Agricolae: a boundary stone at each corner of a field (ground pass, after the field; footprint in world px). */
export function fieldStones(g: CanvasRenderingContext2D, s: GameState, X: number, Y: number, w: number, h: number): void {
  if (!looks(s).cippi) return;
  const c = sprite('x_cippus');
  for (const [x, y] of [[X + 1, Y + 2], [X + w - c.width - 1, Y + 2], [X + 1, Y + h - c.height - 1], [X + w - c.width - 1, Y + h - c.height - 1]])
    g.drawImage(c, x, y);
}

/** Pagus: one or two haystacks on a field from Aestas to Hiems (y-sorted; footprint in tiles). */
export function fieldHay(s: GameState, b: Building, X: number, Y: number, w: number, h: number, season: number,
  push: (y: number, x: number, draw: (g: CanvasRenderingContext2D) => void) => void): void {
  if (season === 0 || !looks(s).hay) return;
  const hay = sprite('x_haystack');
  const n = 1 + (hash2(b.id, 23) < 0.6 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    // never on the farmhouse corner (top-left tile of the sprite)
    const fx = X + TILE + 6 + Math.floor(hash2(b.id, 30 + k) * Math.max(1, w - TILE - 18)), fy = Y + TILE + 12 + Math.floor(hash2(b.id, 40 + k) * Math.max(1, h - TILE - 14));
    push(fy, fx, (g) => g.drawImage(hay, fx - (hay.width >> 1), fy - hay.height));
  }
}

// ───────────────────────────── walls and gates ─────────────────────────────
/** Gates: triumphal garlands over the passage, the smiths' anvil sign beside it (sprite top-left x, y; 'h' or 'v'). */
export function gateDress(g: CanvasRenderingContext2D, s: GameState, x: number, y: number, o: 'h' | 'v'): void {
  const L = looks(s);
  if (L.gateGarlands) {
    const gl = sprite('x_garland');
    if (o === 'h') g.drawImage(gl, x + 12, y + 17);
    else g.drawImage(gl, x + 12, y + 19);
  }
  if (L.anvil) {
    const a = sprite('x_anvil');
    if (o === 'h') g.drawImage(a, x + 4, y + 22);
    else g.drawImage(a, x + 33, y + 10);
  }
}

/** Purple banners: on every fourth tile of a stone wall's south face (wall sprite top-left X, bottom B). */
export function wallBanner(g: CanvasRenderingContext2D, s: GameState, tx: number, ty: number, X: number, B: number): void {
  if (!looks(s).banners || (tx + ty) % 4 !== 0) return;
  g.drawImage(sprite('x_banner'), X + 5, B - 18);
}

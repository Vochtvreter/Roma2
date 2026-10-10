// src/game/world/siterules.ts — DESIGN §5.1 site rules (canPlace check 11) on the live state. Owner: WP-A.
// `ruleFail` checks one site and names the failure; `ruleTester` answers the same question for many sites at once
// (prefix sums over the same predicates), so canPlace and validSlots always agree.
import { B } from '../balance';
import { F, T } from '../types';
import type { BuildingId, GameState, PlaceFail, Rect, Survey } from '../types';
import { getMap } from '../map';
import { dayLayout, memo } from '../memo';
import { sizeOf } from '../derived';
import { BUILDING_DEFS } from '../data/buildings';
import { GH, GN, GW, PrefixSum, anySide, rectGap } from './grid';
import { countT, isFertileT, isHillsRockT, isHillsScrubT } from './rules';

const S = B.site;
const WOODS_R = S.VENATIO_R;                      // 5
const WOOD_R = B.economy.WOOD.CATCHMENT;          // 4

/** A failed site rule: its code and the player-facing reason. */
export interface RuleFail { code: PlaceFail; reason: string }

/** Reasons of check 11 (ARCHITECTURE §8.2), by site rule. */
export const RULE_REASON = {
  fertile: 'Fields need seven fertile tiles.',
  woods: 'Needs ten wooded tiles nearby.',
  wood: 'No standing timber within 4 tiles.',
  rocky: 'Needs hills or rock.',
  clay: 'Must touch a clay bank.',
  ore: 'Must stand on an iron vein.',
  scrubHills: 'Olives need dry slopes.',
  via: 'Must touch the via.',
  nearCastellum: 'No castellum within 18 paces.',
  noFons: 'No spring can be reached.',
} as const;

const viaCache = new WeakMap<Survey, Uint8Array>();

/** Tiles of the via line: the via itself and the decumanus inside the castrum (a mansio must touch one). */
export function viaLine(sv: Survey): Uint8Array {
  let m = viaCache.get(sv);
  if (!m) {
    m = new Uint8Array(GN);
    for (const i of sv.via) m[i] = 1;
    const cy = sv.iy + (sv.interior.h - 1) / 2;
    for (let x = sv.interior.x; x < sv.interior.x + sv.interior.w; x++) if (sv.street[cy * GW + x] && sv.streetRing[cy * GW + x] === 0) m[cy * GW + x] = 1;
    viaCache.set(sv, m);
  }
  return m;
}

/** Prefix sums of standing timber and of wooded tiles (≥ 25% of their stock), memo on the layout epoch and the day. */
export function woodSums(s: GameState): { standing: PrefixSum; wooded: PrefixSum } {
  return memo(s, 'woodSums', dayLayout(s), () => {
    const max = getMap(s.seed).woodMax;
    const standing = new Float64Array(GN);
    const wooded = new Uint8Array(GN);
    for (let i = 0; i < GN; i++) {
      if (max[i] <= 0) continue;
      const v = s.wood[i] ?? max[i];
      standing[i] = v;
      if (v >= max[i] * B.economy.WOOD.STUMP) wooded[i] = 1;
    }
    return { standing: new PrefixSum(standing), wooded: new PrefixSum(wooded) };
  });
}

/** The wood layers around one w×h footprint (grown by `r`, footprint excluded), read tile by tile: a placed wood work's
 *  site multiplier is re-read every day, and rebuilding the whole-map prefix sums (woodSums) for a handful of works
 *  cost more than the rest of their day. Bulk slot scoring keeps the prefix sums. */
export function woodAround(s: GameState, x: number, y: number, w: number, h: number, r: number): { standing: number; wooded: number } {
  const max = getMap(s.seed).woodMax;
  let standing = 0, wooded = 0;
  for (let yy = Math.max(0, y - r); yy < Math.min(GH, y + h + r); yy++) {
    for (let xx = Math.max(0, x - r); xx < Math.min(GW, x + w + r); xx++) {
      if (xx >= x && xx < x + w && yy >= y && yy < y + h) continue;
      const i = yy * GW + xx;
      if (max[i] <= 0) continue;
      const v = s.wood[i] ?? max[i];
      standing += v;
      if (v >= max[i] * B.economy.WOOD.STUMP) wooded++;
    }
  }
  return { standing, wooded };
}

/** Sum of a prefix-summed layer over the rect grown by `r` around a w×h footprint, minus the footprint. */
export function aroundSum(ps: PrefixSum, x: number, y: number, w: number, h: number, r: number): number {
  return ps.sum(x - r, y - r, w + 2 * r, h + 2 * r) - ps.sum(x, y, w, h);
}

/** Footprint rects of the finished castella (whose fountains flow). */
function activeCastella(s: GameState): Rect[] {
  const out: Rect[] = [];
  for (const b of s.buildings) {
    if (b.type !== 'castellum' || b.status !== 'done') continue;
    const [w, h] = sizeOf('castellum', 'plot');
    out.push({ x: b.x, y: b.y, w, h });
  }
  return out;
}

/** Check 11 for one site: the first failed DESIGN §5.1 rule of `type` with a w×h footprint at (x, y), or null. */
export function ruleFail(s: GameState, type: BuildingId, x: number, y: number, w: number, h: number): RuleFail | null {
  const map = getMap(s.seed);
  const t = map.terrain, f = map.feature;
  const terrain = (key: keyof typeof RULE_REASON): RuleFail => ({ code: 'terrain', reason: RULE_REASON[key] });
  switch (BUILDING_DEFS[type].rule) {
    case 'fertile':
      return countT(t, x, y, w, h, isFertileT) < S.AGER_FERTILE ? terrain('fertile') : null;
    case 'woods':
      return aroundSum(woodSums(s).wooded, x, y, w, h, WOODS_R) < S.VENATIO_WOODED ? terrain('woods') : null;
    case 'wood':
      return aroundSum(woodSums(s).standing, x, y, w, h, WOOD_R) < B.economy.WOOD.MIN ? terrain('wood') : null;
    case 'rocky':
      return countT(t, x - 1, y - 1, w + 2, h + 2, isHillsRockT) < S.QUARRY_MIN ? terrain('rocky') : null;
    case 'clay': {
      const clay = (i: number): boolean => f[i] === F.clay;
      return countT(f, x, y, w, h, (v) => v === F.clay) > 0 || anySide(x, y, w, h, clay) ? null : terrain('clay');
    }
    case 'ore':
      return countT(f, x, y, w, h, (v) => v === F.ore) > 0 ? null : terrain('ore');
    case 'scrubHills':
      return countT(t, x, y, w, h, isHillsScrubT) < S.OLIVE_MIN ? terrain('scrubHills') : null;
    case 'via': {
      const line = viaLine(map.survey);
      return anySide(x, y, w, h, (i) => line[i] === 1) ? null : { code: 'needsVia', reason: RULE_REASON.via };
    }
    case 'nearCastellum': {
      const me: Rect = { x, y, w, h };
      return activeCastella(s).some((r) => rectGap(me, r) <= B.map.CASTELLUM_REACH) ? null : { code: 'noCastellum', reason: RULE_REASON.nearCastellum };
    }
    default:
      return null;
  }
}

/** A fast yes/no version of `ruleFail` for many w×h sites of one type on the current state (validSlots). */
export function ruleTester(s: GameState, type: BuildingId, w: number, h: number): (x: number, y: number) => boolean {
  const map = getMap(s.seed);
  const t = map.terrain, f = map.feature;
  const ps = (pred: (i: number) => boolean): PrefixSum => {
    const m = new Uint8Array(GN);
    for (let i = 0; i < GN; i++) if (pred(i)) m[i] = 1;
    return new PrefixSum(m);
  };
  switch (BUILDING_DEFS[type].rule) {
    case 'fertile': {
      const p = ps((i) => isFertileT(t[i]));
      return (x, y) => p.sum(x, y, w, h) >= S.AGER_FERTILE;
    }
    case 'woods': {
      const p = woodSums(s).wooded;
      return (x, y) => aroundSum(p, x, y, w, h, WOODS_R) >= S.VENATIO_WOODED;
    }
    case 'wood': {
      const p = woodSums(s).standing;
      return (x, y) => aroundSum(p, x, y, w, h, WOOD_R) >= B.economy.WOOD.MIN;
    }
    case 'rocky': {
      const p = ps((i) => isHillsRockT(t[i]));
      return (x, y) => p.sum(x - 1, y - 1, w + 2, h + 2) >= S.QUARRY_MIN;
    }
    case 'clay': {
      const p = ps((i) => f[i] === F.clay);
      return (x, y) => p.sum(x - 1, y - 1, w + 2, h + 2) - p.sum(x - 1, y - 1, 1, 1) - p.sum(x + w, y - 1, 1, 1)
        - p.sum(x - 1, y + h, 1, 1) - p.sum(x + w, y + h, 1, 1) > 0;
    }
    case 'ore': {
      const p = ps((i) => f[i] === F.ore);
      return (x, y) => p.sum(x, y, w, h) > 0;
    }
    case 'scrubHills': {
      const p = ps((i) => isHillsScrubT(t[i]));
      return (x, y) => p.sum(x, y, w, h) >= S.OLIVE_MIN;
    }
    case 'via': {
      const line = viaLine(map.survey);
      return (x, y) => anySide(x, y, w, h, (i) => line[i] === 1);
    }
    case 'nearCastellum': {
      const cs = activeCastella(s);
      return (x, y) => cs.some((r) => rectGap({ x, y, w, h }, r) <= B.map.CASTELLUM_REACH);
    }
    default:
      return () => true;
  }
}

/** True when the type's site depends on standing wood (its validity changes as woods are cut, not only with the structure). */
export function woodDependent(type: BuildingId): boolean {
  const r = BUILDING_DEFS[type].rule;
  return r === 'woods' || r === 'wood';
}

/** Terrain tile classes that check 9 forbids for a type: river, crag, sacred ground, ore (mines only), rock (quarries and mines only). */
export function terrainFail(type: BuildingId, terrain: number, feature: number): RuleFail | null {
  if (terrain === T.river) return { code: 'water', reason: 'The river.' };
  if (terrain === T.crag) return { code: 'crag', reason: 'Too steep to build.' };
  if (feature === F.lucus || feature === F.ruins || feature === F.fons) return { code: 'sacred', reason: 'Sacred ground: the gods would not forgive it.' };
  if (feature === F.ore && type !== 'fodina') return { code: 'terrain', reason: 'An iron vein: keep it for a mine.' };
  if (terrain === T.rock && type !== 'lapicidina' && type !== 'fodina') return { code: 'terrain', reason: 'Too rocky to build.' };
  return null;
}

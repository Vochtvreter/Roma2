// src/game/ordo/labour.ts — how the Ordo staffs, and manual labour targets (ARCHITECTURE §8.4, DESIGN §10.4). Owner: WP-C.
// SCAFFOLD: water first (wells to need × WATER_BASE, passive counted first), then food (to need, ≤ FOOD_CAP of the
// workforce), then builders while a site is workable; steps 3 and 5–11 are STUBs.
import { B } from '../balance';
import { LABOR_CATS } from '../types';
import type { Building, GameState, LaborCat, LabourLine, LabourPlan, Reason, ResId, SimView } from '../types';
import { seasonOf } from '../calendar';
import { seasonMult } from '../economy';
import { settingValue } from '../decisions';
import { getBuilding } from '../state';
import { BUILDING_DEFS } from '../data/buildings';

/** Buildings of a labour category that can take workers: finished, open, High priority first, then id. */
function posts(s: GameState, cat: LaborCat): Building[] {
  return s.buildings
    .filter((b) => b.status === 'done' && b.open && BUILDING_DEFS[b.type].labor === cat && BUILDING_DEFS[b.type].slots > 0)
    .sort((a, b) => b.prio - a.prio || a.id - b.id);   // STUB(WP-C): best marginal output, then nearest the forum
}

/** Staffs producers of `res` in category `cat` one worker at a time until output ≥ goal; returns workers used. */
function staffToward(s: GameState, cat: LaborCat, res: ResId, goal: number, max: number, out: Record<number, number>): number {
  const season = seasonOf(s.day);
  let made = 0;
  for (const b of s.buildings) {
    const p = BUILDING_DEFS[b.type].passive;
    if (b.status === 'done' && p?.res === res) made += p.perDay * seasonMult(s, b.type, season);
  }
  let used = 0;
  for (const b of posts(s, cat)) {
    const def = BUILDING_DEFS[b.type];
    if (def.output?.res !== res) continue;
    const per = def.output.perWorker * seasonMult(s, b.type, season);
    let n = out[b.id] ?? 0;
    while (made < goal && used < max && n < def.slots && per > 0) { n++; used++; made += per; }
    if (n > 0) out[b.id] = n;
    if (made >= goal || used >= max) break;
  }
  return used;
}

function line(v: SimView, cat: LaborCat, target: number, reason: Reason): LabourLine {
  return { cat, target, have: v.c.catStaffed[cat], slots: v.c.catSlots[cat], reason };
}

/** The Ordo's daily labour plan with a Reason per line (DESIGN §10.4). */
export function planLabour(s: GameState, v: SimView): LabourPlan {
  const c = v.c;
  const perBuilding: Record<number, number> = {};
  const lines: LabourLine[] = [];
  let free = c.workforce;
  // 1 · water
  const wGoal = c.need.water * B.ordo.WATER_BASE;   // STUB(WP-C): low reserve, thirst, Aestas pre-fill bases
  const w = staffToward(s, 'water', 'water', wGoal, free, perBuilding);
  free -= w;
  lines.push(line(v, 'water', w, { code: 'needWater', params: { need: wGoal } }));
  // 2 · food
  const fGoal = c.need.grain;                        // STUB(WP-C): reserve, hunger, Hiems, full-store bases
  const fMax = Math.min(free, Math.floor(c.workforce * B.ordo.FOOD_CAP));
  const f = staffToward(s, 'food', 'grain', fGoal, fMax, perBuilding);
  free -= f;
  lines.push(line(v, 'food', f, { code: 'needFood', params: { need: fGoal } }));
  // 4 · builders
  let builders = 0;
  if (v.d.sites.some((id) => getBuilding(s, id)?.status === 'building')) {
    const share = Math.max(B.ordo.BUILDERS_MIN, Math.round(c.workforce * settingValue(s, 'builderShare')));
    builders = Math.max(0, Math.min(free, share, Math.floor(c.workforce * B.ordo.BUILDERS_MAX)));
    free -= builders;
    lines.push(line(v, 'builders', builders, { code: 'builderShare', params: { n: builders } }));
  }
  // STUB(WP-C): 3 required services, 5 pending inputs, 6 winter stockpile, 7 tools, 8 luxury, 9 services, 10 focus split, 11 leftovers.
  return { perBuilding, builders, lines };
}

/** Manual labour: category targets → buildings (High first, then id), builders as set. */
export function manualPlan(s: GameState, v: SimView): LabourPlan {
  const perBuilding: Record<number, number> = {};
  const lines: LabourLine[] = [];
  let free = v.c.workforce;
  let builders = 0;
  for (const cat of LABOR_CATS) {
    const want = Math.max(0, Math.floor(s.ordo.manual[cat]));
    let got = 0;
    if (cat === 'builders') {
      builders = got = Math.min(free, want);
    } else {
      for (const b of posts(s, cat)) {
        if (got >= want || free - got <= 0) break;
        const n = Math.min(BUILDING_DEFS[b.type].slots, want - got, free - got);
        if (n > 0) { perBuilding[b.id] = n; got += n; }
      }
    }
    free -= got;
    lines.push(line(v, cat, got, { code: 'priority', params: { cat } }));
  }
  return { perBuilding, builders, lines };
}

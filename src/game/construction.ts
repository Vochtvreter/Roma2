// src/game/construction.ts — works queue, stakes, plans, builders, the Capitolium (ARCHITECTURE §8.3, DESIGN §5.3, §9.5). Owner: WP-B.
// Builders pour work into the first site of the queue until it is done, then the next; the Capitolium takes what is left,
// at most CAP_CREW builders' worth, and draws its materials pro rata to the work it receives.
import { B as B$ } from './balance';
import { RESOURCES as RESOURCES$ } from './types';
import type { ActionResult, Building, Cost, GameState, HouseState, Person, ResId, TickContext } from './types';
import { getMap as getMap$ } from './map';
import { invalidate as invalidate$, touchPeople as touchPeople$ } from './memo';
import { canAfford, log, nextId, pay, refund } from './state';
import { getBuilding as getBuilding$ } from './lookup';
import { fx as fx$ } from './fx';
import { census, peopleIndex, stageOf } from './census';
import { buildingRate, legacyMult, productivity } from './economy';
import { gainSkill } from './people';
import { savingFor } from './ordo/saving';
import { settingValue } from './decisions';
import { seasonOf as seasonOf$ } from './calendar';
import { view } from './sim';
import { placementCost } from './place';
import { wallsDay } from './urbs';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, RESOURCES = RESOURCES$, getMap = getMap$, invalidate = invalidate$, touchPeople = touchPeople$, fx = fx$,
  seasonOf = seasonOf$, BUILDING_DEFS = BUILDING_DEFS$,
  getBuilding = getBuilding$;

const C = B.construction;
const EPS = 1e-9;
const STAGE_NAMES = ['Podium', 'Cella', 'Columnae', 'Fastigium'] as const;
const CAP_RES = Object.keys(C.CAP_MAT) as ResId[];

function newHouse(): HouseState {
  return { tier: 'tentoria', pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 };
}

function notFound(): ActionResult {
  return { ok: false, code: 'notFound', reason: 'No such work.' };
}

/** The cost a site was paid (or a plan will pay): its type's cost plus the aqueduct route, × castellum/lacus fx. */
export function siteCost(s: GameState, b: Pick<Building, 'type' | 'route'>): Cost {
  return placementCost(s, b.type, b.route?.length ?? 0);   // one formula with the placement pipeline (WP-A)
}

/** Unfinished buildings (plan, staked, building) in works order: player-owned first, then `order`, then id. */
export function worksQueue(s: GameState): Building[] {
  return s.buildings
    .filter((b) => b.status !== 'done')
    .sort((a, b) => (a.owner === 'player' ? 0 : 1) - (b.owner === 'player' ? 0 : 1) || a.order - b.order || a.id - b.id);
}

/** Staked Ordo sites become building sites after STAKE_DAYS. */
export function startStaked(s: GameState): void {
  for (const b of s.buildings) {
    if (b.status === 'staked' && s.day - b.placed >= C.STAKE_DAYS) b.status = 'building';
  }
}

/** Player plans become paid building sites, in queue order, when the stock covers them (only the petition fee is kept back). */
export function payPlans(s: GameState, ctx: TickContext): void {
  let keep: Cost | null = null;
  for (const b of worksQueue(s)) {
    if (b.status !== 'plan') continue;
    if (keep === null) {
      const sv = savingFor(s, view(s));
      keep = sv?.for === 'petition' ? sv.cost : {};
    }
    const cost = siteCost(s, b);
    if (!canAfford(s, cost, keep)) continue;
    pay(s, cost);
    for (const r of RESOURCES) {
      const k = cost[r] ?? 0;
      if (k > 0) ctx.rates.cons[r].construction = (ctx.rates.cons[r].construction ?? 0) + k;
    }
    b.paid = true;
    b.status = 'building';
    b.placed = s.day;
    log(s, 'build', `The stores now cover the ${BUILDING_DEFS[b.type].name.toLowerCase()}: works begin.`, undefined, b.id);
  }
}

/** The builders' shared factor: productivity × fx(builders) × fx(labour) × legacy. */
export function builderFactor(s: GameState): number {
  return productivity(s) * fx(s, 'builders') * fx(s, 'labour') * legacyMult(s);
}

/** One builder's work per day: min(MULT_CAP, (1 + 0.04·fabri) × builderFactor), × elder. */
export function builderWork(s: GameState, p: Person, factor = builderFactor(s)): number {
  const m = (1 + B.people.SKILL_BONUS * (p.skills.fabri ?? 0)) * factor;
  return Math.min(B.economy.MULT_CAP, m) * (stageOf(p, s.day) === 3 ? B.people.ELDER_OUT : 1);
}

function complete(s: GameState, ctx: TickContext, b: Building): void {
  b.status = 'done';
  b.progress = 1;
  b.doneDay = s.day;
  if (b.type === 'area' && !b.house) b.house = newHouse();
  if (b.type === 'olivetum') b.youngUntil = s.day + B.site.OLIVE_YOUNG_DAYS;
  s.stats.built++;
  s.stats.builtBy[b.type] = (s.stats.builtBy[b.type] ?? 0) + 1;
  ctx.fx.push({ kind: 'built', id: b.id });
  log(s, 'build', `${BUILDING_DEFS[b.type].name} finished.`, undefined, b.id);
  if (b.type === 'capitolium' && !s.victory) {
    s.victory = true;
    s.stats.victoryDay = s.day;
    ctx.fx.push({ kind: 'victory' });
    log(s, 'milestone', 'The Capitolium is dedicated: Iuppiter, Iuno and Minerva look down on the colonia.', ['highlight'], b.id);
  }
  invalidate(s);
}

/** Capitolium materials per unit of work (CAP_MAT × fx(capMat) spread over its total work). */
function capPerWork(s: GameState, b: Building): Record<string, number> {
  const out: Record<string, number> = {};
  const mat = fx(s, 'capMat');
  for (const r of CAP_RES) out[r] = (C.CAP_MAT[r as keyof typeof C.CAP_MAT] * mat) / Math.max(1, b.work);
  return out;
}

/** Stock the Capitolium may draw per material: above the Ordo's saving target, denarii also above the treasury floor. */
function capAvailable(s: GameState): Partial<Record<ResId, number>> {
  const keep = savingFor(s, view(s))?.cost ?? {};
  const out: Partial<Record<ResId, number>> = {};
  for (const r of CAP_RES) out[r] = Math.max(0, s.res[r] - (keep[r] ?? 0) - (r === 'denarii' ? settingValue(s, 'treasuryFloor') : 0));
  return out;
}

function capitoliumDay(s: GameState, ctx: TickContext, b: Building, crewWork: number): boolean {
  const tool = (b.toolUntil ?? 0) > s.day ? B.economy.TOOL_MULT : 1;
  const per = capPerWork(s, b);
  let work = Math.min(crewWork * tool, b.work * (1 - b.progress));
  const avail = capAvailable(s);
  for (const r of CAP_RES) if (per[r] > 0) work = Math.min(work, (avail[r] ?? 0) / per[r]);
  if (!(work > EPS)) return false;
  const used: Cost = b.matUsed ?? {};
  for (const r of CAP_RES) {
    const k = work * per[r];
    if (k <= 0) continue;
    s.res[r] = Math.max(0, s.res[r] - k);
    used[r] = (used[r] ?? 0) + k;
    ctx.rates.cons[r].capitolium = (ctx.rates.cons[r].capitolium ?? 0) + k;
  }
  b.matUsed = used;
  const before = capitoliumStage(b);
  b.progress = Math.min(1, b.progress + work / b.work);
  if (b.progress >= 1 - EPS) b.progress = 1;
  const after = capitoliumStage(b);
  for (let k = before + 1; k <= after; k++) {
    const name = STAGE_NAMES[k - 1];
    ctx.fx.push({ kind: 'stage', id: b.id, stage: k });
    log(s, 'milestone', `Capitolium: the ${name} is raised.`, ['highlight'], b.id);
    s.modifiers.push({
      id: `capitolium.stage${k}`, label: `Capitolium: ${name}`, until: s.day + B.morale.STAGE_DAYS,
      fx: { add: { morale: B.morale.STAGE } }, benign: true, source: 'stage',
    });
  }
  if (b.progress >= 1) complete(s, ctx, b);
  return true;
}

/** Builders pour work along the queue (player sites first); idle adults add IDLE_BUILD each; site tool kits ×1.2; the
 *  Capitolium takes the rest, capped at CAP_CREW builders and by its materials; completions; builders gain fabri. */
export function constructionDay(s: GameState, ctx: TickContext): void {
  const builders = peopleIndex(s).builders;
  const factor = builderFactor(s);
  let crew = 0;
  for (const p of builders) crew += builderWork(s, p, factor);
  const idleWork = census(s).idle.length * B.economy.IDLE_BUILD;
  let left = crew + idleWork;
  let worked = false;
  let monument: Building | null = null;
  for (const b of worksQueue(s)) {
    if (b.status !== 'building') continue;
    if (b.type === 'capitolium') { monument = b; continue; }
    if (b.work <= 0) { complete(s, ctx, b); continue; }
    if (left <= EPS) continue;
    const tool = (b.toolUntil ?? 0) > s.day ? B.economy.TOOL_MULT : 1;
    const raw = Math.min(left, (b.work * (1 - b.progress)) / tool);
    left -= raw;
    b.progress = Math.min(1, b.progress + (raw * tool) / b.work);
    worked = true;
    if (b.progress >= 1 - EPS) complete(s, ctx, b);
  }
  // the town wall takes what the works leave, at most its crew (urbs.ts), before the Capitolium
  const avg = builders.length > 0 ? crew / builders.length : 0;
  const walls = wallsDay(s, ctx, left, avg);
  if (walls > 0) { left -= walls; worked = true; }
  if (monument) {
    const crewWork = Math.min(left, crew, C.CAP_CREW * avg);
    if (capitoliumDay(s, ctx, monument, crewWork)) worked = true;
  }
  if (worked) for (const p of builders) gainSkill(p, 'fabri', B.people.SKILL_XP);
}

/** Completed Capitolium stages (0..4) from its progress. */
export function capitoliumStage(b: Building): 0 | 1 | 2 | 3 | 4 {
  let k = 0;
  for (const t of C.CAP_STAGES) if (b.progress >= t - EPS) k++;
  return k as 0 | 1 | 2 | 3 | 4;
}

/** The Capitolium's flow: completed stage, days to the next stage at today's flow, the bottleneck (a material or the
 *  crew), work per day and the work still needed for the next stage; and, for a material bottleneck, that material
 *  per day: what comes in (`supply`) against what the crew would use (`demand`), 0 and 0 when the crew binds. Work and
 *  material are different units: "concrete 1.7/day of 3.8", never "30/day of 40,000". Null when it is not under way. */
export function capitoliumFlow(s: GameState): {
  stage: number; eta: number | null; bottleneck: ResId | 'crew' | null; rate: number; need: number; supply: number; demand: number;
} | null {
  const b = s.buildings.find((x) => x.type === 'capitolium' && x.status !== 'done');
  if (!b) return null;
  const stage = capitoliumStage(b);
  const need = Math.max(0, (C.CAP_STAGES[Math.min(stage, C.CAP_STAGES.length - 1)] - b.progress) * b.work);
  const builders = peopleIndex(s).builders;
  const factor = builderFactor(s);
  let crew = 0;
  for (const p of builders) crew += builderWork(s, p, factor);
  if (builders.length > C.CAP_CREW) crew *= C.CAP_CREW / builders.length;
  crew *= (b.toolUntil ?? 0) > s.day ? B.economy.TOOL_MULT : 1;
  let rate = crew;
  let bottleneck: ResId | 'crew' = 'crew';
  const per = capPerWork(s, b);
  const season = seasonOf(s.day);
  const made: Partial<Record<ResId, number>> = {};
  for (const x of s.buildings) {
    const out = buildingRate(s, x, season, 'current');
    for (const r of CAP_RES) if ((out[r] ?? 0) > 0) made[r] = (made[r] ?? 0) + (out[r] ?? 0);
  }
  made.denarii = Math.max(0, s.counters.coinEma);
  const avail = capAvailable(s);
  let supply = 0;
  for (const r of CAP_RES) {
    if (!(per[r] > 0)) continue;
    const comes = (made[r] ?? 0) + (avail[r] ?? 0) / B.ordo.CAP_RESERVE_DAYS;
    const allow = comes / per[r];
    if (allow < rate) { rate = allow; bottleneck = r; supply = comes; }
  }
  const demand = bottleneck === 'crew' ? 0 : per[bottleneck] * crew;
  return { stage, eta: rate > EPS ? Math.ceil(need / rate) : null, bottleneck, rate, need, supply, demand };
}

/** Creates the Capitolium site on the Area Capitolina (once); its materials are drawn as the work proceeds. */
export function startCapitolium(s: GameState): void {
  if (s.buildings.some((b) => b.type === 'capitolium')) return;
  const cap = getMap(s.seed).survey.capitolium;
  const id = nextId(s);
  s.buildings.push({
    id, type: 'capitolium', x: cap.x, y: cap.y, owner: 'player', status: 'building', placed: s.day, progress: 0,
    work: C.CAP_WORK * fx(s, 'capWork'), paid: true, order: id, open: true, prio: 1, matUsed: {},
  });
  log(s, 'build', 'The groma marks the Capitolium on the Area Capitolina.', ['highlight'], id);
  invalidate(s);
}

/** Cancels an unfinished site: 100% within FULL_REFUND_DAYS and before any work, else 75%; plans refund nothing. */
export function cancelSite(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return notFound();
  if (b.status === 'done') return { ok: false, code: 'invalid', reason: 'It is already finished.' };
  if (b.type === 'capitolium') return { ok: false, code: 'invalid', reason: 'The Capitolium cannot be abandoned.' };
  let frac = 0;
  if (b.paid) {
    frac = s.day - b.placed <= C.FULL_REFUND_DAYS && b.progress <= 0 ? 1 : C.REFUND_CANCEL;
    refund(s, siteCost(s, b), frac);
  }
  s.buildings = s.buildings.filter((x) => x.id !== id);
  const pct = Math.round(frac * 100);
  log(s, 'build', `Works on the ${BUILDING_DEFS[b.type].name.toLowerCase()} are abandoned${b.paid ? ` (${pct}% returned to the stores)` : ''}.`);
  invalidate(s);
  return { ok: true };
}

/** Moves a site to the front of its group (player sites, or the Ordo's) in the works queue. */
export function prioritise(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return notFound();
  if (b.status === 'done') return { ok: false, code: 'invalid', reason: 'It is already finished.' };
  const mine = b.owner === 'player';
  let min = Infinity;
  for (const x of s.buildings) {
    if (x.id !== b.id && x.status !== 'done' && (x.owner === 'player') === mine && x.order < min) min = x.order;
  }
  if (min <= b.order) {
    b.order = min - 1;
    invalidate(s);
  }
  return { ok: true, id };
}

/** Opens or closes a building's staffing (closing releases its workers). */
export function setOpen(s: GameState, id: number, open: boolean): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return notFound();
  if (b.open === open) return { ok: true, id };
  b.open = open;
  if (!open) {
    for (const p of peopleIndex(s).byWork.get(id) ?? []) p.work = null;
    touchPeople(s);
  }
  log(s, 'info', `${BUILDING_DEFS[b.type].name} ${open ? 'reopened' : 'closed'}.`, undefined, id);
  invalidate(s);
  return { ok: true, id };
}

/** Sets a building's staffing priority (0 low, 1 normal, 2 high). */
export function setPrio(s: GameState, id: number, prio: 0 | 1 | 2): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return notFound();
  if (prio !== 0 && prio !== 1 && prio !== 2) return { ok: false, code: 'invalid', reason: 'No such priority.' };
  b.prio = prio;
  return { ok: true, id };
}

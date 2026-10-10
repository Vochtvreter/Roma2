// src/game/construction.ts — works queue, stakes, plans, builders, the Capitolium (ARCHITECTURE §8.3, DESIGN §5.3, §9.5). Owner: WP-B.
// SCAFFOLD: one unit of work per builder per day along the queue; completions, stakes, plans, refunds and the site
// actions work; no tools, skills, idle helpers, Capitolium crew cap or gradual materials.
import { B } from './balance';
import { BUILDER } from './types';
import type { ActionResult, Building, GameState, HouseState, ResId, TickContext } from './types';
import { getMap } from './map';
import { invalidate } from './memo';
import { canAfford, getBuilding, log, nextId, pay, refund } from './state';
import { fx } from './fx';
import { BUILDING_DEFS } from './data/buildings';

const EPS = 1e-9;

function newHouse(): HouseState {
  return { tier: 'tentoria', pref: 'auto', okDays: 0, badDays: 0, recoverDays: 0, declining: false, declineDays: 0, renovating: null, oil: 0, wine: 0 };
}

function notFound(): ActionResult {
  return { ok: false, code: 'notFound', reason: 'No such work.' };
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
    if (b.status === 'staked' && s.day - b.placed >= B.construction.STAKE_DAYS) b.status = 'building';
  }
}

/** Player plans become paid building sites, in queue order, when the stock covers them. */
export function payPlans(s: GameState, ctx: TickContext): void {
  // STUB(WP-B): keep the petition fee aside; route cost of a planned castellum.
  void ctx;
  for (const b of worksQueue(s)) {
    if (b.status !== 'plan') continue;
    const cost = BUILDING_DEFS[b.type].cost;
    if (!canAfford(s, cost)) continue;
    pay(s, cost);
    b.paid = true;
    b.status = 'building';
    log(s, 'build', `The stores now cover the ${BUILDING_DEFS[b.type].name.toLowerCase()}: works begin.`, undefined, b.id);
  }
}

function complete(s: GameState, ctx: TickContext, b: Building): void {
  b.status = 'done';
  b.progress = 1;
  b.doneDay = s.day;
  if (b.type === 'area' && !b.house) b.house = newHouse();
  s.stats.built++;
  s.stats.builtBy[b.type] = (s.stats.builtBy[b.type] ?? 0) + 1;
  ctx.fx.push({ kind: 'built', id: b.id });
  log(s, 'build', `${BUILDING_DEFS[b.type].name} finished.`, undefined, b.id);
  if (b.type === 'capitolium' && !s.victory) {
    s.victory = true;
    s.stats.victoryDay = s.day;
    ctx.fx.push({ kind: 'victory' });
    log(s, 'milestone', 'The Capitolium is dedicated.', ['highlight']);
  }
  invalidate(s);
}

/** Builders pour work along the queue; finished sites complete (house state, fx built, stats, log, invalidate). */
export function constructionDay(s: GameState, ctx: TickContext): void {
  let pool = 0;
  for (const p of s.people) if (p.work === BUILDER) pool++;   // STUB(WP-B): skill, fx(builders), idle helpers, tools
  for (const b of worksQueue(s)) {
    if (b.status !== 'building') continue;
    if (b.work <= 0) { complete(s, ctx, b); continue; }
    if (pool <= 0) continue;
    const remaining = b.work * (1 - b.progress);
    const use = Math.min(pool, remaining);
    pool -= use;
    b.progress = Math.min(1, b.progress + use / b.work);
    if (b.progress >= 1 - EPS) complete(s, ctx, b);
  }
}

/** Completed Capitolium stages (0..4) from its progress. */
export function capitoliumStage(b: Building): 0 | 1 | 2 | 3 | 4 {
  let k = 0;
  for (const t of B.construction.CAP_STAGES) if (b.progress >= t - EPS) k++;
  return k as 0 | 1 | 2 | 3 | 4;
}

/** The Capitolium's flow: stage, ETA, bottleneck, work rate and need; null when it is not under way. */
export function capitoliumFlow(s: GameState): { stage: number; eta: number | null; bottleneck: ResId | 'crew' | null; rate: number; need: number } | null {
  // STUB(WP-B): DESIGN §9.5 crew cap and gradual materials.
  const b = s.buildings.find((x) => x.type === 'capitolium' && x.status !== 'done');
  if (!b) return null;
  return { stage: capitoliumStage(b), eta: null, bottleneck: null, rate: 0, need: b.work * (1 - b.progress) };
}

/** Creates the Capitolium site on the Area Capitolina (once). */
export function startCapitolium(s: GameState): void {
  if (s.buildings.some((b) => b.type === 'capitolium')) return;
  const cap = getMap(s.seed).survey.capitolium;
  const id = nextId(s);
  // STUB(WP-B): owner and queue treatment of the monument (crew cap 64).
  s.buildings.push({
    id, type: 'capitolium', x: cap.x, y: cap.y, owner: 'player', status: 'building', placed: s.day, progress: 0,
    work: B.construction.CAP_WORK * fx(s, 'capWork'), paid: true, order: id, open: true, prio: 1, matUsed: {},
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
  if (b.paid) {
    const full = s.day - b.placed <= B.construction.FULL_REFUND_DAYS && b.progress <= 0;
    refund(s, BUILDING_DEFS[b.type].cost, full ? 1 : B.construction.REFUND_CANCEL);   // STUB(WP-B): actual paid cost (route, fx)
  }
  s.buildings = s.buildings.filter((x) => x.id !== id);
  log(s, 'build', `Works on the ${BUILDING_DEFS[b.type].name.toLowerCase()} are abandoned.`);
  invalidate(s);
  return { ok: true };
}

/** Moves a site to the front of its group in the works queue. */
export function prioritise(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return notFound();
  if (b.status === 'done') return { ok: false, code: 'invalid', reason: 'It is already finished.' };
  let min = b.order;
  for (const x of s.buildings) if (x.status !== 'done' && x.order < min) min = x.order;
  if (min < b.order) b.order = min - 1;
  invalidate(s);
  return { ok: true, id };
}

/** Opens or closes a building's staffing. */
export function setOpen(s: GameState, id: number, open: boolean): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return notFound();
  if (b.open === open) return { ok: true, id };
  b.open = open;
  log(s, 'info', `${BUILDING_DEFS[b.type].name} ${open ? 'reopened' : 'closed'}.`, undefined, id);
  invalidate(s);
  return { ok: true, id };
}

/** Sets a building's staffing priority (0 low, 1 normal, 2 high). */
export function setPrio(s: GameState, id: number, prio: 0 | 1 | 2): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return notFound();
  b.prio = prio;
  return { ok: true, id };
}

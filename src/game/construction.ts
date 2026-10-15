// src/game/construction.ts — works queue, stakes, plans, builders, the Capitolium (ARCHITECTURE §8.3, DESIGN §5.3, §9.5). Owner: WP-B.
// Builders pour work into the first site of the queue until it is done, then the next; the Capitolium takes what is left,
// at most CAP_CREW builders' worth, and draws its materials pro rata to the work it receives.
import { B as B$ } from './balance';
import { RESOURCES as RESOURCES$ } from './types';
import type { ActionResult, Building, BuildingId, Cost, FxEvent, GameState, HouseState, Person, ResId, TickContext } from './types';
import { getMap as getMap$ } from './map';
import { invalidate as invalidate$, touchPeople as touchPeople$ } from './memo';
import { canAfford, log, nextId, pay, refund } from './state';
import { getBuilding as getBuilding$ } from './lookup';
import { fx as fx$ } from './fx';
import { census, peopleIndex, stageOf } from './census';
import { buildingRate, inputShares, legacyMult, productivity } from './economy';
import { gainSkill } from './people';
import { savingFor, savingHolds } from './ordo/saving';
import { manualReach } from './ordo/labour';
import { settingValue } from './decisions';
import { seasonOf as seasonOf$ } from './calendar';
import { view } from './sim';
import { placementCost } from './place';
import { forgetDemolition } from './demolition';
import { wallsDay, wallsRising } from './urbs';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { RESOURCE_DEFS as RESOURCE_DEFS$ } from './data/resources';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, RESOURCES = RESOURCES$, getMap = getMap$, invalidate = invalidate$, touchPeople = touchPeople$, fx = fx$,
  seasonOf = seasonOf$, BUILDING_DEFS = BUILDING_DEFS$, RESOURCE_DEFS = RESOURCE_DEFS$,
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
  const built: Extract<FxEvent, { kind: 'built' }> = { kind: 'built', id: b.id };
  ctx.fx.push(built);
  log(s, 'build', `${BUILDING_DEFS[b.type].name} finished.`, undefined, b.id);
  if (b.type === 'capitolium' && !s.victory) {
    s.victory = true;
    s.stats.victoryDay = s.day;
    // the day's figures, kept: the Victory dispatch reads them, also when the Annales open it again later
    const st = s.stats;
    st.atVictory = { pop: s.people.length, peakPop: Math.max(st.peakPop, s.people.length), births: st.births, immigrants: st.immigrants,
      built: st.built, evolved: st.evolved, playMs: st.playMs };
    ctx.fx.push({ kind: 'victory' });
    log(s, 'milestone', 'The Capitolium is dedicated: Iuppiter, Iuno and Minerva look down on the colonia.', ['highlight'], b.id);
  }
  invalidate(s);
  // staffing by hand, its posts wait on the category's target (DESIGN §10.2): what that target lacks for it rides the
  // fx as it stands now (the completion toast's button), since a frame can run more ticks before the toast is made, and
  // the next day's staffing may give the work another's hands (a nearer post fills first) and leave that one empty; the
  // toast takes the larger of this and the count when it is made (ui/tabs/labour.ts finishedStaffing), as a work
  // finished after it in the frame, nearer the forum, would else take the posts it was counted against
  if (!s.ordo.on.labour) {
    const short = manualReach(s, view(s), b.id);
    if (short > 0) built.short = short;
  }
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

/** The Capitolium's flow (capitoliumFlow). The crew: `crew` builders work on it today, of the CAP_CREW that may (the
 *  town wall's `walls` first; `spare` more have nothing to build while no other site is in hand). For a material
 *  bottleneck, that material a day: what comes in (`supply`: the works' net output and the stock it may draw spread
 *  over CAP_RESERVE_DAYS) against what the crew would use (`demand`), the stock in the stores (`stock`, as the stores
 *  panel shows it), the part of it the temple may not draw (`held`: the Ordo's saving target keeps it back, coin also
 *  the treasury floor) and what holds it (`heldFor`: the first work saved for that costs some, the petition, or the
 *  floor), the works' net output (`inflow`), and `starved`, its works held back by a missing input (the scarcest); all
 *  0 or null when the crew binds. */
export interface CapitoliumFlow {
  stage: number; eta: number | null; bottleneck: ResId | 'crew' | null; rate: number; need: number; supply: number; demand: number;
  crew: number; walls: number; spare: number; stock: number; held: number; heldFor: BuildingId | 'petition' | 'floor' | null; inflow: number;
  starved: { works: BuildingId; input: ResId; share: number } | null;
}

/** The Capitolium's flow: completed stage, days to the next stage at today's flow, the bottleneck (a material or the
 *  crew), work per day and the work still needed for the next stage, the crew, and the bottleneck material's stock and
 *  flow (CapitoliumFlow). The works' output counts their inputs as production will draw them (economy.inputShares):
 *  concrete works without water make no concrete, and the stone they mix is no stone for the temple. Work and material
 *  are different units: "concrete 1.7/day of 3.8", never "30/day of 40,000". Null when it is not under way. */
export function capitoliumFlow(s: GameState): CapitoliumFlow | null {
  const b = s.buildings.find((x) => x.type === 'capitolium' && x.status !== 'done');
  if (!b) return null;
  const stage = capitoliumStage(b);
  const need = Math.max(0, (C.CAP_STAGES[Math.min(stage, C.CAP_STAGES.length - 1)] - b.progress) * b.work);
  const builders = peopleIndex(s).builders;
  const factor = builderFactor(s);
  let all = 0;
  for (const p of builders) all += builderWork(s, p, factor);
  // as constructionDay, the queue aside: the town wall takes its crew's worth of what the builders and the idle spare,
  // then the Capitolium at most CAP_CREW builders' worth
  const avg = builders.length > 0 ? all / builders.length : 0;
  const idle = census(s).idle.length * B.economy.IDLE_BUILD;
  const wall = wallsRising(s) ? Math.min(all + idle, B.urbs.MOENIA.CREW * Math.max(avg, B.economy.IDLE_BUILD)) : 0;
  const work = Math.max(0, Math.min(all + idle - wall, all, C.CAP_CREW * avg));
  const onIt = avg > 0 ? Math.round(work / avg) : 0;
  const walls = avg > 0 ? Math.min(builders.length - onIt, Math.round(wall / avg)) : 0;
  const queue = worksQueue(s).some((x) => x.status === 'building' && x.type !== 'capitolium');
  const crew = work * ((b.toolUntil ?? 0) > s.day ? B.economy.TOOL_MULT : 1);
  let rate = crew;
  let bottleneck: ResId | 'crew' = 'crew';
  const per = capPerWork(s, b);
  const season = seasonOf(s.day);
  const shares = inputShares(s);
  const made: Partial<Record<ResId, number>> = {};
  for (const x of s.buildings) {
    const out = buildingRate(s, x, season, 'current');
    const k = shares.get(x.id)?.share ?? 1;
    for (const r of CAP_RES) if (out[r]) made[r] = (made[r] ?? 0) + (out[r] ?? 0) * k;
  }
  made.denarii = Math.max(0, s.counters.coinEma);
  const avail = capAvailable(s);
  let supply = 0;
  for (const r of CAP_RES) {
    if (!(per[r] > 0)) continue;
    const comes = Math.max(0, (made[r] ?? 0) + (avail[r] ?? 0) / B.ordo.CAP_RESERVE_DAYS);
    const allow = comes / per[r];
    if (allow < rate) { rate = allow; bottleneck = r; supply = comes; }
  }
  let starved: CapitoliumFlow['starved'] = null;
  if (bottleneck !== 'crew') {
    for (const x of s.buildings) {
      const sh = shares.get(x.id);
      if (sh && BUILDING_DEFS[x.type].output?.res === bottleneck && (!starved || sh.share < starved.share)) starved = { works: x.type, input: sh.short, share: sh.share };
    }
  }
  const mat = bottleneck === 'crew' ? null : bottleneck;
  // the stores hold `stock`; what the Ordo's saving (and the treasury floor) keeps back of it the temple may not draw
  const stock = mat ? Math.max(0, s.res[mat]) : 0, held = mat ? Math.max(0, stock - (avail[mat] ?? 0)) : 0;
  const heldFor = mat && held > EPS ? savingHolds(s, view(s), mat) ?? (mat === 'denarii' ? 'floor' : null) : null;
  return {
    stage, eta: rate > EPS ? Math.ceil(need / rate) : null, bottleneck, rate, need, supply, demand: mat ? per[mat] * crew : 0,
    crew: onIt, walls, spare: queue ? 0 : Math.max(0, builders.length - onIt - walls),
    stock, held, heldFor, inflow: mat ? made[mat] ?? 0 : 0, starved,
  };
}

/** A count or a flow for the Capitolium's words: one decimal under 10 (dropped when whole), else a whole number with
 *  thousands separators. */
function amount(n: number): string {
  const r = Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return String(r === 0 ? 0 : r).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The builders on the Capitolium in a sentence for the Fabri row: "64 of 64 builders on the Capitolium (the most that
 *  can work on it), 8 on the town wall; 56 more have nothing to build." */
export function crewWords(f: CapitoliumFlow): string {
  const on = f.crew >= C.CAP_CREW ? `${f.crew} of ${C.CAP_CREW} builders on the Capitolium (the most that can work on it)`
    : `${f.crew} ${f.crew === 1 ? 'builder' : 'builders'} on the Capitolium, which takes up to ${C.CAP_CREW}`;
  return `${on}${f.walls > 0 ? `, ${f.walls} on the town wall` : ''}${f.spare > 0 ? `; ${f.spare} more ${f.spare === 1 ? 'has' : 'have'} nothing to build` : ''}.`;
}

/** A material's works held back by a missing input, in words: "no water for the concrete works". */
export function starvedWords(st: NonNullable<CapitoliumFlow['starved']>): string {
  return `${st.share < 0.05 ? 'no' : 'too little'} ${RESOURCE_DEFS[st.input].name.toLowerCase()} for the ${BUILDING_DEFS[st.works].name.toLowerCase()}`;
}

/** The bottleneck material's stock in words, as the stores panel counts it, with what the temple may not draw of it:
 *  "12 in store", "12 in store, all held for the great baths", "40 in store, 25 held for the petition", "900 in
 *  store, all kept as the treasury floor". The works row, its card and the Praefectus Fabrum say it alike. */
export function storeWords(f: Pick<CapitoliumFlow, 'stock' | 'held' | 'heldFor'>): string {
  const store = `${amount(f.stock)} in store`;
  if (amount(f.held) === '0') return store;
  const what = f.heldFor === 'floor' ? 'kept as the treasury floor' : f.heldFor === 'petition' ? 'held for the petition'
    : f.heldFor ? `held for the ${BUILDING_DEFS[f.heldFor].name.toLowerCase()}` : 'held back for other works';
  return `${store}, ${amount(f.stock - f.held) === '0' ? 'all' : amount(f.held)} ${what}`;
}

/** What holds the Capitolium back, in words for the works row and its card (DESIGN §9.5): "crew at its maximum: 64 of
 *  64 builders (the most that can work on it)", "bottleneck: builders (40 of the 64 who could work on it)", or
 *  "waiting for concrete: 0 in store, +0/day of 3.9 (no water for the concrete works)" (the stock with what the Ordo
 *  keeps back of it: storeWords). */
export function capitoliumHold(f: CapitoliumFlow): string {
  if (f.bottleneck === 'crew' || f.bottleneck === null) {
    return f.crew >= C.CAP_CREW ? `crew at its maximum: ${f.crew} of ${C.CAP_CREW} builders (the most that can work on it)`
      : `bottleneck: builders (${f.crew} of the ${C.CAP_CREW} who could work on it)`;
  }
  const flow = `${f.inflow < 0 ? '−' : '+'}${amount(Math.abs(f.inflow))}/day of ${amount(f.demand)}`;
  return `waiting for ${RESOURCE_DEFS[f.bottleneck].name.toLowerCase()}: ${storeWords(f)}, ${flow}${f.starved ? ` (${starvedWords(f.starved)})` : ''}`;
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

/** Cancels an unfinished site: 100% within FULL_REFUND_DAYS and before any work, else 75%; plans refund nothing. It ends
 *  the demolish tool's Undo (demolition.ts forgetDemolition): it is no longer the last demolition. */
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
  forgetDemolition(s);
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

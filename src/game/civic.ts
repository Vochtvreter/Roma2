// src/game/civic.ts — morale, care, dignitas, taxes, upkeep and the Kalends ledger (ARCHITECTURE §8.3, DESIGN §8.8–8.11). Owner: WP-B.
import { B as B$ } from './balance';
import { LABOR_CATS as LABOR_CATS$, MILESTONE_IDS as MILESTONE_IDS$ } from './types';
import type { GameState, SimView, TickContext } from './types';
import { dayEpoch as dayEpoch$, invalidate as invalidate$, memo as memo$, structEpoch as structEpoch$ } from './memo';
import { houseHas } from './coverage';
import { blockOfTile as blockOfTile$, derived as derived$ } from './derived';
import { houseTax, isAquae } from './housing';
import { census, peopleIndex } from './census';
import { meanRation, portion } from './economy';
import { fx as fx$, fxAdd as fxAdd$, fxBreakdown as fxBreakdown$ } from './fx';
import { seasonOf as seasonOf$ } from './calendar';
import { idx as idx$ } from './map';
import { log } from './state';
import { getBuilding as getBuilding$ } from './lookup';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { TIER_DEFS as TIER_DEFS$ } from './data/housing';
import { RANK_DEFS as RANK_DEFS$ } from './data/ranks';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, LABOR_CATS = LABOR_CATS$, MILESTONE_IDS = MILESTONE_IDS$, dayEpoch = dayEpoch$, invalidate = invalidate$,
  memo = memo$, structEpoch = structEpoch$, blockOfTile = blockOfTile$, derived = derived$, fx = fx$, fxAdd = fxAdd$,
  fxBreakdown = fxBreakdown$, seasonOf = seasonOf$, idx = idx$, BUILDING_DEFS = BUILDING_DEFS$, TIER_DEFS = TIER_DEFS$,
  RANK_DEFS = RANK_DEFS$,
  getBuilding = getBuilding$;

const M = B.morale;
const HIEMS = 3;

/** The morale term for today's portion (Largae +6 … Arctae −14) and its label ("Emergency rations" while the Lex de
 *  annona's cut, not the edict, sets the portion). */
function rationTerm(s: GameState): { label: string; value: number } {
  const p = portion(s);
  const P = B.economy.PORTIONS as Readonly<Record<string, number>>;
  const T = M.RATION_TERMS as Readonly<Record<string, number>>;
  const key = Object.keys(P).find((k) => P[k] === p) ?? 'plenae';
  const cut = s.ordo.emergency.rations !== 'none' && p < (P[s.decisions.edicts.rationes] ?? P.plenae) + 1e-9;
  return { label: `${cut ? 'Emergency rations' : 'Rations'}: ${key[0].toUpperCase()}${key.slice(1)}`, value: T[key] ?? 0 };
}

/** Deaths in the last DEATHS_WINDOW days that were not old age (Annales death lines tagged highlight). */
export function recentHardDeaths(s: GameState): number {
  let n = 0;
  for (let k = s.log.length - 1; k >= 0; k--) {
    const e = s.log[k];
    if (e.day <= s.day - M.DEATHS_WINDOW) break;
    if (e.kind === 'death' && e.tags?.includes('highlight')) n++;
  }
  return n;
}

interface Shares { religion: number; baths: number; culture: number; avgTier: number; covered: number }

/** Shares of houses covered by religion / baths / culture, the mean house level, and residents in baths coverage. */
function shares(s: GameState): Shares {
  return memo(s, 'civicShares', dayEpoch(s), () => {
    const ids = derived(s).houses;
    const ix = peopleIndex(s);
    let religion = 0, baths = 0, culture = 0, levels = 0, covered = 0;
    for (const id of ids) {
      const b = getBuilding(s, id);
      if (!b?.house) continue;
      levels += TIER_DEFS[b.house.tier].level;
      if (houseHas(s, id, 'shrine') || houseHas(s, id, 'temple')) religion++;
      if (houseHas(s, id, 'baths')) { baths++; covered += ix.byHome.get(id)?.length ?? 0; }
      if (houseHas(s, id, 'culture')) culture++;
    }
    const n = Math.max(1, ids.length);
    return { religion: religion / n, baths: baths / n, culture: culture / n, avgTier: levels / n, covered };
  });
}

/** Care (DESIGN §8.10): share of residents inside baths coverage + fx(care), clamped 0..1. */
export function careShare(s: GameState): number {
  const pop = s.people.length;
  const base = pop > 0 ? shares(s).covered / pop : 0;
  return Math.min(1, Math.max(0, base + fxAdd(s, 'care')));
}

/** Morale target and its labelled terms (DESIGN §8.9). */
export function moraleTarget(s: GameState, v: SimView): { value: number; terms: { label: string; value: number }[] } {
  const c = v.c;
  const terms: { label: string; value: number }[] = [];
  const add = (label: string, value: number): void => { if (value !== 0) terms.push({ label, value }); };
  add('Base', M.BASE);
  const doh = c.need.grain > 0 ? s.res.grain / c.need.grain : Infinity;
  const gt = M.GRAIN_TERMS.find(([at]) => doh >= at) ?? M.GRAIN_TERMS[M.GRAIN_TERMS.length - 1];
  add('Grain in store', gt[1]);
  const rt = rationTerm(s);
  add(rt.label, rt.value);
  add('Short of grain', -M.SHORT * (1 - meanRation(s, 'grain')));
  add('Short of water', -M.SHORT * (1 - meanRation(s, 'water')));
  if (c.houses > 0) {
    const sh = shares(s);
    add('Homes', M.TIER * sh.avgTier);
    add('Shrines and temples', M.RELIGION * sh.religion);
    add('Baths', M.BATHS * sh.baths);
    add('Theatre', M.CULTURE * sh.culture);
    add('Declining homes', -M.DECLINING * (c.declining / c.houses));
  }
  if (c.pop > 0) add('Homeless', -M.HOMELESS * (c.homeless / c.pop));
  add('Untimely deaths', -Math.min(M.DEATHS_CAP, M.DEATHS * recentHardDeaths(s)));
  for (const src of fxBreakdown(s, 'morale')) add(src.label, src.value);
  if (seasonOf(s.day) === HIEMS) for (const src of fxBreakdown(s, 'hiemsMorale')) add(`${src.label} (Hiems)`, src.value);
  add('Legacy', M.LEGACY * s.legacy);
  if (s.buildings.some((b) => b.type === 'capitolium' && b.status === 'done')) add('The Capitolium', M.CAPITOLIUM);
  if (s.urbs.moenia?.done != null) add('The town wall', B.urbs.MOENIA.MORALE);
  let value = 0;
  for (const t of terms) value += t.value;
  return { value, terms };
}

/** Moves morale toward its target (EMA, B.morale.ALPHA), clamped 0..100. */
export function moraleDay(s: GameState, v: SimView): void {
  const target = moraleTarget(s, v).value;
  s.morale = Math.min(M.MAX, Math.max(M.MIN, s.morale + M.ALPHA * (target - s.morale)));
}

/** The colony's dignitas and its groups (DESIGN §8.11). Works and homes are memoised on day and structure; deeds,
 *  roads, fama and the effect multiplier are read live (events and path choices change them within a day). */
export function dignitas(s: GameState): { value: number; groups: { works: number; homes: number; roads: number; deeds: number; fama: number } } {
  let deeds = 0;
  for (const id of MILESTONE_IDS) if (s.guidance.milestoneDays[id] !== undefined) deeds += B.dignitas.DEEDS;
  const temple = fx(s, 'templeDignitas');
  const built = memo(s, 'dignitas', `${s.day}|${structEpoch(s)}|${s.rank}|${temple}`, () => {
    let works = 0, homes = 0;
    for (const b of s.buildings) {
      if (b.status !== 'done') continue;
      if (b.type === 'principia') works += B.dignitas.FORUM[RANK_DEFS[s.rank].forumStage] ?? 0;
      else if (b.type === 'templum') works += BUILDING_DEFS.templum.dignitas * temple * (blockOfTile(s, idx(b.x, b.y))?.touchesForum ? B.dignitas.TEMPLE_FORUM : 1);
      else works += BUILDING_DEFS[b.type].dignitas;
      if (b.house) homes += TIER_DEFS[b.house.tier].dignitas + (isAquae(s, b) ? B.housing.AQUAE_DIGNITAS : 0);
    }
    if (s.urbs.moenia?.done != null) works += B.urbs.MOENIA.DIGNITAS;   // the town wall (urbs.ts)
    return { works, homes };
  });
  const roads = B.dignitas.ROADS * s.paved.length;
  const fama = fxAdd(s, 'fama');
  const groups = { works: built.works, homes: built.homes, roads, deeds, fama };
  return { value: (groups.works + groups.homes + roads + deeds + fama) * fx(s, 'dignitas'), groups };
}

/** Accrues taxes (residents × house tax × fx(tax) × forum ×1.10) and market tax, and pays Rome's subsidy for the day. */
export function taxesDay(s: GameState, ctx: TickContext): void {
  const ix = peopleIndex(s);
  let tax = 0, market = 0;
  for (const id of derived(s).houses) {
    const b = getBuilding(s, id);
    const n = ix.byHome.get(id)?.length ?? 0;
    if (!b || n === 0) continue;
    tax += n * houseTax(s, b);
    if (houseHas(s, id, 'macellum')) market += n * B.economy.MARKET_TAX.macellum;
    else if (houseHas(s, id, 'market')) market += n * B.economy.MARKET_TAX.taberna;
  }
  tax *= fx(s, 'tax') * (RANK_DEFS[s.rank].forumStage >= B.forum.TAX_STAGE ? B.forum.TAX : 1);
  market *= fx(s, 'marketTax');
  if (tax > 0) {
    s.taxAccrued += tax;
    ctx.rates.prod.denarii.taxes = (ctx.rates.prod.denarii.taxes ?? 0) + tax;
  }
  if (market > 0) {
    s.taxAccrued += market;
    ctx.rates.prod.denarii.marketTax = (ctx.rates.prod.denarii.marketTax ?? 0) + market;
  }
  const subsidy = RANK_DEFS[s.rank].subsidy;
  if (subsidy > 0) {
    s.res.denarii += subsidy;
    ctx.rates.prod.denarii.subsidy = (ctx.rates.prod.denarii.subsidy ?? 0) + subsidy;
  }
}

/** Pays each finished, open building's upkeep in id order, or marks it unpaid (it works at half pace until paid).
 *  A closed building pays nothing (closing the costliest optional work is the Quaestor's coin remedy). */
export function upkeepDay(s: GameState, ctx: TickContext): void {
  let flipped = false;
  for (const b of s.buildings) {
    if (b.status !== 'done') continue;
    const up = BUILDING_DEFS[b.type].upkeep;
    if (up <= 0) continue;
    if (!b.open) {
      if (b.unpaid) { delete b.unpaid; flipped = true; }
      continue;
    }
    if (s.res.denarii >= up) {
      s.res.denarii -= up;
      ctx.rates.cons.denarii.upkeep = (ctx.rates.cons.denarii.upkeep ?? 0) + up;
      if (b.unpaid) { delete b.unpaid; flipped = true; }
    } else if (!b.unpaid) {
      b.unpaid = true;
      flipped = true;
    }
  }
  if (flipped) invalidate(s);   // unpaid services cover half their radius
}

/** Kalends: the accrued taxes reach the aerarium (the relief debt takes its share first); one ledger line; fx taxes. */
export function kalendsDay(s: GameState, ctx: TickContext): void {
  const due = s.taxAccrued;
  s.taxAccrued = 0;
  if (due <= 0) return;
  let repay = 0;
  if (s.trade.debt > 0) {
    repay = Math.min(s.trade.debt, due * B.emergency.RELIEF_REPAY);
    s.trade.debt -= repay;
    ctx.rates.cons.denarii.debt = (ctx.rates.cons.denarii.debt ?? 0) + repay;
  }
  const net = due - repay;
  s.res.denarii += net;
  s.stats.denariiTaxed += due;
  ctx.fx.push({ kind: 'taxes', amount: net });
  const c = census(s);
  const staff = LABOR_CATS.map((k) => `${k} ${c.catStaffed[k]}`).join(', ');
  const debt = repay > 0 ? ` (${Math.round(repay)} to the legion's debt)` : '';
  log(s, 'ledger', `Kalends: the households pay ${Math.round(due)} denarii${debt}. At work: ${staff}.`);
}

// src/game/civic.ts — morale, dignitas, taxes, upkeep and the Kalends ledger (ARCHITECTURE §8.3, DESIGN §8.8–8.11). Owner: WP-B.
// SCAFFOLD: morale holds still; dignitas counts works and homes; taxes accrue from tier rates, the subsidy is paid
// daily, upkeep is paid or marked unpaid, and the Kalends pay the accrued taxes.
import type { GameState, SimView, TickContext } from './types';
import { derived } from './derived';
import { memo, structEpoch } from './memo';
import { houseTax } from './housing';
import { fx } from './fx';
import { getBuilding, log } from './state';
import { BUILDING_DEFS } from './data/buildings';
import { TIER_DEFS } from './data/housing';
import { RANK_DEFS } from './data/ranks';

/** Morale target and its labelled terms (DESIGN §8.9). */
export function moraleTarget(s: GameState, v: SimView): { value: number; terms: { label: string; value: number }[] } {
  // STUB(WP-B): base, grain, rations, shortages, tiers, religion, baths, culture, homeless, declining, deaths, fx(morale), legacy.
  void v;
  return { value: s.morale, terms: [] };
}

/** Moves morale toward its target (EMA, B.morale.ALPHA). */
export function moraleDay(s: GameState, v: SimView): void {
  // STUB(WP-B): s.morale += ALPHA × (target − morale), clamped.
  void s; void v;
}

/** The colony's dignitas and its groups (memo on day). */
export function dignitas(s: GameState): { value: number; groups: { works: number; homes: number; roads: number; deeds: number; fama: number } } {
  return memo(s, 'dignitas', `${s.day}|${structEpoch(s)}`, () => {
    let works = 0, homes = 0;
    for (const b of s.buildings) {
      if (b.status !== 'done') continue;
      works += BUILDING_DEFS[b.type].dignitas;   // STUB(WP-B): principia by forum stage, templum by the forum, fx(templeDignitas)
      if (b.house) homes += TIER_DEFS[b.house.tier].dignitas;
    }
    // STUB(WP-B): roads (paved), deeds (milestones), fama (fxAdd), fx(dignitas).
    const groups = { works, homes, roads: 0, deeds: 0, fama: 0 };
    return { value: works + homes, groups };
  });
}

/** Accrues taxes (residents × tier tax × fx(tax)) and pays Rome's subsidy for the day. */
export function taxesDay(s: GameState, ctx: TickContext): void {
  const living: Record<number, number> = {};
  for (const p of s.people) if (p.home !== null) living[p.home] = (living[p.home] ?? 0) + 1;
  let tax = 0;
  for (const id of derived(s).houses) {
    const b = getBuilding(s, id);
    if (b) tax += (living[id] ?? 0) * houseTax(s, b);
  }
  tax *= fx(s, 'tax');   // STUB(WP-B): market tax, forum stage ×1.10
  if (tax > 0) {
    s.taxAccrued += tax;
    ctx.rates.prod.denarii.taxes = (ctx.rates.prod.denarii.taxes ?? 0) + tax;
  }
  const subsidy = RANK_DEFS[s.rank].subsidy;
  if (subsidy > 0) {
    s.res.denarii += subsidy;
    ctx.rates.prod.denarii.subsidy = (ctx.rates.prod.denarii.subsidy ?? 0) + subsidy;
  }
}

/** Pays each finished building's upkeep in id order, or marks it unpaid. */
export function upkeepDay(s: GameState, ctx: TickContext): void {
  for (const b of s.buildings) {
    if (b.status !== 'done') continue;
    const up = BUILDING_DEFS[b.type].upkeep;
    if (up <= 0 || s.res.denarii >= up) {
      if (up > 0) {
        s.res.denarii -= up;
        ctx.rates.cons.denarii.upkeep = (ctx.rates.cons.denarii.upkeep ?? 0) + up;
      }
      if (b.unpaid) delete b.unpaid;
    } else {
      b.unpaid = true;
    }
  }
}

/** Kalends: the accrued taxes reach the aerarium (STUB: no relief-debt share), with a ledger line and fx taxes. */
export function kalendsDay(s: GameState, ctx: TickContext): void {
  const due = s.taxAccrued;
  s.taxAccrued = 0;
  if (due <= 0) return;
  s.res.denarii += due;
  s.stats.denariiTaxed += due;
  ctx.fx.push({ kind: 'taxes', amount: due });
  log(s, 'ledger', `Kalends: the households pay ${Math.round(due)} denarii in taxes.`);
}

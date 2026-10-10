// src/game/ordo/emergency.ts — the Lex de annona ladder (ARCHITECTURE §8.4, DESIGN §8.12). Owner: WP-C.
// Daily, in order: rations → industry water pause → emergency import → the Legate's relief. Each step is logged once
// when it starts and once when it lifts, tagged 'decided' (the away report lists it). Turning the switch off lifts all.
// "Runs out in" is the forecast's run-out day (net < 0); rations lift on days on hand at the edict's own portion, so
// the cut portion cannot end its own measure early.
import { B } from '../balance';
import { HUBS } from '../types';
import type { EssentialForecast, GameState, HubId, SimView, TickContext } from '../types';
import { edictOption, switchOn } from '../decisions';
import { emergencyImport, hubOpen, price, tripDays } from '../trade';
import { triggerRelief } from '../events';
import { portion } from '../economy';
import { touchPeople } from '../memo';
import { chronicle } from './chronicle';
import { WATER_PAUSED } from './labour';

const LEVEL = { none: 0, parcae: 1, arctae: 2 } as const;

/** Days until the essential runs out at the forecast's net (Infinity while it does not fall). */
function runsOut(s: GameState, fc: EssentialForecast): number {
  return fc.runout === null ? Infinity : Math.max(0, fc.runout - s.day);
}

/** The cheapest open hub selling `qty` grain and what it costs; null when no hub sells grain to us. */
export function cheapestGrain(s: GameState, qty: number): { hub: HubId; cost: number } | null {
  let best: { hub: HubId; cost: number } | null = null;
  for (const hub of HUBS) {
    const p = hubOpen(s, hub) ? price(s, hub, 'grain', 'buy') : null;
    if (p !== null && (!best || p * qty < best.cost)) best = { hub, cost: p * qty };
  }
  return best;
}

/** A relief card is pending or the legion's grain is on the road. */
function reliefUnderWay(s: GameState): boolean {
  return s.choice?.event === 'mutuum' || s.trade.caravans.some((c) => c.kind === 'relief');
}

/** Daily emergency ladder: rations, water pause, emergency import, relief (step 4 calls events.triggerRelief). */
export function emergencyDay(s: GameState, ctx: TickContext, v: SimView): void {
  const em = s.ordo.emergency;
  const E = B.emergency;
  const g = v.f.grain, w = v.f.water;
  const on = switchOn(s, 'emergency');
  const portions = B.economy.PORTIONS as Readonly<Record<string, number>>;
  const edictNeed = g.need * (portions[edictOption(s, 'rationes')] ?? 1) / Math.max(1e-9, portion(s));
  const doh = edictNeed > 0 ? s.res.grain / edictNeed : Infinity;
  const gR = runsOut(s, g);
  const decided = { decided: true };

  // 1 · rations: Parcae below 12 days, Arctae below 6; lifted above 25 days at the edict's portion
  const level = !on ? 'none' : gR < E.ARCTAE ? 'arctae' : gR < E.PARCAE ? 'parcae' : null;
  if (level && level !== 'none' && LEVEL[level] > LEVEL[em.rations]) {
    em.rations = level;
    touchPeople(s);                                                   // the census need follows the new portion today
    chronicle(s, 'emergency', { code: 'emergencyRations', params: { days: Math.floor(gR), level } }, decided);
  } else if (em.rations !== 'none' && (!on || doh > E.LIFT)) {
    em.rations = 'none';
    touchPeople(s);
    chronicle(s, 'emergency', { code: 'emergencyRations', params: { level: 'none', doh: Math.floor(Math.min(doh, 9999)) } }, decided);
  }

  // 2 · water: the concrete works and baths stop drawing below 8 days, until water is back above 15
  const drawers = s.buildings.some((b) => b.status === 'done' && WATER_PAUSED.includes(b.type));
  const wR = runsOut(s, w);
  if (on && !em.waterPause && drawers && wR < E.WATER_PAUSE) {
    em.waterPause = true;
    chronicle(s, 'emergency', { code: 'emergencyWater', params: { days: Math.floor(wR), paused: 1 } }, decided);
  } else if (em.waterPause && (!on || !drawers || w.doh > E.WATER_RESUME)) {
    em.waterPause = false;
    chronicle(s, 'emergency', { code: 'emergencyWater', params: { doh: Math.floor(Math.min(w.doh, 9999)), paused: 0 } }, decided);
  }
  if (!on) return;

  // 3 · emergency import: 20 days of grain from the cheapest open hub when the coin covers it; cooldown 90 days
  const qty = Math.ceil(g.need * E.IMPORT_DAYS);
  const offer = qty > 0 ? cheapestGrain(s, qty) : null;
  // (trade.emergencyImport sets em.lastImport and logs the purchase with the caravan's id; the chronicle rewrites that line)
  if (gR < E.IMPORT_AT && offer && s.res.denarii >= offer.cost && s.day - em.lastImport >= E.IMPORT_COOLDOWN && emergencyImport(s, ctx, qty)) {
    const car = s.trade.caravans.filter((c) => c.kind === 'emergency' && c.depart === s.day).pop();
    chronicle(s, 'emergency', { code: 'emergencyImport', params: { qty, hub: offer.hub, days: tripDays(s, offer.hub, qty) } }, { ...decided, ref: car?.id });
  }

  // 4 · the Legate's relief: structural famine with < 10 days, or < 6 days on hand and no coin for an import
  const famine = g.structural && gR < E.RELIEF_STRUCT;
  const broke = g.doh < E.RELIEF_LOW && g.net < 0 && (!offer || s.res.denarii < offer.cost);
  if ((famine || broke) && s.day - em.lastRelief >= E.RELIEF_COOLDOWN && !reliefUnderWay(s)) {
    const before = em.lastRelief;
    triggerRelief(s, ctx, v);
    if (reliefUnderWay(s) || em.lastRelief !== before) {
      if (em.lastRelief === before) em.lastRelief = s.day;
      chronicle(s, 'emergency', { code: 'relief', params: { days: Math.floor(Math.min(gR, g.doh)) } }, decided);
    }
  }
}

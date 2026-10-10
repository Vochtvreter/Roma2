// src/game/trade.ts — prices, caravans, contracts, the merchant (ARCHITECTURE §8.5, DESIGN §13). Owner: WP-D.
// SCAFFOLD: prices, trip days, slots and hub access follow DESIGN §13.3–13.4; contracts can be created, cancelled and
// resumed but are never dispatched; the market does not drift; no merchant visits.
import { B } from './balance';
import { HUBS } from './types';
import type { ActionResult, ContractSpec, GameState, HubId, Reason, SimView, TickContext, TradeRes } from './types';
import type { Rng } from './rng';
import { derived } from './derived';
import { fx, fxAdd } from './fx';
import { log, nextId } from './state';
import { HUB_DEFS, TRADE_BASE } from './data/hubs';
import { RESOURCE_DEFS } from './data/resources';
import { RANK_DEFS } from './data/ranks';

const VICUS = RANK_DEFS.findIndex((r) => r.id === 'vicus');
const OPPIDUM = RANK_DEFS.findIndex((r) => r.id === 'oppidum');

/** Unit price at a hub: buy = base × market × hub × quirk ÷ fx(tradePrice); sell = … × fx(tradePrice); null = refused. */
export function price(s: GameState, hub: HubId, res: TradeRes, side: 'buy' | 'sell'): number | null {
  const h = HUB_DEFS[hub];
  const q = h.quirks[res]?.[side];
  if (q === 'refused') return null;
  const base = TRADE_BASE[res] * s.trade.market[res] * (side === 'buy' ? h.buy : h.sell) * (q ?? 1);
  return side === 'buy' ? base / fx(s, 'tradePrice') : base * fx(s, 'tradePrice');
}

/** One-way trip days: round(max(MIN_LEG, hub days + ceil(qty / CARGO_PER_DAY) − mansio) × fx(tripDays)). */
export function tripDays(s: GameState, hub: HubId, qty: number): number {
  const mansio = (derived(s).counts.mansio ?? 0) > 0 ? B.trade.MANSIO_DAYS : 0;
  const days = Math.max(B.trade.MIN_LEG, HUB_DEFS[hub].days + Math.ceil(Math.max(0, qty) / B.trade.CARGO_PER_DAY) - mansio);
  return Math.round(days * fx(s, 'tripDays'));
}

/** Caravan slots: 1 + Vicus + Oppidum + min(2, mansiones) + fxAdd(caravanSlots), at most SLOTS_MAX. */
export function caravanSlots(s: GameState): number {
  const mansiones = Math.min(B.trade.MANSIO_SLOTS, derived(s).counts.mansio ?? 0);
  const ranks = (s.rank >= VICUS ? 1 : 0) + (s.rank >= OPPIDUM ? 1 : 0);
  return Math.min(B.trade.SLOTS_MAX, B.trade.SLOTS_BASE + ranks + mansiones + fxAdd(s, 'caravanSlots'));
}

/** Contract caravans currently on the road. */
export function slotsInUse(s: GameState): number {
  return s.trade.caravans.filter((c) => c.kind === 'contract').length;
}

/** A hub trades with us once our rank reaches its rank (trade is inert at Castra unless Mercatores). */
export function hubOpen(s: GameState, hub: HubId): boolean {
  if (HUB_DEFS[hub].rank > s.rank) return false;
  return s.rank >= VICUS || s.decisions.paths.charter === 'mercatores';
}

/** Daily trade: market drift, caravan returns (banditCheck), dispatch of idle contracts, merchant arrival/departure. */
export function tradeDay(s: GameState, ctx: TickContext, rng: Rng, v: SimView): void {
  // STUB(WP-D): DESIGN §13.3–13.6.
  void s; void ctx; void rng; void v;
}

/** Creates a contract (player or Ordo); it is dispatched by tradeDay when a slot is free. */
export function createContract(s: GameState, spec: ContractSpec, owner?: 'player' | 'ordo', reason?: Reason): ActionResult {
  if (!HUBS.includes(spec.hub)) return { ok: false, code: 'invalid', reason: 'No such market.' };
  if (!hubOpen(s, spec.hub)) return { ok: false, code: 'locked', reason: 'That market does not yet trade with us.' };
  if (price(s, spec.hub, spec.res, spec.mode === 'import' ? 'buy' : 'sell') === null) {
    return { ok: false, code: 'refused', reason: `${HUB_DEFS[spec.hub].name} will not trade ${RESOURCE_DEFS[spec.res].name.toLowerCase()} that way.` };
  }
  if (!(spec.qty > 0) || spec.qty > B.ordo.CARGO) return { ok: false, code: 'invalid', reason: `A caravan carries 1 to ${B.ordo.CARGO}.` };
  const id = nextId(s);
  const c: GameState['trade']['contracts'][number] = {
    id, hub: spec.hub, mode: spec.mode, res: spec.res, qty: spec.qty, repeat: spec.repeat,
    owner: owner ?? 'player', status: 'idle', trips: 0, created: s.day,
  };
  if (reason) c.reason = reason;
  s.trade.contracts.push(c);
  log(s, 'trade', `Contract: ${spec.mode} ${spec.qty} ${RESOURCE_DEFS[spec.res].name.toLowerCase()} ${spec.mode === 'import' ? 'from' : 'to'} ${HUB_DEFS[spec.hub].name}.`, undefined, id);
  return { ok: true, id };
}

/** Cancels a contract (a caravan already on the road completes its trip). */
export function cancelContract(s: GameState, id: number): ActionResult {
  const c = s.trade.contracts.find((x) => x.id === id);
  if (!c) return { ok: false, code: 'notFound', reason: 'No such contract.' };
  s.trade.contracts = s.trade.contracts.filter((x) => x.id !== id);
  log(s, 'trade', `Contract with ${HUB_DEFS[c.hub].name} cancelled.`);
  return { ok: true };
}

/** Resumes a paused contract. */
export function resumeContract(s: GameState, id: number): ActionResult {
  const c = s.trade.contracts.find((x) => x.id === id);
  if (!c) return { ok: false, code: 'notFound', reason: 'No such contract.' };
  if (c.status !== 'paused') return { ok: true, id };
  c.status = 'idle';
  delete c.pause;
  return { ok: true, id };
}

/** Whether a contract could dispatch now; failures carry the typed pause code. */
export function checkDispatch(s: GameState, c: ContractSpec, v: SimView): ActionResult {
  const p = price(s, c.hub, c.res, c.mode === 'import' ? 'buy' : 'sell');
  if (p === null) return { ok: false, code: 'refused', reason: 'That market will not trade it.' };
  if (c.mode === 'export') {
    // STUB(WP-D): 'reserve' (Trade reserve × need, Ordo reservations).
    if (s.res[c.res] < c.qty) return { ok: false, code: 'stock', reason: 'Not enough to load.' };
  } else {
    if (s.res.denarii < p * c.qty) return { ok: false, code: 'denarii', reason: 'We cannot pay for it.' };
    if (v.c.caps[c.res] - s.res[c.res] < c.qty) return { ok: false, code: 'storage', reason: 'No room in the stores.' };
  }
  return { ok: true };
}

/** Takes one of the visiting merchant's offers. */
export function takeOffer(s: GameState, offerId: number): ActionResult {
  const m = s.trade.merchant;
  if (!m || !m.offers.some((o) => o.id === offerId && !o.taken)) return { ok: false, code: 'notFound', reason: 'No such offer.' };
  // STUB(WP-D): DESIGN §13.6.
  return { ok: false, code: 'notReady', reason: 'The merchant is still unpacking.' };
}

/** Emergency purchase from the cheapest open hub; arrives after its one-way days. */
export function buyNow(s: GameState, res: TradeRes, qty: number): ActionResult {
  // STUB(WP-D)
  void s; void res; void qty;
  return { ok: false, code: 'notReady', reason: 'No caravan can be sent yet.' };
}

/** The Lex de annona's emergency grain import; true when a caravan was sent. */
export function emergencyImport(s: GameState, ctx: TickContext, qty: number): boolean {
  // STUB(WP-D)
  void s; void ctx; void qty;
  return false;
}

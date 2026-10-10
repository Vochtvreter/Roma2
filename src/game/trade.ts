// src/game/trade.ts — prices, the market, caravans, contracts, the visiting merchant, emergency purchases
// (ARCHITECTURE §8.5, DESIGN §13). Owner: WP-D.
// Distance improves the price in both directions: far hubs sell cheaper and pay more, but take longer. Contracts are
// dispatched by tradeDay whenever a caravan slot is free, pause themselves with a typed code (one log line on pause,
// one on resume) and resume on their own when the cause clears. Exports pay on return; imports pay at dispatch.
import { B } from './balance';
import { HUBS, TRADE_RES } from './types';
import type { ActionResult, Caravan, Contract, ContractSpec, FxEvent, GameState, HubId, Merchant, MerchantOffer, PauseCode, Reason, SimView, TickContext, TradeRes } from './types';
import type { Rng } from './rng';
import { census } from './census';
import { derived } from './derived';
import { elapsed, formatRoman, seasonOf } from './calendar';
import { fx, fxAdd } from './fx';
import { pushActionFx } from './memo';
import { log, nextId } from './state';
import { settingValue } from './decisions';
import { reserved } from './ordo/saving';
import { banditCheck } from './events';
import { HUB_DEFS, MERCHANT_NAMES, SEASON_TARGET, TRADE_BASE } from './data/hubs';
import { RESOURCE_DEFS } from './data/resources';

const VICUS = 1;
const OPPIDUM = 2;
const T = B.trade;
const E = B.events;
/** Merchant quantities scale with the population: × clamp(pop / MERCHANT_POP_REF, …). */
const MERCHANT_POP_REF = B.trade.MERCHANT_POP_REF;
const MERCHANT_SCALE: readonly [number, number] = B.trade.MERCHANT_SCALE;
const MERCHANT_SELL_P = B.trade.MERCHANT_SELL_P;   // chance an offer asks to buy from us
const PAUSE_CODES: readonly string[] = ['reserve', 'stock', 'denarii', 'storage', 'refused'];

const resName = (r: TradeRes): string => RESOURCE_DEFS[r].name.toLowerCase();
const fail = (code: PauseCode | 'invalid' | 'notFound' | 'locked', reason: string): ActionResult => ({ ok: false, code, reason });

/** Unit price at a hub: buy = base × market × hub × quirk ÷ fx(tradePrice); sell = … × fx(tradePrice); null = refused. */
export function price(s: GameState, hub: HubId, res: TradeRes, side: 'buy' | 'sell'): number | null {
  const h = HUB_DEFS[hub];
  const q = h.quirks[res]?.[side];
  if (q === 'refused') return null;
  const base = TRADE_BASE[res] * s.trade.market[res] * (side === 'buy' ? h.buy : h.sell) * (q ?? 1);
  return side === 'buy' ? base / fx(s, 'tradePrice') : base * fx(s, 'tradePrice');
}

/** The regional price of a good (base × market), as the visiting merchant reckons it. */
export function regionalPrice(s: GameState, res: TradeRes): number {
  return TRADE_BASE[res] * s.trade.market[res];
}

/** One-way trip days: round(max(MIN_LEG, hub days + ceil(qty / CARGO_PER_DAY) − mansio) × fx(tripDays)). */
export function tripDays(s: GameState, hub: HubId, qty: number): number {
  const mansio = (derived(s).counts.mansio ?? 0) > 0 ? T.MANSIO_DAYS : 0;
  const days = Math.max(T.MIN_LEG, HUB_DEFS[hub].days + Math.ceil(Math.max(0, qty) / T.CARGO_PER_DAY) - mansio);
  return Math.round(days * fx(s, 'tripDays'));
}

/** Caravan slots: 1 + Vicus + Oppidum + min(2, mansiones) + fxAdd(caravanSlots), at most SLOTS_MAX. */
export function caravanSlots(s: GameState): number {
  const mansiones = Math.min(T.MANSIO_SLOTS, derived(s).counts.mansio ?? 0);
  const ranks = (s.rank >= VICUS ? 1 : 0) + (s.rank >= OPPIDUM ? 1 : 0);
  return Math.min(T.SLOTS_MAX, T.SLOTS_BASE + ranks + mansiones + fxAdd(s, 'caravanSlots'));
}

/** Contract caravans currently on the road. */
export function slotsInUse(s: GameState): number {
  let n = 0;
  for (const c of s.trade.caravans) if (c.kind === 'contract') n++;
  return n;
}

/** A hub trades with us once our rank reaches its rank, from Vicus on (at Castra only with the Mercatores charter). */
export function hubOpen(s: GameState, hub: HubId): boolean {
  if (HUB_DEFS[hub].rank > s.rank) return false;
  return s.rank >= VICUS || s.decisions.paths.charter === 'mercatores';
}

/** The open hub that sells a good cheapest (ties by hub order), or null. */
export function cheapestHub(s: GameState, res: TradeRes): HubId | null {
  let best: HubId | null = null;
  let bestP = Infinity;
  for (const h of HUBS) {
    if (!hubOpen(s, h)) continue;
    const p = price(s, h, res, 'buy');
    if (p !== null && p < bestP) { best = h; bestP = p; }
  }
  return best;
}

/** Goods of `res` already on the road toward us (imports, emergencies, relief). */
function inbound(s: GameState, res: TradeRes): number {
  let n = 0;
  for (const c of s.trade.caravans) if (c.mode === 'import' && c.res === res) n += c.qty;
  return n;
}

/** What an export must leave in store: grain → Trade reserve × daily need; materials → the Ordo's reservations. */
function exportKeep(s: GameState, res: TradeRes, v: SimView): { keep: number; why: string } {
  if (res === 'grain') {
    const days = settingValue(s, 'tradeReserve');
    return { keep: days * v.c.need.grain, why: `we keep ${days} days of grain in reserve` };
  }
  const keep = reserved(s, v)[res] ?? 0;
  return { keep, why: `the Ordo holds ${Math.ceil(keep)} ${resName(res)} for its works` };
}

/** Whether a contract could dispatch now; failures carry the typed pause code and a sentence. */
export function checkDispatch(s: GameState, c: ContractSpec, v: SimView): ActionResult {
  const hub = HUB_DEFS[c.hub];
  const p = price(s, c.hub, c.res, c.mode === 'import' ? 'buy' : 'sell');
  if (p === null) return fail('refused', `${hub.name} will not ${c.mode === 'import' ? 'sell us' : 'buy'} ${resName(c.res)}.`);
  if (c.mode === 'export') {
    if (s.res[c.res] < c.qty) return fail('stock', `Not enough ${resName(c.res)} to load: ${Math.floor(s.res[c.res])} of ${c.qty}.`);
    const k = exportKeep(s, c.res, v);
    if (s.res[c.res] - c.qty < k.keep) return fail('reserve', `Our ${resName(c.res)} caravan to ${hub.name} stands idle: ${k.why}.`);
  } else {
    const cost = p * c.qty;
    if (s.res.denarii < cost) return fail('denarii', `The aerarium cannot pay ${Math.ceil(cost)} denarii for ${c.qty} ${resName(c.res)}.`);
    const room = v.c.caps[c.res] - s.res[c.res] - inbound(s, c.res);
    if (room < c.qty) return fail('storage', `No room in our stores for ${c.qty} more ${resName(c.res)}.`);
  }
  return { ok: true };
}

/** Live preview for the contract form: unit price, value, one-way and round-trip days, and whether it could go now. */
export function contractPreview(s: GameState, spec: ContractSpec, v: SimView): { price: number | null; value: number; oneWay: number; roundTrip: number; check: ActionResult } {
  const p = price(s, spec.hub, spec.res, spec.mode === 'import' ? 'buy' : 'sell');
  const oneWay = tripDays(s, spec.hub, spec.qty);
  return { price: p, value: (p ?? 0) * spec.qty, oneWay, roundTrip: 2 * oneWay, check: checkDispatch(s, spec, v) };
}

/** Creates a contract (player or Ordo); tradeDay dispatches it when a slot is free. */
export function createContract(s: GameState, spec: ContractSpec, owner?: 'player' | 'ordo', reason?: Reason): ActionResult {
  if (!HUBS.includes(spec.hub)) return fail('invalid', 'No such market.');
  if (!TRADE_RES.includes(spec.res)) return fail('invalid', 'That good is not traded.');
  if (spec.mode !== 'export' && spec.mode !== 'import') return fail('invalid', 'Buy or sell?');
  if (!hubOpen(s, spec.hub)) return fail('locked', `${HUB_DEFS[spec.hub].name} does not yet trade with us.`);
  if (price(s, spec.hub, spec.res, spec.mode === 'import' ? 'buy' : 'sell') === null) {
    return fail('refused', `${HUB_DEFS[spec.hub].name} will not ${spec.mode === 'import' ? 'sell us' : 'buy'} ${resName(spec.res)}.`);
  }
  const qty = Math.floor(spec.qty);
  if (!Number.isFinite(qty) || qty < 1 || qty > B.ordo.CARGO) return fail('invalid', `A caravan carries 1 to ${B.ordo.CARGO}.`);
  const id = nextId(s);
  const c: Contract = { id, hub: spec.hub, mode: spec.mode, res: spec.res, qty, repeat: spec.repeat === true, owner: owner ?? 'player', status: 'idle', trips: 0, created: s.day };
  if (reason) c.reason = reason;
  s.trade.contracts.push(c);
  const verb = spec.mode === 'import' ? `buy ${qty} ${resName(spec.res)} from` : `sell ${qty} ${resName(spec.res)} to`;
  log(s, 'trade', `Contract${c.repeat ? ' (standing)' : ''}: ${verb} ${HUB_DEFS[spec.hub].name}.`, owner === 'ordo' ? ['decided'] : undefined, id);
  return { ok: true, id };
}

/** Cancels a contract (a caravan already on the road completes its trip). */
export function cancelContract(s: GameState, id: number): ActionResult {
  const c = s.trade.contracts.find((x) => x.id === id);
  if (!c) return fail('notFound', 'No such contract.');
  s.trade.contracts = s.trade.contracts.filter((x) => x.id !== id);
  log(s, 'trade', `Contract with ${HUB_DEFS[c.hub].name} cancelled.`);
  return { ok: true };
}

/** Resumes a paused contract (it pauses again if the cause still holds). */
export function resumeContract(s: GameState, id: number): ActionResult {
  const c = s.trade.contracts.find((x) => x.id === id);
  if (!c) return fail('notFound', 'No such contract.');
  if (c.status !== 'paused') return { ok: true, id };
  c.status = 'idle';
  delete c.pause;
  log(s, 'trade', `The ${resName(c.res)} caravan to ${HUB_DEFS[c.hub].name} is ready again.`);
  return { ok: true, id };
}

function moveMarket(s: GameState, res: TradeRes, delta: number): void {
  const m = s.trade.market[res] + delta;
  s.trade.market[res] = Math.min(T.CLAMP[1], Math.max(T.CLAMP[0], m));
}

/** Daily drift: each market eases REVERT per day toward its seasonal target. */
function driftMarket(s: GameState): void {
  const season = seasonOf(s.day);
  for (const r of TRADE_RES) moveMarket(s, r, T.REVERT * (SEASON_TARGET[r][season] - s.trade.market[r]));
}

function addCaravan(s: GameState, c: Omit<Caravan, 'id'>): Caravan {
  const car: Caravan = { id: nextId(s), ...c };
  s.trade.caravans.push(car);
  return car;
}

/** Sends a contract's caravan: loads (export) or pays (import), moves the market, books the slot. */
function dispatch(s: GameState, ctx: TickContext, c: Contract): void {
  const p = price(s, c.hub, c.res, c.mode === 'import' ? 'buy' : 'sell') as number;
  const value = p * c.qty;
  if (c.mode === 'export') {
    s.res[c.res] -= c.qty;
    ctx.rates.cons[c.res].trade = (ctx.rates.cons[c.res].trade ?? 0) + c.qty;
    moveMarket(s, c.res, -T.IMPACT * c.qty);
  } else {
    s.res.denarii -= value;
    ctx.rates.cons.denarii.trade = (ctx.rates.cons.denarii.trade ?? 0) + value;
    moveMarket(s, c.res, T.IMPACT * c.qty);
  }
  const days = tripDays(s, c.hub, c.qty);
  const car = addCaravan(s, { contract: c.id, hub: c.hub, mode: c.mode, res: c.res, qty: c.qty, value, depart: s.day, arrive: s.day + 2 * days, kind: 'contract' });
  c.status = 'travelling';
  ctx.fx.push({ kind: 'caravanOut', caravan: car.id, hub: c.hub });
}

/** Re-checks every waiting contract: pause / resume with one log line each, then dispatch while slots are free. */
function dispatchContracts(s: GameState, ctx: TickContext, v: SimView): void {
  for (const c of s.trade.contracts) {
    if (c.status === 'travelling') continue;
    const chk = checkDispatch(s, c, v);
    if (!chk.ok) {
      if (!PAUSE_CODES.includes(chk.code)) continue;
      if (c.status !== 'paused') log(s, 'trade', chk.reason, undefined, c.id);
      c.status = 'paused';
      c.pause = chk.code as PauseCode;
      continue;
    }
    if (c.status === 'paused') {
      c.status = 'idle';
      delete c.pause;
      log(s, 'trade', `The ${resName(c.res)} caravan to ${HUB_DEFS[c.hub].name} sets out again.`, undefined, c.id);
    }
    if (slotsInUse(s) >= caravanSlots(s)) continue;     // waiting for a mule team
    dispatch(s, ctx, c);
  }
}

/** A caravan comes home: coin for exports; goods for imports (overflow refunded pro rata); contract bookkeeping. */
function deliver(s: GameState, ctx: TickContext, car: Caravan): void {
  const hub = HUB_DEFS[car.hub];
  let coin = 0;
  if (car.mode === 'export') {
    coin = car.value;
    s.res.denarii += coin;
    ctx.rates.prod.denarii.trade = (ctx.rates.prod.denarii.trade ?? 0) + coin;
  } else if (car.kind === 'relief') {
    s.res[car.res] += car.qty;
    ctx.rates.prod[car.res].relief = (ctx.rates.prod[car.res].relief ?? 0) + car.qty;
    log(s, 'good', `The legion's grain arrives: ${Math.round(car.qty)} modii.`, ['highlight']);
    return;
  } else {
    const room = Math.max(0, census(s).caps[car.res] - s.res[car.res]);
    const got = Math.min(car.qty, room);
    if (car.qty > 0 && got < car.qty) coin = car.value * (car.qty - got) / car.qty;
    s.res[car.res] += got;
    s.res.denarii += coin;
    ctx.rates.prod[car.res].trade = (ctx.rates.prod[car.res].trade ?? 0) + got;
  }
  s.counters.caravansReturned++;
  ctx.fx.push({ kind: 'caravanIn', caravan: car.id, hub: car.hub, denarii: coin });
  if (car.kind !== 'contract') return;
  if (!s.trade.hubsTraded.includes(car.hub)) s.trade.hubsTraded = HUBS.filter((h) => h === car.hub || s.trade.hubsTraded.includes(h));
  const what = car.mode === 'export'
    ? `${Math.round(car.qty)} ${resName(car.res)} sold for ${Math.round(coin)} denarii`
    : `${Math.round(car.qty)} ${resName(car.res)} brought home${coin > 0 ? ` (${Math.round(coin)} denarii back for what the stores could not hold)` : ''}`;
  log(s, 'trade', `The caravan returns from ${hub.name}: ${what}.`, undefined, car.contract ?? undefined);
  const c = s.trade.contracts.find((x) => x.id === car.contract);
  if (!c) return;
  c.trips++;
  if (c.repeat) c.status = 'idle';
  else s.trade.contracts = s.trade.contracts.filter((x) => x.id !== c.id);
}

/** Caravans whose return day has come, in id order (bandits may strike long routes first). */
function returns(s: GameState, ctx: TickContext, rng: Rng): void {
  if (!s.trade.caravans.some((c) => c.arrive <= s.day)) return;
  const due = s.trade.caravans.filter((c) => c.arrive <= s.day);
  s.trade.caravans = s.trade.caravans.filter((c) => c.arrive > s.day);
  for (const car of due) {
    if (car.kind === 'contract') banditCheck(s, ctx, rng, car);
    deliver(s, ctx, car);
  }
}

/** Merchant offers: 2–4 distinct goods; we buy at 0.85 × the regional price, we sell at 1.15 ×; quantities scale with pop. */
function makeOffers(s: GameState, rng: Rng): MerchantOffer[] {
  const n = rng.int(E.MERCHANT_OFFERS[0], E.MERCHANT_OFFERS[1]);
  const goods = rng.shuffle([...TRADE_RES]).slice(0, n);
  const scale = Math.min(MERCHANT_SCALE[1], Math.max(MERCHANT_SCALE[0], s.people.length / MERCHANT_POP_REF));
  const tp = fx(s, 'tradePrice');
  const offers: MerchantOffer[] = [];
  for (const res of goods) {
    const sellQty = Math.round(rng.int(T.MERCHANT_SELL_QTY[0], T.MERCHANT_SELL_QTY[1]) * scale);
    const wantsOurs = rng.chance(MERCHANT_SELL_P) && s.res[res] >= sellQty;
    const kind: MerchantOffer['kind'] = wantsOurs ? 'sell' : 'buy';
    const qty = kind === 'sell' ? sellQty : Math.round(rng.int(T.MERCHANT_QTY[0], T.MERCHANT_QTY[1]) * scale);
    const unit = kind === 'buy' ? regionalPrice(s, res) * T.MERCHANT_BUY / tp : regionalPrice(s, res) * T.MERCHANT_SELL * tp;
    offers.push({ id: nextId(s), kind, res, qty, price: unit, taken: false });
  }
  return offers;
}

function merchantLeaves(s: GameState, why: string): void {
  const m = s.trade.merchant;
  if (!m) return;
  s.trade.merchant = null;
  s.trade.lastMerchant = s.day;
  log(s, 'trade', `${m.name} ${why}.`);
}

/** Daily merchant step: departure at the end of the stay; otherwise a chance of a visit (DESIGN §12.2 #15, §13.6). */
function merchantDay(s: GameState, rng: Rng): void {
  const m = s.trade.merchant;
  if (m && s.day >= m.until) merchantLeaves(s, 'break camp and take the via');
  if (s.trade.merchant) return;
  if (elapsed(s) < E.START || s.day - s.trade.lastMerchant < E.MERCHANT_GAP) return;
  if (s.morale < B.morale.MERCHANTS_MIN || s.people.length < E.MERCHANT_POP) return;
  const mansiones = Math.min(E.MERCHANT_MANSIO_MAX, derived(s).counts.mansio ?? 0);
  const p = E.MERCHANT_P * fx(s, 'merchants') * Math.pow(E.MERCHANT_MANSIO, mansiones);
  if (rng.chance(p)) spawnMerchant(s, rng);
}

/** A merchant caravan parks at the forum now with 2–4 offers (false when one is already here). */
export function spawnMerchant(s: GameState, rng: Rng): boolean {
  if (s.trade.merchant) return false;
  const merchant: Merchant = { name: rng.pick(MERCHANT_NAMES), arrived: s.day, until: s.day + E.MERCHANT_STAY, offers: [] };
  merchant.offers = makeOffers(s, rng);
  s.trade.merchant = merchant;
  s.eventDays.mercator = s.day;
  const goods = merchant.offers.map((o) => `${o.kind === 'buy' ? 'sells' : 'buys'} ${resName(o.res)}`).join(', ');
  log(s, 'trade', `${merchant.name} camp at the forum until ${formatRoman(merchant.until)}: ${goods}.`, ['highlight']);
  return true;
}

/** Daily trade: market drift, caravan returns (banditCheck), dispatch of waiting contracts, merchant arrival/departure. */
export function tradeDay(s: GameState, ctx: TickContext, rng: Rng, v: SimView): void {
  driftMarket(s);
  returns(s, ctx, rng);
  dispatchContracts(s, ctx, v);
  merchantDay(s, rng);
}

/** Takes one of the visiting merchant's offers ('buy': we buy from them; 'sell': we sell to them). */
export function takeOffer(s: GameState, offerId: number): ActionResult {
  const m = s.trade.merchant;
  const o = m?.offers.find((x) => x.id === offerId && !x.taken);
  if (!m || !o) return fail('notFound', 'No such offer.');
  const total = o.price * o.qty;
  if (o.kind === 'buy') {
    if (s.res.denarii < total) return fail('denarii', `The aerarium cannot pay ${Math.ceil(total)} denarii.`);
    if (census(s).caps[o.res] - s.res[o.res] < o.qty) return fail('storage', `No room in our stores for ${o.qty} more ${resName(o.res)}.`);
    s.res.denarii -= total;
    s.res[o.res] += o.qty;
  } else {
    if (s.res[o.res] < o.qty) return fail('stock', `We have only ${Math.floor(s.res[o.res])} ${resName(o.res)}.`);
    if (o.res === 'grain') {
      const days = settingValue(s, 'tradeReserve');
      if (s.res.grain - o.qty < days * census(s).need.grain) return fail('reserve', `We keep ${days} days of grain in reserve.`);
    }
    s.res[o.res] -= o.qty;
    s.res.denarii += total;
  }
  o.taken = true;
  const verb = o.kind === 'buy' ? 'bought' : 'sold';
  log(s, 'trade', `${m.name}: ${verb} ${o.qty} ${resName(o.res)} for ${Math.round(total)} denarii.`);
  if (m.offers.every((x) => x.taken)) merchantLeaves(s, 'sold out and depart');
  return { ok: true, id: offerId };
}

/** An emergency purchase outside the caravan slots: pays now, arrives after the hub's one-way days. */
function sendEmergency(s: GameState, res: TradeRes, qty: number, hub: HubId, emit: (e: FxEvent) => void): Caravan {
  const p = price(s, hub, res, 'buy') as number;
  const value = p * qty;
  s.res.denarii -= value;
  moveMarket(s, res, T.IMPACT * Math.min(qty, B.ordo.CARGO));
  const days = tripDays(s, hub, Math.min(qty, B.ordo.CARGO));
  const car = addCaravan(s, { contract: null, hub, mode: 'import', res, qty, value, depart: s.day, arrive: s.day + days, kind: 'emergency' });
  emit({ kind: 'caravanOut', caravan: car.id, hub });
  return car;
}

/** Emergency purchase from the cheapest open hub; arrives after its one-way days (no slot, no trade reserve). */
export function buyNow(s: GameState, res: TradeRes, qty: number): ActionResult {
  if (!TRADE_RES.includes(res) || !Number.isFinite(qty) || qty < 1) return fail('invalid', 'Buy how much?');
  const hub = cheapestHub(s, res);
  if (!hub) return fail('locked', `No market will sell us ${resName(res)} yet.`);
  const n = Math.floor(qty);
  const cost = (price(s, hub, res, 'buy') as number) * n;
  if (s.res.denarii < cost) return fail('denarii', `The aerarium cannot pay ${Math.ceil(cost)} denarii.`);
  const car = sendEmergency(s, res, n, hub, pushActionFx);
  log(s, 'trade', `Bought ${n} ${resName(res)} from ${HUB_DEFS[hub].name} for ${Math.round(cost)} denarii; the carts arrive ${formatRoman(car.arrive)}.`, undefined, car.id);
  return { ok: true, id: car.id };
}

/** The Lex de annona's emergency grain import (ignores slots and the trade reserve); true when a caravan was sent. */
export function emergencyImport(s: GameState, ctx: TickContext, qty: number): boolean {
  const n = Math.floor(qty);
  if (!(n >= 1)) return false;
  const hub = cheapestHub(s, 'grain');
  if (!hub) return false;
  const cost = (price(s, hub, 'grain', 'buy') as number) * n;
  if (s.res.denarii < cost) return false;
  const car = sendEmergency(s, 'grain', n, hub, (e) => ctx.fx.push(e));
  ctx.rates.cons.denarii.trade = (ctx.rates.cons.denarii.trade ?? 0) + cost;
  s.ordo.emergency.lastImport = s.day;
  log(s, 'emergency', `Emergency: ${n} grain bought from ${HUB_DEFS[hub].name} for ${Math.round(cost)} denarii, due ${formatRoman(car.arrive)}.`, ['decided'], car.id);
  return true;
}

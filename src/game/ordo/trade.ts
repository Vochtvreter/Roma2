// src/game/ordo/trade.ts — trade automation every 10 days (ARCHITECTURE §8.4, DESIGN §10.7). Owner: WP-C.
// Rules in order: deficit grain import → oil/wine for the great houses → imports for a work kept waiting → surplus
// exports; then, on the merchant's last council day, clearly good deals. Contracts are tagged 'ordo' and carry their
// Reason; the Ordo tidies only its own contracts (never a player's). Every coin spent respects the saving target and the
// treasury floor and keeps a coin runway (90 days for contracts, 60 for the merchant).
import { B as B$ } from '../balance';
import { HUBS as HUBS$, RULES as RULES$, TRADE_RES as TRADE_RES$ } from '../types';
import type { ContractSpec, Cost, GameState, HubId, Reason, ResId, SimView, TickContext, TradeRes } from '../types';
import { cancelContract, caravanSlots, createContract, hubOpen, price, takeOffer, tripDays } from '../trade';
import { settingValue } from '../decisions';
import { tabRevealed } from '../reveal';
import { capitoliumFlow } from '../construction';
import { missing } from '../state';
import { BUILDING_DEFS as BUILDING_DEFS$ } from '../data/buildings';
import { TRADE_BASE as TRADE_BASE$ } from '../data/hubs';
import { RANK_DEFS as RANK_DEFS$ } from '../data/ranks';
import { canSpend, capitoliumAhead, etaDays, outputRates, reserved, savingParts } from './saving';
import { houseWants, walkWishes } from './build';
import { chronicle } from './chronicle';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, HUBS = HUBS$, RULES = RULES$, TRADE_RES = TRADE_RES$, BUILDING_DEFS = BUILDING_DEFS$,
  TRADE_BASE = TRADE_BASE$, RANK_DEFS = RANK_DEFS$;

const MIN_EXPORT = B.ordo.MIN_EXPORT;   // the smallest surplus worth a caravan
const MATERIALS: TradeRes[] = ['timber', 'stone', 'tiles', 'iron'];

/** One contract the Ordo would make, with its reason. */
export interface TradeMove { spec: ContractSpec; reason: Reason }

const isTrade = (r: string): r is TradeRes => (TRADE_RES as readonly string[]).includes(r);

/** Days of coin left after spending `spend` at the 30-day average (Infinity while the treasury grows). */
function runway(v: SimView, spend: number): number {
  const net = v.f.coin.net30;
  return net >= 0 ? Infinity : (v.f.coin.stock - spend) / -net;
}

/** An Ordo contract for this good and direction that is not paused. */
function busy(s: GameState, mode: 'import' | 'export', res: TradeRes): boolean {
  return s.trade.contracts.some((c) => c.owner === 'ordo' && c.mode === mode && c.res === res && c.status !== 'paused');
}

/** Daily use of a good: eaten grain, oil and wine for the houses, processing inputs at today's staffing. */
function dailyUse(s: GameState, v: SimView, res: TradeRes): number {
  if (res === 'grain') return v.c.need.grain;
  const hw = houseWants(s, v);
  if (res === 'oil') return hw.t4Res * B.housing.GOODS.oil;
  if (res === 'wine') return hw.domusRes * B.housing.GOODS.wine;
  let use = 0;
  const staffed = v.c.staffed;   // the census once, not a view read per building
  for (const b of s.buildings) if (b.status === 'done') use += (BUILDING_DEFS[b.type].inputs?.[res] ?? 0) * (staffed[b.id] ?? 0);
  return use;
}

/** Stock above max(trade reserve × daily use, 80% of the cap — 60% under Mercatura) and above what the Ordo holds back. */
function surplus(s: GameState, v: SimView, res: TradeRes): number {
  const share = s.decisions.focus === 'mercatura' ? B.ordo.EXPORT_CAP_MERCATURA : B.ordo.EXPORT_CAP;
  const keep = Math.max(settingValue(s, 'tradeReserve') * dailyUse(s, v, res), share * v.c.caps[res]) + (reserved(s, v)[res] ?? 0);
  return s.res[res] - keep;
}

/** The contracts the Ordo would make now, in rule order, within the free caravan slots. Pure. */
export function tradeMoves(s: GameState, v: SimView): TradeMove[] {
  const out: TradeMove[] = [];
  let free = caravanSlots(s) - s.trade.contracts.filter((c) => c.status !== 'paused').length;
  const room = (res: TradeRes): number => Math.max(0, v.c.caps[res] - s.res[res]);
  const buy = (res: TradeRes, want: number, code: Reason['code'], params: Reason['params'], repeat = false): void => {
    const qty = Math.floor(Math.min(B.ordo.CARGO, want, room(res)));
    if (free <= 0 || qty < 1 || busy(s, 'import', res) || out.some((m) => m.spec.res === res)) return;
    let hub: HubId | null = null, unit = Infinity;
    for (const h of HUBS) { const p = hubOpen(s, h) ? price(s, h, res, 'buy') : null; if (p !== null && p < unit) { unit = p; hub = h; } }
    const cost = unit * qty;
    if (!hub || !canSpend(s, { denarii: cost }, v) || runway(v, cost) <= B.ordo.IMPORT_RUNWAY) return;
    out.push({ spec: { hub, mode: 'import', res, qty, repeat }, reason: { code, params: { res, qty, hub, ...params } } });
    free--;
  };
  const g = v.f.grain;
  const gr = settingValue(s, 'grainReserve');
  // 1 · grain when the Hiems forecast is short, or the stores run low and our fields cannot keep up (Copia: early)
  const hiems = g.crunch && g.crunch.startsIn <= B.advisors.RULES.HIEMS_LEAD && g.crunch.lowestDoh < 1;
  const low = s.decisions.focus === 'copia' ? g.doh < gr : g.doh < gr / 2 && g.structural;
  if (hiems || low) buy('grain', hiems && g.crunch ? g.crunch.needInStore - g.stock : g.need * gr - g.stock, 'deficitImport', { why: hiems ? 'winter' : 'famine' });
  // 2 · oil and wine before the great houses run dry (Urbs keeps twice the runway), on a standing contract
  for (const res of ['oil', 'wine'] as const) {
    const net = dailyUse(s, v, res) - (outputRates(s, 'current')[res] ?? 0);
    const days = net > 0 ? s.res[res] / net : Infinity;
    if (days < B.ordo.LUXURY_RUNWAY * (s.decisions.focus === 'urbs' ? 2 : 1)) buy(res, B.ordo.CARGO, 'luxuryImport', { days: Math.floor(days) }, true);
  }
  // 3 · a work kept waiting more than 40 days on a tradeable good: the pending wish, a request, the Capitolium
  const pending = walkWishes(s, v).pending;
  const waits: { type: string; cost: Cost; days: number | null }[] = [];
  if (pending) waits.push({ type: pending.type, cost: pending.cost, days: etaDays(s, v, missing(s, pending.cost)) });
  for (const p of savingParts(s, v)) if (p.kind === 'request' && p.req && s.day - p.req.day > B.ordo.WISH_WAIT) waits.push({ type: p.type ?? 'wish', cost: p.cost, days: s.day - p.req.day });
  const flow = capitoliumFlow(s);
  if (flow?.bottleneck && isTrade(flow.bottleneck)) waits.push({ type: 'capitolium', cost: capitoliumAhead(s), days: null });
  for (const w of waits) {
    if (w.days !== null && w.days <= B.ordo.WISH_WAIT) continue;
    const lack = missing(s, w.cost);
    for (const r of TRADE_RES) if ((lack[r] ?? 0) > 0) buy(r, lack[r] ?? 0, 'wishImport', w.days === null ? { for: w.type } : { for: w.type, days: w.days });
  }
  // 4 · surplus to the hub paying best per day of the round trip (Materia sells its materials last). While the next
  //     petition still counts markets traded with (Oppidum 2, Colonia 5), the best market not yet traded with comes
  //     first, as the build list raises the works a petition names (DESIGN §9.1, §10.5 row 7).
  const order = s.decisions.focus === 'materia' ? [...TRADE_RES.filter((r) => !MATERIALS.includes(r)), ...MATERIALS] : TRADE_RES;
  const newHubs = s.trade.hubsTraded.length < hubsWanted(s);
  const going = new Set<HubId>([...s.trade.contracts.map((c) => c.hub), ...out.map((m) => m.spec.hub)]);
  for (const res of order) {
    const qty = Math.floor(Math.min(B.ordo.CARGO, surplus(s, v, res)));
    if (free <= 0 || qty < MIN_EXPORT || busy(s, 'export', res)) continue;
    let hub: HubId | null = null, best = 0, fresh = false;
    for (const h of HUBS) {
      const p = hubOpen(s, h) ? price(s, h, res, 'sell') : null;
      const value = p === null ? 0 : (p * qty) / (2 * tripDays(s, h, qty));
      const isNew = newHubs && !s.trade.hubsTraded.includes(h) && !going.has(h) && value > 0;
      if ((isNew && !fresh) || (isNew === fresh && value > best)) { best = value; hub = h; fresh = isNew; }
    }
    if (hub) going.add(hub);
    if (!hub) continue;
    out.push({ spec: { hub, mode: 'export', res, qty, repeat: false }, reason: { code: 'surplusExport', params: { res, qty, hub } } });
    free--;
  }
  return out;
}

/** Markets the next petition wants traded with (B.progress.PETITION: Oppidum 2, Colonia 5); 0 when it names none. */
function hubsWanted(s: GameState): number {
  const next = RANK_DEFS[s.rank + 1];
  const q = next ? (B.progress.PETITION as Readonly<Record<string, { HUBS?: number }>>)[next.id] : undefined;
  return q?.HUBS ?? 0;
}

/** Goods named by an active Cave or Periculum advisory (grain for the annona rules, else the rule's own good); full
 *  sheds (annonae.storage) want room, not grain. */
function wantedGoods(s: GameState): Set<ResId> {
  const out = new Set<ResId>();
  for (const id of RULES) {
    const a = s.guidance.advisories[id];
    if (!a?.active || a.sev < 2 || id === 'annonae.storage') continue;
    const res = a.params.res;
    if (typeof res === 'string' && isTrade(res)) out.add(res);
    else if (id.startsWith('annonae.')) out.add(id === 'annonae.goods' ? 'oil' : 'grain');
  }
  return out;
}

/** On the merchant's last council day: sell him surplus at ≥ 1.1 × base, buy what an urgent advisory names (coin runway > 60 days).
 *  MerchantOffer.kind is the colony's side (WP-D): 'buy' = we buy from him, 'sell' = we sell to him; price is per unit. */
function merchantDeals(s: GameState, v: SimView, decided: boolean): void {
  const m = s.trade.merchant;
  // not before Commercium opens: the Ordo trades only where the player could (an old save may hold a Castra merchant)
  if (!m || m.until - s.day > B.ordo.TRADE_EVERY || !tabRevealed(s, 'trade')) return;
  const wanted = wantedGoods(s);
  for (const o of m.offers) {
    if (o.taken) continue;
    const cost = o.price * o.qty;
    const good = o.kind === 'sell'
      ? o.price >= B.ordo.MERCHANT_DEAL * TRADE_BASE[o.res] && surplus(s, v, o.res) >= o.qty
      : wanted.has(o.res) && v.c.caps[o.res] - s.res[o.res] >= o.qty && canSpend(s, { denarii: cost }, v) && runway(v, cost) > B.ordo.MERCHANT_RUNWAY;
    if (!good || !takeOffer(s, o.id).ok) continue;
    chronicle(s, 'ordo', { code: 'merchantDeal', params: { res: o.res, qty: o.qty, price: o.price, why: o.kind === 'sell' ? 'sold' : 'bought' } }, { decided });
  }
}

/** Every 10 days: tidies the Ordo's paused or needless contracts, makes the new ones, takes good merchant deals (DESIGN §10.7). */
export function ordoTrade(s: GameState, ctx: TickContext, v: SimView): void {
  const decided = ctx.offline && !s.ordo.on.trade;
  for (const c of s.trade.contracts.slice()) {
    if (c.owner !== 'ordo' || c.status === 'travelling') continue;
    const needless = c.repeat && (c.res === 'oil' || c.res === 'wine') && dailyUse(s, v, c.res) <= (outputRates(s, 'current')[c.res] ?? 0);
    if (c.status === 'paused' || needless) cancelContract(s, c.id);
  }
  for (const m of tradeMoves(s, v)) {
    const r = createContract(s, m.spec, 'ordo', m.reason);
    if (r.ok) chronicle(s, 'ordo', m.reason, { ref: r.id, decided });
  }
  merchantDeals(s, v, decided);
}

/** What the Ordo would do in trade now (manual mode's "would" line), or null. */
export function ordoTradeWould(s: GameState, v: SimView): Reason | null {
  return tradeMoves(s, v)[0]?.reason ?? null;
}

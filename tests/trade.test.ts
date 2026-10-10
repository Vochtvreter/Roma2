// tests/trade.test.ts — prices, trip days, slots, contracts and their pause codes, the market, the merchant (WP-D).
import { describe, expect, it } from 'vitest';
import { B } from '../src/game/balance';
import { HUBS, TRADE_RES } from '../src/game/types';
import type { Building, BuildingId, ContractSpec, GameState, TickContext } from '../src/game/types';
import { Rng } from '../src/game/rng';
import { nextId } from '../src/game/state';
import { invalidate } from '../src/game/memo';
import { nextSeasonStart } from '../src/game/calendar';
import { view } from '../src/game/sim';
import {
  buyNow, cancelContract, caravanSlots, cheapestHub, checkDispatch, contractPreview, createContract, emergencyImport, hubOpen, price,
  regionalPrice, resumeContract, slotsInUse, spawnMerchant, takeOffer, tradeDay, tripDays,
} from '../src/game/trade';
import { HUB_DEFS, TRADE_BASE } from '../src/game/data/hubs';
import { ctx, fresh, noNaN } from './util';

function addBuilding(s: GameState, type: BuildingId): Building {
  const id = nextId(s);
  const b: Building = { id, type, x: 2 + id * 2, y: 2, owner: 'player', status: 'done', placed: s.day, progress: 1, work: 1, paid: true, order: id, open: true, prio: 1 };
  s.buildings.push(b);
  invalidate(s);
  return b;
}

function vicus(): GameState {
  const s = fresh();
  s.rank = 1;
  s.decisions.paths = { charter: 'veterani', path1: 'pagus' };
  invalidate(s);
  return s;
}

/** Runs tradeDay alone for `days` days (one stream), collecting the fx. */
function stepTrade(s: GameState, days: number, onDay?: (c: TickContext) => void): void {
  const rng = new Rng(77);
  for (let i = 0; i < days; i++) {
    s.day += 1;
    const c = ctx();
    tradeDay(s, c, rng, view(s));
    onDay?.(c);
  }
}

describe('prices: distance improves the price both ways', () => {
  it('buy = base × market × hub × quirk ÷ fx; sell = … × fx; refused is null', () => {
    const s = fresh();
    expect(price(s, 'durii', 'grain', 'buy')).toBeCloseTo(2 * 1.05 * 1.6);
    expect(price(s, 'durii', 'grain', 'sell')).toBeCloseTo(2 * 0.95 * 1.3);
    expect(price(s, 'massilia', 'grain', 'buy')).toBeNull();
    expect(price(s, 'narbo', 'iron', 'buy')).toBeNull();
    s.trade.market.grain = 1.25;
    expect(price(s, 'silvanum', 'grain', 'buy')).toBeCloseTo(2 * 1.25);
    s.decisions.paths.charter = 'mercatores';               // trade prices ×1.10 better both ways
    expect(price(s, 'silvanum', 'grain', 'buy')).toBeCloseTo(2 * 1.25 / 1.1);
    expect(price(s, 'silvanum', 'grain', 'sell')).toBeCloseTo(2 * 1.25 * 1.1);
  });

  it('near markets charge a spread; the farthest market is best both ways, the nearest worst', () => {
    const s = fresh();
    for (const h of HUBS) for (const r of TRADE_RES) {
      const b = price(s, h, r, 'buy'), se = price(s, h, r, 'sell');
      if (b === null || se === null || HUB_DEFS[h].quirks[r]) continue;
      // DESIGN §13.2: near markets charge a spread; from Forum Narbonis on, a far market sells below what it pays.
      if (HUB_DEFS[h].days <= 10) expect(b, `${h} ${r}`).toBeGreaterThanOrEqual(se);
      else expect(b, `${h} ${r}`).toBeLessThan(se);
    }
    const byDays = HUBS.slice().sort((a, b) => HUB_DEFS[a].days - HUB_DEFS[b].days);
    const near = byDays[0], far = byDays[byDays.length - 1];
    expect(near).toBe('metellianus');
    expect(far).toBe('augusta');
    for (const h of HUBS) {
      expect(price(s, near, 'tiles', 'buy')!).toBeGreaterThanOrEqual(price(s, h, 'tiles', 'buy')!);
      expect(price(s, far, 'tiles', 'buy')!).toBeLessThanOrEqual(price(s, h, 'tiles', 'buy')!);
      expect(price(s, near, 'stone', 'sell')!).toBeLessThanOrEqual(price(s, h, 'stone', 'sell')!);
      expect(price(s, far, 'stone', 'sell')!).toBeGreaterThanOrEqual(price(s, h, 'stone', 'sell')!);
    }
  });

  it('the market eases 2% a day toward its seasonal target and moves with each dispatch', () => {
    const s = vicus();
    s.trade.market.grain = 1;
    stepTrade(s, 1);
    expect(s.trade.market.grain).toBeCloseTo(1 + B.trade.REVERT * (1.15 - 1));   // Ver target 1.15
    s.day = nextSeasonStart(s.day, 2) - 1;
    stepTrade(s, 400);
    expect(s.trade.market.grain).toBeGreaterThan(B.trade.CLAMP[0]);
    expect(s.trade.market.grain).toBeLessThan(B.trade.CLAMP[1]);
    s.res.timber = 300;
    s.trade.market.timber = 1;
    createContract(s, { hub: 'metellianus', mode: 'export', res: 'timber', qty: 80, repeat: false });
    const before = s.trade.market.timber;
    stepTrade(s, 1);
    expect(s.trade.market.timber).toBeLessThan(before);
  });
});

describe('caravans', () => {
  it('one-way = round(max(3, hub days + ceil(qty/40) − mansio) × fx(tripDays))', () => {
    const s = vicus();
    expect(tripDays(s, 'metellianus', 80)).toBe(6);
    expect(tripDays(s, 'metellianus', 1)).toBe(5);
    expect(tripDays(s, 'durii', 41)).toBe(7 + 2);
    expect(tripDays(s, 'augusta', 80)).toBe(20);
    addBuilding(s, 'mansio');
    expect(tripDays(s, 'metellianus', 80)).toBe(5);
    expect(tripDays(s, 'metellianus', 0)).toBe(B.trade.MIN_LEG);
    s.decisions.paths.path2 = 'viaMilitaris';
    expect(tripDays(s, 'augusta', 80)).toBe(Math.round(19 * 0.8));
  });

  it('slots: 1 + Vicus + Oppidum + mansiones (≤ 2) + path bonuses, at most 7', () => {
    const s = fresh();
    expect(caravanSlots(s)).toBe(1);
    s.rank = 1;
    expect(caravanSlots(s)).toBe(2);
    s.rank = 2;
    for (let i = 0; i < 3; i++) addBuilding(s, 'mansio');
    expect(caravanSlots(s)).toBe(5);
    s.decisions.paths = { charter: 'mercatores', path2: 'viaMilitaris' };
    expect(caravanSlots(s)).toBe(7);
    s.modifiers.push({ id: 'x', label: 'x', until: s.day + 9, fx: { add: { caravanSlots: 3 } }, benign: true, source: 'stage' });
    expect(caravanSlots(s)).toBe(B.trade.SLOTS_MAX);
  });

  it('markets open by rank (Castra: none, unless Mercatores — then only the nearest)', () => {
    const s = fresh();
    expect(HUBS.filter((h) => hubOpen(s, h))).toEqual([]);
    expect(createContract(s, { hub: 'metellianus', mode: 'export', res: 'timber', qty: 10, repeat: false })).toMatchObject({ ok: false, code: 'locked' });
    s.rank = 1;
    expect(HUBS.filter((h) => hubOpen(s, h))).toEqual(['metellianus', 'durii', 'silvanum']);
    s.rank = 3;
    expect(HUBS.filter((h) => hubOpen(s, h))).toEqual(HUBS.slice());
  });
});

describe('contracts', () => {
  it('an export leaves at dispatch and pays on return; a one-off contract then closes', () => {
    const s = vicus();
    s.res.timber = 200;
    const r = createContract(s, { hub: 'metellianus', mode: 'export', res: 'timber', qty: 80, repeat: false });
    expect(r.ok).toBe(true);
    const id = r.ok ? r.id! : 0;
    const p = price(s, 'metellianus', 'timber', 'sell')!;
    const outs: TickContext[] = [];
    stepTrade(s, 1, (c) => outs.push(c));
    expect(s.res.timber).toBe(120);
    const car = s.trade.caravans[0];
    expect(car).toMatchObject({ contract: id, kind: 'contract', mode: 'export', qty: 80 });
    expect(car.arrive - car.depart).toBe(2 * 6);
    expect(slotsInUse(s)).toBe(1);
    expect(outs[0].fx.some((e) => e.kind === 'caravanOut')).toBe(true);
    expect(outs[0].rates.cons.timber.trade).toBe(80);
    const den = s.res.denarii;
    const ins: TickContext[] = [];
    stepTrade(s, 12, (c) => ins.push(c));
    expect(s.trade.caravans).toEqual([]);
    expect(s.res.denarii).toBeGreaterThan(den);
    expect(s.res.denarii - den).toBeCloseTo(car.value, 6);
    expect(car.value).toBeGreaterThan(0.9 * p * 80);
    expect(s.trade.contracts).toEqual([]);
    expect(s.counters.caravansReturned).toBe(1);
    expect(s.trade.hubsTraded).toEqual(['metellianus']);
    expect(ins.some((c) => c.fx.some((e) => e.kind === 'caravanIn'))).toBe(true);
  });

  it('a standing import pays at dispatch, brings goods home and goes again', () => {
    const s = vicus();
    s.res.denarii = 5000;
    s.res.stone = 0;
    createContract(s, { hub: 'durii', mode: 'import', res: 'stone', qty: 40, repeat: true });
    stepTrade(s, 1);
    expect(s.res.denarii).toBeLessThan(5000);
    expect(s.trade.contracts[0].status).toBe('travelling');
    stepTrade(s, 2 * tripDays(s, 'durii', 40));
    expect(s.res.stone).toBe(40);
    expect(s.trade.contracts[0].trips).toBe(1);
    expect(s.trade.contracts[0].status).toBe('travelling');   // re-dispatched the same day
  });

  it('pauses with the right typed code, once, and resumes on its own', () => {
    const s = vicus();
    const v = view(s);
    s.res.timber = 10;
    createContract(s, { hub: 'metellianus', mode: 'export', res: 'timber', qty: 80, repeat: true });
    const logs0 = s.log.length;
    stepTrade(s, 5);
    expect(s.trade.contracts[0]).toMatchObject({ status: 'paused', pause: 'stock' });
    expect(s.log.length - logs0).toBe(1);                      // one line, no spam
    s.res.timber = 200;
    stepTrade(s, 1);
    expect(s.trade.contracts[0].status).toBe('travelling');
    expect(s.trade.contracts[0].pause).toBeUndefined();

    const g: ContractSpec = { hub: 'durii', mode: 'export', res: 'grain', qty: 80, repeat: true };
    s.res.grain = 480;                                           // 30-day trade reserve ≈ 610 grain
    const chk = checkDispatch(s, g, v);
    expect(chk).toMatchObject({ ok: false, code: 'reserve' });
    expect(!chk.ok && chk.reason).toContain('30 days of grain');
    s.res.grain = 5000;
    expect(checkDispatch(s, g, view(s)).ok).toBe(true);

    s.res.denarii = 10;
    expect(checkDispatch(s, { hub: 'durii', mode: 'import', res: 'iron', qty: 80, repeat: false }, view(s))).toMatchObject({ ok: false, code: 'denarii' });
    s.res.denarii = 50_000;
    s.res.iron = 90;                                            // cap 100
    expect(checkDispatch(s, { hub: 'durii', mode: 'import', res: 'iron', qty: 80, repeat: false }, view(s))).toMatchObject({ ok: false, code: 'storage' });
    expect(checkDispatch(s, { hub: 'massilia', mode: 'import', res: 'grain', qty: 10, repeat: false }, view(s))).toMatchObject({ ok: false, code: 'refused' });
  });

  it('waits for a mule team when every slot is busy; cancel and resume', () => {
    const s = vicus();
    s.res.timber = 300; s.res.stone = 300;
    createContract(s, { hub: 'metellianus', mode: 'export', res: 'timber', qty: 50, repeat: false });
    createContract(s, { hub: 'metellianus', mode: 'export', res: 'stone', qty: 50, repeat: false });
    const third = createContract(s, { hub: 'durii', mode: 'export', res: 'stone', qty: 50, repeat: false });
    stepTrade(s, 1);
    expect(slotsInUse(s)).toBe(2);
    const id = third.ok ? third.id! : 0;
    expect(s.trade.contracts.find((c) => c.id === id)?.status).toBe('idle');
    expect(cancelContract(s, id).ok).toBe(true);
    expect(cancelContract(s, id)).toMatchObject({ ok: false, code: 'notFound' });
    s.trade.contracts[0].status = 'paused';
    s.trade.contracts[0].pause = 'stock';
    expect(resumeContract(s, s.trade.contracts[0].id).ok).toBe(true);
    expect(s.trade.contracts[0].pause).toBeUndefined();
  });

  it('validates the spec and previews the trip', () => {
    const s = vicus();
    expect(createContract(s, { hub: 'metellianus', mode: 'export', res: 'timber', qty: 0, repeat: false })).toMatchObject({ ok: false, code: 'invalid' });
    expect(createContract(s, { hub: 'metellianus', mode: 'export', res: 'timber', qty: 81, repeat: false })).toMatchObject({ ok: false, code: 'invalid' });
    expect(createContract(s, { hub: 'durii', mode: 'import', res: 'wine', qty: 10, repeat: false })).toMatchObject({ ok: false, code: 'refused' });
    const pv = contractPreview(s, { hub: 'silvanum', mode: 'import', res: 'wine', qty: 20, repeat: false }, view(s));
    expect(pv.price).toBeCloseTo(8 * 1.2);
    expect(pv.value).toBeCloseTo(8 * 1.2 * 20);
    expect(pv.roundTrip).toBe(2 * pv.oneWay);
    const r = createContract(s, { hub: 'silvanum', mode: 'import', res: 'wine', qty: 20, repeat: false }, 'ordo', { code: 'luxuryImport', params: {} });
    expect(r.ok).toBe(true);
    expect(s.trade.contracts.at(-1)).toMatchObject({ owner: 'ordo', reason: { code: 'luxuryImport' } });
    expect(s.log.at(-1)?.tags).toContain('decided');
  });
});

describe('emergency purchases', () => {
  it('buyNow sends to the cheapest open market outside the slots and arrives after its one-way days', () => {
    const s = fresh();
    expect(buyNow(s, 'grain', 100)).toMatchObject({ ok: false, code: 'locked' });
    s.rank = 1;
    const hub = cheapestHub(s, 'grain')!;
    expect(hub).toBe('silvanum');
    s.res.denarii = 50;
    expect(buyNow(s, 'grain', 100)).toMatchObject({ ok: false, code: 'denarii' });
    s.res.denarii = 1000;
    const r = buyNow(s, 'grain', 100);
    expect(r.ok).toBe(true);
    const car = s.trade.caravans[0];
    expect(car).toMatchObject({ kind: 'emergency', hub, qty: 100 });
    expect(car.arrive - s.day).toBe(tripDays(s, hub, 80));
    expect(slotsInUse(s)).toBe(0);
    expect(s.res.denarii).toBeCloseTo(1000 - car.value);
  });

  it('the Lex de annona import is decided in our name', () => {
    const s = vicus();
    s.res.denarii = 2000;
    const c = ctx();
    expect(emergencyImport(s, c, 400)).toBe(true);
    expect(s.ordo.emergency.lastImport).toBe(s.day);
    expect(s.log.at(-1)?.tags).toContain('decided');
    expect(c.fx.some((e) => e.kind === 'caravanOut')).toBe(true);
    s.res.denarii = 0;
    expect(emergencyImport(s, ctx(), 400)).toBe(false);
  });

  it('an import that overflows the stores refunds the overflow pro rata', () => {
    const s = vicus();
    buyNow(s, 'timber', 100);
    const car = s.trade.caravans[0];
    s.res.timber = 250;                                     // cap 300: only 50 fit
    const den = s.res.denarii;
    stepTrade(s, car.arrive - s.day);
    expect(s.res.timber).toBe(300);
    expect(s.res.denarii).toBeCloseTo(den + car.value * 0.5);
  });
});

describe('the visiting merchant', () => {
  it('2–4 offers at 0.85 / 1.15 × the regional price; taking them all sends him on', () => {
    const s = vicus();
    s.res.denarii = 50_000;
    for (const r of TRADE_RES) s.res[r] = 0;
    expect(spawnMerchant(s, new Rng(5))).toBe(true);
    const m = s.trade.merchant!;
    expect(m.offers.length).toBeGreaterThanOrEqual(2);
    expect(m.offers.length).toBeLessThanOrEqual(4);
    expect(m.until - m.arrived).toBe(B.events.MERCHANT_STAY);
    for (const o of m.offers) {
      expect(o.kind).toBe('buy');                          // we have nothing to sell
      expect(o.price).toBeCloseTo(regionalPrice(s, o.res) * B.trade.MERCHANT_BUY);
      expect(TRADE_BASE[o.res]).toBeGreaterThan(0);
    }
    for (const o of m.offers) {
      const r = takeOffer(s, o.id);
      expect(r.ok, o.res).toBe(true);
      expect(s.res[o.res]).toBe(o.qty);
    }
    expect(s.trade.merchant).toBeNull();
    expect(s.trade.lastMerchant).toBe(s.day);
    expect(takeOffer(s, 1)).toMatchObject({ ok: false, code: 'notFound' });
  });

  it('visits only after day 300, in good spirits, at least 60 days apart', () => {
    const s = vicus();
    s.morale = 70;
    s.modifiers.push({ id: 'm', label: 'm', until: 1e7, fx: { mul: { merchants: 40 } }, benign: true, source: 'stage' });
    const arrivals: number[] = [];
    const departures: number[] = [];
    let had = false;
    stepTrade(s, 3000, () => {
      const here = s.trade.merchant !== null;
      if (here && !had) arrivals.push(s.day);
      if (!here && had) departures.push(s.day);
      had = here;
    });
    expect(arrivals.length).toBeGreaterThan(5);
    expect(arrivals[0] - B.time.START_DAY).toBeGreaterThanOrEqual(B.events.START);
    for (let i = 1; i < arrivals.length; i++) expect(arrivals[i] - departures[i - 1]).toBeGreaterThanOrEqual(B.events.MERCHANT_GAP);
    expect(s.eventDays.mercator).toBe(arrivals.at(-1));
    expect(noNaN(s)).toEqual([]);
  });

  it('selling to him respects the stock and the grain reserve', () => {
    const s = vicus();
    s.trade.merchant = { name: 'Greek wine factors', arrived: s.day, until: s.day + 30, offers: [
      { id: 900, kind: 'sell', res: 'grain', qty: 400, price: 3, taken: false },
      { id: 901, kind: 'sell', res: 'iron', qty: 10, price: 12, taken: false },
    ] };
    s.res.grain = 500;
    expect(takeOffer(s, 900)).toMatchObject({ ok: false, code: 'reserve' });
    expect(takeOffer(s, 901)).toMatchObject({ ok: false, code: 'stock' });
    s.res.iron = 10;
    const den = s.res.denarii;
    expect(takeOffer(s, 901).ok).toBe(true);
    expect(s.res.denarii).toBe(den + 120);
    expect(s.trade.merchant).not.toBeNull();
  });
});

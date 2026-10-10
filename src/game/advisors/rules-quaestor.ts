// src/game/advisors/rules-quaestor.ts — the Quaestor's advisories: rules 14–16 (quaestor.coin, quaestor.contract,
// quaestor.merchant) (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import { B } from '../balance';
import { TRADE_RES } from '../types';
import type { AdvisorRule, AdvisoryEval, Building, BuildingId, GameState, Remedy, RuleId, SimView, TradeRes } from '../types';
import { dateOf, dayOf, formatRoman } from '../calendar';
import { settingValue } from '../decisions';
import { missing } from '../state';
import { BUILDING_DEFS } from '../data/buildings';
import { SETTING_DEFS } from '../data/decisions';
import { HUB_DEFS } from '../data/hubs';
import { R, STEP, bestHub, days, exportRemedy, held, inDays, int, listJoin, lowLadder, num, resName, runway, three, todayRate } from './util';

const P = (x: unknown): number => (typeof x === 'number' ? x : 0);
/** Works whose closing saves coin without starving or unhousing anyone (DESIGN §11.6 "costliest optional"). */
const OPTIONAL: readonly BuildingId[] = ['theatrum', 'thermae', 'balneum', 'macellum', 'mansio', 'taberna', 'fabrica', 'officina', 'caementarium', 'figlina', 'fodina', 'apotheca'];

// ───────────────────────────── 14 · quaestor.coin ─────────────────────────────

/** The finished, open optional work with the highest upkeep (lowest id on ties). */
function costliest(s: GameState): Building | null {
  let best: Building | null = null;
  for (const b of s.buildings) {
    const up = BUILDING_DEFS[b.type].upkeep;
    if (b.status === 'done' && b.open && up > 0 && OPTIONAL.includes(b.type) && (!best || up > BUILDING_DEFS[best.type].upkeep)) best = b;
  }
  return best;
}

/** The tradeable good with the largest surplus above what we keep (grain: the trade reserve; others: 30% of the store). */
function surplus(s: GameState, v: SimView): { res: TradeRes; qty: number } | null {
  let best: { res: TradeRes; qty: number; value: number } | null = null;
  for (const r of TRADE_RES) {
    const keep = r === 'grain' ? v.f.grain.need * settingValue(s, 'tradeReserve') : STEP.SURPLUS_KEEP * v.c.caps[r];
    const qty = Math.min(B.ordo.CARGO, Math.floor(s.res[r] - keep));
    const h = qty >= STEP.SURPLUS_MIN ? bestHub(s, r, 'sell', qty) : null;
    if (h && (!best || h.unit * qty > best.value)) best = { res: r, qty, value: h.unit * qty };
  }
  return best;
}

const coin: AdvisorRule = {
  id: 'quaestor.coin', advisor: 'quaestor',
  evaluate(s, v): AdvisoryEval | null {
    const c = v.f.coin;
    let unpaid = 0, upkeep = 0;
    for (const b of s.buildings) {
      if (b.unpaid) unpaid++;
      if (b.status === 'done') upkeep += BUILDING_DEFS[b.type].upkeep;
    }
    const r = runway(c.stock, c.net30);
    const sev = unpaid > 0 ? 3 : r === null ? null : lowLadder(r, R.COIN_RUNOUT, held(s, 'quaestor.coin'));
    if (sev === null) return null;
    const tax = (todayRate('prod', 'denarii', 'taxes') ?? 0) + (todayRate('prod', 'denarii', 'marketTax') ?? 0);
    return {
      rule: 'quaestor.coin', severity: sev,
      metric: r !== null ? { label: 'Aerarium', value: Math.floor(r), unit: 'days' } : { label: 'Aerarium', value: Math.floor(c.stock), unit: 'den' },
      params: {
        R: r === null ? -1 : Math.floor(r), unpaid, stock: c.stock, net: c.net30,
        up: todayRate('cons', 'denarii', 'upkeep') ?? upkeep, tax, sub: todayRate('prod', 'denarii', 'subsidy') ?? 0,
      },
    };
  },
  title(_s, a) {
    const p = a.params;
    if (P(p.unpaid) > 0) return `${P(p.unpaid) === 1 ? 'One work goes' : `${P(p.unpaid)} works go`} unpaid and labour${P(p.unpaid) === 1 ? 's' : ''} at half pace.`;
    return `The aerarium empties ${inDays(P(p.R))}.`;
  },
  text(s, _v, a) {
    const p = a.params;
    const rome = P(p.sub) > 0 ? ` and Rome's stipend of ${num(P(p.sub))}` : '';
    const when = P(p.R) >= 0 ? ` At this rate it is empty on ${formatRoman(s.day + P(p.R))}.` : ` We hold ${int(P(p.stock))} denarii.`;
    return `Upkeep ${num(P(p.up))} a day against taxes ${num(P(p.tax))}${rome}; taxes come in on the Kalends.${when}`;
  },
  remedies(s, v) {
    const sp = surplus(s, v);
    const b = costliest(s);
    return three(
      { kind: 'edict', edict: 'tributum', option: 'grave' },
      sp ? exportRemedy(s, sp.res, sp.qty) : null,
      b ? { kind: 'building', op: 'close', id: b.id } : null,
    );
  },
};

// ───────────────────────────── 15 · quaestor.contract ─────────────────────────────

/** The next Kalends after a day (taxes arrive then). */
function nextKalends(day: number): number {
  const d = dateOf(day);
  return d.month === 12 ? dayOf(d.year + 1, 1, 1) : dayOf(d.year, d.month + 1, 1);
}

const contract: AdvisorRule = {
  id: 'quaestor.contract', advisor: 'quaestor',
  evaluate(s): AdvisoryEval | null {
    const c = s.trade.contracts.find((x) => x.status === 'paused');
    if (!c) return null;
    return {
      rule: 'quaestor.contract', severity: 1,
      params: { id: c.id, code: c.pause ?? 'reserve', res: c.res, hub: c.hub, mode: c.mode, qty: c.qty, X: settingValue(s, 'tradeReserve') },
    };
  },
  title(_s, a) {
    const p = a.params;
    const res = resName(p.res as TradeRes);
    const hub = HUB_DEFS[p.hub as keyof typeof HUB_DEFS]?.name ?? 'the market';
    const way = `Our ${res} caravan ${p.mode === 'export' ? 'to' : 'from'} ${hub}`;
    switch (p.code) {
      case 'reserve': return `${way} stands idle: we keep ${int(P(p.X))} days in reserve.`;
      case 'stock': return `${way} waits: we hold too little to load ${int(P(p.qty))}.`;
      case 'denarii': return `${way} waits: the aerarium cannot pay for ${int(P(p.qty))}.`;
      case 'storage': return `${way} waits: no room in the stores for ${int(P(p.qty))}.`;
      default: return `${hub} no longer trades ${res} with us.`;
    }
  },
  text(s, _v, a) {
    const p = a.params;
    const res = resName(p.res as TradeRes);
    switch (p.code) {
      case 'reserve': return `Exports stop where fewer than ${int(P(p.X))} days of ${res} would remain. Lower the reserve, or let the stock grow.`;
      case 'stock': return `It sets out on its own as soon as the stores hold ${int(P(p.qty))} ${res}.`;
      case 'denarii': return `It sets out when the aerarium can pay; taxes come in on ${formatRoman(nextKalends(s.day))}.`;
      case 'storage': return `It sets out once there is room: use some ${res}, or raise a store.`;
      default: return 'Send the caravan to another market.';
    }
  },
  remedies(_s, _v, a) {
    const p = a.params;
    const min = SETTING_DEFS.tradeReserve.min;
    const lower: Remedy | null = p.code === 'reserve' && P(p.X) > min ? { kind: 'setting', setting: 'tradeReserve', value: Math.max(min, P(p.X) - STEP.TRADE_RESERVE) } : null;
    const store: Remedy | null = p.code === 'storage' ? { kind: 'place', building: p.res === 'grain' ? 'horreum' : 'apotheca' } : null;
    return three(lower, store, { kind: 'open', tab: 'trade', anchor: `contract-${P(p.id)}` });
  },
};

// ───────────────────────────── 16 · quaestor.merchant ─────────────────────────────

/** Goods named by an active advisory at Cave or above (what a merchant's offer could answer). */
function wanted(s: GameState): TradeRes[] {
  const at = (r: RuleId): boolean => { const m = s.guidance.advisories[r]; return m?.active === true && m.sev >= 2; };
  const out: TradeRes[] = [];
  if (at('annonae.grain.runout') || at('annonae.famine') || at('annonae.hiems.forecast') || at('annonae.mess')) out.push('grain');
  const goods = s.guidance.advisories['annonae.goods'];
  if (at('annonae.goods') && (goods?.params.res === 'oil' || goods?.params.res === 'wine')) out.push(goods.params.res);
  const st = s.guidance.advisories['fabrum.stalled'];
  if (at('fabrum.stalled') && st && typeof st.params.type === 'string' && BUILDING_DEFS[st.params.type as BuildingId]) {
    const m = missing(s, BUILDING_DEFS[st.params.type as BuildingId].cost);
    for (const r of TRADE_RES) if ((m[r] ?? 0) > 0) out.push(r);
  }
  return out;
}

const merchant: AdvisorRule = {
  id: 'quaestor.merchant', advisor: 'quaestor',
  evaluate(s): AdvisoryEval | null {
    const m = s.trade.merchant;
    if (!m || m.until <= s.day) return null;
    const want = wanted(s);
    const open = m.offers.filter((o) => !o.taken);
    const answer = open.find((o) => o.kind === 'buy' && want.includes(o.res));
    const sells = TRADE_RES.filter((r) => open.some((o) => o.kind === 'buy' && o.res === r));
    const buys = TRADE_RES.filter((r) => open.some((o) => o.kind === 'sell' && o.res === r));
    return {
      rule: 'quaestor.merchant', severity: answer ? 1 : 0, metric: { label: 'Leaves', value: m.until - s.day, unit: 'days' },
      params: { name: m.name, d: m.until - s.day, answer: answer?.res ?? '', sells: sells.join(','), buys: buys.join(',') },
    };
  },
  title(_s, a) {
    const name = String(a.params.name);
    return `${name} ${/s$/.test(name) ? 'camp' : 'camps'} at the forum for ${days(P(a.params.d))} more.`;
  },
  text(_s, _v, a) {
    const p = a.params;
    const list = (x: unknown): string => listJoin(String(x).split(',').filter(Boolean).map((r) => resName(r as TradeRes)));
    const parts = [p.sells ? `They sell ${list(p.sells)}` : '', p.buys ? `they buy ${list(p.buys)}` : ''].filter(Boolean);
    const offer = parts.length > 0 ? `${parts.join('; ')}.` : 'They have sold all they brought.';
    return p.answer ? `${offer} They carry the ${resName(p.answer as TradeRes)} we lack.` : offer;
  },
  remedies: () => three({ kind: 'open', tab: 'trade', anchor: 'merchant' }),
};

/** The Quaestor's rules, in RULES order. */
export const QUAESTOR_RULES: AdvisorRule[] = [coin, contract, merchant];

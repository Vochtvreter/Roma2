// src/game/advisors/rules-annonae.ts — the Praefectus Annonae's advisories: rules 1–6 (annonae.grain.runout …
// annonae.goods) (DESIGN §11.6). Owner: WP-E.
// Load order: only engine.ts imports this file (it spreads the array at module evaluation); nothing here runs at
// import time, and tests must import engine.ts (or sim.ts) before any rule file.
import { B } from '../balance';
import type { AdvisorRule, GameState, Person, Remedy, Severity, SimView } from '../types';
import { formatRoman, seasonOf } from '../calendar';
import { stageOf } from '../census';
import { edictOption, settingValue } from '../decisions';
import { buildingRate, seasonMult } from '../economy';
import { fx } from '../fx';
import { getBuilding } from '../state';
import { BUILDING_DEFS } from '../data/buildings';
import { SETTING_DEFS } from '../data/decisions';
import {
  CLEAR, R, bestFood, days, exportRemedy, fractionWord, held, idleBySkill, importRemedy, inDays, int, labourRemedy, listJoin, lowLadder,
  namesOf, num, openPosts, runway, three, todayRate,
} from './util';

const HIEMS = 3;
const EPS = 1e-6;
const RESERVE_STEP = 3;   // the Grain reserve remedy raises the setting by 3 steps (15 days)
const P = (x: unknown): number => (typeof x === 'number' ? x : 0);

/** "Grain runs out in 18 days." */
function runsOut(what: string, r: number): string {
  return r < 1 ? `${what} runs out today.` : `${what} runs out in ${days(r)}.`;
}

// ───────────────────────────── 1 · annonae.grain.runout ─────────────────────────────

const grainRunout: AdvisorRule = {
  id: 'annonae.grain.runout', advisor: 'annonae', supersedes: ['annonae.mess'],
  evaluate(s, v) {
    const g = v.f.grain;
    const r = runway(g.stock, g.net3);
    const sev = r === null ? null : lowLadder(r, R.GRAIN_RUNOUT, held(s, 'annonae.grain.runout'));
    if (r === null || sev === null) return null;
    return {
      rule: 'annonae.grain.runout', severity: sev, metric: { label: 'Grain', value: Math.floor(r), unit: 'days' },
      params: { R: Math.floor(r), prod: g.prod, cons: g.cons, need: g.need, pot: g.maxPotential, fix: g.structural ? 0 : 1 },
    };
  },
  title: (_s, a) => runsOut('Grain', P(a.params.R)),
  text(s, v, a) {
    const p = a.params;
    const when = `The last modius goes on ${formatRoman(s.day + P(p.R))}.`;
    if (p.fix !== 1) return `Even with every hand in the fields we would gather ${num(P(p.pot))} of the ${num(P(p.need))} we eat each day: we must build or buy. ${when}`;
    const idle = idleBySkill(s, v, 'agri');
    const open = openPosts(v, 'food');
    const who = idle.length > 0 ? `${namesOf(idle)} ${idle.length === 1 ? 'stands' : 'stand'} idle; ` : 'No hand stands idle; ';
    const where = open > 0 ? `${open} ${open === 1 ? 'place waits' : 'places wait'} in the fields.` : 'every post in the fields is taken.';
    return `We eat ${num(P(p.cons))} a day and gather ${num(P(p.prod))}. ${who}${where} ${when}`;
  },
  remedies(s, v, a) {
    const p = a.params;
    const work = labourRemedy(s, v, 'food', 'grain', P(p.cons) - P(p.prod));
    const build: Remedy = { kind: 'place', building: bestFood(s) };
    const ration: Remedy | null = edictOption(s, 'rationes') === 'parcae' ? null : { kind: 'edict', edict: 'rationes', option: 'parcae' };
    return three(p.fix === 1 ? work : build, ration, importRemedy(s, 'grain', B.ordo.CARGO), p.fix === 1 ? build : work);
  },
};

// ───────────────────────────── 2 · annonae.famine ─────────────────────────────

const famine: AdvisorRule = {
  id: 'annonae.famine', advisor: 'annonae', supersedes: ['annonae.grain.runout', 'annonae.mess'],
  evaluate(s, v) {
    const g = v.f.grain;
    const r = runway(g.stock, g.net3);
    const limit = R.FAMINE_R * (held(s, 'annonae.famine') ? CLEAR : 1);
    if (!(g.maxPotential < g.need) || r === null || r >= limit) return null;
    return {
      rule: 'annonae.famine', severity: 3, metric: { label: 'Grain', value: Math.floor(r), unit: 'days' },
      params: { R: Math.floor(r), pct: Math.floor((100 * g.maxPotential) / Math.max(EPS, g.need)), pot: g.maxPotential, need: g.need },
    };
  },
  title: (_s, a) => `Famine looms: even every hand in the fields feeds only ${P(a.params.pct)}% of us.`,
  text(s, _v, a) {
    const p = a.params;
    return `At best our fields and lodges give ${num(P(p.pot))} a day; we eat ${num(P(p.need))}. Grain runs out ${inDays(P(p.R))}, `
      + `on ${formatRoman(s.day + P(p.R))}. New fields, grain from abroad, or the Legate's relief.`;
  },
  remedies(s, _v, a) {
    const qty = Math.ceil(P(a.params.need) * R.BUY_DAYS);
    return three({ kind: 'place', building: bestFood(s) }, { kind: 'buyNow', res: 'grain', qty }, { kind: 'relief' });
  },
};

// ───────────────────────────── 3 · annonae.hiems.forecast ─────────────────────────────

const hiems: AdvisorRule = {
  id: 'annonae.hiems.forecast', advisor: 'annonae',
  evaluate(s, v) {
    const g = v.f.grain;
    const c = g.crunch;
    if (!c || c.season !== HIEMS || (seasonOf(s.day) !== HIEMS && c.startsIn > R.HIEMS_LEAD)) return null;
    const low = c.lowestDoh;
    let sev: Severity | null = null;
    if (low <= 0) sev = c.startsIn < R.HIEMS_SOON ? 3 : 2;
    else if (low < R.HIEMS_M * (held(s, 'annonae.hiems.forecast') ? CLEAR : 1)) sev = 1;
    if (sev === null) return null;
    const empty = low <= 0 ? c.emptyDay ?? c.lowestDay : -1;
    return {
      rule: 'annonae.hiems.forecast', severity: sev, metric: { label: 'Hiems low', value: Math.max(0, Math.floor(low)), unit: 'days' },
      params: { D: c.startsIn, low: Math.max(0, Math.floor(low)), empty, start: s.day + c.startsIn, need: c.needInStore, stock: g.stock, cap: g.cap, daily: g.need },
    };
  },
  title(_s, a) {
    const p = a.params;
    const head = P(p.D) > 0 ? `Hiems in ${days(P(p.D))}` : 'Hiems is upon us';
    return P(p.empty) >= 0 ? `${head}: grain would run out on ${formatRoman(P(p.empty))}.` : `${head}: our lowest would be ${days(P(p.low))} of grain.`;
  },
  text(s, _v, a) {
    const p = a.params;
    const short = P(p.cap) < P(p.need) ? ' Even full, our stores are too small.' : '';
    return `In Hiems our fields give ${fractionWord(seasonMult(s, 'ager', HIEMS))}. We need about ${int(P(p.need))} in store by `
      + `${formatRoman(P(p.start))}; we hold ${int(P(p.stock))}, with room for ${int(P(p.cap))}.${short}`;
  },
  remedies(s, _v, a) {
    const p = a.params;
    const def = SETTING_DEFS.grainReserve;
    const x = Math.min(def.max, settingValue(s, 'grainReserve') + RESERVE_STEP * def.step);
    const reserve: Remedy | null = s.ordo.on.build && x > settingValue(s, 'grainReserve') ? { kind: 'setting', setting: 'grainReserve', value: x } : null;
    return three(P(p.cap) < P(p.need) ? { kind: 'place', building: 'horreum' } : null, reserve,
      { kind: 'place', building: 'venatio' }, importRemedy(s, 'grain', B.ordo.CARGO));
  },
};

// ───────────────────────────── 4 · annonae.mess ─────────────────────────────

/** Ration ratio per tier (children, youths + adults, elders) from today's eating, children served first (DESIGN §8.4). */
function ratios(eaten: number, need: readonly number[]): [number, number, number] {
  let left = eaten;
  const take = (n: number): number => {
    if (n <= 0) return 1;
    const got = Math.min(left, n);
    left -= got;
    return got / n;
  };
  return [take(need[0]), take(need[1] + need[2]), take(need[3])];
}

const GROUP_WORD = ['the children', 'the youths and adults', 'the elders'] as const;

/** People of the short tiers to watch: the youngest children, the eldest elders, then adults by id. */
function watchList(s: GameState, short: readonly boolean[]): Person[] {
  const tier = (p: Person): number => { const st = stageOf(p, s.day); return st === 0 ? 0 : st === 3 ? 2 : 1; };
  return s.people.filter((p) => short[tier(p)])
    .sort((a, b) => tier(a) - tier(b) || (tier(a) === 0 ? b.born - a.born : tier(a) === 2 ? a.born - b.born : a.id - b.id))
    .slice(0, 3);
}

const mess: AdvisorRule = {
  id: 'annonae.mess', advisor: 'annonae',
  evaluate(_s, v) {
    const eaten = todayRate('cons', 'grain', 'eating');
    const gn = v.c.groupNeed.grain;
    const need = gn[0] + gn[1] + gn[2] + gn[3];
    if (eaten === null || need <= 0 || eaten >= need - EPS) return null;
    const short = ratios(eaten, gn).map((x) => x < 1 - EPS);
    if (!short.some(Boolean)) return null;
    const pct = Math.floor((100 * eaten) / need);
    return {
      rule: 'annonae.mess', severity: short[0] ? 3 : 2, metric: { label: 'Fed', value: pct, unit: 'pct' },
      params: { kids: short[0] ? 1 : 0, adults: short[1] ? 1 : 0, elders: short[2] ? 1 : 0, pct, need: v.c.need.grain },
    };
  },
  title(_s, a) {
    const sh = [a.params.kids === 1, a.params.adults === 1, a.params.elders === 1];
    return `Yesterday's mess: ${listJoin(GROUP_WORD.filter((_, i) => sh[i]))} went short.`;
  },
  text(s, _v, a) {
    const names = namesOf(watchList(s, [a.params.kids === 1, a.params.adults === 1, a.params.elders === 1]), 3);
    return `We ate ${P(a.params.pct)}% of what we need; the children are served first.${names ? ` Watch: ${names}.` : ''}`;
  },
  remedies: (_s, _v, a) => three(
    { kind: 'buyNow', res: 'grain', qty: Math.ceil(P(a.params.need) * R.BUY_DAYS) },
    { kind: 'open', tab: 'people', anchor: 'watch' },
  ),
};

// ───────────────────────────── 5 · annonae.storage ─────────────────────────────

const storage: AdvisorRule = {
  id: 'annonae.storage', advisor: 'annonae',
  evaluate(s, v) {
    const g = v.f.grain;
    const rot = todayRate('cons', 'grain', 'rot') ?? 0;
    const spill = todayRate('cons', 'grain', 'spill') ?? 0;
    const fill = g.cap > 0 ? g.stock / g.cap : 0;
    const full = fill >= R.STORAGE_FULL && g.net3 > 0;
    const rotting = rot >= R.ROT_M;
    if (held(s, 'annonae.storage') ? fill < R.STORAGE_CLEAR && rot < R.ROT_CLEAR : !full && !rotting) return null;
    const waste = spill + rot;
    return {
      rule: 'annonae.storage', severity: waste > R.SPILL_C ? 2 : 1, metric: { label: 'Stores', value: Math.round(100 * fill), unit: 'pct' },
      params: { waste, pct: Math.round(100 * fill), surplus: g.stock - g.need * settingValue(s, 'tradeReserve'), holdDays: rotting ? 0 : R.STORAGE_DAYS },
    };
  },
  title: (_s, a) => (P(a.params.waste) >= 0.05
    ? `The sheds overflow: ${num(P(a.params.waste))} grain a day spills or rots.`
    : `The sheds are full: ${P(a.params.pct)}% of our room is taken.`),
  text(s) {
    const safe = (BUILDING_DEFS.horreum.storage?.grain ?? 0) * fx(s, 'horreaCap');
    return `Grain in the open sheds rots ${num(B.economy.SHED_ROT * 100)}% a day, twice that in Aestas; a Horreum keeps `
      + `${int(safe)} safe. Or sell the surplus while it is ours to sell.`;
  },
  remedies: (s, _v, a) => three({ kind: 'place', building: 'horreum' }, exportRemedy(s, 'grain', Math.min(B.ordo.CARGO, P(a.params.surplus)))),
};

// ───────────────────────────── 6 · annonae.goods ─────────────────────────────

interface Goods { res: 'oil' | 'wine'; R: number | null; supply: number; houses: number; demand: number; prod: number; lapsed: boolean }

/** Oil and wine for the T4 houses: daily demand, local production, mean supply, and whether a house declines for want of it. */
function goods(s: GameState, v: SimView): Goods[] {
  if (v.c.byTier.insula + v.c.byTier.domus === 0) return [];
  const per: Record<number, number> = {};
  for (const p of s.people) if (p.home !== null) per[p.home] = (per[p.home] ?? 0) + 1;
  const season = seasonOf(s.day);
  let oilProd = 0;
  for (const b of s.buildings) if (b.type === 'olivetum') oilProd += buildingRate(s, b, season, 'current').oil ?? 0;
  const out: Goods[] = [];
  for (const res of ['oil', 'wine'] as const) {
    let residents = 0, houses = 0, supply = 0, lapsed = false;
    for (const id of v.d.houses) {
      const h = getBuilding(s, id)?.house;
      if (!h || (h.tier !== 'domus' && (res === 'wine' || h.tier !== 'insula'))) continue;
      houses++;
      residents += per[id] ?? 0;
      supply += h[res];
      if (h.declining && h[res] < B.housing.SUPPLIED) lapsed = true;
    }
    if (houses === 0) continue;
    const demand = residents * B.housing.GOODS[res];
    const prod = res === 'oil' ? oilProd : 0;
    out.push({ res, R: runway(s.res[res], prod - demand), supply: supply / houses, houses, demand, prod, lapsed });
  }
  return out;
}

const goodsRule: AdvisorRule = {
  id: 'annonae.goods', advisor: 'annonae',
  evaluate(s, v) {
    const hold = held(s, 'annonae.goods');
    const bad = goods(s, v).filter((g) => (g.R !== null && g.R < R.GOODS_DAYS * (hold ? CLEAR : 1)) || g.supply < R.GOODS_SUPPLY);
    if (bad.length === 0) return null;
    const g = bad.sort((a, b) => (a.R ?? Infinity) - (b.R ?? Infinity) || a.supply - b.supply)[0];
    return {
      rule: 'annonae.goods', severity: bad.some((x) => x.lapsed) ? 2 : 1,
      metric: g.R !== null ? { label: g.res === 'oil' ? 'Oil' : 'Wine', value: Math.floor(g.R), unit: 'days' } : { label: 'Supplied', value: Math.round(100 * g.supply), unit: 'pct' },
      params: { res: g.res, R: g.R === null ? -1 : Math.floor(g.R), pct: Math.round(100 * g.supply), houses: g.houses, demand: g.demand, prod: g.prod },
    };
  },
  title(_s, a) {
    const p = a.params;
    const what = p.res === 'oil' ? 'Oil for the insulae' : 'Wine for the atrium houses';
    return P(p.R) >= 0 ? `${what} runs out ${inDays(P(p.R))}.` : `Only ${P(p.pct)}% of the better houses get their ${p.res}.`;
  },
  text(_s, _v, a) {
    const p = a.params;
    const src = p.res === 'oil' ? `our groves press ${num(P(p.prod))}` : 'wine comes only by caravan';
    return `${P(p.houses)} ${P(p.houses) === 1 ? 'house uses' : 'houses use'} ${num(P(p.demand))} amphorae a day; ${src}. A house without its ${p.res} falls back a tier.`;
  },
  remedies(s, _v, a) {
    const res = a.params.res === 'wine' ? 'wine' : 'oil';
    return three(res === 'oil' ? { kind: 'place', building: 'olivetum' } : null, importRemedy(s, res, B.ordo.CARGO), { kind: 'overlay', overlay: 'domus' });
  },
};

/** The Praefectus Annonae's rules, in RULES order. */
export const ANNONAE_RULES: AdvisorRule[] = [grainRunout, famine, hiems, mess, storage, goodsRule];

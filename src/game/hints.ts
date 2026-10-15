// src/game/hints.ts — "how to get more", benefit lines, the inspector's output chain and why a works stands idle for
// water (ARCHITECTURE §8.6, DESIGN §5.2, §8.1, §11.10). Owner: WP-E. Every line is generated from BUILDING_DEFS,
// HUB_DEFS and the live state.
import { B } from './balance';
import { HUBS, RESOURCES, TRADE_RES } from './types';
import type { Building, BuildingId, Cost, GameState, Remedy, ResId, SimView, TradeRes } from './types';
import { SEASON_NAMES, seasonOf } from './calendar';
import { stageOf } from './census';
import { buildingRate, seasonMult, waterHold } from './economy';
import { fx } from './fx';
import { siteMult } from './site';
import { HUB_DEFS } from './data/hubs';
import { BUILDING_DEFS, BUILD_ORDER, slotsOf } from './data/buildings';
import { RANK_DEFS } from './data/ranks';
import { TIER_DEFS } from './data/housing';
import { RESOURCE_DEFS } from './data/resources';
import { SETTING_DEFS } from './data/decisions';
import { aName, bestHub, fractionWord, int, labourRemedy, listJoin, num, openPosts, rankWord, three } from './advisors/util';

const STORE: Partial<Record<ResId, BuildingId>> = {
  grain: 'horreum', water: 'cisterna', timber: 'apotheca', stone: 'apotheca', tiles: 'apotheca', concrete: 'apotheca',
  ore: 'apotheca', iron: 'apotheca', tools: 'apotheca', oil: 'apotheca', wine: 'apotheca',
};
const PLURAL: Partial<Record<BuildingId, string>> = {
  ager: 'fields', olivetum: 'olive groves', caementarium: 'concrete works', thermae: 'great baths', castellum: 'aqueducts',
  horreum: 'granaries', apotheca: 'warehouses', taberna: 'shop rows', fodina: 'iron mines',
};

/** A cost in short words: "50 den, 20 timber". */
function costWords(c: Cost): string {
  const parts: string[] = [];
  for (const r of RESOURCES) if ((c[r] ?? 0) > 0) parts.push(`${int(c[r] ?? 0)} ${r === 'denarii' ? 'den' : RESOURCE_DEFS[r].name.toLowerCase()}`);
  return parts.join(', ');
}

/** 2nd, 3rd, 4th … */
function ordinal(n: number): string {
  const t = n % 100;
  const suf = t >= 11 && t <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suf}`;
}

/** An ordinal with its article as it is spoken: "a 2nd", "an 8th", "an 11th", "an 18th", "an 80th", "a 100th". The
 *  article follows the first spoken word, which the leading group of digits names (eight…, eleven, eighteen). */
export function anOrdinal(n: number): string {
  const digits = String(Math.floor(Math.abs(n)));
  const lead = Number(digits.slice(0, digits.length % 3 || 3));
  const vowel = lead === 11 || lead === 18 || /^8/.test(String(lead));
  return `${vowel ? 'an' : 'a'} ${ordinal(n)}`;
}

/** "+40%" / "−15%" for a factor. */
function pct(x: number): string {
  return `${x >= 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}%`;
}

/** ", best in Hiems (×1.3)" for a building with seasons. */
function bestSeason(type: BuildingId): string {
  const q = BUILDING_DEFS[type].seasons;
  if (!q) return '';
  let k = 0;
  for (let i = 1; i < 4; i++) if (q[i] > q[k]) k = i;
  return q[k] !== 1 ? `, best in ${SEASON_NAMES[k]} (×${num(q[k])})` : '';
}

/** Ways to get more of a resource: producers from the registry, markets that sell it, idle forage or a road felling the
 *  woods, and a live line. */
export function howToGetMore(s: GameState, res: ResId, v: SimView): string[] {
  const out: string[] = [];
  let main: BuildingId | null = null;
  for (const t of BUILD_ORDER) {
    const d = BUILDING_DEFS[t];
    const lock = d.rank > s.rank ? ` Rome grants it to ${rankWord(d.rank)}.` : '';
    if (d.output?.res === res) {
      const uses = d.inputs ? `, from ${listJoin(RESOURCES.filter((r) => d.inputs?.[r]).map((r) => `${num(d.inputs?.[r] ?? 0)} ${RESOURCE_DEFS[r].name.toLowerCase()}`))} a hand` : '';
      out.push(`${d.name}: ${num(d.output.perWorker)} a day for each of ${slotsOf(t, s.rank)} hands${uses}${bestSeason(t)}.${lock}`);
      if (!main && !lock) main = t;
    } else if (d.passive?.res === res) {
      out.push(`${d.name}: ${int(d.passive.perDay)} a day with no hands${bestSeason(t)}.${lock}`);
    }
  }
  if (res === 'grain') out.push(`Idle hands forage ${num(B.economy.IDLE_FORAGE)} a day each.`);
  // full stores, at the Ordo's own threshold (ordo.STORE_FULL): what comes in past the cap spills at the day's end
  const store = STORE[res];
  const full = !!store && s.res[res] >= B.ordo.STORE_FULL * v.c.caps[res];
  // a road is free and fells the woods it crosses into the stores (place.ts buildRoad, DESIGN §3.7): taught only while
  // they have room, never beside "the stores are full" for a felling that would all spill
  if (res === 'timber' && !full) out.push(`Lay a road through the woods (free): the felled trees go to the stores, up to ${B.map.WOOD_DENSE} timber a pace.`);
  if (res === 'denarii') out.push(...coinLines(s));
  if ((TRADE_RES as readonly string[]).includes(res)) {
    const tr = res as TradeRes;
    const h = bestHub(s, tr, 'buy', B.ordo.CARGO);
    if (h) out.push(`Buy it from ${HUB_DEFS[h.hub].name} at ${num(h.unit)} den each, ${h.days} days away.`);
    else {
      const later = HUBS.filter((x) => HUB_DEFS[x].quirks[tr]?.buy !== 'refused');
      if (later.length > 0) out.push(`${HUB_DEFS[later[0]].name} would sell it once our caravans reach it (${RANK_DEFS[Math.max(1, HUB_DEFS[later[0]].rank)].name}).`);
      else if (out.length === 0) out.push('No market sells it to us.');
    }
  }
  if (main) out.push(liveLine(s, v, main));
  if (store && full) {
    const lock = BUILDING_DEFS[store].rank > s.rank ? ` Rome grants it to ${rankWord(BUILDING_DEFS[store].rank)}.` : '';
    out.push(`The stores are full (${int(s.res[res])} of ${int(v.c.caps[res])}): ${aName(store)} adds room.${lock}`);
  }
  return out;
}

/** Where coin comes from: taxes by tier, market tax, Rome's stipend, sales — and this month's accrued taxes. */
function coinLines(s: GameState): string[] {
  const t = TIER_DEFS;
  const sub = RANK_DEFS[s.rank].subsidy;
  return [
    `Households pay taxes on the Kalends, more as their houses rise: ${t.casa.tax} a soul a day in a hut, ${t.domus.tax} in an atrium house.`,
    `Shop rows and market halls add ${B.economy.MARKET_TAX.taberna} and ${B.economy.MARKET_TAX.macellum} a covered soul a day.`,
    sub > 0 ? `Rome pays a stipend of ${num(sub)} a day while we are ${rankWord(s.rank)}.` : 'Rome pays no stipend any more.',
    'Caravans and merchants pay for our surplus.',
  ];
}

/** "You have 2 fields (11 of 12 hands). Next: staff 1 more, or raise a 3rd (50 den, 20 timber)." */
function liveLine(s: GameState, v: SimView, type: BuildingId): string {
  const d = BUILDING_DEFS[type];
  let n = 0, hands = 0, slots = 0;
  for (const b of s.buildings) {
    if (b.type !== type || b.status !== 'done') continue;
    n++;
    hands += v.c.staffed[b.id] ?? 0;
    slots += v.c.slots[b.id] ?? 0;
  }
  const many = PLURAL[type] ?? `${d.name.toLowerCase()}s`;
  if (n === 0) return `You have none yet: raise ${aName(type)} (${costWords(d.cost)}).`;
  const open = slots - hands;
  const staff = open > 0 ? `staff ${open} more, or ` : '';
  return `You have ${n === 1 ? aName(type) : `${n} ${many}`} (${hands} of ${slots} hands). Next: ${staff}raise ${anOrdinal(n + 1)} (${costWords(d.cost)}).`;
}

/** The building card's one-line benefit. */
export function benefitLine(type: BuildingId): string {
  return BUILDING_DEFS[type].benefit;
}

/** The inspector's output chain (DESIGN §8.1): hands × per hand × each factor that is not 1 = the day's total. */
export function outputChain(s: GameState, b: Building): { label: string; value: string }[] {
  const def = BUILDING_DEFS[b.type];
  const res = def.output?.res ?? def.passive?.res;
  if (b.status !== 'done' || !res) return [];
  const season = seasonOf(s.day);
  const sm = seasonMult(s, b.type, season);
  const out: { label: string; value: string }[] = [];
  const add = (label: string, x: number): void => { if (Math.abs(x - 1) >= 0.005) out.push({ label, value: pct(x) }); };
  if (def.output) {
    const workers = s.people.filter((p) => p.work === b.id);
    out.push({ label: 'Hands', value: `${workers.length} of ${slotsOf(b.type, s.rank)}` }, { label: 'Per hand', value: num(def.output.perWorker) });
    if (Math.abs(sm - 1) >= 0.005) out.push({ label: SEASON_NAMES[season], value: `×${num(sm)}` });
    const site = siteMult(s, b);
    const skill = def.skill && workers.length > 0
      ? workers.reduce((a, p) => a + 1 + B.people.SKILL_BONUS * (p.skills[def.skill as keyof typeof p.skills] ?? 0), 0) / workers.length : 1;
    const tools = b.toolUntil !== undefined && b.toolUntil > s.day ? B.economy.TOOL_MULT : 1;
    const spirits = B.economy.PROD_BASE + (B.economy.PROD_MORALE * s.morale) / 100;
    const effects = def.fxKey ? fx(s, def.fxKey) : 1;
    const legacy = 1 + B.economy.LEGACY * s.legacy + s.legacyBonus;
    add('Site', site); add('Skill', skill); add('Tools', tools); add('Spirits', spirits); add('Effects', effects); add('Legacy', legacy);
    if (site * skill * tools * spirits * effects * legacy > B.economy.MULT_CAP) out.push({ label: 'Cap', value: `×${num(B.economy.MULT_CAP)} at most` });
    const elders = workers.filter((p) => stageOf(p, s.day) === 3).length;
    if (elders > 0) out.push({ label: 'Elders', value: `${elders} at ×${num(B.people.ELDER_OUT)}` });
    if (def.inputs) out.push({ label: 'Uses', value: listJoin(RESOURCES.filter((r) => def.inputs?.[r]).map((r) => `${num(def.inputs?.[r] ?? 0)} ${RESOURCE_DEFS[r].name.toLowerCase()} a hand`)) });
  } else if (def.passive) {
    out.push({ label: 'No hands', value: `${int(def.passive.perDay)} a day` });
    if (Math.abs(sm - 1) >= 0.005) out.push({ label: SEASON_NAMES[season], value: `×${num(sm)}` });
  }
  if (b.unpaid) out.push({ label: 'Unpaid', value: `×${num(B.economy.UNPAID)}` });
  // a works held from its water makes nothing, whatever its hands (its idle line says why: waterIdle)
  const total = waterHold(s, b) ? 0 : buildingRate(s, b, season, 'current')[res] ?? 0;
  out.push({ label: 'Total', value: `${num(total)} ${RESOURCE_DEFS[res].unit} a day` });
  return out;
}

/** Why a staffed works stands idle for want of water, and what lets it work again (DESIGN §5.2, §15.4): the inspector's
 *  idle line, which the Praefectus Fabrum repeats for a site that waits on its goods (§11.6); null while it draws. `why`
 *  follows "Idle: ". The fixes: under Populo prius the Aequa edict, a reserve a day under the stock (only where the
 *  setting goes that low: one at or above the stock would release nothing), more water (the wells first, else a new
 *  well); under the Lex de annona's pause more water (a full store always lifts it: economy.waterResume). */
export function waterIdle(s: GameState, v: SimView, b: Building): { why: string; remedies: Remedy[] } | null {
  const w = waterHold(s, b);
  if (!w) return null;
  const up = (x: number): number => Math.ceil(x - 1e-6), down = (x: number): number => Math.floor(x + 1e-6);
  const draw = (BUILDING_DEFS[b.type].inputs?.water ?? 0) * (v.c.staffed[b.id] ?? 0);
  const water: Remedy = openPosts(v, 'water') > 0 ? labourRemedy(s, v, 'water', 'water', draw) : { kind: 'place', building: 'puteus' };
  // a floor set by the stores' room (three-quarters of a full store) is shown as that share of the full store's days as
  // shown, so the two numbers agree ("above 14, three-quarters of the 19", never "above 15" by a 19.9 floored to 19); it
  // is never under the days the stores are shown to hold while the works wait (both floored)
  const full = down(w.full), roomKeep = Math.round(B.economy.RESERVE_ROOM * full);
  const room = `${fractionWord(B.economy.RESERVE_ROOM)} of the ${full} a full store holds`;
  if (w.why === 'pause') {
    const small = w.keep < B.emergency.WATER_RESUME - 1e-6;      // stores that hold under 20 days lift it three-quarters full
    return {
      why: `the Lex de annona paused the works that draw water when it ran low. They resume above ${small ? roomKeep : up(w.keep)} days in store`
        + `${small ? `, ${room}` : ''}; we hold ${down(w.have)}.`,
      remedies: [water],
    };
  }
  const people = 'Under Populo prius the people drink first.';
  const why = w.keep >= w.reserve - 1e-6
    ? `the water reserve (${w.reserve} days) is not met; the stores hold ${down(w.have)}. ${people}`
    : `the water reserve is not met; the stores hold ${down(w.have)} days, and the works draw only above ${roomKeep}, ${room}. ${people}`;
  const lower = Math.max(SETTING_DEFS.waterReserve.min, down(w.have) - 1);
  const frees = lower < w.reserve && lower < w.have - 1e-6;       // the new floor falls under the stock: the works draw
  return {
    why,
    remedies: three({ kind: 'edict', edict: 'aquae', option: 'aequa' }, frees ? { kind: 'setting', setting: 'waterReserve', value: lower } : null, water),
  };
}

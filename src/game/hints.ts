// src/game/hints.ts — "how to get more", benefit lines and the inspector's output chain (ARCHITECTURE §8.6,
// DESIGN §8.1, §11.10). Owner: WP-E. Every line is generated from BUILDING_DEFS, HUB_DEFS and the live state.
import { B } from './balance';
import { HUBS, RESOURCES, TRADE_RES } from './types';
import type { Building, BuildingId, Cost, GameState, ResId, SimView, TradeRes } from './types';
import { SEASON_NAMES, seasonOf } from './calendar';
import { stageOf } from './census';
import { buildingRate, seasonMult } from './economy';
import { fx } from './fx';
import { siteMult } from './site';
import { HUB_DEFS } from './data/hubs';
import { BUILDING_DEFS, BUILD_ORDER } from './data/buildings';
import { RANK_DEFS } from './data/ranks';
import { RESOURCE_DEFS } from './data/resources';
import { aName, bestHub, int, listJoin, num, rankWord } from './advisors/util';

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

/** Ways to get more of a resource: producers from the registry, markets that sell it, idle forage, and a live line. */
export function howToGetMore(s: GameState, res: ResId, v: SimView): string[] {
  const out: string[] = [];
  let main: BuildingId | null = null;
  for (const t of BUILD_ORDER) {
    const d = BUILDING_DEFS[t];
    const lock = d.rank > s.rank ? ` Rome grants it to ${rankWord(d.rank)}.` : '';
    if (d.output?.res === res) {
      const uses = d.inputs ? `, from ${listJoin(RESOURCES.filter((r) => d.inputs?.[r]).map((r) => `${num(d.inputs?.[r] ?? 0)} ${RESOURCE_DEFS[r].name.toLowerCase()}`))} a hand` : '';
      out.push(`${d.name}: ${num(d.output.perWorker)} a day for each of ${d.slots} hands${uses}${bestSeason(t)}.${lock}`);
      if (!main && !lock) main = t;
    } else if (d.passive?.res === res) {
      out.push(`${d.name}: ${int(d.passive.perDay)} a day with no hands${bestSeason(t)}.${lock}`);
    }
  }
  if (res === 'grain') out.push(`Idle hands forage ${num(B.economy.IDLE_FORAGE)} a day each.`);
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
  const store = STORE[res];
  if (store && s.res[res] >= 0.95 * v.c.caps[res]) out.push(`The stores are full (${int(s.res[res])} of ${int(v.c.caps[res])}): ${aName(store)} adds room.`);
  return out;
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
  return `You have ${n === 1 ? aName(type) : `${n} ${many}`} (${hands} of ${slots} hands). Next: ${staff}raise a ${ordinal(n + 1)} (${costWords(d.cost)}).`;
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
    out.push({ label: 'Hands', value: `${workers.length} of ${def.slots}` }, { label: 'Per hand', value: num(def.output.perWorker) });
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
  const total = buildingRate(s, b, season, 'current')[res] ?? 0;
  out.push({ label: 'Total', value: `${num(total)} ${RESOURCE_DEFS[res].unit} a day` });
  return out;
}

// src/game/advisors/util.ts — shared helpers of the advisor rules: severity ladders, the tick channel, the house-wants
// memo, and the words that name people, places, markets and fractions (DESIGN §11.1, §11.4–11.6). Owner: WP-E.
// Load order: only function bodies here touch other game modules, so any file may import this one.
import { B } from '../balance';
import { HOUSE_TIERS, HUBS } from '../types';
import type {
  AdvisorRule, BuildingId, ContractSpec, Essential, GameState, HouseTierId, HubId, LaborCat, NeedId, Person, Rates, Remedy, ResId, RuleId, Severity, SimView,
  SkillId, TradeRes,
} from '../types';
import { seasonOf } from '../calendar';
import { seasonMult } from '../economy';
import { distToRect, getMap, tx, ty } from '../map';
import { censusEpoch, memo, structEpoch } from '../memo';
import { personName } from '../people';
import { getBuilding, getPerson } from '../state';
import { nextTier, unmetNeeds } from '../housing';
import { hubOpen, price, tripDays } from '../trade';
import { BUILDING_DEFS } from '../data/buildings';
import { NEED_META, TIER_DEFS } from '../data/housing';
import { RANK_DEFS } from '../data/ranks';
import { RESOURCE_DEFS } from '../data/resources';

/** Hysteresis release factor: an advisory clears only past its threshold × CLEAR (DESIGN §11.4). */
export const CLEAR = B.advisors.CLEAR;
/** Per-rule thresholds (DESIGN §11.6). */
export const R = B.advisors.RULES;

/** A rule the engine evaluates only every `every` days (day % every == 0); on other days it is left exactly as it stands. */
export type CadencedRule = AdvisorRule & { every?: number };
/** The house rules follow the sim's own house-check cadence (DESIGN §7.2): houses change state only on their check days. */
export const HOUSE_CADENCE = B.housing.CHECK_EVERY;

// ───────────────────────────── ladders and hysteresis ─────────────────────────────

/** True while the rule's advisory is raised (its evaluate then holds it up to threshold × CLEAR). */
export function held(s: GameState, id: RuleId): boolean {
  return s.guidance.advisories[id]?.active === true;
}

/** Severity of a low-is-bad metric: P < t[0] · C < t[1] · M < t[2]; a held advisory stays up to t[2] × CLEAR. */
export function lowLadder(x: number, t: readonly number[], hold: boolean): Severity | null {
  if (x < t[0]) return 3;
  if (x < t[1]) return 2;
  if (x < t[2] * (hold ? CLEAR : 1)) return 1;
  return null;
}

/** Days until a stock runs out at a net rate (stock / −net when net < 0), else null. */
export function runway(stock: number, net: number): number | null {
  return net < 0 ? Math.max(0, stock) / -net : null;
}

// The day's ledger, lent to the rules by advisorsDay for the length of one evaluation pass (never saved).
let tickRates: Rates | null = null;
// States that have run offline ticks in this session: the mentor's `away` tip waits for them (UI only, never saved).
const away = new WeakSet<GameState>();

/** Notes that a state has just been advanced offline (advisorsDay with ctx.offline). */
export function markAway(s: GameState): void {
  away.add(s);
}

/** True once this state has run offline ticks in this session (the away report was written). */
export function wasAway(s: GameState): boolean {
  return away.has(s);
}

/** Sets (or clears) the ledger of the tick being evaluated; called only by advisorsDay. */
export function lendRates(r: Rates | null): void {
  tickRates = r;
}

/** Today's ledger amount of a source (consumption or production) while advisorsDay runs; null outside it. */
export function todayRate(side: 'prod' | 'cons', res: keyof Rates['prod'], src: string): number | null {
  if (!tickRates) return null;
  return (tickRates[side][res] as Record<string, number | undefined>)[src] ?? 0;
}

/** Today's net of a resource from the lent ledger (Σ production − Σ consumption); null outside advisorsDay. */
export function netToday(res: ResId): number | null {
  if (!tickRates) return null;
  let n = 0;
  for (const v of Object.values(tickRates.prod[res])) n += v ?? 0;
  for (const v of Object.values(tickRates.cons[res])) n -= v ?? 0;
  return n;
}

// ───────────────────────────── labour ─────────────────────────────

/** Open posts in a labour category. */
export function openPosts(v: SimView, cat: LaborCat): number {
  return Math.max(0, v.c.catSlots[cat] - v.c.catStaffed[cat]);
}

/** Best output per hand this season among a category's finished producers of an essential (0 if none). */
export function perHand(s: GameState, cat: LaborCat, res: Essential): number {
  const season = seasonOf(s.day);
  let best = 0;
  for (const b of s.buildings) {
    const d = BUILDING_DEFS[b.type];
    if (b.status === 'done' && b.open && d.labor === cat && d.output?.res === res) best = Math.max(best, d.output.perWorker * seasonMult(s, b.type, season));
  }
  return best;
}

/** The labour remedy for a shortfall: the Ordo puts the category first, or (manual labour) k more hands by hand. */
export function labourRemedy(s: GameState, v: SimView, cat: LaborCat, res: Essential, deficit: number): Remedy {
  if (s.ordo.on.labour) return { kind: 'priority', cat, days: R.REMEDY_DAYS };
  const per = perHand(s, cat, res);
  const k = per > 0 ? Math.ceil(Math.max(0, deficit) / per) : 1;
  return { kind: 'assign', cat, n: Math.max(1, Math.min(Math.max(1, openPosts(v, cat)), k)) };
}

/** The grain producer that gives most per hand this season among those Rome allows us. */
export function bestFood(s: GameState): BuildingId {
  const season = seasonOf(s.day);
  let best: BuildingId = 'ager', top = -1;
  for (const t of ['ager', 'venatio', 'pabulatio'] as const) {
    const d = BUILDING_DEFS[t];
    const v = d.rank <= s.rank && d.output ? d.output.perWorker * seasonMult(s, t, season) : -1;
    if (v > top) { top = v; best = t; }
  }
  return best;
}

// ───────────────────────────── houses ─────────────────────────────

/** One house's view for the Aedilis and the Curator: its tier, the next tier and its unmet needs (in need order), decline. */
export interface HouseWant { id: number; tile: number; tier: HouseTierId; next: HouseTierId | null; unmet: NeedId[]; want: NeedId | null; declining: boolean; lapsed: NeedId[] }

const PREFS = ['auto', 'insula', 'domus'] as const;

/** Everything a house's needs read besides the structure: coverage, the fed index, rank, and per house its tier, decline, goods and preference. */
function houseSig(s: GameState, v: SimView): string {
  return memo(s, 'adv.houseSig', `${s.day}|${structEpoch(s)}|${censusEpoch(s)}`, () => {
    const S = B.housing.SUPPLIED;
    const codes: number[] = [];
    for (const id of v.d.houses) {
      const h = getBuilding(s, id)?.house;
      if (!h) continue;
      const bits = (h.declining ? 4 : 0) + (h.oil >= S ? 2 : 0) + (h.wine >= S ? 1 : 0);
      codes.push(48 + (HOUSE_TIERS.indexOf(h.tier) * 8 + bits) * 3 + PREFS.indexOf(h.pref));
    }
    return `${structEpoch(s)}|${v.cov.key}|${s.fed >= B.needs.FED_MIN ? 1 : 0}|${s.rank}|${String.fromCharCode(...codes)}`;
  });
}

/** Every finished house with its wants. Pure, and memoised on everything the needs read (houseSig), so it is recomputed only when the structure, coverage, fed index or a house changes — not every day. */
export function houseWants(s: GameState, v: SimView): HouseWant[] {
  return memo(s, 'adv.houses', houseSig(s, v), () => {
    const out: HouseWant[] = [];
    const W = getMap(s.seed).W;
    for (const id of v.d.houses) {
      const b = getBuilding(s, id);
      const h = b?.house;
      if (!b || !h) continue;
      const next = nextTier(s, b);
      const unmet = next ? unmetNeeds(s, b, next) : [];
      out.push({ id, tile: b.y * W + b.x, tier: h.tier, next, unmet, want: unmet[0] ?? null, declining: h.declining, lapsed: h.declining ? unmetNeeds(s, b, h.tier) : [] });
    }
    return out;
  });
}

/** Houses whose next tier has waited on an unmet need for at least `days` days (finished that long ago, no OK days). */
export function blockedHouses(s: GameState, v: SimView, days: number): HouseWant[] {
  return houseWants(s, v).filter((w) => {
    const b = getBuilding(s, w.id);
    return w.want !== null && b !== undefined && s.day - (b.doneDay ?? b.placed) >= days && (b.house?.okDays ?? 0) === 0;
  });
}

/** The building that answers a house need, by what the colony can raise now (null: no building answers it). */
export function serviceFor(s: GameState, need: NeedId, castellumActive: boolean): BuildingId | null {
  const pick = (a: BuildingId, b: BuildingId): BuildingId => (BUILDING_DEFS[b].rank <= s.rank ? b : a);
  switch (need) {
    case 'water': return castellumActive ? 'lacus' : 'puteus';
    case 'fed': return 'ager';
    case 'religion': return 'lararium';
    case 'market': return 'taberna';
    case 'temple': return 'templum';
    case 'baths': return castellumActive ? pick('balneum', 'thermae') : 'balneum';
    case 'macellum': return 'macellum';
    case 'desirability': return 'hortus';
    case 'oil': return 'olivetum';
    default: return null;
  }
}

/** The one remedy that answers a house need: a building to place, wine by contract, or the petition for rank. */
export function needRemedy(s: GameState, v: SimView, need: NeedId): Remedy {
  const b = serviceFor(s, need, v.d.castellumActive);
  if (b) return { kind: 'place', building: b };
  if (need === 'wine') return importRemedy(s, 'wine', B.ordo.CARGO) ?? { kind: 'open', tab: 'trade' };
  if (need === 'rank') return { kind: 'open', tab: 'council', anchor: 'petition' };
  if (need === 'street') return { kind: 'open', tab: 'build', anchor: 'road' };
  return { kind: 'overlay', overlay: 'domus' };
}

/** A house need as a noun phrase ("a shrine", "water"). */
export function needWord(need: NeedId): string {
  if (need === 'desirability') return 'a finer street';
  if (need === 'fed') return 'full bellies';
  if (need === 'rank') return 'a charter from Rome';
  return NEED_META[need].label.replace(/^[A-Z]/, (c) => c.toLowerCase());
}

const TIER_PLURAL: Record<HouseTierId, string> = {
  tentoria: 'tent plots', casa: 'huts', tegulata: 'tiled cottages', domusParva: 'stone houses', insula: 'insulae', domus: 'atrium houses',
};

/** A tier as a plural noun ("tiled cottages"), or singular for one. */
export function tierWord(t: HouseTierId, n = 2): string {
  return n === 1 ? TIER_DEFS[t].name.toLowerCase() : TIER_PLURAL[t];
}

// ───────────────────────────── words ─────────────────────────────

const SINGULAR: Partial<Record<BuildingId, string>> = {
  ager: 'a field', olivetum: 'an olive grove', castellum: 'an aqueduct', thermae: 'great baths', caementarium: 'concrete works',
  area: 'a house plot', principia: 'the forum', capitolium: 'the Capitolium',
};

/** A building with its article ("a granary", "an olive grove"). */
export function aName(t: BuildingId): string {
  const s = SINGULAR[t];
  if (s) return s;
  const n = BUILDING_DEFS[t].name.toLowerCase();
  return `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`;
}

/** A building's bare lowercase name ("granary", "field"). */
export function bName(t: BuildingId): string {
  return aName(t).replace(/^(a|an|the) /, '');
}

/** Mends the seams of generated copy: a date's abbreviation point before a full stop ("Kal. Oct.."). */
export function tidy(text: string): string {
  return text.replace(/\.\./g, '.');
}

/** "a, b and c". */
export function listJoin(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** Whole number with thousands separators (display only). */
export function int(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? '−' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** One decimal under 10 (dropped when whole), else a whole number. */
export function num(n: number): string {
  if (Math.abs(n) >= 10) return int(n);
  const r = Math.round(Math.abs(n) * 10) / 10;
  return (n < 0 && r > 0 ? '−' : '') + (Number.isInteger(r) ? String(r) : r.toFixed(1));
}

/** "1 day" / "12 days" (floors; never negative). */
export function days(n: number): string {
  const d = Math.max(0, Math.floor(n));
  return d === 1 ? '1 day' : `${d} days`;
}

/** "in 12 days", or "today" under a day. */
export function inDays(n: number): string {
  return n < 1 ? 'today' : `in ${days(n)}`;
}

const FRACTIONS: [number, string][] = [
  [0.2, 'a fifth'], [0.25, 'a quarter'], [1 / 3, 'a third'], [0.4, 'two-fifths'], [0.5, 'half'], [0.6, 'three-fifths'],
  [2 / 3, 'two-thirds'], [0.75, 'three-quarters'], [0.8, 'four-fifths'],
];

/** A factor in words ("a third", "four-fifths"), or a percentage when no common fraction is close. */
export function fractionWord(x: number): string {
  for (const [f, w] of FRACTIONS) if (Math.abs(x - f) <= 0.04) return w;
  return `${Math.round(x * 100)}%`;
}

/** A resource's lowercase name. */
export function resName(r: keyof typeof RESOURCE_DEFS): string {
  return RESOURCE_DEFS[r].name.toLowerCase();
}

/** "Oppidum" with its article ("an Oppidum"). */
export function rankWord(rank: number): string {
  const n = RANK_DEFS[rank]?.name ?? 'Colonia';
  return `${/^[AEIOU]/.test(n) ? 'an' : 'a'} ${n}`;
}

// ───────────────────────────── people ─────────────────────────────

/** Idle able people, best at a skill first (then lowest id). */
export function idleBySkill(s: GameState, v: SimView, skill: SkillId | null): Person[] {
  const out: Person[] = [];
  for (const id of v.c.idle) { const p = getPerson(s, id); if (p) out.push(p); }
  return out.sort((a, b) => (skill ? (b.skills[skill] ?? 0) - (a.skills[skill] ?? 0) : 0) || a.id - b.id);
}

/** "Quintus Flavius", "Quintus Flavius and Gaia Antonia", "Quintus Flavius and 4 others". */
export function namesOf(ps: readonly Person[], max = 2): string {
  if (ps.length === 0) return '';
  if (ps.length <= max) return listJoin(ps.map(personName));
  const rest = ps.length - (max - 1);
  return `${ps.slice(0, max - 1).map(personName).join(', ')} and ${rest} others`;
}

// ───────────────────────────── places ─────────────────────────────

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'] as const;

/** Compass direction from (x0, y0) to (x1, y1) (map y grows southward). */
export function compass(x0: number, y0: number, x1: number, y1: number): string {
  if (x0 === x1 && y0 === y1) return 'here';
  const a = Math.atan2(y1 - y0, x1 - x0);
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

const GATE_WORD = { praetoria: 'the Porta Praetoria', decumana: 'the Porta Decumana', principalisN: 'the north gate', principalisS: 'the south gate' } as const;

/** A place in words, generated from the survey: "by the north gate", "in the Praetentura", "12 paces east of the walls". */
export function placeName(s: GameState, tile: number): string {
  const sv = getMap(s.seed).survey;
  const x = tx(tile), y = ty(tile);
  for (const g of sv.gates) if (Math.max(Math.abs(tx(g.tile) - x), Math.abs(ty(g.tile) - y)) <= 4) return `by ${GATE_WORD[g.id]}`;
  if (distToRect(tile, sv.forum) === 0) return 'in the forum';
  const fx = sv.forum.x + (sv.forum.w - 1) / 2, fy = sv.forum.y + (sv.forum.h - 1) / 2;
  if (distToRect(tile, sv.interior) === 0) {
    const bid = sv.blockAt[tile];
    const blk = bid >= 0 ? sv.blocks[bid] : null;
    if (!blk || blk.district === 'latera') return `${compass(fx, fy, x, y)} of the forum`;
    return blk.district === 'praetentura' ? 'in the Praetentura' : 'in the Retentura';
  }
  const dir = compass(fx, fy, x, y);
  const bid = sv.blockAt[tile];
  if (bid >= 0 && sv.blocks[bid].ring > 0) return `in the canabae to the ${dir}`;
  return `${int(distToRect(tile, sv.castrum))} paces ${dir} of the walls`;
}

/** The place of a building's top-left tile. */
export function buildingPlace(s: GameState, id: number): string {
  const b = getBuilding(s, id);
  return b ? placeName(s, b.y * getMap(s.seed).W + b.x) : 'beyond the walls';
}

// ───────────────────────────── markets ─────────────────────────────

/** The cheapest open market for a good on one side (buy = they sell to us), ties by trip days then hub order. */
export function bestHub(s: GameState, res: TradeRes, side: 'buy' | 'sell', qty: number): { hub: HubId; unit: number; days: number } | null {
  let best: { hub: HubId; unit: number; days: number } | null = null;
  for (const hub of HUBS) {
    if (!hubOpen(s, hub)) continue;
    const p = price(s, hub, res, side);
    if (p === null) continue;
    const d = tripDays(s, hub, qty);
    const better = !best || (side === 'buy' ? p < best.unit : p > best.unit) || (p === best.unit && d < best.days);
    if (better) best = { hub, unit: p, days: d };
  }
  return best;
}

/** A pre-filled import contract from the cheapest open market (null when no market sells it to us). */
export function importRemedy(s: GameState, res: TradeRes, qty: number): Remedy | null {
  const q = Math.max(1, Math.min(B.ordo.CARGO, Math.ceil(qty)));
  const h = bestHub(s, res, 'buy', q);
  if (!h) return null;
  const spec: ContractSpec = { hub: h.hub, mode: 'import', res, qty: q, repeat: false };
  return { kind: 'contract', spec };
}

/** A pre-filled export contract to the best-paying open market (null when nobody buys it). */
export function exportRemedy(s: GameState, res: TradeRes, qty: number): Remedy | null {
  const q = Math.max(1, Math.min(B.ordo.CARGO, Math.floor(qty)));
  const h = bestHub(s, res, 'sell', q);
  if (!h) return null;
  return { kind: 'contract', spec: { hub: h.hub, mode: 'export', res, qty: q, repeat: false } };
}

/** Keeps the first 1–3 remedies, dropping nulls (every rule offers at least one). */
export function three(...rs: (Remedy | null | false | undefined)[]): Remedy[] {
  const out: Remedy[] = [];
  for (const r of rs) if (r && out.length < 3) out.push(r);
  return out;
}

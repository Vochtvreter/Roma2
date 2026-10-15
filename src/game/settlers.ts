// src/game/settlers.ts — how fast the colony gains souls at today's pace (DESIGN §6.5, §6.6): Rome's settlers and the
// births, each with its factors, the factor that holds the settlers back most, and how long until a count of souls (the
// petition's Souls line). Pure, read at render time by the souls tooltip, the Populus census, the petition and the
// Aedilis; the numbers are the tick's own (people.ts arrivalFactors, birthFactors, ageHazard), never a second formula.
import { B } from './balance';
import type { GameState, RankIndex } from './types';
import { census } from './census';
import { careShare } from './civic';
import { fxBreakdown } from './fx';
import { ageHazard, arrivalFactors, bedsFactor, birthFactors, mothersOf } from './people';
import { RANK_DEFS } from './data/ranks';
import { int, num } from './advisors/util';

const P = B.people;
const YEAR = B.time.YEAR_DAYS;

export type ArrivalFactorId = 'rank' | 'spirits' | 'food' | 'water' | 'favour' | 'edicts';
export type BirthFactorId = 'food' | 'spirits' | 'favour' | 'edicts' | 'beds';

/** One factor of a rate: its value, the most it can reach (`best`) and what sets it, in a few words (`why`). */
export interface RateFactor<K extends string = string> { id: K; label: string; value: number; best: number; why: string }

/** Rome's settlers at today's draw (DESIGN §6.6). */
export interface ArrivalOutlook {
  perDay: number;                              // households a day (people.immigrationChance)
  every: number | null;                        // ≈ days between families while the gates are open; null when none are drawn
  shut: 'roll' | 'beds' | null;                // what turns every family back today: Rome's roll is full, or no free bed
  factors: RateFactor<ArrivalFactorId>[];      // the rank's own rate (`value` in households a day), then the multipliers
  limiter: RateFactor<ArrivalFactorId> | null; // the multiplier furthest below its best; null when each stands at it
}

/** The colony's births at today's pace (DESIGN §6.5). */
export interface BirthOutlook { perYear: number; mothers: number; factors: RateFactor<BirthFactorId>[] }

/** Days of an essential in store at today's need. */
function doh(s: GameState, res: 'grain' | 'water'): number {
  const need = census(s).need[res];
  return need > 0 ? s.res[res] / need : Infinity;
}

/** "34 days in store" ("∞" when nothing is eaten or drunk). */
function inStore(n: number): string {
  return `${Number.isFinite(n) ? int(n) : '∞'} days in store`;
}

/** "Newcomers: Patentes ×1.6, Coloni ×1.3", or "none in force" when no edict, path or event moves the key. */
function sources(s: GameState, key: 'immigration' | 'births'): string {
  const xs = fxBreakdown(s, key).filter((t) => Math.abs(t.value - 1) > 1e-9).map((t) => `${t.label} ×${num(t.value)}`);
  return xs.length > 0 ? xs.join(', ') : 'none in force';
}

/** "×0.98", "×1.25", "×1.0": a factor as the tooltips show it, to the hundredth. */
export function times(x: number): string {
  const t = x.toFixed(2);
  return `×${t.endsWith('0') ? x.toFixed(1) : t}`;
}

/** "×1.2": Rome's favour as it was always shown, floored to a tenth (×2.96 never reads ×3). */
export function favourTimes(x: number): string {
  return `×${(Math.floor(x * 10 + 1e-9) / 10).toFixed(1)}`;
}

/** The settlers Rome sends at today's draw, their factors and what holds them back most. */
export function arrivalOutlook(s: GameState): ArrivalOutlook {
  const c = census(s);
  const f = arrivalFactors(s);
  const A = P.ATTRACT;
  const perDay = f.rank * f.spirits * f.food * f.water * f.favour * f.edicts;   // immigrationChance, factor by factor
  const grain = doh(s, 'grain'), water = doh(s, 'water');
  const factors: RateFactor<ArrivalFactorId>[] = [
    { id: 'rank', label: `Rome's draw (${RANK_DEFS[s.rank].name})`, value: f.rank, best: f.rank, why: `1 family in ${int(1 / f.rank)} days at ×1` },
    { id: 'spirits', label: `Spirits ${Math.round(s.morale)}`, value: f.spirits, best: A.MAX, why: `×1 at ${A.MORALE + A.SPAN}, ×${A.MAX} at ${A.MORALE + A.SPAN * A.MAX}` },
    { id: 'food', label: `Grain ${inStore(grain)}`, value: f.food, best: 1, why: `×1 from ${P.FOOD_F[0][0]} days in store` },
    { id: 'water', label: `Water ${inStore(water)}`, value: f.water, best: 1, why: `×1 from ${P.WATER_F[0][0]} days in store` },
    { id: 'favour', label: "Rome's favour", value: f.favour, best: P.RENOWN.MAX, why: `gardens and paved streets, up to ×${P.RENOWN.MAX}` },
    { id: 'edicts', label: 'Edicts and paths', value: f.edicts, best: Math.max(1, f.edicts), why: sources(s, 'immigration') },
  ];
  let limiter: RateFactor<ArrivalFactorId> | null = null;
  for (const x of factors) {
    if (x.id === 'rank' || x.value >= x.best - 1e-9) continue;
    if (!limiter || x.value / x.best < limiter.value / limiter.best) limiter = x;
  }
  const shut = c.pop >= c.roll ? 'roll' : c.freeBeds <= 0 ? 'beds' : null;
  return { perDay, every: perDay > 0 ? 1 / perDay : null, shut, factors, limiter };
}

/** The births a year at today's pace (each mother's chance × the free beds), their factors and the mothers. */
export function birthOutlook(s: GameState): BirthOutlook {
  const f = birthFactors(s);
  const M = P.BIRTH_MORALE;
  const mothers = mothersOf(s).length;
  const free = census(s).freeBeds;
  const beds = bedsFactor(free);
  const factors: RateFactor<BirthFactorId>[] = [
    { id: 'food', label: 'Grain', value: f.food, best: 1, why: `×1 from ${P.FOOD_F[0][0]} days in store` },
    { id: 'spirits', label: 'Spirits', value: f.spirits, best: M[2], why: `×1 at ${M[0]}` },
    { id: 'favour', label: "Rome's favour", value: f.favour, best: 1 + P.RENOWN.BIRTHS * (P.RENOWN.MAX - 1), why: "a splendid town's families thrive" },
    { id: 'edicts', label: 'Edicts and events', value: f.edicts, best: Math.max(1, f.edicts), why: sources(s, 'births') },
    { id: 'beds', label: 'Free beds', value: beds, best: 1, why: `${int(free)} free; a cradle wants ${P.BIRTH_BEDS[0][0]}` },
  ];
  const perYear = mothers * P.BIRTH_RATE * f.food * f.spirits * f.favour * f.edicts * beds;
  return { perYear, mothers, factors };
}

/** Ordinary deaths a year at today's ages and care (the hazard of DESIGN §6.5; hunger, thirst and fever aside). */
export function deathsPerYear(s: GameState): number {
  const careF = 1 - P.HAZARD.care * careShare(s);
  let n = 0;
  for (const p of s.people) n += ageHazard((s.day - p.born) / YEAR) * careF;   // the age as deaths() reads it
  return n;
}

/** Days until the colony counts `goal` souls at today's pace: Rome's settlers up to the roll (as the gates stand open
 *  today: a family needs free beds), then births less deaths. 0 when reached, null when the count would not grow. */
export function soulsEta(s: GameState, goal: number): number | null {
  const c = census(s);
  if (c.pop >= goal) return 0;
  const a = arrivalOutlook(s);
  const natural = (birthOutlook(s).perYear - deathsPerYear(s)) / YEAR;
  const settlers = a.shut === null ? a.perDay * P.CALL.SOULS : 0;
  const toRoll = Math.max(0, Math.min(goal, c.roll) - c.pop), past = Math.max(0, goal - Math.max(c.pop, c.roll));
  let t = 0;
  if (toRoll > 0) {
    if (settlers + natural <= 0) return null;
    t += toRoll / (settlers + natural);
  }
  if (past > 0) {
    if (natural <= 0) return null;
    t += past / natural;
  }
  return Math.ceil(t);
}

/** "about one family every 217 days" (or "no family at all" when none is drawn). */
export function paceWords(a: ArrivalOutlook): string {
  return a.every === null ? 'no family at all' : `about one family every ${int(a.every)} days`;
}

/** What holds Rome's settlers back most today, as the Aedilis and the census say it: a shut gate first, else the
 *  factor furthest below its best; '' when each stands at its best. */
export function limiterLine(s: GameState, a: ArrivalOutlook): string {
  const next = Math.min(RANK_DEFS.length - 1, s.rank + 1) as RankIndex;
  if (a.shut === 'roll') return s.rank < next ? `Rome's roll is full: petition for ${RANK_DEFS[next].name} to open the gates.` : 'Rome will enrol no more.';
  if (a.shut === 'beds') return 'No house has a free bed: families turn back at the gate. Raise house plots.';
  const x = a.limiter;
  if (!x) return 'Every gate stands wide: only a higher rank brings more.';
  const A = P.ATTRACT;
  switch (x.id) {
    case 'spirits': {
      const m = Math.round(s.morale), full = A.MORALE + A.SPAN, top = A.MORALE + A.SPAN * A.MAX;
      return m < full ? `Spirits hold them back most (${m}): settlers come at full pace from ${full}, and faster still up to ${top}.`
        : `Spirits hold them back most (${m}): settlers come faster still as they rise to ${top}.`;
    }
    case 'food': return `Thin granaries hold them back most: Rome sends families at full pace while we keep ${P.FOOD_F[0][0]} days of grain.`;
    case 'water': return `Low water holds them back most: under ${P.WATER_F[0][0]} days in store halves them.`;
    case 'favour': return `Rome's favour holds them back most (${favourTimes(x.value)} of ×${P.RENOWN.MAX}): gardens and paved streets among the homes draw them faster.`;
    case 'edicts': return `The edicts hold them back most: ${x.why}.`;
    default: return '';
  }
}

/** Expected births and ordinary deaths a year, for the census ("≈ 0.4 births, 0.6 deaths a year"). */
export function naturalWords(s: GameState): string {
  const b = birthOutlook(s);
  const n = (x: number, one: string, many: string): string => `${num(x)} ${num(x) === '1' ? one : many}`;
  return `≈ ${n(b.perYear, 'birth', 'births')} and ${n(deathsPerYear(s), 'death', 'deaths')} a year from ${n(b.mothers, 'mother', 'mothers')}`;
}

/** The days in words for the petition's Souls line ("≈ 680 days at today's pace"); '' once reached. */
export function etaWords(s: GameState, goal: number): string {
  const t = soulsEta(s, goal);
  if (t === 0) return '';
  const a = arrivalOutlook(s);
  if (a.shut === 'beds') return 'no free beds: newcomers turn back';
  if (t === null) return 'not growing at today\'s pace';
  return `≈ ${int(t)} days${t >= 2 * YEAR ? ` (${Math.round(t / YEAR)} years)` : ''} at today's pace`;
}

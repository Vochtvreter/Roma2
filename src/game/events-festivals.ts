// src/game/events-festivals.ts — the calendar festivals of DESIGN §12.3, kept automatically by the Feriae edict.
// Owner: WP-D (split from events.ts). Festivals are toasts, never cards; one that the stores cannot spare (or that
// would take more than CLAMP_RES of a stock) is skipped with a note from the Augur.
import { B as B$ } from './balance';
import type { Cost, FestivalId, GameState, TickContext } from './types';
import { FESTIVALS as FESTIVALS$ } from './types';
import { aucYear as aucYear$, dateOf as dateOf$, dayOf as dayOf$, formatAuc as formatAuc$, formatRoman as formatRoman$ } from './calendar';
import { fx as fx$ } from './fx';
import { canAfford, log, pay } from './state';
import { dignitas } from './civic';
import { addModifier } from './events-catalogue';
import { RANK_DEFS as RANK_DEFS$ } from './data/ranks';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, FESTIVALS = FESTIVALS$, aucYear = aucYear$, dateOf = dateOf$, dayOf = dayOf$, formatAuc = formatAuc$,
  formatRoman = formatRoman$, fx = fx$, RANK_DEFS = RANK_DEFS$;

/** One festival: its date, the Feriae options that keep it, its cost per resident and its effects. */
export interface FestivalDef {
  id: FestivalId; name: string; month: number; day: number;
  kept: readonly string[] | 'always';
  perResident: { grain?: number; denarii?: number; wine?: number };   // wine is taken only "if any"
  morale: number; moraleDays: number;
}

const DUR = B.events.DUR;                            // festival morale, days
const SATURNALIA_BIRTHS = B.events.SATURNALIA_BIRTHS;
const LANTERN_DAYS = B.events.LANTERN_DAYS;

/** The six festivals (DESIGN §12.3) in calendar order. */
export const FESTIVAL_DEFS: Record<FestivalId, FestivalDef> = {
  parilia: { id: 'parilia', name: 'Parilia', month: 4, day: 21, kept: ['solemnes', 'frequentes'], perResident: { grain: 0.5, denarii: 0.1 }, morale: 6, moraleDays: DUR },
  robigalia: { id: 'robigalia', name: 'Robigalia', month: 4, day: 25, kept: ['solemnes', 'frequentes'], perResident: {}, morale: 0, moraleDays: 0 },
  floralia: { id: 'floralia', name: 'Floralia', month: 4, day: 28, kept: ['frequentes'], perResident: { grain: 0.3, denarii: 0.1 }, morale: 4, moraleDays: DUR },
  ludiRomani: { id: 'ludiRomani', name: 'Ludi Romani', month: 9, day: 5, kept: ['frequentes'], perResident: { denarii: 0.2, wine: 0.02 }, morale: 6, moraleDays: DUR },
  saturnalia: { id: 'saturnalia', name: 'Saturnalia', month: 12, day: 17, kept: ['solemnes', 'frequentes'], perResident: { grain: 1, denarii: 0.2, wine: 0.05 }, morale: 10, moraleDays: DUR },
  lustrum: { id: 'lustrum', name: 'Lustrum', month: 4, day: 1, kept: 'always', perResident: {}, morale: 0, moraleDays: 0 },
};

/** Whether the current Feriae edict keeps a festival. */
export function festivalKept(s: GameState, id: FestivalId): boolean {
  const k = FESTIVAL_DEFS[id].kept;
  return k === 'always' || k.includes(s.decisions.edicts.feriae);
}

/** True when `day` is a Lustrum day: Kal. Apr. every fifth year from AUC DCCCV. */
export function isLustrum(day: number): boolean {
  const d = dateOf(day);
  const L = B.events.LUSTRUM;
  return d.month === FESTIVAL_DEFS.lustrum.month && d.day === FESTIVAL_DEFS.lustrum.day && d.year >= L.FROM_AUC && (d.year - L.FROM_AUC) % L.EVERY === 0;
}

/** The next festival the colony keeps, strictly after today (for the date tooltip). */
export function nextFestival(s: GameState): { id: FestivalId; day: number } | null {
  const y = aucYear(s.day);
  let best: { id: FestivalId; day: number } | null = null;
  for (const id of FESTIVALS) {
    if (!festivalKept(s, id)) continue;
    const f = FESTIVAL_DEFS[id];
    for (let k = 0; k <= B.events.LUSTRUM.EVERY; k++) {
      const day = dayOf(y + k, f.month, f.day);
      if (day <= s.day || (id === 'lustrum' && !isLustrum(day))) continue;
      if (!best || day < best.day) best = { id, day };
      break;
    }
  }
  return best;
}

/** The festival's bill for today's population × fx(festivalCost); wine only as far as we have it. */
function bill(s: GameState, f: FestivalDef): Cost {
  const n = s.people.length * fx(s, 'festivalCost');
  const c: Cost = {};
  if (f.perResident.grain) c.grain = f.perResident.grain * n;
  if (f.perResident.denarii) c.denarii = f.perResident.denarii * n;
  if (f.perResident.wine) {
    const w = Math.min(s.res.wine * B.events.CLAMP_RES, f.perResident.wine * n);
    if (w > 0) c.wine = w;
  }
  return c;
}

/** Within the clamp: no festival takes more than CLAMP_RES of any stock. */
function withinClamp(s: GameState, c: Cost): boolean {
  for (const k of ['grain', 'denarii', 'wine'] as const) {
    const v = c[k];
    if (v !== undefined && v > s.res[k] * B.events.CLAMP_RES) return false;
  }
  return true;
}

function keep(s: GameState, ctx: TickContext, f: FestivalDef): void {
  const c = bill(s, f);
  if (!canAfford(s, c) || !withinClamp(s, c)) {
    log(s, 'advisor', `Augur: the ${f.name} passes unkept; the stores cannot spare the feast.`);
    return;
  }
  pay(s, c);
  for (const k of ['grain', 'denarii', 'wine'] as const) {
    const v = c[k];
    if (v) ctx.rates.cons[k].festival = (ctx.rates.cons[k].festival ?? 0) + v;
  }
  s.counters.festivalsKept[f.id] = (s.counters.festivalsKept[f.id] ?? 0) + 1;
  if (f.morale > 0) addModifier(s, { id: f.id, label: f.name, until: s.day + f.moraleDays, fx: { add: { morale: f.morale } }, benign: true, source: f.id });
  const year = formatAuc(aucYear(s.day));
  switch (f.id) {
    case 'parilia': {
      log(s, 'event', `The Parilia: bonfires for the founding of Rome (spirits +${f.morale}).`);
      const d = dignitas(s).value;
      log(s, 'fasti', `Fasti ${year}: ${s.name}, ${RANK_DEFS[s.rank].name}, ${s.people.length} souls, dignitas ${Math.round(d)}.`);
      break;
    }
    case 'saturnalia':
      addModifier(s, { id: 'saturnalia.births', label: 'Saturnalia: births ×1.2', until: s.day + SATURNALIA_BIRTHS.DAYS, fx: { mul: { births: SATURNALIA_BIRTHS.MUL } }, benign: true, source: 'saturnalia' });
      addModifier(s, { id: 'saturnalia.lanterns', label: 'Saturnalia lanterns', until: s.day + LANTERN_DAYS, fx: {}, benign: true, source: 'saturnalia' });
      log(s, 'event', `Io Saturnalia! Masks and lanterns in every street (spirits +${f.morale}).`, ['highlight']);
      break;
    default:
      log(s, 'event', `The ${f.name} is kept (spirits +${f.morale}).`);
  }
}

/** Daily: keeps today's festivals (by the Feriae edict), the Robigalia's blessing and the Lustrum census. */
export function festivalsDay(s: GameState, ctx: TickContext): void {
  const d = dateOf(s.day);
  for (const id of FESTIVALS) {
    const f = FESTIVAL_DEFS[id];
    if (d.month !== f.month || d.day !== f.day || !festivalKept(s, id)) continue;
    if (id === 'robigalia') {
      s.counters.robigaliaYear = d.year;
      s.counters.festivalsKept.robigalia = (s.counters.festivalsKept.robigalia ?? 0) + 1;
      // blight weight ×0.5 for the rest of the year (Feriae Nullae keeps no Robigalia: blight strikes twice as often)
      addModifier(s, { id: 'robigalia', label: 'Robigalia kept: blight ×0.5', until: dayOf(d.year + 1, 1, 1), fx: { mul: { blight: B.events.ROBIGO.KEPT } }, benign: true, source: 'robigalia' });
      log(s, 'event', 'The Robigalia: a red dog for Robigus; the rust will spare our wheat this year.');
    } else if (id === 'lustrum') {
      if (!isLustrum(s.day)) continue;
      const coin = B.events.LUSTRUM.PER_POP * s.people.length;
      s.res.denarii += coin;
      ctx.rates.prod.denarii.event = (ctx.rates.prod.denarii.event ?? 0) + coin;
      s.counters.festivalsKept.lustrum = (s.counters.festivalsKept.lustrum ?? 0) + 1;
      log(s, 'ledger', `Lustrum ${formatAuc(d.year)} (${formatRoman(s.day)}): the censors count ${s.people.length} souls in ${s.families.length} households; Rome sends ${Math.round(coin)} denarii.`, ['highlight']);
    } else keep(s, ctx, f);
  }
}

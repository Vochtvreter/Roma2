// src/ui/hud-tips.ts — the HUD's tooltips (DESIGN §11.10): resource ledger with "how to get more", coin, souls, spirits,
// dignitas and the date. Owner: WP-H. Built lazily on hover from live state; every line is DOM, never HTML.
import { EDICTS, RESOURCES } from '../game/types';
import type { MulKey, RateSource, ResId } from '../game/types';
import type { Game } from './types';
import { fmt, fmtDays, fmtRate, h, realTime } from './dom';
import { caps, tipCard, tipHead, tipKicker, tipNote, tipRow, tipSep } from './tipkit';
import { census } from '../game/census';
import { forecast } from '../game/forecast';
import { view } from '../game/sim';
import { fxBreakdown } from '../game/fx';
import { howToGetMore } from '../game/hints';
import { dignitas, moraleTarget } from '../game/civic';
import { edictOption, edictWindow } from '../game/decisions';
import {
  aucYear, dateOf, dayOf, formatModern, formatRoman, formatRomanLong, nextSeasonStart, seasonDay, seasonLength, seasonOf,
  SEASON_NAMES, toRoman,
} from '../game/calendar';
import { BUILDING_DEFS } from '../game/data/buildings';
import { EDICT_DEFS } from '../game/data/decisions';
import { RANK_DEFS } from '../game/data/ranks';
import { RESOURCE_DEFS } from '../game/data/resources';

const SOURCE_LABEL: Partial<Record<RateSource, string>> = {
  drinking: 'Drinking', idleForage: 'Idle hands forage', renovation: 'Renovations', construction: 'Building sites',
  capitolium: 'The Capitolium works', upkeep: 'Upkeep of works', taxes: 'Taxes (paid on the Kalends)', marketTax: 'Market dues',
  subsidy: 'Stipendium from Rome', trade: 'Caravans', merchant: 'Merchant', rot: 'Rot in the open sheds', evaporation: 'Evaporation',
  spill: 'Spilt: the stores are full', festival: 'Festivals', event: 'Events', baths: 'The baths', relief: 'Relief grain',
  debt: 'Relief debt', felling: 'Felling for sites', goods: 'Goods to the homes',
};

/** Effect keys worth tagging on each resource's tooltip. */
const FX_KEYS: Partial<Record<ResId, MulKey[]>> = {
  grain: ['fields', 'hunting', 'forage', 'grainUse'], water: ['wells', 'rain', 'waterUse'], timber: ['timber'],
  stone: ['quarry'], ore: ['quarry'], tiles: ['industry'], concrete: ['industry'], iron: ['industry'], tools: ['industry'],
  oil: ['olives'], denarii: ['tax', 'marketTax'],
};

/** Calendar festivals (DESIGN §12.3): month, day. Kept or skipped by the Feriae edict. */
const FESTIVAL_DATES: [string, number, number][] = [
  ['Parilia', 4, 21], ['Robigalia', 4, 25], ['Floralia', 4, 28], ['Ludi Romani', 9, 5], ['Saturnalia', 12, 17],
];

/** Net per day of a resource in the last tick's ledger. */
export function netRate(g: Game, r: ResId): number {
  let p = 0, c = 0;
  for (const v of Object.values(g.rates.prod[r])) p += v ?? 0;
  for (const v of Object.values(g.rates.cons[r])) c += v ?? 0;
  return p - c;
}

function sourceLabel(g: Game, src: RateSource, res: ResId): string {
  const s = g.state;
  if ((BUILDING_DEFS as Record<string, unknown>)[src]) {
    const type = src as keyof typeof BUILDING_DEFS;
    const c = census(s);
    let n = 0, hands = 0;
    for (const b of s.buildings) if (b.type === type && b.status === 'done') { n++; hands += c.staffed[b.id] ?? 0; }
    const def = BUILDING_DEFS[type];
    return `${def.name}${n > 1 ? ` ×${n}` : ''}${def.slots > 0 ? ` (${hands} ${hands === 1 ? 'hand' : 'hands'})` : ''}`;
  }
  if (src === 'eating' || (src === 'drinking' && res === 'water')) {
    const pop = s.people.length;
    if (src === 'drinking') return `Drinking · ${pop} souls`;
    const opt = EDICT_DEFS.rationes.options.find((o) => o.id === edictOption(s, 'rationes'));
    return `Eating · ${pop} souls${opt ? ` (${opt.name})` : ''}`;
  }
  if (src === 'idleForage') return `Idle hands forage (${census(s).idle.length})`;
  return SOURCE_LABEL[src] ?? src;
}

/** The ledger lines of one resource from the last tick's Rates, gains first, largest first, then the net. */
export function ledger(g: Game, r: ResId): HTMLElement[] {
  const rows: { label: string; v: number }[] = [];
  for (const [src, v] of Object.entries(g.rates.prod[r])) if (v && Math.abs(v) >= 0.005) rows.push({ label: sourceLabel(g, src as RateSource, r), v });
  for (const [src, v] of Object.entries(g.rates.cons[r])) if (v && Math.abs(v) >= 0.005) rows.push({ label: sourceLabel(g, src as RateSource, r), v: -v });
  rows.sort((a, b) => (b.v > 0 ? 1 : 0) - (a.v > 0 ? 1 : 0) || Math.abs(b.v) - Math.abs(a.v));
  const out = rows.map((x) => tipRow(`${x.v > 0 ? '+' : '−'} ${x.label}`, fmtRate(x.v).replace('/d', ''), x.v > 0 ? 'pos' : 'neg'));
  const net = netRate(g, r);
  out.push(tipRow('= a day', `${fmtRate(net).replace('/d', '')} ${net > 0.05 ? '▲' : net < -0.05 ? '▼' : '■'}`, 'total'));
  return out;
}

/** Chips naming the active effects (paths, edicts, modifiers) on this resource's producers. */
export function fxTags(g: Game, r: ResId): HTMLElement | null {
  const tags: HTMLElement[] = [];
  for (const k of FX_KEYS[r] ?? []) {
    for (const t of fxBreakdown(g.state, k)) {
      if (Math.abs(t.value - 1) < 0.001) continue;
      tags.push(h('span', { class: t.value > 1 === (k !== 'grainUse' && k !== 'waterUse') ? 'chip good' : 'chip bad' }, `${t.label} ×${fmt(t.value)}`));
    }
  }
  return tags.length ? h('div', { class: 'tip-tags' }, tags) : null;
}

/** The crunch outlook line of an essential (Hiems for grain, Aestas for water). */
export function outlookLine(g: Game, r: 'grain' | 'water'): string {
  const f = forecast(g.state)[r];
  const cr = f.crunch;
  if (!cr) return '';
  const name = SEASON_NAMES[cr.season];
  const when = cr.startsIn > 0 ? `${name} in ${cr.startsIn} days` : `${name} now`;
  if (cr.emptyDay !== null && cr.lowestDoh < 1) return `${when}: we would run out on ${formatRoman(cr.emptyDay)}.`;
  return `${when}: our lowest would be ${fmtDays(cr.lowestDoh)} on hand.`;
}

/** Resource tooltip: name, stock / cap (and days for essentials), the per-source ledger, effect tags, outlook, how to get more. */
export function resourceTip(g: Game, r: ResId): Node {
  const s = g.state;
  const def = RESOURCE_DEFS[r];
  const c = census(s);
  const cap = c.caps[r];
  const kids: (Node | null)[] = [tipHead(def.name, def.latin)];
  if (r === 'grain' || r === 'water') {
    const f = forecast(s)[r];
    kids.push(tipNote(`${fmt(f.stock)} of ${fmt(f.cap)} · ${fmtDays(f.doh)} on hand · room for ${fmtDays(f.need > 0 ? f.room / f.need : null)}`, 'tip-big'));
  } else if (r === 'denarii') {
    kids.push(tipNote(`${fmt(s.res.denarii)} in the aerarium · ${fmt(s.taxAccrued)} accrued for the Kalends`, 'tip-big'));
  } else {
    kids.push(tipNote(`${fmt(s.res[r])} of ${fmt(cap)} ${def.unit}`, 'tip-big'));
  }
  kids.push(tipNote(def.desc), tipSep(), ...ledger(g, r), fxTags(g, r));
  if (r === 'grain' || r === 'water') {
    const line = outlookLine(g, r);
    if (line) kids.push(tipSep(), tipNote(line, 'tip-outlook'));
  }
  const more = howToGetMore(s, r, view(s));
  if (more.length) kids.push(tipSep(), tipKicker('HOW TO GET MORE'), h('ul', { class: 'tip-list' }, more.map((m) => h('li', null, m))));
  return tipCard(...kids);
}

/** Coin tooltip: the aerarium, the ledger, the 30-day average and how long it lasts. */
export function coinTip(g: Game): Node {
  const s = g.state;
  const f = forecast(s).coin;
  const next = nextKalends(s.day);
  return tipCard(
    tipHead('Coin', 'Aerarium'),
    tipNote(`${fmt(s.res.denarii)} denarii · ${fmt(s.taxAccrued)} accrued, paid on ${formatRoman(next)} (in ${next - s.day} days)`, 'tip-big'),
    tipSep(), ...ledger(g, 'denarii'),
    tipRow('30-day average', fmtRate(f.net30), f.net30 >= 0 ? 'pos' : 'neg'),
    f.runout !== null ? tipNote(`At this pace the aerarium empties on ${formatRoman(f.runout)} (${realTime(f.runout - s.day, g.speed)}).`, 'bad') : null,
    fxTags(g, 'denarii'),
  );
}

function nextKalends(day: number): number {
  const d = dateOf(day);
  return d.month === 12 ? dayOf(d.year + 1, 1, 1) : dayOf(d.year, d.month + 1, 1);
}

/** Souls tooltip: population by life stage, beds, Rome's roll, workers. */
export function soulsTip(g: Game): Node {
  const c = census(g.state);
  const [ch, yo, ad, el] = c.byStage;
  return tipCard(
    tipHead('Souls', 'Populus'),
    tipNote(`${c.pop} souls in ${c.beds} beds · ${c.freeBeds} free${c.homeless ? ` · ${c.homeless} homeless` : ''}`, 'tip-big'),
    tipSep(),
    tipRow('Children', String(ch)), tipRow('Youths', String(yo)), tipRow('Adults', String(ad)), tipRow('Elders', String(el)),
    tipSep(),
    tipRow('Able to work', String(c.workforce)), tipRow('Idle hands', String(c.idle.length), c.idle.length ? 'neg' : ''),
    tipRow("Rome's roll", `${c.pop} / ${c.roll}`, c.pop >= c.roll ? 'neg' : ''),
    tipNote(c.pop >= c.roll ? "The roll is full: petition Rome for a higher rank to admit new colonists."
      : c.freeBeds < 2 ? 'No free beds: newcomers turn back at the gate. Raise house plots.' : 'Families settle where beds are free.'),
  );
}

/** Spirits tooltip: every morale term signed, and where it is heading. */
export function moraleTip(g: Game): Node {
  const s = g.state;
  const t = moraleTarget(s, view(s));
  const m = s.morale;
  const dir = t.value > m + 0.5 ? `rising toward ${Math.round(t.value)}` : t.value < m - 0.5 ? `falling toward ${Math.round(t.value)}` : 'steady';
  return tipCard(
    tipHead('Spirits', 'Laetitia'),
    tipNote(`${Math.round(m)} of 100 · ${dir}`, 'tip-big'),
    t.terms.length ? tipSep() : null,
    ...t.terms.map((x) => tipRow(x.label, `${x.value >= 0 ? '+' : '−'}${fmt(Math.abs(x.value))}`, x.value > 0 ? 'pos' : x.value < 0 ? 'neg' : '')),
    tipNote('Below 25 families begin to leave; above 55 the colony is stable.'),
  );
}

/** Dignitas tooltip: groups and the next threshold. */
export function dignitasTip(g: Game): Node {
  const s = g.state;
  const d = dignitas(s);
  const next = RANK_DEFS[s.rank + 1];
  const gr = d.groups;
  return tipCard(
    tipHead('Dignitas', 'the colony’s standing'),
    tipNote(`${Math.round(d.value)}${next ? ` · ${next.name} needs ${next.dignitas}` : ''}`, 'tip-big'),
    tipSep(),
    tipRow('Public works', fmt(gr.works)), tipRow('Homes', fmt(gr.homes)), tipRow('Paved roads', fmt(gr.roads)),
    tipRow('Res gestae', fmt(gr.deeds)), tipRow('Fama', fmt(gr.fama)),
    tipNote('A rating, never spent: temples, the forum, fine homes and deeds raise it.'),
  );
}

/** Date tooltip: long Roman date, modern date, season day, next crunch, next edict window, next festival. */
export function dateTip(g: Game): Node {
  const d = g.state.day;
  const se = seasonOf(d);
  const hiems = se === 3 ? 0 : nextSeasonStart(d, 3) - d;
  const aestas = se === 1 ? 0 : nextSeasonStart(d, 1) - d;
  const win = nextEdictWindow(g);
  const fest = nextFestival(d);
  return tipCard(
    tipHead(formatRomanLong(d), `AUC ${toRoman(aucYear(d))}`),
    tipNote(formatModern(d), 'tip-big'),
    tipSep(),
    tipRow(`${SEASON_NAMES[se]}`, `day ${seasonDay(d)} of ${seasonLength(d)}`),
    tipRow('Aestas, the thirsty season', aestas === 0 ? 'now' : `in ${aestas} days`),
    tipRow('Hiems, the hungry season', hiems === 0 ? 'now' : `in ${hiems} days`),
    tipRow('Next edict window', `${formatRoman(win)} (${win - d} d)`),
    fest ? tipRow(`Next festival: ${fest.name}`, `${formatRoman(fest.day)}`) : null,
    tipNote(`One day passes each second at 1×. ${caps('Kalendae')}: taxes reach the aerarium.`),
  );
}

function nextEdictWindow(g: Game): number {
  let best = nextSeasonStart(g.state.day);
  for (const id of EDICTS) {
    const w = edictWindow(g.state, id);
    if (!w.open) best = Math.min(best, w.next);
  }
  return best;
}

function nextFestival(day: number): { name: string; day: number } | null {
  const y = dateOf(day).year;
  let best: { name: string; day: number } | null = null;
  for (const yy of [y, y + 1]) for (const [name, m, dd] of FESTIVAL_DATES) {
    const at = dayOf(yy, m, dd);
    if (at > day && (!best || at < best.day)) best = { name, day: at };
  }
  return best;
}

/** Fraction of the current season elapsed (0..1), for the 3 px season bar. */
export function seasonFrac(day: number): number {
  return Math.max(0, Math.min(1, (seasonDay(day) - 1) / Math.max(1, seasonLength(day))));
}

/** Resources other than coin, grain and water, in registry order (the HUD strip). */
export const STRIP_RES: readonly ResId[] = RESOURCES.filter((r) => r !== 'denarii' && r !== 'grain' && r !== 'water');

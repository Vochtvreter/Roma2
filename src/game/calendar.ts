// src/game/calendar.ts — the proleptic Julian calendar with Roman dates and seasons (ARCHITECTURE §6, DESIGN §2.2).
// Port of rome's state/calendar.ts with one fix: inclusive counting before the Ides (a.d. {Ides − d + 1}).
// day 0 = Kalendae Ianuariae AUC DCCC (1 January AD 47); the game starts on day 90 = Kal. Apr.
import { B } from './balance';
import type { SeasonIndex } from './types';

/** A calendar date: AUC year, month 1..12, day of month 1..31. */
export interface RomanDate { year: number; month: number; day: number }

const EPOCH_YEAR = 800;
const AD_OFFSET = 753;                                  // AD = AUC − 753
const MONTH_LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const LONG_MONTHS = [3, 5, 7, 10] as const;             // Nones on the 7th, Ides on the 15th
const SEASON_START_MONTH = [3, 6, 9, 12] as const;      // Kal. Mart. / Iun. / Sept. / Dec.

/** Short month abbreviations, Ianuarius first. */
export const MONTH_ABBR = ['Ian.', 'Feb.', 'Mart.', 'Apr.', 'Mai.', 'Iun.', 'Iul.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'] as const;
/** Latin season names by SeasonIndex. */
export const SEASON_NAMES = ['Ver', 'Aestas', 'Autumnus', 'Hiems'] as const;
/** English month names for the modern date. */
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

// rome's tables: nominative/genitive after Kalendae/Nonae, ablative after Idibus.
const KAL_GEN = ['Ianuariae', 'Februariae', 'Martiae', 'Apriles', 'Maii', 'Iunii', 'Iulii', 'Augusti', 'Septembres', 'Octobris', 'Novembris', 'Decembris'] as const;
const IDES_ABL = ['Ianuariis', 'Februariis', 'Martiis', 'Aprilibus', 'Maiis', 'Iuniis', 'Iuliis', 'Augustis', 'Septembribus', 'Octobribus', 'Novembribus', 'Decembribus'] as const;
// accusative plural adjectives after ante diem … Kalendas/Nonas/Idus.
const MONTH_ACC = ['Ianuarias', 'Februarias', 'Martias', 'Apriles', 'Maias', 'Iunias', 'Iulias', 'Augustas', 'Septembres', 'Octobres', 'Novembres', 'Decembres'] as const;
// ordinals (accusative) for ante diem III … XIX.
const ORDINALS: Record<number, string> = {
  3: 'tertium', 4: 'quartum', 5: 'quintum', 6: 'sextum', 7: 'septimum', 8: 'octavum', 9: 'nonum', 10: 'decimum',
  11: 'undecimum', 12: 'duodecimum', 13: 'tertium decimum', 14: 'quartum decimum', 15: 'quintum decimum',
  16: 'sextum decimum', 17: 'septimum decimum', 18: 'duodevicesimum', 19: 'undevicesimum',
};

const ROMAN_ONES = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'] as const;
const ROMAN_TENS = ['', 'X', 'XX', 'XXX', 'XL', 'L', 'LX', 'LXX', 'LXXX', 'XC'] as const;
const ROMAN_HUNDREDS = ['', 'C', 'CC', 'CCC', 'CD', 'D', 'DC', 'DCC', 'DCCC', 'CM'] as const;

/** Proleptic Julian leap year for the AD year aligned with this AUC year (AUC 801 = AD 48 is leap). */
export function isLeapAuc(y: number): boolean {
  const ad = y - AD_OFFSET;
  return ad > 0 && ad % 4 === 0;
}

/** Days in a month (1..12) of an AUC year. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapAuc(year)) return 29;
  return MONTH_LEN[month - 1];
}

function yearLength(y: number): number {
  return isLeapAuc(y) ? 366 : 365;
}

// Memoised start day of each year from AUC 800 on: yearStarts[k] = day of Kal. Ian. AUC 800 + k.
const yearStarts: number[] = [0];

function ensureYears(day: number): void {
  let last = yearStarts.length - 1;
  while (yearStarts[last] + yearLength(EPOCH_YEAR + last) <= day) {
    yearStarts.push(yearStarts[last] + yearLength(EPOCH_YEAR + last));
    last++;
  }
}

/** Absolute day of Kal. Ian. of an AUC year. */
function yearStartOf(year: number): number {
  if (year >= EPOCH_YEAR) {
    const k = year - EPOCH_YEAR;
    while (yearStarts.length <= k) ensureYears(yearStarts[yearStarts.length - 1] + 366);
    return yearStarts[k];
  }
  let start = 0;
  for (let y = EPOCH_YEAR - 1; y >= year; y--) start -= yearLength(y);
  return start;
}

/** Calendar date of an absolute game day (walks whole years, then months). */
export function dateOf(day: number): RomanDate {
  const d = Math.floor(day);
  let year: number;
  let start: number;
  if (d >= 0) {
    ensureYears(d);
    let k = Math.min(yearStarts.length - 1, Math.floor(d / 365.25));
    while (k > 0 && yearStarts[k] > d) k--;
    while (k + 1 < yearStarts.length && yearStarts[k + 1] <= d) k++;
    year = EPOCH_YEAR + k;
    start = yearStarts[k];
  } else {
    year = EPOCH_YEAR;
    start = 0;
    while (d < start) {
      year--;
      start -= yearLength(year);
    }
  }
  let rest = d - start;
  let month = 1;
  while (rest >= daysInMonth(year, month)) {
    rest -= daysInMonth(year, month);
    month++;
  }
  return { year, month, day: rest + 1 };
}

/** Absolute game day of a calendar date (inverse of dateOf). */
export function dayOf(year: number, month: number, day: number): number {
  let d = yearStartOf(year);
  for (let m = 1; m < month; m++) d += daysInMonth(year, m);
  return d + day - 1;
}

/** AUC year of a game day. */
export function aucYear(day: number): number {
  return dateOf(day).year;
}

/** Days elapsed since the founding (day − START_DAY). */
export function elapsed(s: { day: number }): number {
  return s.day - B.time.START_DAY;
}

/** Nones of a month (7 in March, May, July, October; otherwise 5). */
export function nonesOf(month: number): number {
  return (LONG_MONTHS as readonly number[]).includes(month) ? 7 : 5;
}

/** Ides of a month (15 in March, May, July, October; otherwise 13). */
export function idesOf(month: number): number {
  return (LONG_MONTHS as readonly number[]).includes(month) ? 15 : 13;
}

function seasonOfMonth(month: number): SeasonIndex {
  if (month >= 3 && month <= 5) return 0;
  if (month >= 6 && month <= 8) return 1;
  if (month >= 9 && month <= 11) return 2;
  return 3;
}

/** Season of a game day: Mar–May Ver, Jun–Aug Aestas, Sep–Nov Autumnus, Dec–Feb Hiems. */
export function seasonOf(day: number): SeasonIndex {
  return seasonOfMonth(dateOf(day).month);
}

/** True on the first day of a month. */
export function isKalends(day: number): boolean {
  return dateOf(day).day === 1;
}

/** Absolute day of the next Kal. Mart./Iun./Sept./Dec. strictly after `day` (of that season if given). */
export function nextSeasonStart(day: number, season?: SeasonIndex): number {
  const dt = dateOf(day);
  let year = dt.year;
  let month = dt.month;
  for (let i = 0; i < 13; i++) {
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
    const k = (SEASON_START_MONTH as readonly number[]).indexOf(month);
    if (k >= 0 && (season === undefined || k === season)) return dayOf(year, month, 1);
  }
  return dayOf(year, month, 1);
}

/** Absolute day on which the season containing `day` began. */
export function seasonStartOf(day: number): number {
  const dt = dateOf(day);
  const s = seasonOfMonth(dt.month);
  const startMonth = SEASON_START_MONTH[s];
  const year = dt.month < startMonth ? dt.year - 1 : dt.year;    // Ian./Feb. belong to the Hiems begun last December
  return dayOf(year, startMonth, 1);
}

/** 1-based day within the current season (2 April = Ver, day 33). */
export function seasonDay(day: number): number {
  return Math.floor(day) - seasonStartOf(day) + 1;
}

/** Length in days of the season containing `day` (89–92). */
export function seasonLength(day: number): number {
  const start = seasonStartOf(day);
  return nextSeasonStart(start) - start;
}

/** Roman numeral (1..3999); other values as plain digits. */
export function toRoman(n: number): string {
  const v = Math.floor(n);
  if (v <= 0 || v >= 4000) return String(v);
  return 'M'.repeat(Math.floor(v / 1000)) + ROMAN_HUNDREDS[Math.floor((v % 1000) / 100)] +
    ROMAN_TENS[Math.floor((v % 100) / 10)] + ROMAN_ONES[v % 10];
}

/** 'AUC DCCC' for an AUC year. */
export function formatAuc(year: number): string {
  return `AUC ${toRoman(year)}`;
}

function withYear(text: string, year: number, opts?: { year?: boolean }): string {
  return opts?.year ? `${text} ${formatAuc(year)}` : text;
}

/** Short Roman date: 'Kal. Apr.', 'a.d. IV Non. Apr.', 'pridie Id. Apr.', 'a.d. XVII Kal. Mai.'; `{year: true}` appends ' AUC DCCC'. */
export function formatRoman(day: number, opts?: { year?: boolean }): string {
  const { year, month, day: d } = dateOf(day);
  const m = MONTH_ABBR[month - 1];
  const next = MONTH_ABBR[month % 12];
  const nones = nonesOf(month);
  const ides = idesOf(month);
  const len = daysInMonth(year, month);
  let text: string;
  if (d === 1) text = `Kal. ${m}`;
  else if (d === nones) text = `Non. ${m}`;
  else if (d === ides) text = `Id. ${m}`;
  else if (d === nones - 1) text = `pridie Non. ${m}`;
  else if (d === ides - 1) text = `pridie Id. ${m}`;
  else if (d === len) text = `pridie Kal. ${next}`;
  else if (d < nones) text = `a.d. ${toRoman(nones - d + 1)} Non. ${m}`;
  else if (d < ides) text = `a.d. ${toRoman(ides - d + 1)} Id. ${m}`;
  else text = `a.d. ${toRoman(len - d + 2)} Kal. ${next}`;
  return withYear(text, year, opts);
}

/** 'Kalendae Apriles', 'Nonae Apriles', 'Idibus Aprilibus' on the three named days, else the short form. */
export function formatRomanFull(day: number, opts?: { year?: boolean }): string {
  const { year, month, day: d } = dateOf(day);
  const i = month - 1;
  if (d === 1) return withYear(`Kalendae ${KAL_GEN[i]}`, year, opts);
  if (d === nonesOf(month)) return withYear(`Nonae ${KAL_GEN[i]}`, year, opts);
  if (d === idesOf(month)) return withYear(`Idibus ${IDES_ABL[i]}`, year, opts);
  return formatRoman(day, opts);
}

/** Spelled-out date: 'ante diem quartum Nonas Apriles', 'pridie Idus Apriles'; named days as formatRomanFull. */
export function formatRomanLong(day: number, opts?: { year?: boolean }): string {
  const { year, month, day: d } = dateOf(day);
  const i = month - 1;
  const nones = nonesOf(month);
  const ides = idesOf(month);
  const len = daysInMonth(year, month);
  const nextAcc = MONTH_ACC[month % 12];
  const acc = MONTH_ACC[i];
  if (d === 1 || d === nones || d === ides) return formatRomanFull(day, opts);
  let text: string;
  if (d === nones - 1) text = `pridie Nonas ${acc}`;
  else if (d === ides - 1) text = `pridie Idus ${acc}`;
  else if (d === len) text = `pridie Kalendas ${nextAcc}`;
  else if (d < nones) text = `ante diem ${ordinal(nones - d + 1)} Nonas ${acc}`;
  else if (d < ides) text = `ante diem ${ordinal(ides - d + 1)} Idus ${acc}`;
  else text = `ante diem ${ordinal(len - d + 2)} Kalendas ${nextAcc}`;
  return withYear(text, year, opts);
}

function ordinal(n: number): string {
  return ORDINALS[n] ?? toRoman(n);
}

/** Modern date: '2 April AD 47'. */
export function formatModern(day: number): string {
  const { year, month, day: d } = dateOf(day);
  const ad = year - AD_OFFSET;
  const era = ad > 0 ? `AD ${ad}` : `${1 - ad} BC`;
  return `${d} ${MONTH_NAMES[month - 1]} ${era}`;
}

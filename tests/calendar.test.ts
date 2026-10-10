// tests/calendar.test.ts — ARCHITECTURE §6 dates, leap years, seasons, Kalends.
import { describe, expect, it } from 'vitest';
import {
  aucYear, dateOf, dayOf, daysInMonth, elapsed, formatModern, formatRoman, formatRomanFull, formatRomanLong,
  idesOf, isKalends, isLeapAuc, nextSeasonStart, nonesOf, seasonDay, seasonLength, seasonOf, seasonStartOf, toRoman,
} from '../src/game/calendar';

describe('calendar: day numbering', () => {
  it('day 0 is Kal. Ian. AUC DCCC and day 90 is Kal. Apr.', () => {
    expect(dateOf(0)).toEqual({ year: 800, month: 1, day: 1 });
    expect(dateOf(90)).toEqual({ year: 800, month: 4, day: 1 });
    expect(formatRoman(0)).toBe('Kal. Ian.');
    expect(formatRoman(90)).toBe('Kal. Apr.');
    expect(formatRoman(90, { year: true })).toBe('Kal. Apr. AUC DCCC');
  });

  it('matches the §6 fixed dates', () => {
    expect(formatRoman(151)).toBe('Kal. Iun.');
    expect(formatRoman(334)).toBe('Kal. Dec.');
    expect(formatRoman(425)).toBe('Kal. Mart.');
    expect(aucYear(425)).toBe(801);
    expect(formatRoman(425, { year: true })).toBe('Kal. Mart. AUC DCCCI');
  });

  it('counts inclusively before the Nones and the Ides (2 Apr = a.d. IV Non., 11 Apr = a.d. III Id.)', () => {
    // §6 lists these one day late (92/101/102); the real dates are 2, 11 and 12 April = days 91, 100, 101.
    expect(formatRoman(91)).toBe('a.d. IV Non. Apr.');
    expect(formatRoman(92)).toBe('a.d. III Non. Apr.');
    expect(formatRoman(93)).toBe('pridie Non. Apr.');
    expect(formatRoman(94)).toBe('Non. Apr.');
    expect(formatRoman(95)).toBe('a.d. VIII Id. Apr.');
    expect(formatRoman(100)).toBe('a.d. III Id. Apr.');
    expect(formatRoman(101)).toBe('pridie Id. Apr.');
    expect(formatRoman(102)).toBe('Id. Apr.');
    expect(formatRoman(103)).toBe('a.d. XVIII Kal. Mai.');
    expect(formatRoman(104)).toBe('a.d. XVII Kal. Mai.');
    expect(formatRoman(118)).toBe('a.d. III Kal. Mai.');
    expect(formatRoman(119)).toBe('pridie Kal. Mai.');
    expect(formatRoman(120)).toBe('Kal. Mai.');
  });

  it('puts Nones on the 7th and Ides on the 15th in March, May, July and October', () => {
    expect([3, 5, 7, 10].map(nonesOf)).toEqual([7, 7, 7, 7]);
    expect([3, 5, 7, 10].map(idesOf)).toEqual([15, 15, 15, 15]);
    expect([1, 2, 4, 6, 8, 9, 11, 12].map(nonesOf)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect([1, 2, 4, 6, 8, 9, 11, 12].map(idesOf)).toEqual([13, 13, 13, 13, 13, 13, 13, 13]);
    expect(formatRoman(dayOf(800, 3, 15))).toBe('Id. Mart.');
    expect(formatRoman(dayOf(800, 3, 7))).toBe('Non. Mart.');
    expect(formatRoman(dayOf(800, 3, 2))).toBe('a.d. VI Non. Mart.');
    expect(formatRoman(dayOf(800, 12, 31))).toBe('pridie Kal. Ian.');
    expect(formatRoman(dayOf(800, 1, 14))).toBe('a.d. XIX Kal. Feb.');
  });

  it('formats the full, long and modern forms', () => {
    expect(formatRomanFull(90)).toBe('Kalendae Apriles');
    expect(formatRomanFull(94)).toBe('Nonae Apriles');
    expect(formatRomanFull(102)).toBe('Idibus Aprilibus');
    expect(formatRomanFull(91)).toBe('a.d. IV Non. Apr.');
    expect(formatRomanLong(91)).toBe('ante diem quartum Nonas Apriles');
    expect(formatRomanLong(101)).toBe('pridie Idus Apriles');
    expect(formatRomanLong(119)).toBe('pridie Kalendas Maias');
    expect(formatRomanLong(104)).toBe('ante diem septimum decimum Kalendas Maias');
    expect(formatModern(91)).toBe('2 April AD 47');
    expect(formatModern(425)).toBe('1 March AD 48');
  });
});

describe('calendar: leap years', () => {
  it('uses the proleptic Julian rule AD = AUC − 753', () => {
    expect(isLeapAuc(800)).toBe(false);
    expect(isLeapAuc(801)).toBe(true);
    expect(isLeapAuc(805)).toBe(true);
    expect(isLeapAuc(806)).toBe(false);
    expect(isLeapAuc(753)).toBe(false);
    expect(daysInMonth(800, 2)).toBe(28);
    expect(daysInMonth(801, 2)).toBe(29);
    expect(formatRoman(dayOf(801, 2, 29))).toBe('pridie Kal. Mart.');
  });

  it('has 366-day years only when leap', () => {
    for (let y = 800; y < 860; y++) {
      expect(dayOf(y + 1, 1, 1) - dayOf(y, 1, 1)).toBe(isLeapAuc(y) ? 366 : 365);
    }
  });

  it('round-trips dateOf ↔ dayOf and advances one day at a time', () => {
    let prev = dateOf(0);
    for (let d = 1; d < 20000; d++) {
      const cur = dateOf(d);
      expect(dayOf(cur.year, cur.month, cur.day)).toBe(d);
      if (cur.day === 1) {
        expect(prev.day).toBe(daysInMonth(prev.year, prev.month));
        expect(cur.month === 1 ? cur.year === prev.year + 1 : cur.month === prev.month + 1).toBe(true);
      } else {
        expect(cur.day).toBe(prev.day + 1);
      }
      prev = cur;
    }
  });
});

describe('calendar: seasons and Kalends', () => {
  it('maps months to seasons', () => {
    expect(seasonOf(90)).toBe(0);    // April: Ver
    expect(seasonOf(151)).toBe(1);   // Kal. Iun.: Aestas
    expect(seasonOf(243)).toBe(2);   // Kal. Sept.: Autumnus
    expect(seasonOf(334)).toBe(3);   // Kal. Dec.: Hiems
    expect(seasonOf(365)).toBe(3);   // Ianuarius
    expect(seasonOf(424)).toBe(3);   // 29 Feb 801
    expect(seasonOf(425)).toBe(0);   // Kal. Mart. 801
  });

  it('finds the next season start strictly after a day', () => {
    expect(nextSeasonStart(90)).toBe(151);
    expect(nextSeasonStart(151)).toBe(243);
    expect(nextSeasonStart(90, 3)).toBe(334);
    expect(nextSeasonStart(90, 1)).toBe(151);
    expect(nextSeasonStart(334, 0)).toBe(425);
    expect(nextSeasonStart(425, 0)).toBe(dayOf(802, 3, 1));
    // DESIGN §2.2 key dates in elapsed days
    expect([151, 243, 334, 425].map((d) => elapsed({ day: d }))).toEqual([61, 153, 244, 335]);
  });

  it('knows the season start, day and length', () => {
    expect(seasonStartOf(91)).toBe(59);
    expect(seasonDay(91)).toBe(33);
    expect(seasonLength(91)).toBe(92);
    expect(seasonStartOf(400)).toBe(334);                 // Feb 801 belongs to the Hiems begun Kal. Dec. 800
    expect(seasonLength(400)).toBe(91);                   // Dec 31 + Ian 31 + Feb 29
    expect(seasonLength(dayOf(801, 12, 5))).toBe(90);     // Dec 31 + Ian 31 + Feb 28 (AUC 802 is not leap)
  });

  it('flags the Kalends', () => {
    expect(isKalends(90)).toBe(true);
    expect(isKalends(91)).toBe(false);
    let count = 0;
    for (let d = 0; d < 365; d++) if (isKalends(d)) count++;
    expect(count).toBe(12);
  });
});

describe('calendar: Roman numerals', () => {
  it('writes AUC years and day counts', () => {
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(19)).toBe('XIX');
    expect(toRoman(800)).toBe('DCCC');
    expect(toRoman(801)).toBe('DCCCI');
    expect(toRoman(839)).toBe('DCCCXXXIX');
    expect(toRoman(1999)).toBe('MCMXCIX');
    expect(toRoman(0)).toBe('0');
  });
});

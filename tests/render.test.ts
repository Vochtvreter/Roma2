// tests/render.test.ts — render-side decisions that are plain functions of the state (no canvas): the snow palette of a
// Hiems dura (REVIEW R49).
import { describe, expect, it } from 'vitest';
import { seasonOf } from '../src/game/calendar';
import { paletteOf } from '../src/render/terrain';
import { fresh } from './util';

/** The first day at or after `from` in season `k`. */
function dayIn(k: number, from: number): number {
  let d = from;
  while (seasonOf(d) !== k) d++;
  return d;
}

describe('render: terrain palette', () => {
  it('snows only while a Hiems dura holds', () => {
    const s = fresh(42);
    s.day = dayIn(3, s.day);
    expect(paletteOf(s)).toBe(3);
    s.modifiers.push({ id: 'frigus', label: 'Hiems dura', until: s.day + 30, fx: {}, benign: false, source: 'frigus' });
    expect(paletteOf(s)).toBe(4);
    s.day += 30;                                   // the modifier has run out
    expect(paletteOf(s)).toBe(seasonOf(s.day));
    expect(paletteOf(s)).not.toBe(4);
  });

  it('is the season itself outside Hiems, whatever the modifiers', () => {
    const s = fresh(42);
    s.day = dayIn(2, s.day);
    s.modifiers.push({ id: 'frigus', label: 'Hiems dura', until: s.day + 300, fx: {}, benign: false, source: 'frigus' });
    expect(paletteOf(s)).toBe(2);
  });
});

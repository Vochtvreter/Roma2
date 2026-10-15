// tests/letters.test.ts — the parchment letters can never close unread, and the Victory dispatch can be read again
// (DESIGN §9.5, §15.5, §15.8). A letter holds the focus on itself, so a reflex Space or Enter presses none of its buttons
// (modals.ts restingFocus); under any modal the game's keys, Space the pause key among them, do nothing (keys.ts
// keysToGame); the dedication day's figures are kept (stats.atVictory), so the letter the Annales reopen reads as it did.
// Headless: the pure decisions and the figures (the DOM wiring needs a browser).
import { describe, expect, it } from 'vitest';
import type { Building, GameState } from '../src/game/types';
import { assignJobs } from '../src/game/people';
import { constructionDay, startCapitolium } from '../src/game/construction';
import { deserialize, serialize } from '../src/game/save';
import { restingFocus } from '../src/ui/modals';
import { keysToGame } from '../src/ui/keys';
import { victoryFigures } from '../src/ui/dispatch';
import { ctx, fresh } from './util';

describe('where focus rests as a modal opens (restingFocus)', () => {
  const isX = (c: string): boolean => c === '✕';
  it('a parchment letter holds it on the dialog itself, never on a button that would close it', () => {
    expect(restingFocus(true, 'dialog', 'Keep governing', ['✕', 'Keep governing', 'Found a new colony'], isX)).toBe('dialog');
    expect(restingFocus(true, 'dialog', null, ['✕', 'Return to the city'], isX)).toBe('dialog');
    expect(restingFocus(true, 'dialog', null, ['Raise the standard'], isX)).toBe('dialog');
  });
  it('any other modal: its autofocus control, else its first control but ✕, else ✕, else the dialog', () => {
    expect(restingFocus(false, 'dialog', 'Keep governing', ['✕', 'Copy', 'Keep governing'], isX)).toBe('Keep governing');
    expect(restingFocus(false, 'dialog', null, ['✕', 'Resume', 'Save'], isX)).toBe('Resume');
    expect(restingFocus(false, 'dialog', null, ['✕'], isX)).toBe('✕');
    expect(restingFocus(false, 'dialog', null, [], isX)).toBe('dialog');
  });
});

describe('the game\'s keys under a modal (keysToGame)', () => {
  it('Space never pauses while a modal is open: the key is the focused control\'s', () => {
    expect(keysToGame('game', false, 0)).toBe(true);
    expect(keysToGame('game', false, 1)).toBe(false);
    expect(keysToGame('game', false, 2)).toBe(false);
  });
  it('nor in an input, on the title or during the catch-up', () => {
    expect(keysToGame('game', true, 0)).toBe(false);
    expect(keysToGame('title', false, 0)).toBe(false);
    expect(keysToGame('catchup', false, 0)).toBe(false);
  });
});

/** A colony whose Capitolium is finished by the next construction day. */
function dedicated(): GameState {
  const s = fresh();
  startCapitolium(s);
  const cap = s.buildings.find((b) => b.type === 'capitolium') as Building;
  for (const r of ['stone', 'concrete', 'tiles', 'iron', 'denarii'] as const) s.res[r] = 1e6;
  assignJobs(s, { perBuilding: {}, builders: 6, lines: [] });
  cap.progress = 1 - 1e-9;
  s.stats.playMs = 3 * 3_600_000;
  s.day++;
  constructionDay(s, ctx());
  expect(s.victory).toBe(true);
  return s;
}

describe('the Victory dispatch, read again (victoryFigures)', () => {
  it('the dedication keeps the day\'s figures, and the letter reads them', () => {
    const s = dedicated();
    const st = s.stats;
    expect(st.atVictory).toEqual({ pop: s.people.length, peakPop: Math.max(st.peakPop, s.people.length), births: st.births,
      immigrants: st.immigrants, built: st.built, evolved: st.evolved, playMs: 3 * 3_600_000 });
    const f = victoryFigures(s);
    expect(f.day).toBe(st.victoryDay);
    expect(f.pop).toBe(s.people.length);
    expect(f.built).toBe(st.built);
  });

  it('reads the same later, however the colony has grown since', () => {
    const s = dedicated();
    const then = victoryFigures(s);
    s.day += 400;
    s.stats.births += 120; s.stats.immigrants += 80; s.stats.built += 30; s.stats.evolved += 15; s.stats.peakPop += 200;
    s.stats.playMs += 2 * 3_600_000;
    s.people.pop();
    expect(victoryFigures(s)).toEqual(then);
  });

  it('a colony dedicated before the figures were kept reads its figures to date', () => {
    const s = dedicated();
    delete s.stats.atVictory;
    s.stats.births += 7;
    const f = victoryFigures(s);
    expect(f.births).toBe(s.stats.births);
    expect(f.pop).toBe(s.people.length);
    expect(f.day).toBe(s.stats.victoryDay);
  });

  it('the figures survive a save; a malformed set is dropped, and a colony not yet dedicated keeps none', () => {
    const s = dedicated();
    const back = deserialize(serialize(s)) as GameState;
    expect(back.stats.atVictory).toEqual(s.stats.atVictory);
    expect(victoryFigures(back)).toEqual(victoryFigures(s));

    const raw = JSON.parse(serialize(s)) as { stats: Record<string, unknown>; victory: boolean };
    raw.stats.atVictory = 'many souls';
    expect(deserialize(JSON.stringify(raw))?.stats.atVictory).toBeUndefined();
    raw.stats.atVictory = { pop: 900 };
    expect(deserialize(JSON.stringify(raw))?.stats.atVictory).toBeUndefined();
    raw.stats.atVictory = { ...s.stats.atVictory };
    raw.victory = false;
    expect(deserialize(JSON.stringify(raw))?.stats.atVictory).toBeUndefined();

    const before = fresh();   // a save from before the figures were kept: nothing to fill in
    expect(deserialize(serialize(before))?.stats.atVictory).toBeUndefined();
  });
});

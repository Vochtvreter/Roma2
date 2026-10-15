// tests/demolish.test.ts — the demolish tool on the map (render/demolish.ts, DESIGN §5.3, §15.8): a click arms a work and
// a second one pulls it down, never a double-click (CONFIRM_GUARD_MS) and never on a timer; a sweep's rectangle arms
// every work it touches and a click inside it confirms; the words over armed works say what the click would do; Esc and
// Back drop armed works before they end the tool. A press that never moved stays a click under a tool that owns drags.
// Armed works read what they would do again when the structure changes, while the colony runs at most every REARM_MS.
import { describe, expect, it } from 'vitest';
import type { DemolitionImpact } from '../src/game/demolition';
import { demolitionImpact } from '../src/game/demolition';
import { W, idx } from '../src/game/map';
import { derived } from '../src/game/derived';
import { CONFIRM_GUARD_MS, REARM_MS, covers, demolishTap, impactLines, rearmDue, sweepIds, sweepRect } from '../src/render/demolish';
import type { Doom } from '../src/render/demolish';
import { footprintOf } from '../src/game/derived';
import { BACK_RANK } from '../src/ui/history';
import { Input } from '../src/render/input';
import type { InputHandlers } from '../src/render/input';
import { fresh } from './util';

const NONE: DemolitionImpact = { ids: [], spared: [], homes: 0, people: 0, workers: 0, sites: 0, losing: [], refund: {}, frac: null };

function doom(ids: number[], at: number, rect: Doom['rect'] = null): Doom {
  return { ids, rect, at, touch: false, impact: { ...NONE, ids } };
}

describe('demolishTap: two clicks, no timer, no double-click', () => {
  it('arms a work, ignores a second click inside the guard, confirms after it at any later time', () => {
    expect(demolishTap(null, 7, 100, 0)).toBe('arm');
    const d = doom([7], 1000);
    expect(demolishTap(d, 7, 100, 1000 + CONFIRM_GUARD_MS - 1)).toBe('early');
    expect(demolishTap(d, 7, 100, 1000 + CONFIRM_GUARD_MS)).toBe('confirm');
    expect(demolishTap(d, 7, 100, 1000 + 600_000)).toBe('confirm');   // ten minutes later: still armed
  });

  it('a click on another work arms it instead; on bare ground it disarms', () => {
    const d = doom([7], 0);
    expect(demolishTap(d, 8, 100, 5000)).toBe('arm');
    expect(demolishTap(d, null, 100, 5000)).toBe('disarm');
  });

  it('inside an armed sweep any tile confirms, bare ground too; outside it disarms', () => {
    const rect = { x: 10, y: 10, w: 4, h: 3 };
    const d = doom([7, 9], 0, rect);
    expect(demolishTap(d, null, idx(12, 11), 5000)).toBe('confirm');
    expect(demolishTap(d, 9, idx(30, 30), 5000)).toBe('confirm');
    expect(demolishTap(d, null, idx(14, 11), 5000)).toBe('disarm');
    expect(covers(d, null, idx(13, 12))).toBe(true);
    expect(covers(d, null, idx(13, 13))).toBe(false);
    expect(covers({ ids: [7], rect: null }, null, idx(12, 11))).toBe(false);
  });
});

describe('rearmDue: armed works read again when the structure changes, not every frame', () => {
  it('while the colony runs, at most every REARM_MS; paused, or a work of theirs gone, at once', () => {
    expect(rearmDue(1000, 1000 + REARM_MS - 1, false, false)).toBe(false);   // the last impact stands
    expect(rearmDue(1000, 1000 + REARM_MS, false, false)).toBe(true);
    expect(rearmDue(1000, 1001, true, false)).toBe(true);                    // paused: only the player changed it
    expect(rearmDue(1000, 1001, false, true)).toBe(true);                    // the armed set lost a work
  });
});

describe('sweeps', () => {
  it('a rectangle from two corners in any order, both included', () => {
    expect(sweepRect(idx(5, 9), idx(2, 3))).toEqual({ x: 2, y: 3, w: 4, h: 7 });
    expect(sweepRect(idx(2, 3), idx(5, 9))).toEqual({ x: 2, y: 3, w: 4, h: 7 });
    expect(sweepRect(idx(4, 4), idx(4, 4))).toEqual({ x: 4, y: 4, w: 1, h: 1 });
  });

  it('takes every work its rectangle touches, once each', () => {
    const s = fresh(42);
    const homes = s.buildings.filter((b) => b.type === 'area' && b.house).slice(0, 2);
    const tiles = homes.flatMap((b) => footprintOf(b, s));
    const xs = tiles.map((t) => t % W), ys = tiles.map((t) => Math.floor(t / W));
    const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 };
    const ids = sweepIds(s, r);
    for (const b of homes) expect(ids).toContain(b.id);
    const at = derived(s).buildingAt;
    for (const id of ids) expect(footprintOf(s.buildings.find((b) => b.id === id)!, s).some((t) => at[t] === id)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('impactLines: what the second click would do, in words', () => {
  it("the playtest's example: homes and people, the homes that lose water, a quarter back", () => {
    const imp: DemolitionImpact = { ...NONE, ids: [1, 2, 3], homes: 2, people: 14, losing: [{ need: 'water', homes: 3 }], refund: { timber: 10 }, frac: 0.25 };
    expect(impactLines(imp, { touch: false })).toEqual([
      { text: 'Click again to demolish all 3', tone: 'bad' },
      { text: '2 homes, 14 people', tone: 'info' },
      { text: '3 homes lose water', tone: 'warn' },
      { text: '25% back: 10 timber', tone: 'info' },
    ]);
  });

  it('one work, a finger, workers, two needs, a mixed refund', () => {
    const imp: DemolitionImpact = {
      ...NONE, ids: [4], workers: 1, sites: 1, losing: [{ need: 'water', homes: 1 }, { need: 'religion', homes: 2 }], refund: { denarii: 3.75, timber: 0.4 }, frac: null,
    };
    expect(impactLines(imp, { touch: true }).map((l) => l.text)).toEqual([
      'Tap again to demolish', '1 worker out of work · 1 site abandoned', '1 home loses water · 2 homes lose a shrine', 'Back: 4 coin',
    ]);
  });

  it('a sweep being dragged counts its works; the principia alone cannot come down', () => {
    expect(impactLines({ ...NONE, ids: [1, 2], refund: {}, frac: 0 }, { touch: false, sweep: true }).map((l) => l.text))
      .toEqual(['2 works to pull down', 'Nothing comes back']);
    expect(impactLines({ ...NONE, spared: ['principia'] }, { touch: false })).toEqual([{ text: 'The Principia cannot be pulled down', tone: 'bad' }]);
    expect(impactLines(NONE, { touch: false, sweep: true })).toEqual([{ text: 'Nothing to pull down here', tone: 'bad' }]);
  });

  it('reads a real colony: the founders\' well', () => {
    const s = fresh(42);
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    const lines = impactLines(demolitionImpact(s, [well.id]), { touch: false }).map((l) => l.text);
    expect(lines[0]).toBe('Click again to demolish');
    expect(lines[lines.length - 1]).toMatch(/^25% back: /);
  });
});

describe('Esc and Back: armed works first, then the tool', () => {
  it('the armed works are a layer between the tray and placing', () => {
    expect(BACK_RANK.armed).toBeLessThan(BACK_RANK.tray);
    expect(BACK_RANK.armed).toBeGreaterThan(BACK_RANK.placing);
  });
});

describe('input: a tool that takes an unmoved press as a click', () => {
  type Listener = (e: unknown) => void;
  function setup(endOwns: boolean): { fire: (type: string, e: Record<string, unknown>) => void; taps: number[][]; phases: string[] } {
    const on = new Map<string, Listener[]>();
    const el = {
      style: {} as CSSStyleDeclaration,
      addEventListener: (t: string, f: Listener) => { on.set(t, [...(on.get(t) ?? []), f]); },
      removeEventListener: () => undefined,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setPointerCapture: () => undefined,
    } as unknown as HTMLElement;
    const taps: number[][] = [], phases: string[] = [];
    const nop = (): void => undefined;
    const h: InputHandlers = {
      hover: nop, leave: nop, pan: nop, fling: nop, zoom: nop, cancel: nop,
      tap: (x, y) => { taps.push([x, y]); },
      toolDrag: (phase) => { phases.push(phase); return phase === 'end' ? endOwns : true; },
    };
    new Input(el, h);
    const fire = (type: string, e: Record<string, unknown>): void => {
      for (const f of on.get(type) ?? []) f({ pointerType: 'mouse', button: 0, shiftKey: false, timeStamp: 0, preventDefault: () => undefined, ...e });
    };
    return { fire, taps, phases };
  }

  it('an unmoved press taps when the tool hands it back at its end', () => {
    const { fire, taps, phases } = setup(false);
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    fire('pointerup', { pointerId: 1, clientX: 100, clientY: 100, timeStamp: 80 });
    expect(phases).toEqual(['start', 'end']);
    expect(taps).toEqual([[100, 100]]);
  });

  it('a dragged press never taps; a road drag (which owns its end) never taps either', () => {
    const a = setup(false);
    a.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    a.fire('pointermove', { pointerId: 1, clientX: 140, clientY: 100, timeStamp: 16 });
    a.fire('pointerup', { pointerId: 1, clientX: 140, clientY: 100, timeStamp: 32 });
    expect(a.phases).toEqual(['start', 'move', 'end']);
    expect(a.taps).toEqual([]);
    const b = setup(true);
    b.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    b.fire('pointerup', { pointerId: 1, clientX: 100, clientY: 100, timeStamp: 80 });
    expect(b.taps).toEqual([]);
  });
});

// tests/steady.test.ts — a widget held still under the mouse (steady.ts PointerHold) and the Res Gestae's rebuild policy
// (objective.ts goalsWait): a mouse the widget was rebuilt or shrank out from under, which hears no pointerleave, holds it
// a few seconds at most, and a new goal never waits on a resting mouse (playtest: the goals panel froze for thousands of
// days on a finished goal, hiding the petition's CTA). Headless: fake elements and a fake window carry the events.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PointerHold } from '../src/ui/steady';
import { goalsWait } from '../src/ui/objective';
import { B } from '../src/game/balance';

type Listener = (e: unknown) => void;

/** Something events are fired at: listeners by type, and a fire that calls them. */
function target(): { add: (t: string, f: Listener) => void; fire: (t: string, e: Record<string, unknown>) => void } {
  const on = new Map<string, Listener[]>();
  return {
    add: (t, f) => { on.set(t, [...(on.get(t) ?? []), f]); },
    fire: (t, e) => { for (const f of on.get(t) ?? []) f(e); },
  };
}

let clock = 0;
let win: ReturnType<typeof target>;

/** A widget with a child under the mouse, and a PointerHold on it. */
function widget(): { hold: PointerHold; child: object; fire: (t: string, e?: Record<string, unknown>) => void } {
  const t = target();
  const child = {};
  const el = { addEventListener: t.add, contains: (n: unknown) => n === el || n === child } as unknown as HTMLElement;
  return { hold: new PointerHold(el), child, fire: (type, e = {}) => t.fire(type, { pointerId: 1, pointerType: 'mouse', ...e }) };
}

/** A pointer move at `at` ms, heard by the window (as the browser's own move is, wherever it lands). */
function move(at: number, over: object, pointerType = 'mouse'): void {
  clock = at;
  win.fire('pointermove', { target: over, pointerType, pointerId: 1 });
}

/** A click in a widget: pressed at `at`, let go 50 ms later. */
function click(w: ReturnType<typeof widget>, at: number, pointerId = 1): void {
  clock = at;
  w.fire('pointerdown', { pointerId });
  clock = at + 50;
  win.fire('pointerup', { pointerId });
}

const elsewhere = {};   // the map, the HUD: anything outside the widget

beforeEach(() => {
  clock = 0;
  win = target();
  vi.stubGlobal('window', { addEventListener: win.add });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PointerHold (steady.ts)', () => {
  it('holds while the mouse rests on the widget, and lets the answer to a click through', () => {
    const w = widget();
    expect(w.hold.holds(0)).toBe(false);
    move(0, w.child);
    expect(w.hold.holds(100)).toBe(true);
    click(w, 1000);
    expect(w.hold.holds(1000 + B.ui.CLICK_GUARD_MS - 1)).toBe(true);   // never under the press itself
    expect(w.hold.busy(1000 + B.ui.CLICK_GUARD_MS - 1)).toBe(true);
    expect(w.hold.holds(1000 + B.ui.CLICK_GUARD_MS + 1)).toBe(false);  // the click's own consequence shows at once
    expect(w.hold.busy(1000 + B.ui.CLICK_GUARD_MS + 1)).toBe(false);
  });

  it('lets go when the mouse is seen anywhere else, though no pointerleave came (the node under it was removed)', () => {
    const w = widget();
    move(0, w.child);
    expect(w.hold.holds(10)).toBe(true);
    move(20, elsewhere);
    expect(w.hold.holds(30)).toBe(false);
    move(40, w.child);
    expect(w.hold.holds(50)).toBe(true);
    clock = 60;
    w.fire('pointerleave');
    expect(w.hold.holds(70)).toBe(false);
  });

  it('holds a few seconds at most after the mouse last moved over it; a move or a wheel there holds it again', () => {
    const w = widget();
    move(0, w.child);
    expect(w.hold.holds(3000)).toBe(true);
    expect(w.hold.holds(10_000)).toBe(false);
    move(10_000, w.child);
    expect(w.hold.holds(13_000)).toBe(true);
    clock = 20_000;
    w.fire('wheel');
    expect(w.hold.holds(23_000)).toBe(true);
    expect(w.hold.holds(30_000)).toBe(false);
  });

  it('never holds for a finger resting on it, but always while a press made in it is held, until its let-go', () => {
    const w = widget();
    move(0, w.child, 'touch');
    expect(w.hold.holds(100)).toBe(false);
    clock = 1000;
    w.fire('pointerdown', { pointerId: 7, pointerType: 'touch' });
    expect(w.hold.holds(8000)).toBe(true);   // a ± held down and repeating: no rest ends it
    expect(w.hold.busy(8000)).toBe(true);
    clock = 9000;
    win.fire('pointerup', { pointerId: 7 });
    expect(w.hold.busy(9000 + B.ui.CLICK_GUARD_MS - 1)).toBe(true);
    expect(w.hold.holds(9000 + B.ui.CLICK_GUARD_MS + 1)).toBe(false);
  });
});

describe('goalsWait (objective.ts: the Res Gestae rebuild policy)', () => {
  it('a mouse resting on the panel or the counsel card holds back new chips or a CTA, never a new goal', () => {
    const panel = widget();
    const counsel = widget();
    expect(goalsWait(false, panel.hold, counsel.hold)).toBe(false);
    move(0, panel.child);
    expect(goalsWait(false, panel.hold, counsel.hold)).toBe(true);
    expect(goalsWait(true, panel.hold, counsel.hold)).toBe(false);
    move(100, counsel.child);
    expect(goalsWait(false, panel.hold, counsel.hold)).toBe(true);
    expect(goalsWait(true, panel.hold, counsel.hold)).toBe(false);
    expect(goalsWait(true, panel.hold, null)).toBe(false);
  });

  it('a press or click under way in either holds even a new goal, so the button being pressed never moves', () => {
    const panel = widget();
    const counsel = widget();
    click(counsel, 0);
    expect(goalsWait(true, panel.hold, counsel.hold)).toBe(true);
    clock = B.ui.CLICK_GUARD_MS + 1;
    expect(goalsWait(true, panel.hold, counsel.hold)).toBe(false);
    click(panel, 1000);
    expect(goalsWait(true, panel.hold, counsel.hold)).toBe(true);
    clock = 1000 + B.ui.CLICK_GUARD_MS + 1;
    expect(goalsWait(true, panel.hold, counsel.hold)).toBe(false);
  });

  it('a counsel card clicked and folded out from under a still mouse holds the panel a few seconds at most', () => {
    const panel = widget();
    const counsel = widget();
    move(0, counsel.child);
    click(counsel, 500);   // the card folds; the mouse, still, is over the map now, and no pointerleave comes
    clock = 3000;          // past the click's release the resting mouse holds again …
    expect(goalsWait(false, panel.hold, counsel.hold)).toBe(true);
    clock = 10_000;        // … but not for good
    expect(goalsWait(false, panel.hold, counsel.hold)).toBe(false);
    move(10_000, counsel.child);
    move(10_100, elsewhere);   // and the first move over the map ends it at once
    expect(goalsWait(false, panel.hold, counsel.hold)).toBe(false);
  });
});

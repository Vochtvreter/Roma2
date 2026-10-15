// tests/confirm.test.ts — confirms that are no timing puzzle (DESIGN §15.5): a permanent choice is asked by name in a
// dialog with no timeout (edicta.ts pathAsk for the charter and the paths), and a two-step confirm ignores a second
// press that comes as the other half of a double-click (modals.ts confirmPress), the lessons' Skip among them
// (counsel.ts skipLessonsLink); one armed out of sight takes no Esc and holds nothing (anyArmed), and one in sight holds
// the Res Gestae still with the counsel card (armedOr). Headless: the pure helpers, and confirm2 on fake buttons (a fake
// document and window carry the events and the drain's timer; the dialog needs a browser).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATH_DECISIONS } from '../src/game/types';
import type { ActionResult } from '../src/game/types';
import type { Game } from '../src/ui/types';
import { B } from '../src/game/balance';
import { PATH_DEFS } from '../src/game/data/decisions';
import { RANK_DEFS } from '../src/game/data/ranks';
import { anyArmed, armedOr, confirm2, confirmPress } from '../src/ui/modals';
import { skipLessonsLink } from '../src/ui/counsel';
import { goalsWait } from '../src/ui/objective';
import { pathAsk } from '../src/ui/tabs/edicta';
import { fresh } from './util';

describe('confirmPress', () => {
  it('arms on the first press, waits through a double-click, runs on a deliberate second press', () => {
    expect(confirmPress(null, 5_000)).toBe('arm');
    expect(confirmPress(5_000, 5_000)).toBe('wait');
    expect(confirmPress(5_000, 5_000 + B.ui.CONFIRM_MIN_MS - 1)).toBe('wait');
    expect(confirmPress(5_000, 5_000 + B.ui.CONFIRM_MIN_MS)).toBe('run');
    expect(confirmPress(5_000, 5_000 + 60_000)).toBe('run');   // no timeout of its own: the button decides when it disarms
  });

  it('a double-click (well under half a second) never confirms; an armed button that drains gives far more than 3 s', () => {
    expect(B.ui.CONFIRM_MIN_MS).toBeGreaterThanOrEqual(400);
    expect(B.ui.CONFIRM_MIN_MS).toBeLessThan(1000);
    expect(B.ui.CONFIRM_MS).toBeGreaterThanOrEqual(8000);
  });
});

describe('pathAsk', () => {
  it('names every permanent choice, says what it does and what the town will show, and that it is for good', () => {
    for (const d of PATH_DECISIONS) {
      for (const o of PATH_DEFS[d].options) {
        const q = pathAsk(d, o.id, d === 'charter' ? null : { denarii: 900, stone: 250 });
        expect(q.title).toContain(o.name);
        expect(q.title.endsWith('?')).toBe(true);
        expect(q.lines).toContain(o.desc);
        if (o.visible) expect(q.lines).toContain(`You will see: ${o.visible}`);
        expect(q.lines[q.lines.length - 1]).toMatch(/^This is for good/);
        expect(q.lines.every((l) => l.length > 0)).toBe(true);
        expect(q.ok.length).toBeGreaterThan(0);
        expect(q.cancel).toBe('Not yet');
      }
    }
  });

  it('the charter is proclaimed, free; a path petitions Rome for its rank and names the fee', () => {
    const charter = pathAsk('charter', 'veterani', null);
    expect(charter.title).toBe('Proclaim Colonia veteranorum?');
    expect(charter.ok).toBe('Proclaim it');
    expect(charter.lines.some((l) => l.includes('fee'))).toBe(false);
    expect(charter.lines).toContain('This is for good: the charter is the first line of your story.');

    const path = pathAsk('path2', 'pietas', { denarii: 900, stone: 250 });
    expect(path.title).toBe(`Petition Rome for ${RANK_DEFS[2].name}: Pietas?`);
    expect(path.kicker).toBe('PETITIO · OPPIDVM');
    expect(path.ok).toBe('Petition Rome');
    expect(path.lines).toContain('Rome takes the fee: 900 den · 250 stone.');
  });
});

type Handler = (e: Record<string, unknown>) => void;

/** Something events are fired at (a button, the document, the window): listeners by type, added and removed. */
class Target {
  private readonly on = new Map<string, Handler[]>();
  addEventListener(t: string, f: Handler): void { this.on.set(t, [...(this.on.get(t) ?? []), f]); }
  removeEventListener(t: string, f: Handler): void { this.on.set(t, (this.on.get(t) ?? []).filter((x) => x !== f)); }
  fire(t: string, e: Record<string, unknown> = {}): void { for (const f of this.on.get(t) ?? []) f({ target: this, ...e }); }
}
class FakeNode extends Target {}
class FakeText extends FakeNode { constructor(readonly data: string) { super(); } }
/** A button as h() and confirm2 use it; `offsetParent` null: inside something display: none (a folded panel). */
class FakeButton extends FakeNode {
  textContent = '';
  className = '';
  isConnected = true;
  offsetParent: object | null = {};
  visibility = 'visible';
  readonly dataset: Record<string, string> = {};
  readonly style = { setProperty: (): void => undefined };
  private readonly cls = new Set<string>();
  readonly classList = {
    add: (...c: string[]): void => { for (const x of c) this.cls.add(x); },
    remove: (...c: string[]): void => { for (const x of c) this.cls.delete(x); },
    contains: (c: string): boolean => this.cls.has(c),
  };
  setAttribute(): void { /* type, aria-*: nothing a confirm reads */ }
  appendChild(n: FakeText): void { this.textContent += n.data; }
  contains(n: unknown): boolean { return n === this; }
}

let clock = 0;
let seq = 0;
let timers: { at: number; id: number; f: () => void }[] = [];
const made: FakeButton[] = [];
const doc = Object.assign(new Target(), {
  createElement: (): FakeButton => { const b = new FakeButton(); made.push(b); return b; },
  createTextNode: (t: string): FakeText => new FakeText(t),
});
const win = Object.assign(new Target(), {
  setTimeout: (f: () => void, ms: number): number => { timers.push({ at: clock + ms, id: ++seq, f }); return seq; },
  clearTimeout: (id: number): void => { timers = timers.filter((t) => t.id !== id); },
});

/** Wall time passes: the drain's timer runs when it is due. */
function wait(ms: number): void {
  clock += ms;
  for (const t of timers.filter((x) => x.at <= clock)) { timers = timers.filter((x) => x !== t); t.f(); }
}

/** A plain two-step confirm (a Cancel? on a works queue row), and how often it ran. */
function confirmButton(): { b: FakeButton; ran: () => number } {
  let n = 0;
  const b = doc.createElement();
  b.textContent = 'Cancel';
  confirm2(b as unknown as HTMLButtonElement, 'Cancel?', () => { n++; });
  return { b, ran: () => n };
}

/** Esc pressed: whether something took it (the armed confirm it disarmed), or it goes on to its usual job. */
function esc(): boolean {
  let taken = false;
  doc.fire('keydown', { key: 'Escape', preventDefault: () => { taken = true; } });
  return taken;
}

describe('two-step confirms on the page (confirm2, anyArmed, armedOr)', () => {
  beforeEach(() => {
    clock = 10_000;
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', win);
    vi.stubGlobal('Node', FakeNode);
    vi.stubGlobal('getComputedStyle', (b: FakeButton) => ({ visibility: b.visibility }));
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    for (const b of made) b.isConnected = false;   // off the page: no test's armed button holds the next one's
    made.length = 0;
    timers = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('Skip the lessons asks once more; the second half of a double-click skips nothing, a deliberate press skips them', () => {
    const acts: ActionResult[] = [];
    const g = { state: fresh(), act: (r: ActionResult) => { acts.push(r); return r; } } as unknown as Game;
    const link = skipLessonsLink(g) as unknown as FakeButton;
    expect(link.textContent).toBe('Skip the lessons');
    link.fire('click');
    expect(link.textContent).toBe('Skip every lesson?');
    expect(anyArmed()).toBe(true);                                       // the counsel card holds still meanwhile
    wait(B.ui.CONFIRM_MIN_MS - 1);
    link.fire('click');                                                  // a double-click's second half
    expect(acts).toHaveLength(0);
    expect(link.textContent).toBe('Skip every lesson?');
    wait(1);
    link.fire('click');
    expect(acts).toHaveLength(1);                                        // skipIntro: every lesson skipped
    expect(link.textContent).toBe('Skip the lessons');
    expect(anyArmed()).toBe(false);
  });

  it('a card built afresh asks again (the armed state is the link\'s own), and a tap\'s arming drains away', () => {
    const acts: ActionResult[] = [];
    const g = { state: fresh(), act: (r: ActionResult) => { acts.push(r); return r; } } as unknown as Game;
    const first = skipLessonsLink(g) as unknown as FakeButton;
    first.fire('click');                                                 // armed, no mouse on it: it drains
    first.isConnected = false;                                           // the card was built afresh
    const link = skipLessonsLink(g) as unknown as FakeButton;
    wait(B.ui.CONFIRM_MIN_MS);
    link.fire('click');
    expect(acts).toHaveLength(0);                                        // one press on the new link only asks
    expect(link.textContent).toBe('Skip every lesson?');
    wait(B.ui.CONFIRM_MS);
    expect(link.textContent).toBe('Skip the lessons');                   // drained: disarmed
    expect(anyArmed()).toBe(false);
  });

  it('one armed out of sight (its panel folded by C, its card hidden) takes no Esc and holds nothing', () => {
    const { b, ran } = confirmButton();
    b.fire('click');                                                     // armed by a key: it drains
    expect(anyArmed()).toBe(true);
    b.offsetParent = null;                                               // C: the panel's body is display: none
    expect(anyArmed()).toBe(false);
    expect(esc()).toBe(false);                                           // Esc does its usual job
    expect(b.dataset.armed).toBe('1');                                   // the confirm drains on, unseen
    b.offsetParent = {};                                                 // the panel is back within the 8 s
    expect(anyArmed()).toBe(true);
    expect(esc()).toBe(true);                                            // Esc disarms it before anything else
    expect(b.dataset.armed).toBe('');
    b.fire('click');
    b.visibility = 'hidden';                                             // a pinned card whose target was panned away
    expect(anyArmed()).toBe(false);
    expect(esc()).toBe(false);
    expect(ran()).toBe(0);
  });

  it('the Res Gestae waits while a confirm is armed, through a new goal too, and the counsel card\'s pointer still counts', () => {
    const idle = { holds: (): boolean => false, busy: (): boolean => false };
    const below = armedOr(idle);
    expect(goalsWait(true, idle, below)).toBe(false);
    const { b } = confirmButton();
    b.fire('click');
    expect(goalsWait(true, idle, below)).toBe(true);                     // its rebuild would move what stands under it
    expect(goalsWait(false, idle, below)).toBe(true);
    wait(B.ui.CONFIRM_MS);                                               // drained
    expect(goalsWait(true, idle, below)).toBe(false);
    expect(goalsWait(false, idle, armedOr({ holds: () => true, busy: () => false }))).toBe(true);
    expect(goalsWait(true, idle, armedOr({ holds: () => true, busy: () => false }))).toBe(false);
  });
});

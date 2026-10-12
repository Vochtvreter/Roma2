// tests/sheet.test.ts — the phone SHEET's finishing (DESIGN §15.7, ARCHITECTURE §13.10): the context card's brief
// (inspector.ts briefParts), where a placing's ghost starts and what a Place does next (mapbar.ts startAt, afterPlace,
// placingWhy), the held ± (labour.ts holdSteps), lesson I's job carried in its own card and its glow there (layout.ts
// hostPointer, CARD_ROWS), Aedificia's tray or whole tab by the row asked for and the tray lessons arriving folded
// (layout.ts trayHolds, route, lessonFolds), and a dispatch coming through the voice line (counsel.ts pickCounsel). Headless: these
// modules touch no DOM at import, and every helper here is pure over its arguments or the state.
import { describe, expect, it } from 'vitest';
import type { GameState, PendingChoice } from '../src/game/types';
import type { Game, PlacingState } from '../src/ui/types';
import { BRIEF, BRIEF_LINES, briefParts } from '../src/ui/inspector';
import type { CardKind } from '../src/ui/inspector';
import { afterPlace, placingWhy, startAt } from '../src/ui/mapbar';
import { HOLD, holdSteps } from '../src/ui/tabs/labour';
import { CARD_LESSONS, CARD_ROWS, HOSTS, REVEAL, detentsOf, hostPointer, lessonFolds, reveal, route, shownAt, trayHolds } from '../src/ui/layout';
import type { OpenFrom } from '../src/ui/layout';
import { pickCounsel, voiceAction, waitingBeyond, awaitingItems } from '../src/ui/counsel';
import { LESSONS, lessonPointer } from '../src/game/intro';
import { newGame } from '../src/game/state';
import { DEFAULT_PREFS } from '../src/game/save';
import { emptyRates } from '../src/game/sim';
import { fresh } from './util';

function fakeGame(s: GameState): Game {
  return { state: s, view: { placing: null, overlay: 'none' }, prefs: DEFAULT_PREFS, rates: emptyRates(), speed: 1, paused: false, mode: 'game', modalOpen: false } as unknown as Game;
}

const dispatch = (s: GameState): PendingChoice => ({ event: 'veterani', kicker: 'NVNTIVS · VETERANI AD PORTAM', title: 'Veterans at the gate', text: '',
  options: [{ label: 'Give them land' }, { label: 'Send them on' }], defaultIndex: 1, created: s.day, expires: s.day + 28 } as unknown as PendingChoice);

describe('the context card\'s brief (briefParts)', () => {
  const table: [CardKind, string[], string[]][] = [
    // a house: its tier, beds and first want (with its fix); the household's names, renovation and the rest wait behind More
    ['house', ['sub', 'beds', 'who', 'needs', 'renovation', 'pref', 'demolish'], ['sub', 'beds', 'needs']],
    // a declining house: the decline comes first and its tier steps behind More
    ['house', ['sub', 'beds', 'who', 'declining', 'needs', 'renovation', 'demolish'], ['beds', 'declining', 'needs']],
    ['house', ['sub', 'beds', 'who', 'finest', 'demolish'], ['sub', 'beds', 'finest']],
    // a staffed work: its hands and its category's labour line, staffed in place, and its controls
    ['works', ['benefit', 'staff', 'names', 'labour', 'chain', 'site', 'flags', 'controls', 'demolish'], ['benefit', 'staff', 'labour', 'controls']],
    // a work with no posts: what it does and what it stores
    ['works', ['benefit', 'stores', 'site', 'demolish'], ['benefit', 'stores']],
    ['works', ['benefit', 'service', 'service', 'site', 'demolish'], ['benefit', 'service']],
    // a site: its progress (a line and a bar: one part), why, and its queue buttons
    ['site', ['progress', 'progress', 'why', 'notes', 'queue'], ['progress', 'why', 'notes', 'queue']],
    ['block', ['status', 'plots', 'actions'], ['status', 'plots', 'actions']],
    ['tile', ['facts', 'coords', 'buildable'], ['facts', 'buildable']],
  ];
  for (const [kind, present, want] of table) {
    it(`${kind}: ${present.join(' ')} → ${want.join(' ')}`, () => expect(briefParts(kind, present)).toEqual(want));
  }

  it('keeps the card\'s order, at most BRIEF_LINES lines, and every action of its kind', () => {
    for (const kind of Object.keys(BRIEF) as CardKind[]) {
      const all = [...BRIEF[kind].lines, ...BRIEF[kind].acts, 'demolish', 'who'];
      const got = briefParts(kind, all);
      expect(got.filter((p) => BRIEF[kind].lines.includes(p)).length, kind).toBeLessThanOrEqual(BRIEF_LINES);
      for (const a of BRIEF[kind].acts) expect(got, `${kind} ${a}`).toContain(a);
      expect(got).toEqual(all.filter((p) => got.includes(p)));   // in the card's own order
      expect(got).not.toContain('demolish');                       // a demolition is never in a brief
    }
    expect(briefParts('works', [])).toEqual([]);
  });
});

describe('placing a work on touch (startAt, afterPlace)', () => {
  const well: PlacingState = { kind: 'building', type: 'puteus' };
  const best = (): number => 4242;

  it('starts a finger\'s ghost, or any on the phone sheet, on the best plot; never a mouse\'s elsewhere, a Move, or a tool', () => {
    expect(startAt(well, true, false, best)).toEqual({ ...well, at: 4242 });
    expect(startAt(well, false, true, best)).toEqual({ ...well, at: 4242 });
    expect(startAt(well, false, false, best)).toBe(well);                                   // a mouse on a desktop: its camera never jumps
    expect(startAt({ ...well, at: 7 }, true, true, best)).toEqual({ ...well, at: 7 });       // a tile given stays
    expect(startAt({ ...well, replaceId: 3 }, true, true, best)).toEqual({ ...well, replaceId: 3 });   // a Move: the player picks
    expect(startAt({ kind: 'road' }, true, true, best)).toEqual({ kind: 'road' });
    expect(startAt(well, true, true, () => undefined)).toBe(well);                           // no plot anywhere: no ghost yet
  });

  it('keeps placing after a refusal; after a work placed, on Shift (a mouse) or ⟳ (a finger), never after a Move', () => {
    const o = { ok: true, shift: false, touch: false, keep: false, moving: false };
    expect(afterPlace({ ...o, ok: false })).toBe('stay');
    expect(afterPlace(o)).toBe('end');
    expect(afterPlace({ ...o, shift: true })).toBe('more');                       // Shift-click, as ever
    expect(afterPlace({ ...o, touch: true })).toBe('end');                        // a finger without ⟳: the sheet stays closed
    expect(afterPlace({ ...o, touch: true, keep: true })).toBe('more');           // ⟳: the touch Shift-click
    expect(afterPlace({ ...o, touch: false, keep: true })).toBe('end');           // ⟳ is a finger's: a mouse has Shift
    expect(afterPlace({ ...o, touch: true, keep: true, moving: true })).toBe('end');
    expect(afterPlace({ ...o, shift: true, moving: true })).toBe('end');          // the stake it replaced is gone
  });

  it('says why: the lesson that asks for the work, else nothing of its own accord', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    s.guidance.advisories = {};
    s.guidance.intro.lesson = LESSONS.findIndex((l) => l.id === 'water');
    s.guidance.intro.done = false;
    expect(placingWhy(s, 'cisterna')).toBe(LESSONS.find((l) => l.id === 'water')?.job);
    expect(placingWhy(s, 'puteus')).toBeNull();
    s.guidance.intro.done = true;   // the breather: the job is done
    expect(placingWhy(s, 'cisterna')).toBeNull();
  });
});

describe('the held ± (holdSteps)', () => {
  it('a tap is ±1 (its click); a long press steps ±5, and ±5 again every REPEAT_MS while held', () => {
    expect(holdSteps(0)).toBe(0);
    expect(holdSteps(HOLD.LONG_MS - 1)).toBe(0);
    expect(holdSteps(HOLD.LONG_MS)).toBe(1);
    expect(holdSteps(HOLD.LONG_MS + HOLD.REPEAT_MS - 1)).toBe(1);
    expect(holdSteps(HOLD.LONG_MS + HOLD.REPEAT_MS)).toBe(2);
    expect(holdSteps(1500)).toBe(4);
    expect(HOLD.STEP).toBe(5);
    for (let ms = 0; ms < 5000; ms += 37) expect(holdSteps(ms + 37)).toBeGreaterThanOrEqual(holdSteps(ms));   // never back
  });
});

describe('lesson I in its card on the phone (hostPointer, CARD_ROWS)', () => {
  it('a card lesson opens no tab on the sheet and glows the card\'s own row; every other lesson, and every other host, as before', () => {
    expect(CARD_LESSONS).toEqual(['fields']);
    for (const l of LESSONS) {
      for (const host of HOSTS) {
        const p = hostPointer(l, host), base = lessonPointer(l);
        if (host === 'sheet' && CARD_LESSONS.includes(l.id)) {
          expect(p.open, l.id).toBeNull();
          expect(p.card).toBe(true);
          expect(p.glow).toBe(base.glow);
        } else if ((host === 'sheet' || host === 'drawer' || host === 'dock') && base.open === 'build' && base.anchor === undefined) {
          // VIII ("a work you choose") points the phone's build tray at its cards, every category (P3: the landscape
          // drawer's catalogue too, which its short pane would otherwise show from the Agenda at the tab's top; P4: the
          // tablet's docked pane, as narrow)
          expect(p, l.id).toEqual({ ...base, anchor: 'cards', card: false });
        } else expect(p, `${l.id} ${host}`).toEqual({ ...base, card: false });
      }
    }
  });

  it('the Annona row glows in the lesson card on the sheet, in Populus elsewhere; a row is never a frame proxy', () => {
    expect(reveal('.tab-lab[data-cat="food"]', 'sheet')).toBe('#counsel .tab-lab[data-cat="food"]');
    for (const host of ['drawer', 'dock', 'columns'] as const) expect(reveal('.tab-lab[data-cat="food"]', host)).toBe('.tab-lab[data-cat="food"]');
    for (const host of HOSTS) for (const k of Object.keys(CARD_ROWS[host])) expect(REVEAL[host][k], k).toBeUndefined();
  });

  it('routes a card lesson to half on the sheet (full when tiny), where its card and its row show', () => {
    const fields = LESSONS.find((l) => l.id === 'fields')!;
    const row = reveal(lessonPointer(fields).glow ?? '', 'sheet');
    for (const tiny of [false, true]) {
      for (const d of detentsOf('sheet', tiny)) {
        const to = route({ kind: 'lesson', lesson: 'fields' }, { host: 'sheet', detent: d, tiny }).detent;
        expect(to).toBe(tiny ? 'full' : 'half');
        expect(shownAt(row, 'sheet', to)).toBe(true);
      }
    }
  });
});

describe('the build tray and the whole Aedificia tab (trayHolds, route with an anchor)', () => {
  // the anchors Aedificia's callers pass: the voice line's ORDO/AGENDA lines (ticker.ts), the street need's remedy
  // (advisors/util.ts needRemedy), the tools' buttons, the lessons' works, the cards themselves, and none
  const tray = ['b-cisterna', 'b-area', 'b-puteus', 'cards', undefined];
  const whole = ['agenda', 'works', 'builders', 'road', 'pave', 'reserve', 'demolish', 'pin'];
  const froms: (OpenFrom | undefined)[] = ['chip', 'remedy', 'lesson', 'tab', 'key', undefined];

  it('the tray carries a work\'s card and the cards; the Agenda, the queue and the tools are the whole tab\'s', () => {
    for (const a of tray) expect(trayHolds(a), String(a)).toBe(true);
    for (const a of whole) expect(trayHolds(a), a).toBe(false);
  });

  it('on the phone sheet Aedificia opens at half for the tray, at full for a row only the whole tab has', () => {
    for (const from of froms) {
      for (const d of detentsOf('sheet', false)) {
        const at = (anchor?: string) => route({ kind: 'open', tab: 'build', from, anchor }, { host: 'sheet', detent: d, tiny: false }).detent;
        for (const a of tray) expect(at(a), `${from} ${a}`).toBe('half');
        for (const a of whole) expect(at(a), `${from} ${a}`).toBe('full');
        expect(route({ kind: 'open', tab: 'people', from, anchor: 'agenda' }, { host: 'sheet', detent: d, tiny: false }).detent).toBe('half');   // Aedificia's only
      }
    }
    // a tiny sheet has no half: full either way
    for (const a of [...tray, ...whole]) expect(route({ kind: 'open', tab: 'build', from: 'chip', anchor: a }, { host: 'sheet', detent: 'closed', tiny: true }).detent).toBe('full');
  });

  it('the street remedy lands on the road tool at full on the phone', () => {
    const r = { kind: 'open', tab: 'build', anchor: 'road' } as const;   // needRemedy(s, v, 'street')
    expect(route({ kind: 'open', tab: r.tab, from: 'remedy', anchor: r.anchor }, { host: 'sheet', detent: 'closed', tiny: false }).detent).toBe('full');
  });

  it('every other host routes as it did, whatever the anchor', () => {
    for (const host of HOSTS) {
      if (host === 'sheet') continue;
      for (const from of froms) for (const d of detentsOf(host, false)) for (const a of [...tray, ...whole]) {
        const c = { host, detent: d, tiny: false };
        expect(route({ kind: 'open', tab: 'build', from, anchor: a }, c), `${host} ${from} ${d} ${a}`).toEqual(route({ kind: 'open', tab: 'build', from }, c));
      }
    }
  });

  it('every lesson that opens Aedificia on the phone lands in the tray, and arrives folded there (lessonFolds)', () => {
    const folded = LESSONS.filter((l) => lessonFolds(l, 'sheet')).map((l) => l.id);
    expect(folded).toEqual(['water', 'homes', 'works']);
    for (const l of LESSONS) {
      const p = hostPointer(l, 'sheet');
      if (p.open === 'build') expect(trayHolds(p.anchor), l.id).toBe(true);
      for (const host of HOSTS) if (host !== 'sheet') expect(lessonFolds(l, host), `${l.id} ${host}`).toBe(false);
    }
    // and the route a lesson takes there is the tray's half
    for (const id of folded) expect(route({ kind: 'lesson', lesson: id }, { host: 'sheet', detent: 'closed', tiny: false }).detent, id).toBe('half');
  });
});

describe('a dispatch through the voice line (pickCounsel on the sheet)', () => {
  it('comes right after a Periculum, before a lesson, and only where the line carries it', () => {
    const s = newGame({ seed: 42, now: 0, intro: true });
    s.guidance.advisories = {};
    s.choice = dispatch(s);
    const g = fakeGame(s);
    expect(pickCounsel(g, true)).toEqual({ kind: 'event', c: s.choice });   // over the lesson, and over the tip it brings
    expect(pickCounsel(g, false).kind).not.toBe('event');   // off the phone the event card floats on its own
    expect(pickCounsel(g).kind).not.toBe('event');          // headless: no host, no line
    s.choice = null;
    expect(pickCounsel(g, true).kind).toBe('lesson');
  });

  it('a Periculum still outranks it', () => {
    const s = fresh(42);
    s.guidance.advisories = {};
    s.decisions.paths.charter = 'veterani';
    s.guidance.advisories['aquarum.water.runout'] = { rule: 'aquarum.water.runout', active: true, sev: 3, since: s.day, lowerSince: null,
      params: { R: 4, cons: 10, need: 10, fix: 0, pot: 6, prod: 6 }, flips: [] };
    s.choice = dispatch(s);
    expect(pickCounsel(fakeGame(s), true)).toMatchObject({ kind: 'advisory', a: { rule: 'aquarum.water.runout' } });
  });

  it('offers Read, and is not counted again in the +n pip', () => {
    const s = fresh(42);
    s.guidance.advisories = {};
    s.decisions.paths.charter = 'veterani';
    s.choice = dispatch(s);
    const item = pickCounsel(fakeGame(s), true);
    expect(voiceAction(item, s)).toEqual({ kind: 'event', label: 'Read' });
    const items = awaitingItems(s);
    expect(items.some((x) => x.kind === 'event')).toBe(true);
    expect(waitingBeyond(items, item)).toBe(items.length - 1);
  });
});

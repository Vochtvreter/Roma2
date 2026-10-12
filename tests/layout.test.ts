// tests/layout.test.ts — the layout engine's pure part (src/ui/layout.ts, ARCHITECTURE §13.10): size classes, input
// classes and the host for every window size the game was measured on (platform.md §0's 35 and the design's own), the
// route() table, the lessons' table, and that every lesson's pointer shows on every host. Headless: no DOM (the Layout
// class is never built here).
import { describe, expect, it } from 'vitest';
import { TABS } from '../src/game/types';
import { LESSONS } from '../src/game/intro';
import {
  DEFAULT_DETENT, DETENTS, HOSTS, LESSON_VIEW, MAP_TOOLS, REVEAL, SHEET_FULL_TABS, VISIBLE, aboveDefault, classify, detentsOf,
  fitDetent, inFrame, inputClass, keepDetent, lessonTarget, reveal, route, shownAt, stepDown,
} from '../src/ui/layout';
import type { Box, Detent, Host, Media, RouteCtx } from '../src/ui/layout';
import { coveredArea, dodge, roomShift } from '../src/ui/inspector';

const TOUCH: Media = { coarse: true, anyFine: false, anyCoarse: true };    // a phone, a tablet
const PAD_KB: Media = { coarse: true, anyFine: true, anyCoarse: true };    // an iPad with a Magic Keyboard or a trackpad
const TOUCH_PC: Media = { coarse: false, anyFine: true, anyCoarse: true }; // a touch laptop, a Chromebook
const MOUSE: Media = { coarse: false, anyFine: true, anyCoarse: false };
const NONE: Media = { coarse: false, anyFine: false, anyCoarse: false };   // no pointer at all (a TV, a test runner)

describe('inputClass', () => {
  it('touch, mixed both ways, mouse', () => {
    expect(inputClass(TOUCH)).toBe('touch');
    expect(inputClass(PAD_KB)).toBe('mixed');
    expect(inputClass(TOUCH_PC)).toBe('mixed');
    expect(inputClass(MOUSE)).toBe('mouse');
    expect(inputClass(NONE)).toBe('mouse');
  });
});

describe('classify: platform.md §0, the 35 measured window sizes', () => {
  // [id, w, h, media, host, w class, h class, tiny] — the host from the rules: DRAWER short & < 960 · SHEET < 720 ·
  // COLUMNS mouse ≥ 1280 or ≥ 1440 · else DOCK
  const SIZES: readonly [string, number, number, Media, Host, string, string, boolean][] = [
    ['flip-cover', 360, 374, TOUCH, 'drawer', 'compact', 'short', true],
    ['ipad-slideover', 320, 980, TOUCH, 'sheet', 'compact', 'tall', true],
    ['phone-360', 360, 780, TOUCH, 'sheet', 'compact', 'tall', false],
    ['iphone-se-safari', 375, 553, TOUCH, 'sheet', 'compact', 'regular', false],
    ['iphone-se', 375, 667, TOUCH, 'sheet', 'compact', 'regular', false],
    ['fold5-cover', 344, 882, TOUCH, 'sheet', 'compact', 'tall', true],
    ['iphone-15-safari', 393, 659, TOUCH, 'sheet', 'compact', 'regular', false],
    ['iphone-15-pwa', 393, 759, TOUCH, 'sheet', 'compact', 'regular', false],
    ['pixel-7-chrome', 412, 839, TOUCH, 'sheet', 'compact', 'tall', false],
    ['fold6-cover', 412, 968, TOUCH, 'sheet', 'compact', 'tall', false],
    ['iphone-promax-pwa', 440, 863, TOUCH, 'sheet', 'compact', 'tall', false],
    ['iphone-15-land-safari', 852, 340, TOUCH, 'drawer', 'medium', 'short', true],
    ['iphone-15-land-pwa', 734, 372, TOUCH, 'drawer', 'medium', 'short', true],
    ['ipad-split-507', 507, 1180, TOUCH, 'sheet', 'compact', 'tall', false],
    ['ipad-split-678', 678, 1024, TOUCH, 'sheet', 'medium', 'tall', false],
    ['fold6-inner', 744, 860, TOUCH, 'dock', 'medium', 'tall', false],
    ['fold6-inner-land', 860, 744, TOUCH, 'dock', 'medium', 'regular', false],
    ['ipad-mini', 744, 1133, TOUCH, 'dock', 'medium', 'tall', false],
    ['tab-s4-port', 712, 1138, TOUCH, 'sheet', 'medium', 'tall', false],   // under 720: too narrow for a docked pane
    ['ipad-air', 820, 1180, TOUCH, 'dock', 'medium', 'tall', false],
    ['pixel-fold-inner', 836, 842, TOUCH, 'dock', 'medium', 'tall', false],
    ['ipad-11', 834, 1194, TOUCH, 'dock', 'medium', 'tall', false],
    ['tab-port', 800, 1280, TOUCH, 'dock', 'medium', 'tall', false],
    ['ipad-split-981', 981, 1024, TOUCH, 'dock', 'expanded', 'tall', false],
    ['ipad-13-port', 1032, 1376, TOUCH, 'dock', 'expanded', 'tall', false],
    ['ipad-mini-land', 1133, 744, TOUCH, 'dock', 'expanded', 'regular', false],
    ['ipad-air-land', 1180, 820, TOUCH, 'dock', 'expanded', 'tall', false],
    ['ipad-11-land', 1194, 834, TOUCH, 'dock', 'expanded', 'tall', false],
    ['android-tab-land', 1280, 800, TOUCH, 'dock', 'expanded', 'tall', false],
    ['ipad-13-land', 1376, 1032, TOUCH, 'dock', 'expanded', 'tall', false],
    ['desk-800', 800, 600, MOUSE, 'dock', 'medium', 'regular', false],
    ['desk-1000', 1000, 700, MOUSE, 'dock', 'expanded', 'regular', false],
    ['chromebook', 1366, 768, MOUSE, 'columns', 'expanded', 'tall', false],
    ['desktop', 1440, 900, MOUSE, 'columns', 'large', 'tall', false],
    ['desk-1920', 1920, 1080, MOUSE, 'columns', 'large', 'tall', false],
  ];

  it('covers all 35', () => expect(SIZES.length).toBe(35));

  for (const [id, w, h, m, host, wc, hc, tiny] of SIZES) {
    it(`${id} ${w}×${h} → ${host}`, () => {
      expect(classify(w, h, m)).toEqual({ w: wc, h: hc, input: inputClass(m), host, tiny });
    });
  }

  it('a touch Chromebook (fine primary, a touch screen) at 1366 is mixed and docks; with a mouse alone it keeps the columns', () => {
    expect(classify(1366, 768, TOUCH_PC)).toMatchObject({ input: 'mixed', host: 'dock' });
    expect(classify(1366, 768, MOUSE)).toMatchObject({ input: 'mouse', host: 'columns' });
  });
});

describe('classify: the design\'s sizes (IMPL §1)', () => {
  const CASES: readonly [number, number, Media[], Host][] = [
    [375, 553, [TOUCH], 'sheet'], [375, 667, [TOUCH], 'sheet'],
    [393, 659, [TOUCH, PAD_KB], 'sheet'], [393, 852, [TOUCH, PAD_KB], 'sheet'], [412, 915, [TOUCH], 'sheet'],
    [852, 393, [TOUCH, MOUSE], 'drawer'], [852, 340, [TOUCH, MOUSE], 'drawer'],
    [690, 829, [TOUCH], 'sheet'],
    [744, 860, [TOUCH], 'dock'], [744, 1133, [TOUCH], 'dock'], [820, 1180, [TOUCH], 'dock'], [800, 1280, [TOUCH], 'dock'],
    [1032, 1376, [TOUCH], 'dock'], [1180, 820, [TOUCH], 'dock'], [1280, 800, [TOUCH], 'dock'],
    [1366, 1024, [PAD_KB, TOUCH_PC], 'dock'],
    [1280, 800, [MOUSE], 'columns'],
    [1440, 900, [TOUCH, PAD_KB, TOUCH_PC, MOUSE], 'columns'],
    [800, 600, [MOUSE], 'dock'],
  ];
  for (const [w, h, ms, host] of CASES) {
    it(`${w}×${h} → ${host}`, () => { for (const m of ms) expect(classify(w, h, m).host).toBe(host); });
  }

  it('the thresholds: classes at their edges', () => {
    const at = (w: number, h: number) => classify(w, h, TOUCH);
    expect([at(599, 800).w, at(600, 800).w, at(959, 800).w, at(960, 800).w, at(1439, 800).w, at(1440, 800).w])
      .toEqual(['compact', 'medium', 'medium', 'expanded', 'expanded', 'large']);
    expect([at(800, 479).h, at(800, 480).h, at(800, 759).h, at(800, 760).h]).toEqual(['short', 'regular', 'regular', 'tall']);
    expect([at(959, 479).host, at(960, 479).host, at(719, 600).host, at(720, 600).host]).toEqual(['drawer', 'dock', 'sheet', 'dock']);
    expect([at(359, 800).tiny, at(360, 800).tiny, at(400, 419).tiny, at(400, 420).tiny]).toEqual([true, false, true, false]);
    expect([classify(1279, 800, MOUSE).host, classify(1280, 800, MOUSE).host, at(1439, 900).host, at(1440, 900).host])
      .toEqual(['dock', 'columns', 'dock', 'columns']);
  });

  it('a rotating tablet keeps its host; a phone turned sideways goes from sheet to drawer', () => {
    for (const [w, h] of [[820, 1180], [744, 1133], [1032, 1376]]) expect(classify(h, w, TOUCH).host).toBe(classify(w, h, TOUCH).host);
    expect(classify(393, 852, TOUCH).host).toBe('sheet');
    expect(classify(852, 393, TOUCH).host).toBe('drawer');
  });
});

describe('detents', () => {
  it('defaults: phones show the map, tablets and desktops the docked pane', () => {
    expect(DEFAULT_DETENT).toEqual({ sheet: 'closed', drawer: 'closed', dock: 'half', columns: 'half' });
  });

  it('a tiny sheet has no half: up from closed goes full, down from full goes closed', () => {
    expect(detentsOf('sheet', true)).toEqual(['closed', 'full']);
    for (const h of HOSTS) expect(detentsOf(h, false)).toEqual(DETENTS);
    expect(detentsOf('drawer', true)).toEqual(DETENTS);   // tiny affects the sheet only (a landscape phone is short)
    expect(fitDetent('half', 'closed', 'sheet', true)).toBe('full');
    expect(fitDetent('half', 'full', 'sheet', true)).toBe('closed');
    expect(fitDetent('half', 'closed', 'sheet', false)).toBe('half');
    expect(stepDown('full', 'sheet', true)).toBe('closed');
    expect(stepDown('full', 'dock', false)).toBe('half');
    expect(stepDown('half', 'sheet', false)).toBe('closed');
  });

  it('a detent above the host default is a Back layer', () => {
    expect(aboveDefault('half', 'sheet')).toBe(true);
    expect(aboveDefault('closed', 'sheet')).toBe(false);
    expect(aboveDefault('half', 'columns')).toBe(false);
    expect(aboveDefault('full', 'columns')).toBe(true);
  });
});

describe('route', () => {
  const ctx = (host: Host, detent: Detent, tiny = false): RouteCtx => ({ host, detent, tiny });

  it('place and focus clear a phone\'s map and remember; a tablet or desktop pane stays', () => {
    for (const host of ['sheet', 'drawer'] as const) {
      for (const d of DETENTS) {
        expect(route({ kind: 'place' }, ctx(host, d))).toEqual({ detent: 'closed', remember: true, card: false });
        expect(route({ kind: 'focus' }, ctx(host, d))).toEqual({ detent: 'closed', remember: true, card: true });
      }
    }
    for (const host of ['dock', 'columns'] as const) {
      for (const d of DETENTS) {
        expect(route({ kind: 'place' }, ctx(host, d))).toEqual({ detent: d, remember: false, card: false });
        expect(route({ kind: 'focus' }, ctx(host, d))).toEqual({ detent: d, remember: false, card: false });
      }
    }
  });

  it('a tab on the sheet: half for people, advisors and build, full for the long ledgers', () => {
    const open = (tab: (typeof TABS)[number], c: RouteCtx, from?: 'chip' | 'key' | 'remedy' | 'lesson' | 'tab') =>
      route({ kind: 'open', tab, from }, c).detent;
    for (const tab of TABS) {
      const want = SHEET_FULL_TABS.includes(tab) ? 'full' : 'half';
      expect(open(tab, ctx('sheet', 'closed'))).toBe(want);
      expect(open(tab, ctx('sheet', 'closed'), 'remedy')).toBe(want);
      expect(open(tab, ctx('sheet', 'closed', true))).toBe('full');            // tiny: no half
      expect(open(tab, ctx('sheet', 'closed'), 'chip')).toBe('half');          // a chip: part-way
      expect(open(tab, ctx('sheet', 'full'), 'chip')).toBe('half');
      expect(open(tab, ctx('sheet', 'closed', true), 'chip')).toBe('full');
      expect(open(tab, ctx('sheet', 'half'), 'tab')).toBe('half');             // switching tabs keeps the detent
      expect(open(tab, ctx('sheet', 'full'), 'tab')).toBe('full');
      expect(open(tab, ctx('sheet', 'closed'), 'tab')).toBe(want);
    }
    expect(SHEET_FULL_TABS).toEqual(['council', 'trade', 'annals']);
  });

  it('a tab in the drawer opens at half (a tab switch at full stays full)', () => {
    for (const tab of TABS) {
      for (const d of DETENTS) expect(route({ kind: 'open', tab }, ctx('drawer', d)).detent).toBe('half');
      expect(route({ kind: 'open', tab, from: 'tab' }, ctx('drawer', 'full')).detent).toBe('full');
      expect(route({ kind: 'open', tab, from: 'chip' }, ctx('drawer', 'full')).detent).toBe('half');
    }
  });

  it('a tab on a dock or the columns: docked unless already wide; Shift with its key goes wide; a chip docks', () => {
    for (const host of ['dock', 'columns'] as const) {
      for (const tab of TABS) {
        expect(route({ kind: 'open', tab }, ctx(host, 'closed')).detent).toBe('half');
        expect(route({ kind: 'open', tab }, ctx(host, 'half')).detent).toBe('half');
        expect(route({ kind: 'open', tab }, ctx(host, 'full')).detent).toBe('full');
        expect(route({ kind: 'open', tab, from: 'key' }, ctx(host, 'closed')).detent).toBe('half');
        expect(route({ kind: 'open', tab, from: 'key', shift: true }, ctx(host, 'closed')).detent).toBe('full');
        expect(route({ kind: 'open', tab, from: 'key', shift: true }, ctx(host, 'half')).detent).toBe('full');
        expect(route({ kind: 'open', tab, from: 'chip' }, ctx(host, 'full')).detent).toBe('half');
        expect(route({ kind: 'open', tab }, ctx(host, 'half')).remember).toBe(false);
      }
    }
  });
});

describe('the lessons\' table', () => {
  it('covers every LessonId, and agrees with the lesson: a tab lesson has a tab, a frame lesson points at the frame', () => {
    expect(Object.keys(LESSON_VIEW).sort()).toEqual(LESSONS.map((l) => l.id).sort());
    for (const l of LESSONS) {
      const v = LESSON_VIEW[l.id], target = lessonTarget(l);
      expect(target, l.id).not.toBeNull();
      if (v === 'tab') { expect(l.tab, l.id).toBeDefined(); expect(l.find, l.id).toBeUndefined(); }
      if (v === 'frame') expect(inFrame(target ?? ''), l.id).toBe(true);
      if (v === 'map') expect(MAP_TOOLS, l.id).toContain(target);
      if (l.find) expect(v, l.id).toBe('frame');
    }
  });

  it('a lesson opens its tab where that tab opens; a map lesson steps a full panel down; a frame lesson leaves it', () => {
    for (const l of LESSONS) {
      for (const host of HOSTS) {
        for (const tiny of [false, true]) {
          for (const d of detentsOf(host, tiny)) {
            const r = route({ kind: 'lesson', lesson: l.id }, { host, detent: d, tiny });
            expect(detentsOf(host, tiny), `${l.id} ${host} ${d}`).toContain(r.detent);
            const v = LESSON_VIEW[l.id];
            if (v === 'tab' && l.tab) expect(r.detent).toBe(route({ kind: 'open', tab: l.tab, from: 'lesson' }, { host, detent: d, tiny }).detent);
            if (v === 'frame') expect(r.detent).toBe(d);
            if (v === 'map') expect(r.detent).toBe(d === 'full' ? stepDown('full', host, tiny) : d);
          }
        }
      }
    }
  });

  it('every lesson\'s pointer shows on every host, from every detent the player may have', () => {
    for (const l of LESSONS) {
      const target = lessonTarget(l) ?? '';
      for (const host of HOSTS) {
        for (const tiny of [false, true]) {
          for (const d of detentsOf(host, tiny)) {
            const to = route({ kind: 'lesson', lesson: l.id }, { host, detent: d, tiny }).detent;
            const sel = reveal(target, host);
            expect(shownAt(sel, host, to), `${l.id} → ${sel} on ${host} at ${to} (from ${d}${tiny ? ', tiny' : ''})`).toBe(true);
          }
        }
      }
    }
  });
});

describe('reveal', () => {
  it('a proxy is shown where its target is hidden; a target a host shows is its own pointer', () => {
    for (const host of HOSTS) {
      for (const [hidden, proxy] of Object.entries(REVEAL[host])) {
        expect(VISIBLE[host], `${host}: ${hidden}`).not.toContain(hidden);
        expect(VISIBLE[host], `${host}: ${proxy}`).toContain(proxy);
      }
      for (const sel of VISIBLE[host]) expect(reveal(sel, host)).toBe(sel);
      for (const t of TABS) expect(VISIBLE[host]).toContain(`#tab-${t}`);   // every host can show every tab's button
    }
  });

  it('tells frame targets from rows of a tab body', () => {
    expect(inFrame('#speed')).toBe(true);
    expect(inFrame('#tab-advisors')).toBe(true);
    expect(inFrame('.tab-lab[data-cat="food"]')).toBe(false);
    expect(inFrame('[data-anchor="b-area"]')).toBe(false);
    expect(shownAt('.path-card', 'columns', 'closed')).toBe(false);
    expect(shownAt('#overlay-bar', 'sheet', 'full')).toBe(false);
    expect(shownAt('#overlay-bar', 'sheet', 'half')).toBe(true);
  });
});

describe('roomShift (the inspector popup on a strip of map)', () => {
  it('0 when a card fits above or below, else the least move; 0 when the band is too short', () => {
    expect(roomShift(400, 460, 148, 652, 190)).toBe(0);          // room above already
    expect(roomShift(150, 200, 148, 452, 190)).toBe(0);          // room below already
    expect(roomShift(268, 332, 148, 452, 190)).toBe(70);         // a phone's strip over its sheet: down (a tie), the card above
    expect(roomShift(268, 332, 148, 452.09, 190)).toBe(70);      // a fractional bound does not tip the tie
    expect(roomShift(250, 314, 148, 452, 190)).toBe(-52);        // nearer the room below: up, the card below
    expect(roomShift(290, 354, 148, 452, 190)).toBe(48);
    expect(roomShift(200, 264, 148, 452, 190)).toBe(-2);
    expect(roomShift(200, 300, 148, 300, 190)).toBe(0);          // too short for both
  });

  it('keeps the target below a band of cards the popup may cover (a phone\'s Res Gestae and counsel)', () => {
    expect(roomShift(268, 332, 148, 452, 190, 285)).toBe(70);    // up would put it under the band
    expect(roomShift(250, 314, 148, 452, 190, 285)).toBe(88);
    expect(roomShift(300, 364, 148, 452, 190, 285)).toBe(38);
    expect(roomShift(400, 460, 148, 652, 190, 285)).toBe(0);
  });
});

describe('keepDetent (the classes change under the panel)', () => {
  it('a tiny sheet has no half: full, forced; half again once the window allows it', () => {
    expect(keepDetent('half', false, 'sheet', true)).toEqual({ detent: 'full', forced: true });      // the Fold's cover screen
    expect(keepDetent('full', true, 'sheet', true)).toEqual({ detent: 'full', forced: true });       // still tiny
    expect(keepDetent('full', true, 'dock', false)).toEqual({ detent: 'half', forced: false });      // unfolded: docked, not wide
    expect(keepDetent('full', true, 'sheet', false)).toEqual({ detent: 'half', forced: false });     // a slide-over widened
    expect(keepDetent('full', false, 'dock', false)).toEqual({ detent: 'full', forced: false });     // a full the player chose stays
    expect(keepDetent('closed', true, 'sheet', true)).toEqual({ detent: 'closed', forced: false });  // closed is never forced
  });

  it('always lands on a detent the host offers', () => {
    for (const host of HOSTS) {
      for (const tiny of [false, true]) {
        for (const d of DETENTS) {
          for (const forced of [false, true]) expect(detentsOf(host, tiny)).toContain(keepDetent(d, forced, host, tiny).detent);
        }
      }
    }
  });
});

describe('dodge (a pinned target clear of what floats over the map)', () => {
  const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
  const at = (b: Box, d: { dx: number; dy: number }): Box => box(b.left + d.dx, b.top + d.dy, b.right + d.dx, b.bottom + d.dy);
  // an iPhone 15 (393×852) with its sheet half open, as today's CSS lays it out: the HUD, the sheet, the band of cards,
  // the overlay bar and zoom buttons at the right, the ticker and the sheet's toggle above the sheet
  const PHONE: readonly Box[] = [box(0, 0, 393, 140), box(0, 460, 393, 852), box(8, 146, 385, 222), box(8, 228, 385, 279),
    box(193, 304, 385, 358), box(245, 364, 385, 408), box(8, 408, 333, 452), box(341, 418, 385, 462)];
  const SCREEN = box(0, 0, 393, 852);

  it('coveredArea counts the overlaps, not a fractional touch', () => {
    expect(coveredArea(box(0, 0, 10, 10), [box(5, 5, 20, 20)])).toBe(25);
    expect(coveredArea(box(0, 0, 10, 10), [box(9.7, 0, 20, 10)])).toBe(0);
    expect(coveredArea(box(0, 0, 10, 10), [])).toBe(0);
  });

  it('leaves a clear target alone', () => {
    expect(dodge(box(100, 300, 164, 364), [box(0, 0, 50, 50)], SCREEN, 16)).toEqual({ dx: 0, dy: 0 });
  });

  it('a target glided above the sheet but under the zoom buttons and the ticker: the nearest clear spot, a margin off', () => {
    const t = box(200, 380, 264, 444);
    expect(coveredArea(t, PHONE)).toBeGreaterThan(0);
    const d = dodge(t, PHONE, SCREEN, 16);
    expect(d).toEqual({ dx: -87, dy: -42 });                                  // left of the overlay bar, above the toggle's line
    expect(coveredArea(at(t, d), PHONE)).toBe(0);
  });

  it('stays inside its bounds, and falls back to the least cover only when that uncovers a quarter', () => {
    const t = box(0, 0, 100, 100);
    expect(dodge(t, [box(0, 0, 100, 100)], box(0, 0, 100, 100), 16)).toEqual({ dx: 0, dy: 0 });   // nowhere to go
    const half = dodge(t, [box(0, 0, 100, 150)], box(0, 0, 160, 100), 16);                         // a 60 px strip clears 60%
    expect(half).toEqual({ dx: 60, dy: 0 });
    expect(coveredArea(at(t, half), [box(0, 0, 100, 150)])).toBe(4000);
    expect(dodge(t, [box(0, 0, 100, 150)], box(0, 0, 110, 100), 16)).toEqual({ dx: 0, dy: 0 });   // 10% is not worth a move
  });
});

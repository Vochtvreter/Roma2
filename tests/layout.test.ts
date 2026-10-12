// tests/layout.test.ts — the layout engine's pure part (src/ui/layout.ts, ARCHITECTURE §13.10): size classes, input
// classes and the host for every window size the game was measured on (platform.md §0's 35 and the design's own), the
// route() table, the lessons' table, that every lesson's pointer shows on every host (the phones' through their proxies),
// the phone sheet's own tables (its heights, the drag's snap, the grabber's cycle and the bar's slots) and the landscape
// drawer's (the pane's widths and their snap, the free map beside what stands at its foot, the HUD row's priority+).
// Headless: no DOM (the Layout class is never built here).
import { describe, expect, it } from 'vitest';
import { TABS } from '../src/game/types';
import { LESSONS } from '../src/game/intro';
import {
  BAR_SLOTS, DEFAULT_DETENT, DETENTS, DRAWER, FLING, HOSTS, LESSON_VIEW, MAP_TOOLS, REVEAL, SHEET, SHEET_FULL_TABS, VISIBLE, aboveDefault, barSlot,
  classify, clearOf, cycleDetent, detentsOf, drawerWidths, fitDetent, hostEntryDetent, inFrame, inputClass, isPhone, keepDetent, lessonTarget,
  priorityDrops, reveal, route, sheetHeights, shownAt, slotTap, snapDetent, stepDown,
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
      for (const d of DETENTS) expect(open(tab, ctx('sheet', d), 'tab')).toBe(want);   // a slot tap: the tab's own detent, from anywhere
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
      // every host can show every tab's button, or its way in: the phone bar has no Annales slot, the menu has its row
      for (const t of TABS) expect(VISIBLE[host]).toContain(reveal(`#tab-${t}`, host));
    }
  });

  // P3 (IMPL §1 reveal): the DRAWER hides the overlay bar in its Mappae popover too, so it takes the SHEET's proxies
  it('the phones: the overlay bar glows the Mappae button, the Res Gestae the HUD, the ticker the voice line, Annales the menu', () => {
    for (const host of ['sheet', 'drawer'] as const) {
      expect(reveal('#overlay-bar', host)).toBe('#map-mappae');
      expect(reveal('#objective', host)).toBe('#hud');
      expect(reveal('#ticker', host)).toBe('#counsel');
      expect(reveal('#tab-annals', host)).toBe('#hud-menu');   // the DRAWER's spine icon glows itself when it shows (Layout.reveal)
      for (const t of TABS.filter((x) => x !== 'annals')) expect(reveal(`#tab-${t}`, host)).toBe(`#tab-${t}`);   // on the bar, the spine
      expect(reveal('#speed', host)).toBe('#speed');   // the [❚❚][1× ▾] pair is #speed itself
      for (const tool of ['#map-via', '#map-mappae']) expect(VISIBLE[host]).toContain(tool);
    }
    for (const host of ['dock', 'columns'] as const) expect(reveal('#overlay-bar', host)).toBe('#overlay-bar');
    expect(HOSTS.filter(isPhone)).toEqual(['sheet', 'drawer']);
  });

  it('tells frame targets from rows of a tab body', () => {
    expect(inFrame('#speed')).toBe(true);
    expect(inFrame('#tab-advisors')).toBe(true);
    expect(inFrame('.tab-lab[data-cat="food"]')).toBe(false);
    expect(inFrame('[data-anchor="b-area"]')).toBe(false);
    expect(shownAt('.path-card', 'columns', 'closed')).toBe(false);
    // the SHEET's overlay bar lives in the Mappae popover: its button rides the tool column, hidden under a full sheet
    expect(shownAt('#overlay-bar', 'sheet', 'half')).toBe(false);
    expect(shownAt('#map-mappae', 'sheet', 'half')).toBe(true);
    expect(shownAt('#map-mappae', 'sheet', 'closed')).toBe(true);
    expect(shownAt('#map-mappae', 'sheet', 'full')).toBe(false);
    expect(shownAt('#overlay-bar', 'dock', 'half')).toBe(true);
    expect(shownAt('#overlay-bar', 'dock', 'full')).toBe(false);
    expect(shownAt('#tab-advisors', 'sheet', 'full')).toBe(true);   // the bar stands at every detent
  });
});

describe('the phone sheet', () => {
  // the harness's portrait phones (impl/measure.mjs): #app's height, the one-row HUD (52) and the bar (60)
  const PHONES: readonly [string, number, number][] = [['se-safari', 375, 553], ['iphone-15', 393, 852], ['iphone-15-safari', 393, 659], ['pixel-7', 412, 915]];
  const HEAD = 64;   // the grabber strip and a one-line voice line

  it('half is clamp(240, 44% of #app, 380), 50% on a regular-height phone; full reaches the HUD; closed is the head', () => {
    const at = (w: number, H: number) => sheetHeights({ H, top: 52, bar: 60, head: HEAD, h: classify(w, H, TOUCH).h });
    expect(at(375, 553)).toEqual({ closed: 64, half: 277, full: 441 });   // regular: 50%
    expect(at(393, 659)).toEqual({ closed: 64, half: 330, full: 547 });   // regular: 50%
    expect(at(393, 852)).toEqual({ closed: 64, half: 375, full: 740 });   // tall: 44%
    expect(at(412, 915)).toEqual({ closed: 64, half: 380, full: 803 });   // tall: 44%, capped at 380
    expect(at(360, 480)).toEqual({ closed: 64, half: 240, full: 368 });   // the floor
    expect(SHEET).toMatchObject({ halfMin: 240, halfMax: 380, halfShare: 0.44, halfShareRegular: 0.5 });
  });

  it('never squeezes the head: a head taller than the room gives every detent the head', () => {
    expect(sheetHeights({ H: 300, top: 52, bar: 60, head: 200, h: 'short' })).toEqual({ closed: 200, half: 200, full: 200 });
    const hs = sheetHeights({ H: 700, top: 52, bar: 60, head: 90, h: 'regular' });
    expect(hs.closed).toBeLessThanOrEqual(hs.half);
    expect(hs.half).toBeLessThanOrEqual(hs.full);
  });

  it('half leaves the tab body 200 px on every phone of the harness, 160 on the SE in Safari (IMPL §4 P2b)', () => {
    for (const [id, w, H] of PHONES) {
      const hs = sheetHeights({ H, top: 52, bar: 60, head: HEAD, h: classify(w, H, TOUCH).h });
      expect(hs.half - HEAD, id).toBeGreaterThanOrEqual(id === 'se-safari' ? 160 : 200);
      expect(classify(w, H, TOUCH).host, id).toBe('sheet');
    }
  });

  it('a released drag rests on the nearest detent; a fling goes on to the next one its way', () => {
    const hs = { closed: 64, half: 375, full: 740 };
    const all = detentsOf('sheet', false), tiny = detentsOf('sheet', true);
    expect(snapDetent(64, 0, hs, all)).toBe('closed');
    expect(snapDetent(210, 0, hs, all)).toBe('closed');     // nearer closed than half
    expect(snapDetent(230, 0, hs, all)).toBe('half');
    expect(snapDetent(600, 0, hs, all)).toBe('full');
    expect(snapDetent(100, FLING, hs, all)).toBe('half');   // a flick up off closed: half, not past it
    expect(snapDetent(400, FLING, hs, all)).toBe('full');
    expect(snapDetent(740, 2, hs, all)).toBe('full');        // nothing above the top
    expect(snapDetent(700, -FLING, hs, all)).toBe('half');
    expect(snapDetent(350, -FLING, hs, all)).toBe('closed');
    expect(snapDetent(64, -2, hs, all)).toBe('closed');
    expect(snapDetent(300, FLING * 0.9, hs, all)).toBe('half');   // under the fling speed: the nearest
    expect(snapDetent(100, FLING, hs, tiny)).toBe('full');   // a tiny sheet has no half
    expect(snapDetent(380, 0, hs, tiny)).toBe('closed');
  });

  it('a tap on the grabber cycles closed → half → full → closed (a tiny sheet closed ↔ full)', () => {
    const all = detentsOf('sheet', false), tiny = detentsOf('sheet', true);
    expect([cycleDetent('closed', all), cycleDetent('half', all), cycleDetent('full', all)]).toEqual(['half', 'full', 'closed']);
    expect([cycleDetent('closed', tiny), cycleDetent('full', tiny)]).toEqual(['full', 'closed']);
  });

  it('the bar: five stable slots, Annales on none; the open tab\'s slot folds a sheet that is up', () => {
    expect(BAR_SLOTS).toEqual(['council', 'advisors', 'build', 'people', 'trade']);
    expect(TABS.map(barSlot)).toEqual([1, 2, 3, 4, 5, 0]);
    expect(BAR_SLOTS).toEqual(TABS.filter((t) => t !== 'annals'));   // the panels' order, one slot each
    for (const d of ['half', 'full'] as const) expect(slotTap('people', 'people', d)).toBe('close');
    expect(slotTap('people', 'people', 'closed')).toBe('open');
    for (const d of DETENTS) expect(slotTap('build', 'people', d)).toBe('open');
  });

  it('a slot tap that opens routes as a tab: the tab\'s own detent (IMPL §1), whatever the sheet showed', () => {
    const c = (detent: Detent): RouteCtx => ({ host: 'sheet', detent, tiny: false });
    expect(route({ kind: 'open', tab: 'people', from: 'tab' }, c('closed')).detent).toBe('half');
    expect(route({ kind: 'open', tab: 'council', from: 'tab' }, c('closed')).detent).toBe('full');
    expect(route({ kind: 'open', tab: 'council', from: 'tab' }, c('half')).detent).toBe('full');   // Populus at half → Edicta
    expect(route({ kind: 'open', tab: 'trade', from: 'tab' }, c('half')).detent).toBe('full');
    expect(route({ kind: 'open', tab: 'people', from: 'tab' }, c('full')).detent).toBe('half');    // Edicta at full → Populus
    expect(route({ kind: 'open', tab: 'council', from: 'chip' }, c('closed')).detent).toBe('half');   // Review: the Mandata part-way
    expect(route({ kind: 'place' }, c('half'))).toEqual({ detent: 'closed', remember: true, card: false });
    expect(DEFAULT_DETENT.sheet).toBe('closed');
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

describe('hostEntryDetent (a host change: entering the SHEET closes it)', () => {
  it('a load or a turn to portrait shows the map; a tab opened just now keeps its detent', () => {
    for (const d of DETENTS) {
      expect(hostEntryDetent(d, false, 'drawer', 'sheet', false, false), d).toEqual({ detent: 'closed', forced: false });
      expect(hostEntryDetent(d, false, 'dock', 'sheet', false, false), d).toEqual({ detent: 'closed', forced: false });
      expect(hostEntryDetent(d, false, null, 'sheet', false, false), d).toEqual({ detent: 'closed', forced: false });   // a load
    }
    expect(hostEntryDetent('full', true, 'drawer', 'sheet', true, false)).toEqual({ detent: 'closed', forced: false });   // never a forced full
    expect(hostEntryDetent('half', false, 'drawer', 'sheet', false, true)).toEqual({ detent: 'half', forced: false });  // just opened
    expect(hostEntryDetent('full', false, 'drawer', 'sheet', false, true)).toEqual({ detent: 'full', forced: false });
    expect(hostEntryDetent('half', false, 'drawer', 'sheet', true, true)).toEqual({ detent: 'full', forced: true });    // tiny: no half
  });

  it('every other change keeps the player\'s detent (keepDetent)', () => {
    for (const d of DETENTS) {
      for (const jo of [false, true]) {
        expect(hostEntryDetent(d, false, 'sheet', 'drawer', false, jo), `sheet→drawer ${d}`).toEqual({ detent: d, forced: false });
        expect(hostEntryDetent(d, false, 'dock', 'columns', false, jo), `dock→columns ${d}`).toEqual({ detent: d, forced: false });
        expect(hostEntryDetent(d, false, 'columns', 'dock', false, jo), `columns→dock ${d}`).toEqual({ detent: d, forced: false });
        expect(hostEntryDetent(d, false, 'sheet', 'sheet', false, jo), `a resize on the sheet ${d}`).toEqual({ detent: d, forced: false });
        expect(hostEntryDetent(d, false, null, 'dock', false, jo), `a load on a dock ${d}`).toEqual({ detent: d, forced: false });
      }
    }
    expect(hostEntryDetent('full', true, 'sheet', 'sheet', false, false)).toEqual({ detent: 'half', forced: false });   // un-tinied
    expect(hostEntryDetent('half', false, 'sheet', 'sheet', true, false)).toEqual({ detent: 'full', forced: true });    // tinied
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

describe('the landscape drawer', () => {
  // the harness's landscape phones (impl/measure.mjs) and the Home Screen window of platform.md, with the 56 px spine
  const LAND: readonly [string, number, number][] = [['phone-land', 852, 393], ['phone-land-safari', 852, 340], ['iphone-land-pwa', 734, 372], ['se-land', 667, 375]];

  it('the pane is clamp(280, 42% of #app, 360) at half and everything left of the spine at full; closed has none', () => {
    expect(drawerWidths(852, 56)).toEqual({ closed: 0, half: 358, full: 796 });   // SPEC A §7: x438–796
    expect(drawerWidths(734, 56)).toEqual({ closed: 0, half: 308, full: 678 });
    expect(drawerWidths(667, 56)).toEqual({ closed: 0, half: 280, full: 611 });   // the floor
    expect(drawerWidths(959, 56)).toEqual({ closed: 0, half: 360, full: 903 });   // the cap
    expect(drawerWidths(300, 56)).toEqual({ closed: 0, half: 244, full: 244 });   // never wider than full
    expect(drawerWidths(852, 0)).toEqual({ closed: 0, half: 358, full: 852 });    // no spine yet (a new colony)
    expect(DRAWER).toMatchObject({ spine: 56, paneMin: 280, paneShare: 0.42, paneMax: 360 });
  });

  // a budget of the frame's sizes (the live free map is measured by the acceptance harness, impl/measure.mjs): what the
  // opaque chrome takes, and on the two phones of the acceptance what floats over the map's corner too
  it('the budget: the 56 px spine and the 44 px HUD leave over 70% of the window to the map, half a pane of 280 px or more', () => {
    for (const [id, W, H] of LAND) {
      expect(classify(W, H, TOUCH).host, id).toBe('drawer');
      const ws = drawerWidths(W, DRAWER.spine);
      expect(((W - DRAWER.spine) * (H - 44)) / (W * H), id).toBeGreaterThanOrEqual(0.7);
      expect(ws.half, id).toBeGreaterThanOrEqual(280);
      expect(ws.full - ws.half, id).toBeGreaterThanOrEqual(300);   // half keeps the map beside it
    }
    // closed on 852 × 393 and 852 × 340: less the floating voice line (380 × 48 at most) and the tool column (5 × 44 px
    // and their gaps), still 70%
    for (const [id, W, H] of LAND.slice(0, 2)) {
      const voice = Math.min(380, W - DRAWER.spine - 8 - 68) * 48, column = 44 * (5 * 44 + 4 * 4);
      expect(((W - DRAWER.spine) * (H - 44) - voice - column) / (W * H), id).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('a drag of the pane\'s edge comes to rest on the nearest width; a fling goes on to the next one its way', () => {
    const ws = drawerWidths(852, 56), all = detentsOf('drawer', false);
    expect(snapDetent(358, 0, ws, all)).toBe('half');
    expect(snapDetent(170, 0, ws, all)).toBe('closed');     // dragged most of the way right
    expect(snapDetent(200, 0, ws, all)).toBe('half');
    expect(snapDetent(600, 0, ws, all)).toBe('full');
    expect(snapDetent(380, FLING, ws, all)).toBe('full');   // a flick to the left: the next one wider
    expect(snapDetent(340, -FLING, ws, all)).toBe('closed');
    expect(snapDetent(700, -FLING, ws, all)).toBe('half');
    expect(snapDetent(796, 3, ws, all)).toBe('full');        // nothing past full
    expect(detentsOf('drawer', true)).toEqual(DETENTS);     // a short phone is tiny, and keeps its half
  });

  it('the spine: the open tab\'s icon closes an open pane, any other opens its tab at half (a switch at full stays full)', () => {
    for (const d of ['half', 'full'] as const) expect(slotTap('people', 'people', d)).toBe('close');
    expect(slotTap('people', 'people', 'closed')).toBe('open');
    const c = (detent: Detent): RouteCtx => ({ host: 'drawer', detent, tiny: true });
    expect(route({ kind: 'open', tab: 'trade', from: 'tab' }, c('closed')).detent).toBe('half');
    expect(route({ kind: 'open', tab: 'trade', from: 'tab' }, c('full')).detent).toBe('full');
    expect(route({ kind: 'open', tab: 'council', from: 'chip' }, c('closed')).detent).toBe('half');
    expect(DEFAULT_DETENT.drawer).toBe('closed');
    expect(aboveDefault('half', 'drawer')).toBe(true);    // half and full are Back layers
    expect(aboveDefault('closed', 'drawer')).toBe(false);
    expect(stepDown('full', 'drawer', true)).toBe('half');
  });

  it('clearOf: the free map above a wide, short thing at its foot, beside a tall one, whole when they do not meet', () => {
    const map: Box = { left: 0, top: 44, right: 740, bottom: 393 };
    // the floating voice line (8–388 × 341–385): above it
    expect(clearOf(map, { left: 8, top: 341, right: 388, bottom: 385 }, 8)).toEqual({ left: 0, top: 44, right: 740, bottom: 333 });
    // a context card 398 × 245 at the bottom-left: right of it
    expect(clearOf(map, { left: 8, top: 140, right: 406, bottom: 385 }, 8)).toEqual({ left: 414, top: 44, right: 740, bottom: 393 });
    // the one-row placing banner (8–736 × 329–385): above it
    expect(clearOf(map, { left: 8, top: 329, right: 736, bottom: 385 }, 8)).toEqual({ left: 0, top: 44, right: 740, bottom: 321 });
    // nothing in the way: the box itself (a copy)
    const far = clearOf(map, { left: 760, top: 50, right: 790, bottom: 90 });
    expect(far).toEqual(map);
    expect(far).not.toBe(map);
    // a tie goes above
    expect(clearOf({ left: 0, top: 0, right: 100, bottom: 100 }, { left: 0, top: 50, right: 50, bottom: 100 })).toEqual({ left: 0, top: 0, right: 100, bottom: 50 });
  });

  it('priorityDrops: as many of the droppable figures go, in their order, as the row needs to fit; none while it fits', () => {
    const w = [164, 56, 99, 104, 88, 120];   // the date, spirits, souls, coin, Aqua, Grain (with their gaps)
    expect(priorityDrops(820, 848, w)).toBe(0);
    expect(priorityDrops(848, 848, w)).toBe(0);
    expect(priorityDrops(849, 848, w)).toBe(1);   // the date first
    expect(priorityDrops(820, 678, w)).toBe(1);   // a 734 px Home Screen window less its pads: the date steps out
    expect(priorityDrops(820, 640, w)).toBe(2);   // then spirits
    expect(priorityDrops(820, 400, w)).toBe(4);   // … souls and coin, Aqua and Grain still in
    expect(priorityDrops(2000, 100, w)).toBe(6);  // never more than there are
    expect(priorityDrops(500, 600, [])).toBe(0);
  });
});

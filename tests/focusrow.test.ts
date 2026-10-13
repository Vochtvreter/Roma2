// tests/focusrow.test.ts — the focus row's pure part (src/ui/focusrow.ts, DESIGN §15.7): what a ledger row names on the
// map (its data-focus value, built and read back), and the tile rects that resolves to in a state: a building's
// footprint, an Agenda wish's, a labour category's works (the builders' sites and the rising town wall), the homes in
// decline; and their union, which the map brings into view; and the hosts whose panel keeps the row (the tablet DOCK,
// the desktop COLUMNS). Headless: the module touches no DOM at import.
import { describe, expect, it } from 'vitest';
import type { Remedy } from '../src/game/types';
import { LABOR_CATS } from '../src/game/types';
import { FOCUS_HOSTS, focusOfAdvisory, focusOfBuilding, focusOfLabour, focusOfWish, focusRects, keepsFocus, parseFocus, unionRect, wallStretch } from '../src/ui/focusrow';
import { commissionWalls, wallsRising } from '../src/game/urbs';
import { invalidate } from '../src/game/memo';
import { BUILDING_DEFS } from '../src/game/data/buildings';
import { footprintOf } from '../src/game/derived';
import { W, idx } from '../src/game/map';
import { fresh, freeSlots, place } from './util';

describe('a row\'s data-focus', () => {
  it('builds and reads back every kind; refuses what it does not know', () => {
    expect(parseFocus(focusOfBuilding(12))).toEqual({ kind: 'building', id: 12 });
    expect(parseFocus(focusOfWish('puteus', 5034))).toEqual({ kind: 'wish', type: 'puteus', tile: 5034 });
    for (const cat of LABOR_CATS) expect(parseFocus(focusOfLabour(cat))).toEqual({ kind: 'labour', cat });
    expect(parseFocus('decl')).toEqual({ kind: 'declining' });
    for (const junk of [undefined, '', 'b:', 'b:x', 'w:nothing:12', 'w:puteus:', 'c:sleep', 'x:1', 'b:1.5']) expect(parseFocus(junk), String(junk)).toBeNull();
    expect(FOCUS_HOSTS).toEqual(['dock', 'columns']);   // (P5: the desktop's panel keeps one too)
    expect(keepsFocus('columns')).toBe(true);
    expect(keepsFocus('dock')).toBe(true);
    expect(keepsFocus('sheet')).toBe(false);
    expect(keepsFocus('drawer')).toBe(false);
    expect(keepsFocus(null)).toBe(false);   // before the layout runs
  });

  it('an advisory names the building its remedy centres, the Aedilis\' decline every declining home, else nothing', () => {
    const centre: Remedy = { kind: 'building', op: 'center', id: 7 };
    const overlay: Remedy = { kind: 'overlay', overlay: 'aqua' };
    expect(focusOfAdvisory('aquarum.something', [{ remedy: overlay }, { remedy: centre }])).toBe('b:7');
    expect(focusOfAdvisory('aedilis.declining', [{ remedy: overlay }])).toBe('decl');
    expect(focusOfAdvisory('annonae.grain', [{ remedy: overlay }, { remedy: { kind: 'building', op: 'open', id: 3 } }])).toBeNull();
    expect(focusOfAdvisory('annonae.grain', [])).toBeNull();
  });
});

describe('what a row names on the map (focusRects)', () => {
  const box = (tiles: number[]) => {
    const xs = tiles.map((i) => i % W), ys = tiles.map((i) => Math.floor(i / W));
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 };
  };

  it('a building: its whole footprint; nothing once it is gone', () => {
    const s = fresh();
    for (const b of s.buildings) expect(focusRects(s, { kind: 'building', id: b.id })).toEqual([box(footprintOf(b, s))]);
    expect(focusRects(s, { kind: 'building', id: 99_999 })).toEqual([]);
  });

  it('a wish: the work\'s footprint at its tile, the work itself once it stands there', () => {
    const s = fresh();
    const at = freeSlots(s, 'puteus')[0], tile = idx(at.x, at.y);
    const [w, h] = BUILDING_DEFS.puteus.size;
    expect(focusRects(s, { kind: 'wish', type: 'puteus', tile })).toEqual([{ x: at.x, y: at.y, w, h }]);
    expect(place(s, 'puteus', at.x, at.y).ok).toBe(true);
    const well = s.buildings[s.buildings.length - 1];
    expect(focusRects(s, { kind: 'wish', type: 'puteus', tile })).toEqual([box(footprintOf(well, s))]);
  });

  it('a labour category: its finished works with posts, in order; the builders: every site in hand', () => {
    const s = fresh();
    for (const cat of LABOR_CATS.filter((c) => c !== 'builders')) {
      const want = s.buildings.filter((b) => b.status === 'done' && BUILDING_DEFS[b.type].labor === cat && BUILDING_DEFS[b.type].slots > 0);
      expect(focusRects(s, { kind: 'labour', cat })).toEqual(want.map((b) => box(footprintOf(b, s))));
    }
    const before = focusRects(s, { kind: 'labour', cat: 'builders' }).length;
    const at = freeSlots(s, 'puteus')[0];
    expect(place(s, 'puteus', at.x, at.y).ok).toBe(true);   // a new site
    expect(focusRects(s, { kind: 'labour', cat: 'builders' })).toHaveLength(before + 1);
    expect(focusRects(s, { kind: 'labour', cat: 'water' }).some((r) => r.x === at.x && r.y === at.y)).toBe(false);   // not staffed until done
  });

  it("the builders: the town wall's next stretch while its crew raises it", () => {
    const s = fresh();
    s.rank = 3;
    invalidate(s);
    s.res.stone = 1e6;
    s.res.denarii = 1e6;
    const sites = focusRects(s, { kind: 'labour', cat: 'builders' });
    expect(wallStretch(s)).toBeNull();                                    // no wall laid out
    expect(commissionWalls(s).ok).toBe(true);
    const mo = s.urbs.moenia!;
    expect(wallsRising(s)).toBe(true);
    const tile = (k: number) => ({ x: mo.tiles[k] % W, y: Math.floor(mo.tiles[k] / W), w: 1, h: 1 });
    expect(focusRects(s, { kind: 'labour', cat: 'builders' })).toEqual([...sites, tile(0)]);
    mo.progress = 0.5;
    expect(focusRects(s, { kind: 'labour', cat: 'builders' })).toEqual([...sites, tile(Math.floor(mo.tiles.length * 0.5))]);
    mo.progress = 1;
    expect(focusRects(s, { kind: 'labour', cat: 'builders' })).toEqual([...sites, tile(mo.tiles.length - 1)]);
    mo.done = s.day;                                                      // finished: no crew
    expect(focusRects(s, { kind: 'labour', cat: 'builders' })).toEqual(sites);
    mo.done = null;
    s.res.stone = 0;                                                      // waiting for stone: no crew either
    expect(focusRects(s, { kind: 'labour', cat: 'builders' })).toEqual(sites);
  });

  it('the declining homes: each of them', () => {
    const s = fresh();
    const houses = s.buildings.filter((b) => b.house);
    expect(houses.length).toBeGreaterThan(1);   // the founding tents
    expect(focusRects(s, { kind: 'declining' })).toEqual([]);
    houses[0].house!.declining = true;
    houses[1].house!.declining = true;
    expect(focusRects(s, { kind: 'declining' })).toEqual([box(footprintOf(houses[0], s)), box(footprintOf(houses[1], s))]);
  });

  it('unionRect: the smallest rect holding them all; null for none', () => {
    expect(unionRect([])).toBeNull();
    expect(unionRect([{ x: 4, y: 5, w: 2, h: 2 }])).toEqual({ x: 4, y: 5, w: 2, h: 2 });
    expect(unionRect([{ x: 4, y: 5, w: 2, h: 2 }, { x: 10, y: 1, w: 3, h: 1 }, { x: 6, y: 9, w: 1, h: 1 }])).toEqual({ x: 4, y: 1, w: 9, h: 9 });
  });
});

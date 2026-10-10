// tests/render.test.ts — render-side decisions that are plain functions of the state (no canvas): the snow palette of a
// Hiems dura (REVIEW R49), and the looks that path choices and cosmetic rewards give the map (REVIEW R30, R31).
import { describe, expect, it } from 'vitest';
import { seasonOf } from '../src/game/calendar';
import { paletteOf } from '../src/render/terrain';
import { looks } from '../src/render/decor';
import { MILESTONES } from '../src/game/objectives';
import { PATH_DEFS } from '../src/game/data/decisions';
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

describe('render: path looks and cosmetic rewards', () => {
  it('follow the paths chosen, and refresh when a path is added', () => {
    const s = fresh(42);
    s.decisions.paths = { charter: 'veterani' };
    expect(looks(s)).toMatchObject({ cloaks: true, standards: true, stalls: false, mules: false, togas: false });
    s.decisions.paths.path3 = 'iusLatii';
    expect(looks(s)).toMatchObject({ cloaks: true, togas: true, dole: false });
    s.decisions.paths = { charter: 'mercatores', path1: 'pagus', path2: 'arsFabrilis', path3: 'aquaeSalutares' };
    expect(looks(s)).toMatchObject({ cloaks: false, stalls: true, mules: true, hay: true, anvil: true, smoke: 1.6, baths: 2, incense: 1 });
  });

  it('show each cosmetic reward only once its milestone is recorded', () => {
    const s = fresh(42);
    expect(looks(s)).toMatchObject({ gilded: false, statues: false, fountains: false, banners: false, quadriga: false, gateGarlands: false, lanterns: false });
    const reward: Record<string, keyof ReturnType<typeof looks>> = {
      gildedStandards: 'gilded', bronzeStatues: 'statues', minimapFountains: 'fountains', purpleBanners: 'banners',
      gildedQuadriga: 'quadriga', triumphalGarlands: 'gateGarlands', festalLanterns: 'lanterns',
    };
    for (const m of MILESTONES) {
      const c = m.unlocks.find((u) => u.kind === 'cosmetic' && reward[u.id]);
      if (!c || c.kind !== 'cosmetic') continue;
      expect(looks(s)[reward[c.id]], c.id).toBe(false);
      s.guidance.milestoneDays[m.id] = s.day;
      expect(looks(s)[reward[c.id]], c.id).toBe(true);
    }
  });

  it('every path option with a promise is drawn (DESIGN §9.2), except those drawn elsewhere', () => {
    // coloni (more family carts: more arrivals), viaMilitaris (the paved via) and the Colonia crowns are drawn by the
    // sim's own effects and buildings.ts; every other option must change a look
    const elsewhere = new Set(['coloni', 'viaMilitaris', 'iuppiter', 'aeternitas', 'imperium']);
    const base = JSON.stringify(looks(fresh(42)));
    for (const def of Object.values(PATH_DEFS))
      for (const o of def.options) {
        if (elsewhere.has(o.id)) continue;
        const s = fresh(42);
        s.decisions.paths = { [def.id]: o.id };
        expect(JSON.stringify(looks(s)), o.id).not.toBe(base);
      }
  });
});

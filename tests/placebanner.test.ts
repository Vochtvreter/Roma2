// tests/placebanner.test.ts — entering placement (ui/mapbar.openPlacing): a pre-positioned placement (an advisor's "Place
// it myself", the Consiliarii, "Could be built here") ends with the map's verdict on its tile, so a touch player gets
// Place at once instead of an empty banner that asks for a second tap. The inspector's Place buttons pre-position too:
// the slot that serves the house (else the one nearest it), a free plot in the tapped block. Headless: a stand-in view drives the real Placement
// as MapView.startPlacing does.
import { describe, expect, it } from 'vitest';
import type { BuildingId, GameState, PlaceCheck } from '../src/game/types';
import type { PlacingState } from '../src/render/view';
import { Placement } from '../src/render/placement';
import { openPlacing } from '../src/ui/mapbar';
import { fixSlot } from '../src/ui/tabs/house';
import { canPlace, freePlot, placeBuilding, validSlots } from '../src/game/place';
import { bestSlot, resolvePlaceAt } from '../src/game/site';
import { serveSlot } from '../src/game/advisors/util';
import { classAt, sizeOf } from '../src/game/derived';
import { previewCovered } from '../src/game/coverage';
import { nextTier, unmetNeeds } from '../src/game/housing';
import { getMap, tx, ty } from '../src/game/map';
import { fresh } from './util';

type Draw = [PlacingState | null, PlaceCheck | null];

/** The app's wiring (main.ts): the view previews a pre-positioned tile as it starts (MapView.startPlacing) and its
 *  onPlacementPreview redraws the banner with the view's placing state; every banner draw is recorded. */
function wired(): { view: { startPlacing(p: PlacingState, s: GameState): void }; banner: (p: PlacingState | null, c: PlaceCheck | null) => void; draws: Draw[] } {
  const draws: Draw[] = [];
  const banner = (p: PlacingState | null, c: PlaceCheck | null): void => { draws.push([p, c]); };
  const place = new Placement();
  let placing: PlacingState | null = null;
  const view = {
    startPlacing(p: PlacingState, s: GameState): void {
      placing = p;
      place.start(p, s);
      if (p.kind === 'building' && p.at !== undefined) banner(placing, place.check);
    },
  };
  return { view, banner, draws };
}

describe('openPlacing: the banner of a pre-positioned placement', () => {
  for (const type of ['area', 'puteus'] as BuildingId[]) {
    it(`${type}: ends with the verdict on its tile, so a touch banner shows Place without a second tap`, () => {
      const s = fresh(42);
      const at = bestSlot(s, type, { owner: 'player' })?.tile;
      expect(at).toBeDefined();
      const p: PlacingState = { kind: 'building', type, at };
      const { view, banner, draws } = wired();
      openPlacing(view, banner, p, s);
      expect(draws[0]).toEqual([p, null]);                       // the banner opens first…
      const [shown, check] = draws[draws.length - 1];            // …and the map's verdict has the last word
      expect(shown).toBe(p);
      expect(check?.ok).toBe(true);                              // renderPlaceBanner: Place shows when coarse && check.ok
      expect(check).toEqual(canPlace(s, type, at!, { owner: 'player' }));
    });
  }

  it('without a tile the banner keeps the empty verdict until the player picks a plot', () => {
    const s = fresh(42);
    const p: PlacingState = { kind: 'building', type: 'area' };
    const { view, banner, draws } = wired();
    openPlacing(view, banner, p, s);
    expect(draws).toEqual([[p, null]]);
  });
});

describe('the inspector pre-positions its Place buttons', () => {
  it("a house's Place button sets the ghost on a free slot that serves that house", () => {
    const s = fresh(42);
    const dry = s.buildings.filter((b) => b.house && unmetNeeds(s, b, nextTier(s, b)!).includes('water'));
    expect(dry.length).toBeGreaterThan(0);
    for (const b of dry) {
      const at = fixSlot(s, b.id, 'water', 'puteus');
      expect(at).toBeDefined();
      expect(validSlots(s, 'puteus', 'player').has(at!)).toBe(true);
      const reach = previewCovered(s, 'puteus', tx(at!), ty(at!)).filter((l) => l.layer === 'water');
      expect(reach.some((l) => l.houses.includes(b.id))).toBe(true);
    }
  });

  it("with no free slot that reaches the house, its Place still starts by it: the valid slot nearest the house", () => {
    const s = fresh(42);
    const b = s.buildings.find((x) => x.house && unmetNeeds(s, x, nextTier(s, x)!).includes('water'))!;
    expect(b).toBeDefined();
    // every free slot that reaches it taken (the Ordo builds there) until none serves it
    for (let i = 0; i < 30; i++) {
      const at = serveSlot(s, 'puteus', 'player', 'water', [b.id])?.tile;
      if (at === undefined) break;
      expect(placeBuilding(s, 'puteus', at, { owner: 'ordo', ignoreCost: true }).ok).toBe(true);
    }
    expect(serveSlot(s, 'puteus', 'player', 'water', [b.id])).toBeNull();
    const at = fixSlot(s, b.id, 'water', 'puteus');
    expect(at).toBeDefined();
    expect(validSlots(s, 'puteus', 'player').has(at!)).toBe(true);
    const [w, h] = sizeOf(b.type, classAt(s, b.type, b.x, b.y));
    expect(at).toBe(resolvePlaceAt(s, 'puteus', undefined, 'player', { near: { x: b.x, y: b.y, w, h } }));
  });

  it('"Place a house plot" takes a free plot in the tapped block, then the next one', () => {
    const s = fresh(42);
    const sv = getMap(s.seed).survey;
    const open = [...new Set([...validSlots(s, 'area', 'player').keys()].map((t) => sv.blockAt[t]))].filter((id) => id >= 0);
    expect(open.length).toBeGreaterThan(1);
    const [a, b] = open;
    const pa = freePlot(s, a, 'player'), pb = freePlot(s, b, 'player');
    expect(pa !== null && sv.blockAt[pa] === a && canPlace(s, 'area', pa, { owner: 'player' }).ok).toBe(true);
    expect(pb !== null && sv.blockAt[pb] === b).toBe(true);
    expect(placeBuilding(s, 'area', pa!, { ignoreCost: true }).ok).toBe(true);
    const next = freePlot(s, a, 'player');
    expect(next !== null && next !== pa && sv.blockAt[next] === a).toBe(true);
  });

  it('a block with no glowing plot leaves the player to choose', () => {
    const s = fresh(42);
    const sv = getMap(s.seed).survey;
    const slots = validSlots(s, 'area', 'player');
    const shut = sv.blocks.findIndex((_, id) => ![...slots.keys()].some((t) => sv.blockAt[t] === id));
    expect(shut).toBeGreaterThanOrEqual(0);
    expect(freePlot(s, shut, 'player')).toBeNull();
  });
});

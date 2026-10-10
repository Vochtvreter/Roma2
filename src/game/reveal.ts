// src/game/reveal.ts — progressive reveal predicates and the next-unlock teaser (ARCHITECTURE §8.5, DESIGN §15.3). Owner: WP-D.
// SCAFFOLD: everything is revealed; buildings two ranks ahead stay hidden.
import type { BuildingId, GameState, OverlayId, ResId, SectionId, TabId, ToolId } from './types';
import { BUILDING_DEFS } from './data/buildings';

/** Whether a side-panel tab is revealed. */
export function tabRevealed(s: GameState, tab: TabId): boolean {
  void s; void tab;   // STUB(WP-D): DESIGN §15.3 reveal column
  return true;
}

/** Whether a resource is shown in the HUD strip. */
export function resourceRevealed(s: GameState, res: ResId): boolean {
  void s; void res;   // STUB(WP-D)
  return true;
}

/** Whether a council section (focus, edicts, settings, switches, manual, story) is revealed. */
export function sectionRevealed(s: GameState, sec: SectionId): boolean {
  void s; void sec;   // STUB(WP-D)
  return true;
}

/** Whether an overlay is available. */
export function overlayRevealed(s: GameState, o: OverlayId): boolean {
  void s; void o;     // STUB(WP-D)
  return true;
}

/** Whether a map tool is available. */
export function toolRevealed(s: GameState, t: ToolId): boolean {
  void s; void t;     // STUB(WP-D)
  return true;
}

/** Whether a building card is visible (hidden when ≥ 2 ranks ahead). */
export function buildingVisible(s: GameState, type: BuildingId): boolean {
  return BUILDING_DEFS[type].rank < s.rank + 2;
}

/** One-line teaser of the next unlock, or null. */
export function nextTeaser(s: GameState): { label: string; at: string } | null {
  void s;             // STUB(WP-D)
  return null;
}

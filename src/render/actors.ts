// src/render/actors.ts — walkers, carts, caravans, merchant, veterans, animals (ARCHITECTURE §12.6). Owner: WP-F.
// Visual only: walkers are sampled with hash2(personId, day) so a reload looks the same; they never touch the sim.
// SCAFFOLD: a typed stub that draws nothing.
import type { FxEvent, GameState, LaborCat, Rect } from '../game/types';

/** Tunic colour by labour category of the job (ARCHITECTURE §12.6). */
export const TUNIC: Readonly<Record<LaborCat | 'none', string>> = {
  water: '#62b0d6', food: '#d9a35b', materials: '#8a6b4a', industry: '#55565e', services: '#9e2f25', builders: '#c0623f', none: '#bba58b',
};

/** The walker and convoy layer. */
export class Actors {
  /** Drops every actor (new or loaded game). */
  reset(): void {
    // STUB(WP-F): walker pool, road-graph BFS cache per structEpoch.
  }

  /** Spawns convoys and columns for arrive/leave/caravan/rank events. */
  handleFx(_events: FxEvent[], _s: GameState): void {
    // STUB(WP-F): ox-cart and family on arrive, mule trains, legionary column, plough ox.
  }

  /** Advances the actors by dtMs of real time at the given game speed. */
  update(_dtMs: number, _s: GameState, _speed: number): void {
    // STUB(WP-F): min(220, pop / 4) walkers (120 on touch), home ↔ work along the roads.
  }

  /** Draws the actors in view (world-px transform applied). */
  draw(_g: CanvasRenderingContext2D, _vis: Rect): void {
    // STUB(WP-F)
  }
}

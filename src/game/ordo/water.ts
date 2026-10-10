// src/game/ordo/water.ts — what lifts the summer water low: the Ordo's Aestas wish (DESIGN §10.5 row 2) and the
// Curator Aquarum's Aestas remedies reckon it alike. A leaf of the Ordo: it imports only what the advisor rules already
// import (balance, calendar, economy, data), so either side may load it first.
import { B } from '../balance';
import type { BuildingId, CrunchForecast, EssentialForecast, GameState, SimView } from '../types';
import { seasonLength } from '../calendar';
import { maxPotential } from '../economy';
import { BUILDING_DEFS } from '../data/buildings';

const AESTAS = 1;

/** The work the Aestas wish raises, or null when none would lift the summer low (DESIGN §10.5 row 2).
 *  Room is the fix while Aestas is still ahead and a full store falls short of what Aestas takes from it: the deficit
 *  with every well manned, the water reserve, and the sun's share (evaporation, in proportion to the store). Then a
 *  cistern — unless the wells fall short in Aestas by more than one cistern's room could carry, when a well comes
 *  first. Otherwise a well, whose yield lifts the low by what it draws in Aestas before the low day: none when the low
 *  comes before a new well could draw (the store is short of water, not of room or yield; the labour plan tops it up).
 *  Room raised once Aestas has come cannot fill before the low, and room beyond what Aestas takes stays empty: each
 *  left the forecast as it was, and the next build day raised another (30 cisterns in five years in a grown city). */
export function aestasWork(s: GameState, v: SimView, w: EssentialForecast, wc: CrunchForecast, wr: number): BuildingId | null {
  const len = seasonLength(s.day + wc.startsIn);
  const deficit = w.cons - maxPotential(s, 'water', AESTAS);
  const kept = Math.max(0.5, 1 - B.economy.EVAPORATION * B.economy.EVAP_SEASON[AESTAS] * len);
  const hold = (Math.max(0, deficit) * len + wr * w.need) / kept;
  const room = BUILDING_DEFS.cisterna.storage?.water ?? 0;
  if (wc.startsIn > 0 && w.cap < hold && (deficit <= 0 || hold <= w.cap + room)) return 'cisterna';
  const ready = s.day + B.construction.STAKE_DAYS + Math.ceil(BUILDING_DEFS.puteus.work / Math.max(1, v.c.catStaffed.builders));
  return wc.lowestDay > Math.max(ready, s.day + wc.startsIn) ? 'puteus' : null;
}

// src/game/hints.ts — "how to get more", benefit lines and the inspector's output chain (ARCHITECTURE §8.6, DESIGN §8.1). Owner: WP-E.
// SCAFFOLD: generated from BUILDING_DEFS and HUB_DEFS; the live line and the full multiplier chain are STUBs.
import { BUILDINGS, HUBS, TRADE_RES } from './types';
import type { Building, BuildingId, GameState, ResId, SimView, TradeRes } from './types';
import { seasonOf, SEASON_NAMES } from './calendar';
import { seasonMult } from './economy';
import { hubOpen, price } from './trade';
import { BUILDING_DEFS } from './data/buildings';
import { HUB_DEFS } from './data/hubs';
import { RESOURCE_DEFS } from './data/resources';

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Ways to get more of a resource: producers, hubs that sell it, and a live line. */
export function howToGetMore(s: GameState, res: ResId, v: SimView): string[] {
  const out: string[] = [];
  for (const id of BUILDINGS) {
    const d = BUILDING_DEFS[id];
    if (d.output?.res === res) out.push(`${d.name}: ${num(d.output.perWorker)} a day per worker.`);
    else if (d.passive?.res === res) out.push(`${d.name}: ${num(d.passive.perDay)} a day.`);
  }
  if ((TRADE_RES as readonly string[]).includes(res)) {
    const tr = res as TradeRes;
    for (const h of HUBS) if (hubOpen(s, h) && price(s, h, tr, 'buy') !== null) out.push(`Import from ${HUB_DEFS[h].name}.`);
  }
  // STUB(WP-E): live line (who could be reassigned, best slot, stalled producers).
  out.push(`Stores hold ${Math.floor(s.res[res])} of ${num(v.c.caps[res])} ${RESOURCE_DEFS[res].unit}.`);
  return out;
}

/** The building card's one-line benefit. */
export function benefitLine(type: BuildingId): string {
  return BUILDING_DEFS[type].benefit;
}

/** The inspector's output chain (DESIGN §8.1), only non-1 factors. */
export function outputChain(s: GameState, b: Building): { label: string; value: string }[] {
  const def = BUILDING_DEFS[b.type];
  if (!def.output || b.status !== 'done') return [];
  const n = s.people.filter((p) => p.work === b.id).length;
  const season = seasonOf(s.day);
  const sm = seasonMult(s, b.type, season);
  const out = [{ label: 'Hands', value: String(n) }, { label: 'Per hand', value: num(def.output.perWorker) }];
  if (sm !== 1) out.push({ label: SEASON_NAMES[season], value: `×${num(sm)}` });
  // STUB(WP-E): site, skill, tools, spirits, fx, legacy factors.
  out.push({ label: 'Total', value: `${num(n * def.output.perWorker * sm)} ${RESOURCE_DEFS[def.output.res].unit} a day` });
  return out;
}

// src/game/data/resources.ts — DESIGN §4 (resources) and §13.1 (trade base prices). Owner: scaffold.
import type { ResId, ResourceDef } from '../types';

/** Every stocked resource (DESIGN §4): labels, unit, base cap (principia sheds), trade base price, icon sprite. */
export const RESOURCE_DEFS: Record<ResId, ResourceDef> = {
  denarii: {
    id: 'denarii', name: 'Coin', latin: 'Denarii', unit: 'den', baseCap: Infinity, trade: null, icon: 'i_denarii',
    desc: 'Coin for building costs, upkeep, petition fees and imports. The aerarium has no cap.',
  },
  grain: {
    id: 'grain', name: 'Grain', latin: 'Frumentum', unit: 'modii', baseCap: 600, trade: 2, icon: 'i_grain',
    desc: 'The only staple and vital #1. Grain above the horrea capacity sits in the open sheds and rots.',
  },
  water: {
    id: 'water', name: 'Water', latin: 'Aqua', unit: 'amphorae', baseCap: 300, trade: null, icon: 'i_water',
    desc: 'Drunk daily (vital #2); also drawn by the concrete works and the baths. Evaporates in Aestas.',
  },
  timber: {
    id: 'timber', name: 'Timber', latin: 'Lignum', unit: 'logs', baseCap: 300, trade: 3, icon: 'i_timber',
    desc: 'Building material and fuel for the tile kiln, the bloomery and the smithy.',
  },
  stone: {
    id: 'stone', name: 'Stone', latin: 'Lapis', unit: 'blocks', baseCap: 300, trade: 4, icon: 'i_stone',
    desc: 'Building, renovation, concrete and paving.',
  },
  tiles: {
    id: 'tiles', name: 'Tiles', latin: 'Tegulae', unit: 'stacks', baseCap: 100, trade: 4, icon: 'i_tiles',
    desc: 'Terracotta roof tiles for tiled cottages and up, and for civic buildings.',
  },
  concrete: {
    id: 'concrete', name: 'Concrete', latin: 'Opus caementicium', unit: 'cubicae', baseCap: 100, trade: null, icon: 'i_concrete',
    desc: 'The civic gate material: temples, baths, insulae, the aqueduct and the Capitolium.',
  },
  ore: {
    id: 'ore', name: 'Iron ore', latin: 'Venae ferri', unit: 'loads', baseCap: 100, trade: null, icon: 'i_ore',
    desc: 'Dug by the iron mine; smelted into iron at the bloomery.',
  },
  iron: {
    id: 'iron', name: 'Iron', latin: 'Ferrum', unit: 'ingots', baseCap: 100, trade: 10, icon: 'i_iron',
    desc: 'Tools, domus, thermae, petition fees and the Capitolium.',
  },
  tools: {
    id: 'tools', name: 'Tool kits', latin: 'Instrumenta', unit: 'kits', baseCap: 20, trade: null, icon: 'i_tools',
    desc: 'Issued automatically: +20% output for the building that receives one.',
  },
  oil: {
    id: 'oil', name: 'Oil', latin: 'Oleum', unit: 'amphorae', baseCap: 60, trade: 6, icon: 'i_oil',
    desc: 'Needed by every insula and domus.',
  },
  wine: {
    id: 'wine', name: 'Wine', latin: 'Vinum', unit: 'amphorae', baseCap: 60, trade: 8, icon: 'i_wine',
    desc: 'Needed by the domus and poured at festivals. No local producer: only trade and merchants bring it.',
  },
};

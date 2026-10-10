// src/game/data/hubs.ts — DESIGN §13.1 (goods), §13.2 (hubs), §13.3 (seasonal targets), §13.6 (merchants). Owner: scaffold.
//
// Prices: buy = TRADE_BASE × market × hub.buy × quirk.buy ÷ fx(tradePrice); sell = TRADE_BASE × market × hub.sell ×
// quirk.sell × fx(tradePrice). A quirk without a side ("oil & wine ×0.9") applies to both sides. 'refused' = the hub
// will not trade that good in that direction (buy = it will not sell to us; sell = it will not buy from us).
// Wine has no local producer: only Silvanum, Narbo and Massilia sell it (DESIGN §4); likewise oil is sold only by
// those three ("sells oil" is Silvanum's distinguishing quirk).
import type { HubDef, HubId, Quad, TradeRes } from '../types';

/** The six trade hubs (DESIGN §13.2): one-way days, price factors, quirks and the rank that opens them. */
export const HUB_DEFS: Record<HubId, HubDef> = {
  metellianus: {
    id: 'metellianus', name: 'Vicus Metellianus', days: 4, buy: 1.15, sell: 0.88, rank: 0,
    desc: 'Nearest hamlet: quick trips, but merchants charge a premium.',
    quirks: { oil: { buy: 'refused' }, wine: { buy: 'refused' } },
  },
  durii: {
    id: 'durii', name: 'Pagus Durii', days: 7, buy: 1.05, sell: 0.95, rank: 1,
    desc: 'A farming pagus with lean harvests: grain costs ×1.6 to buy there and fetches ×1.3.',
    quirks: { grain: { buy: 1.6, sell: 1.3 }, oil: { buy: 'refused' }, wine: { buy: 'refused' } },
  },
  silvanum: {
    id: 'silvanum', name: 'Oppidum Silvanum', days: 10, buy: 1.0, sell: 1.0, rank: 1,
    desc: 'A market town among the woods: it sells oil, and charges ×1.2 for wine.',
    quirks: { wine: { buy: 1.2 } },
  },
  narbo: {
    id: 'narbo', name: 'Forum Narbonis', days: 14, buy: 0.92, sell: 1.06, rank: 2,
    desc: 'The provincial road-town: timber is dear (×1.6), it will not sell iron, oil and wine are cheap (×0.9).',
    quirks: { timber: { buy: 1.6 }, iron: { buy: 'refused' }, oil: { buy: 0.9, sell: 0.9 }, wine: { buy: 0.9, sell: 0.9 } },
  },
  massilia: {
    id: 'massilia', name: 'Portus Massiliae', days: 12, buy: 0.88, sell: 1.1, rank: 2,
    desc: 'The Greek port: it will not sell grain, iron is dear (×1.6), it pays ×1.3 for timber, and its oil and wine are the cheapest (×0.8).',
    quirks: { grain: { buy: 'refused' }, iron: { buy: 1.6 }, timber: { sell: 1.3 }, oil: { buy: 0.8, sell: 0.8 }, wine: { buy: 0.8, sell: 0.8 } },
  },
  augusta: {
    id: 'augusta', name: 'Colonia Augusta', days: 18, buy: 0.82, sell: 1.15, rank: 3,
    desc: 'The great colonia far up the via: stone is dear (×1.6); it pays ×1.3 for iron and ×1.2 for tiles.',
    quirks: { stone: { buy: 1.6 }, iron: { sell: 1.3 }, tiles: { sell: 1.2 }, oil: { buy: 'refused' }, wine: { buy: 'refused' } },
  },
};

/** Base price in denarii per unit of each tradeable good (DESIGN §13.1). */
export const TRADE_BASE: Record<TradeRes, number> = { grain: 2, timber: 3, stone: 4, tiles: 4, iron: 10, oil: 6, wine: 8 };

/** Seasonal market targets [Ver, Aestas, Autumnus, Hiems] that `market[res]` eases toward (DESIGN §13.3). */
export const SEASON_TARGET: Record<TradeRes, Quad> = {
  grain: [1.15, 0.95, 0.8, 1.25],
  timber: [1.0, 1.0, 1.0, 1.2],
  stone: [1.0, 1.0, 1.0, 1.0],
  tiles: [1.0, 1.0, 1.0, 1.0],
  iron: [1.0, 1.0, 1.0, 1.0],
  oil: [1.0, 1.0, 1.1, 0.85],
  wine: [1.0, 1.0, 0.85, 1.0],
};

/** Visiting merchant caravan names (from rome; DESIGN §13.6). */
export const MERCHANT_NAMES: string[] = [
  'Caravan from Lutetia', 'Syrian spice traders', 'Gallic cattle merchants', 'Pannonian iron peddlers', 'Greek wine factors',
];

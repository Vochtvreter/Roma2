// src/game/data/housing.ts — DESIGN §7.1 (tiers), §7.7 (wants), §7.4 / ARCHITECTURE §12.5 (coverage layers). Owner: scaffold.
//
// `needs` is the cumulative list a house must meet to BECOME (and to stay) that tier, in NEEDS order.
// 'desirability' compares the house's desirability with `desirMin`; 'rank' compares the colony rank with `rank`.
// 'materials' is never listed: it is the renovation-pool want shown once every listed need holds (§7.2, §7.7).
// Path bonuses (Coloni: T0–T2 +2 beds via fxAdd lowCap; Ius Latii: insula +4 via fxAdd insulaCap) and the aquae
// variant (insula +6 beds, domus tax ×1.3, +1 dignitas; B.housing) are applied by census/housing, not here.
import type { CoverageLayerId, HouseTierDef, HouseTierId, NeedId } from '../types';

/** The six house tiers (DESIGN §7.1): beds, tax per resident-day, cumulative needs, renovation materials, rank, dignitas. */
export const TIER_DEFS: Record<HouseTierId, HouseTierDef> = {
  tentoria: {
    id: 'tentoria', level: 0, name: 'Tents', latin: 'Tentoria',
    beds: 5, tax: 0.02, needs: ['street'], desirMin: null,
    renovation: { timber: 4 }, rank: 0, dignitas: 0, patrician: false, desir: [0, 0],
  },
  casa: {
    id: 'casa', level: 1, name: 'Wattle-and-thatch hut', latin: 'Casa',
    beds: 8, tax: 0.04, needs: ['street', 'water', 'fed'], desirMin: null,
    renovation: { timber: 8 }, rank: 0, dignitas: 0.5, patrician: false, desir: [0, 0],
  },
  tegulata: {
    id: 'tegulata', level: 2, name: 'Tiled cottage', latin: 'Casa tegulata',
    beds: 10, tax: 0.06, needs: ['street', 'water', 'fed', 'religion', 'market', 'desirability', 'rank'], desirMin: -5,
    renovation: { timber: 6, tiles: 8 }, rank: 1, dignitas: 1, patrician: false, desir: [0, 0],
  },
  domusParva: {
    id: 'domusParva', level: 3, name: 'Stone house', latin: 'Domus parva',
    beds: 13, tax: 0.08, needs: ['street', 'water', 'fed', 'religion', 'market', 'temple', 'desirability', 'rank'], desirMin: 0,
    renovation: { stone: 12, tiles: 8 }, rank: 2, dignitas: 2, patrician: false, desir: [0, 0],
  },
  insula: {
    id: 'insula', level: 4, name: 'Apartment block', latin: 'Insula',
    beds: 24, tax: 0.07,
    needs: ['street', 'water', 'fed', 'religion', 'market', 'temple', 'desirability', 'baths', 'macellum', 'oil', 'rank'], desirMin: 0,
    renovation: { stone: 20, tiles: 12, concrete: 8 }, rank: 2, dignitas: 3, patrician: false, desir: [-1, 2],
  },
  domus: {
    id: 'domus', level: 4, name: 'Atrium house', latin: 'Domus',
    beds: 10, tax: 0.30,
    needs: ['street', 'water', 'fed', 'religion', 'market', 'temple', 'desirability', 'baths', 'macellum', 'oil', 'wine', 'rank'], desirMin: 10,
    renovation: { stone: 16, tiles: 12, concrete: 6, iron: 4 }, rank: 2, dignitas: 5, patrician: true, desir: [1, 2],
  },
};

/** Labels and want-bubble icons for every house need (DESIGN §7.7; icon sprites `i_want_<needId>`). */
export const NEED_META: Record<NeedId, { label: string; icon: string }> = {
  street: { label: 'Street access', icon: 'i_want_street' },
  water: { label: 'Water', icon: 'i_want_water' },
  fed: { label: 'Fed', icon: 'i_want_fed' },
  religion: { label: 'A shrine', icon: 'i_want_religion' },
  market: { label: 'A market', icon: 'i_want_market' },
  temple: { label: 'A temple', icon: 'i_want_temple' },
  desirability: { label: 'Desirability', icon: 'i_want_desirability' },
  baths: { label: 'Baths', icon: 'i_want_baths' },
  macellum: { label: 'A market hall', icon: 'i_want_macellum' },
  oil: { label: 'Oil', icon: 'i_want_oil' },
  wine: { label: 'Wine', icon: 'i_want_wine' },
  rank: { label: 'A charter from Rome', icon: 'i_want_rank' },
  materials: { label: 'Materials', icon: 'i_want_materials' },
};

/** Coverage layer labels and overlay colours (ARCHITECTURE §12.5; DESIGN §16 palette). */
export const LAYER_META: Record<CoverageLayerId, { label: string; color: string }> = {
  water: { label: 'Water', color: '#9fd4f0' },
  fountain: { label: 'Fountains', color: '#3d7fa6' },
  shrine: { label: 'Shrines', color: '#f2c94c' },
  temple: { label: 'Temples', color: '#c99a3b' },
  market: { label: 'Markets', color: '#d9a35b' },
  macellum: { label: 'Market halls', color: '#c0623f' },
  baths: { label: 'Baths', color: '#62b0d6' },
  culture: { label: 'Culture', color: '#b0578f' },
};

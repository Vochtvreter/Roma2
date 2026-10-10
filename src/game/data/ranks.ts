// src/game/data/ranks.ts — DESIGN §9.1 (cursus), §6.6 (Rome's roll and immigration), §3.5 (rings, territory),
// §8.8 (stipendium), §8.11 (dignitas thresholds). Owner: scaffold.
//
// `fee` and `dignitas` are the petition fee and threshold to ENTER the rank. `unlocks` and `hubs` list only what the
// rank newly opens. `territory` is the Chebyshev distance from the fossa rectangle (999 = the whole map).
// `rings` are the survey rings inside the pomerium. `subsidy` is the stipendium legionis in den/day.
import type { RankDef } from '../types';

/** The five ranks, index 0 (Castra) … 4 (Colonia). */
export const RANK_DEFS: RankDef[] = [
  {
    index: 0, id: 'castra', name: 'Castra', title: 'Praefectus castrorum',
    fee: {}, dignitas: 0,
    ceiling: 100, territory: 20, rings: [0], immRate: 0.014, subsidy: 3,
    unlocks: ['area', 'ager', 'venatio', 'pabulatio', 'puteus', 'cisterna', 'horreum', 'lignarius', 'lapicidina', 'lararium', 'hortus'],
    hubs: ['metellianus'], forumStage: 0,
  },
  {
    index: 1, id: 'vicus', name: 'Vicus', title: 'Magister vici',
    fee: { denarii: 250, timber: 100 }, dignitas: 12,
    ceiling: 260, territory: 26, rings: [0, 1], immRate: 0.011, subsidy: 1.5,
    unlocks: ['figlina', 'taberna', 'apotheca', 'mansio', 'olivetum'],
    hubs: ['durii', 'silvanum'], forumStage: 1,
  },
  {
    index: 2, id: 'oppidum', name: 'Oppidum', title: 'Praefectus oppidi',
    fee: { denarii: 900, stone: 250, tiles: 150 }, dignitas: 40,
    ceiling: 560, territory: 34, rings: [0, 1, 2], immRate: 0.0053, subsidy: 0,
    unlocks: ['caementarium', 'fodina', 'officina', 'fabrica', 'templum', 'macellum', 'balneum'],
    hubs: ['narbo', 'massilia'], forumStage: 2,
  },
  {
    index: 3, id: 'municipium', name: 'Municipium', title: 'Duumvir',
    fee: { denarii: 2500, stone: 400, concrete: 200, iron: 60 }, dignitas: 100,
    ceiling: 900, territory: 44, rings: [0, 1, 2], immRate: 0.0019, subsidy: 0,
    unlocks: ['castellum', 'lacus', 'thermae', 'theatrum'],
    hubs: ['augusta'], forumStage: 3,
  },
  {
    index: 4, id: 'colonia', name: 'Colonia', title: 'Patronus coloniae',
    fee: { denarii: 5000, stone: 600, concrete: 300, iron: 120 }, dignitas: 190,
    ceiling: 1500, territory: 999, rings: [0, 1, 2], immRate: 0.04, subsidy: 0,
    unlocks: ['capitolium'],
    hubs: [], forumStage: 4,
  },
];

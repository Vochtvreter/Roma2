// src/game/data/decisions.ts — DESIGN §10.8 (focus), §10.9 (edicts), §9.2 (charter and paths), §10.10 (settings,
// switches). Owner: scaffold.
//
// Effects are fed to the effect bus (fx.ts) from the chosen path options and the current edict options.
// Not on the bus (applied by economy/civic from the option id and balance.ts):
//   · Rationes portions and their morale term — B.economy.PORTIONS / B.morale.RATION_TERMS, keyed largae/plenae/parcae;
//     so the rationes options carry only their extra effects (Parcae births ×0.8).
//   · Feriae festival schedule (which festivals are kept; Nullae drops Robigalia, hence "blight ×2").
//   · Aquae water priorities and Operibus prius' concrete ×1.05 (no MulKey for concrete alone).
// Settings are stored as plain numbers in their unit: days, beds, den; unit '%' settings (builderShare, renovation)
// are stored as FRACTIONS 0..1 (0.15 = 15%) and displayed ×100.
import type { EdictDef, EdictId, FocusDef, FocusId, PathDecisionId, PathDef, SettingDef, SettingId, SwitchDef, SwitchId } from '../types';

/**
 * Council focus (DESIGN §10.8). `plan` is the ordered build plan: each step [type, n] wants at least n of that type
 * in total (later steps of the same type raise the target). `split` weights the spare workers by labour category.
 */
export const FOCUS_DEFS: Record<FocusId, FocusDef> = {
  concordia: {
    id: 'concordia', name: 'Balanced', latin: 'Concordia',
    desc: 'A little of everything, in the classic order. Trade stays balanced.',
    plan: [
      ['lignarius', 1], ['lapicidina', 1], ['lararium', 1], ['venatio', 1], ['horreum', 1], ['cisterna', 1], ['ager', 2],
      ['figlina', 1], ['taberna', 2], ['apotheca', 1], ['olivetum', 1], ['mansio', 1], ['caementarium', 1], ['fodina', 1],
      ['officina', 1], ['fabrica', 1], ['macellum', 1], ['templum', 1], ['balneum', 1],
    ],
    split: { materials: 0.35, industry: 0.35, services: 0.30 },
  },
  copia: {
    id: 'copia', name: 'Food & growth', latin: 'Copia',
    desc: 'Fields, granaries and cisterns first. Keeps 4 more spare beds, a winter store ×1.25, and imports grain early.',
    plan: [
      ['ager', 2], ['venatio', 1], ['pabulatio', 1], ['horreum', 2], ['cisterna', 2], ['ager', 3], ['olivetum', 1], ['horreum', 3],
    ],
    split: { food: 0.50, materials: 0.25, industry: 0.25 },
  },
  materia: {
    id: 'materia', name: 'Materials & industry', latin: 'Materia',
    desc: 'Camps, quarries and workshops first. Builder share +5 points; exports materials last.',
    plan: [
      ['lignarius', 2], ['lapicidina', 2], ['figlina', 1], ['apotheca', 1], ['caementarium', 2], ['fodina', 1], ['officina', 2],
      ['fabrica', 1],
    ],
    split: { materials: 0.50, industry: 0.40, services: 0.10 },
  },
  mercatura: {
    id: 'mercatura', name: 'Trade & coin', latin: 'Mercatura',
    desc: 'Shops, road stations and olives first. Exports from 60% of the cap; the treasury floor is halved.',
    plan: [['taberna', 2], ['mansio', 1], ['olivetum', 2], ['apotheca', 2], ['macellum', 1], ['mansio', 2]],
    split: { services: 0.40, industry: 0.30, materials: 0.30 },
  },
  urbs: {
    id: 'urbs', name: 'The city beautiful', latin: 'Urbs',
    desc: 'Shrines, gardens, temples and fountains. Raises gardens for the stone houses, paves 2 busy streets a month, imports oil and wine.',
    plan: [['lararium', 2], ['hortus', 2], ['taberna', 2], ['templum', 1], ['lacus', 2], ['balneum', 1]],
    split: { services: 0.60, materials: 0.20, industry: 0.20 },
  },
};

/** The nine edicts (DESIGN §10.9): three options each, the default is `initial`; one change per season window. */
export const EDICT_DEFS: Record<EdictId, EdictDef> = {
  rationes: {
    id: 'rationes', name: 'Rations', latin: 'Rationes', prompt: 'How much grain does each mouth receive?',
    options: [
      { id: 'largae', name: 'Largae', desc: 'Generous portions: grain need ×1.15, morale +6.', fx: {} },
      { id: 'plenae', name: 'Plenae', desc: 'Full portions: grain need ×1.0.', fx: {} },
      { id: 'parcae', name: 'Parcae', desc: 'Lean portions: grain need ×0.85, morale −6, births ×0.8.', fx: { mul: { births: 0.8 } } },
    ],
    initial: 'plenae', unlock: 'fed30',
    situational: 'Parcae through a famine Hiems; Largae in a full summer.',
  },
  tributum: {
    id: 'tributum', name: 'Taxes', latin: 'Tributum', prompt: 'What do households owe?',
    options: [
      { id: 'leve', name: 'Leve', desc: 'Light: taxes ×0.7, morale +4, immigration ×1.1.', fx: { mul: { tax: 0.7, immigration: 1.1 }, add: { morale: 4 } } },
      { id: 'iustum', name: 'Iustum', desc: 'The customary tax.', fx: {} },
      { id: 'grave', name: 'Grave', desc: 'Heavy: taxes ×1.4, morale −8, immigration ×0.8.', fx: { mul: { tax: 1.4, immigration: 0.8 }, add: { morale: -8 } } },
    ],
    initial: 'iustum', unlock: 'horreum',
    situational: 'Grave to fund the Capitolium; Leve during unrest.',
  },
  opera: {
    id: 'opera', name: 'Public works', latin: 'Opera publica', prompt: 'How hard do we push public works?',
    options: [
      { id: 'magna', name: 'Magna', desc: 'Great works: builders ×1.3, renovations twice as fast, morale −5.', fx: { mul: { builders: 1.3, renovation: 2 }, add: { morale: -5 } } },
      { id: 'solita', name: 'Solita', desc: 'The usual pace.', fx: {} },
      { id: 'modica', name: 'Modica', desc: 'Modest works: builders ×0.85, morale +5.', fx: { mul: { builders: 0.85 }, add: { morale: 5 } } },
    ],
    initial: 'solita', unlock: 'hiems',
    situational: 'Magna for the horreum before Hiems, the aqueduct, the Capitolium.',
  },
  hospites: {
    id: 'hospites', name: 'Newcomers', latin: 'Hospites', prompt: 'How are newcomers received?',
    options: [
      { id: 'patentes', name: 'Patentes', desc: 'Open gates: immigration ×1.6, fever ×1.2, morale −2.', fx: { mul: { immigration: 1.6, disease: 1.2 }, add: { morale: -2 } } },
      { id: 'cauti', name: 'Cauti', desc: 'Careful: newcomers are welcome as beds allow.', fx: {} },
      { id: 'clausi', name: 'Clausi', desc: 'Closed gates: immigration ×0.2, veterans ×0.5, morale +3.', fx: { mul: { immigration: 0.2, veterans: 0.5 }, add: { morale: 3 } } },
    ],
    initial: 'cauti', unlock: 'pop50',
    situational: 'Patentes after laying out plots; Clausi before a hard Hiems.',
  },
  horae: {
    id: 'horae', name: 'Working hours', latin: 'Horae operis', prompt: 'How long do our people labour?',
    options: [
      { id: 'otium', name: 'Otium', desc: 'Leisure: labour ×0.9, morale +6.', fx: { mul: { labour: 0.9 }, add: { morale: 6 } } },
      { id: 'solitae', name: 'Solitae', desc: 'The usual hours.', fx: {} },
      { id: 'longae', name: 'Longae', desc: 'Long days: labour ×1.15, morale −10, fever ×1.3.', fx: { mul: { labour: 1.15, disease: 1.3 }, add: { morale: -10 } } },
    ],
    initial: 'solitae', unlock: 'vicus',
    situational: 'Longae to rush a petition; Otium to fix morale.',
  },
  nundinae: {
    id: 'nundinae', name: 'Market days', latin: 'Nundinae', prompt: 'How often are market days held?',
    options: [
      { id: 'frequentes', name: 'Frequentes', desc: 'Frequent: merchants ×2, prices ×1.05 better, morale +2, labour ×0.97.', fx: { mul: { merchants: 2, tradePrice: 1.05, labour: 0.97 }, add: { morale: 2 } } },
      { id: 'solitae', name: 'Solitae', desc: 'Every ninth day, as custom has it.', fx: {} },
      { id: 'rarae', name: 'Rarae', desc: 'Rare: merchants ×0.5, labour ×1.03.', fx: { mul: { merchants: 0.5, labour: 1.03 } } },
    ],
    initial: 'solitae', unlock: 'caravan',
    situational: 'Frequentes when trade is the plan.',
  },
  feriae: {
    id: 'feriae', name: 'Festivals', latin: 'Feriae', prompt: 'Which festivals does the colony keep?',
    options: [
      { id: 'frequentes', name: 'Frequentes', desc: 'All four feasts (Parilia, Floralia, Ludi Romani, Saturnalia) and the Robigalia: morale +4, dignitas ×1.05.', fx: { mul: { dignitas: 1.05 }, add: { morale: 4 } } },
      { id: 'solemnes', name: 'Solemnes', desc: 'The solemn feasts: Parilia, Robigalia and Saturnalia.', fx: {} },
      { id: 'nullae', name: 'Nullae', desc: 'No feasts: labour ×1.04, morale −6; Robigalia is not kept, so blight strikes twice as often.', fx: { mul: { labour: 1.04 }, add: { morale: -6 } } },
    ],
    initial: 'solemnes', unlock: 'tegulae',
    situational: 'Frequentes before a petition or to cure unrest.',
  },
  silvae: {
    id: 'silvae', name: 'Woods', latin: 'Silvae', prompt: 'How are the woods cut?',
    options: [
      { id: 'caedua', name: 'Caedua', desc: 'Clear-cut: timber ×1.35, no regrowth, morale −3.', fx: { mul: { timber: 1.35, regrow: 0 }, add: { morale: -3 } } },
      { id: 'renovata', name: 'Renovata', desc: 'Cut and replant.', fx: {} },
      { id: 'lucus', name: 'Lucus', desc: 'Sacred groves: timber ×0.85, regrowth ×2, hunting ×1.15, morale +3.', fx: { mul: { timber: 0.85, regrow: 2, hunting: 1.15 }, add: { morale: 3 } } },
    ],
    initial: 'renovata', unlock: 'pop150',
    situational: 'Caedua for a building boom.',
  },
  aquae: {
    id: 'aquae', name: 'Water priority', latin: 'Aquae', prompt: 'When water is short, who drinks first?',
    options: [
      { id: 'operibus', name: 'Operibus prius', desc: 'Works first: industry and baths keep their full draw; concrete ×1.05.', fx: {} },
      { id: 'populo', name: 'Populo prius', desc: 'People first: industry pauses below the water reserve.', fx: {} },
      { id: 'aequa', name: 'Aequa', desc: 'Equal shares: people and works draw in proportion.', fx: {} },
    ],
    initial: 'populo', unlock: 'oppidum',
    situational: 'Operibus prius once the aqueduct flows.',
  },
};

/** The charter and the four paths (DESIGN §9.2): five permanent three-way choices; `grants` is the rank each confers. */
export const PATH_DEFS: Record<PathDecisionId, PathDef> = {
  charter: {
    id: 'charter', name: 'Lex coloniae', prompt: 'By what law is this colony founded?', grants: 0,
    options: [
      { id: 'veterani', name: 'Colonia veteranorum', desc: 'Builders ×1.25; veterans at the gate twice as often, their heads +1 skill; morale +2.',
        fx: { mul: { builders: 1.25, veterans: 2 }, add: { morale: 2 } }, visible: 'Walkers in legion-red cloaks; extra standards at the principia.' },
      { id: 'agricolae', name: 'Coloni agrarii', desc: 'Fields ×1.2; horrea capacity ×1.25.',
        fx: { mul: { fields: 1.2, horreaCap: 1.25 } }, visible: 'Centuriation boundary stones between the fields.' },
      { id: 'mercatores', name: 'Emporium castrense', desc: '+1 caravan slot; trade prices ×1.10 better; merchants ×2; contracts with Vicus Metellianus already at Castra.',
        fx: { mul: { tradePrice: 1.1, merchants: 2 }, add: { caravanSlots: 1 } }, visible: 'Market stalls in the forum; mules join the caravans.' },
    ],
  },
  path1: {
    id: 'path1', name: 'Vicus', prompt: 'The canabae outside the gates swell with camp-followers. What will the vicus become?', grants: 1,
    options: [
      { id: 'canabae', name: 'Canabae', desc: 'A market village: market radius +3; market tax ×1.4; oil ×1.2.',
        fx: { mul: { marketTax: 1.4, olives: 1.2 }, add: { marketRadius: 3 } }, visible: 'The casae grow shop awnings.' },
      { id: 'pagus', name: 'Pagus rusticus', desc: 'Hunting and forage ×1.3; winter wheat: Hiems fields 0.35 → 0.45.',
        fx: { mul: { hunting: 1.3, forage: 1.3 }, add: { hiemsFields: 0.1 } }, visible: 'Haystacks in the fields.' },
      { id: 'coloni', name: 'Coloni', desc: 'Immigration ×1.3; tents, huts and tiled cottages +2 beds; births ×1.2.',
        fx: { mul: { immigration: 1.3, births: 1.2 }, add: { lowCap: 2 } }, visible: 'More family carts on the via.' },
    ],
  },
  path2: {
    id: 'path2', name: 'Oppidum', prompt: 'A walled town rises. What will Castra Valeria be known for?', grants: 2,
    options: [
      { id: 'arsFabrilis', name: 'Ars fabrilis', desc: 'Tile kiln, concrete works, bloomery and smithy ×1.25; tool kits last 180 days.',
        fx: { mul: { industry: 1.25, toolDays: 1.5 } }, visible: 'Smoke plumes; an anvil sign on the gates.' },
      { id: 'pietas', name: 'Pietas', desc: 'Shrine and temple radius +4; temple dignitas ×1.5; festival costs ×0.5; morale +4.',
        fx: { mul: { templeDignitas: 1.5, festivalCost: 0.5 }, add: { shrineRadius: 4, morale: 4 } }, visible: 'Incense particles; garlanded shrines.' },
      { id: 'viaMilitaris', name: 'Via militaris', desc: 'Caravan trips ×0.8; +1 caravan slot; bandits ×0.3.',
        fx: { mul: { tripDays: 0.8, bandits: 0.3 }, add: { caravanSlots: 1 } }, visible: 'The via is paved in basalt to the edge, with milestones.' },
    ],
  },
  path3: {
    id: 'path3', name: 'Municipium', prompt: 'Rome grants a charter. What rights will the municipium hold?', grants: 3,
    options: [
      { id: 'iusLatii', name: 'Ius Latii', desc: 'Immigration ×1.5; taxes ×1.10; insulae +4 beds.',
        fx: { mul: { immigration: 1.5, tax: 1.1 }, add: { insulaCap: 4 } }, visible: 'Citizen togas on the walkers.' },
      { id: 'annonaPublica', name: 'Annona publica', desc: 'Grain need ×0.95; horrea ×1.25; morale +6 in Hiems; one free Legate\'s relief a year.',
        fx: { mul: { grainUse: 0.95, horreaCap: 1.25 }, add: { hiemsMorale: 6 } }, visible: 'A grain-dole queue at the forum.' },
      { id: 'aquaeSalutares', name: 'Aquae salutares', desc: 'Castellum cost ×0.7; lacus cost ×0.5; baths radius +4; care +0.2.',
        fx: { mul: { castellumCost: 0.7, lacusCost: 0.5 }, add: { bathsRadius: 4, care: 0.2 } }, visible: 'Steam from every bath; extra fountain sparkle.' },
    ],
  },
  path4: {
    id: 'path4', name: 'Colonia', prompt: 'Under what vision will the Capitolium rise?', grants: 4,
    options: [
      { id: 'iuppiter', name: 'Iuppiter Optimus Maximus', desc: 'Morale +8; Capitolium work ×0.8.',
        fx: { mul: { capWork: 0.8 }, add: { morale: 8 } }, visible: 'A gilded quadriga crowns the pediment.' },
      { id: 'aeternitas', name: 'Aeternitas', desc: 'Capitolium materials ×0.8.',
        fx: { mul: { capMat: 0.8 } }, visible: 'A gilded eagle (aquila) on the pediment.' },
      { id: 'imperium', name: 'Imperium', desc: 'All labour ×1.10; the next colony gets +5% legacy.',
        fx: { mul: { labour: 1.1 } }, visible: 'A she-wolf group and imperial standards.' },
    ],
  },
};

/** Council settings (DESIGN §10.10): slider range, step, default and unlocking milestone. */
export const SETTING_DEFS: Record<SettingId, SettingDef> = {
  spareBeds: {
    id: 'spareBeds', name: 'Spare beds', latin: 'Cubilia vacua',
    desc: 'Free beds the Ordo keeps ready for newcomers before it lays out more house plots.',
    min: 0, max: 40, step: 1, initial: 8, unit: 'beds', unlock: 'firstWork',
  },
  grainReserve: {
    id: 'grainReserve', name: 'Grain reserve', latin: 'Frumenti subsidium',
    desc: 'Days of grain the Ordo aims to keep: food staffing, the winter stockpile, the industry floor and the Hiems wish.',
    min: 10, max: 120, step: 5, initial: 45, unit: 'days', unlock: 'fed30',
  },
  builderShare: {
    id: 'builderShare', name: 'Builder share', latin: 'Fabri',
    desc: 'Share of the workforce the Ordo sends to the building sites while any site is workable (at least 2 builders).',
    min: 0.05, max: 0.4, step: 0.01, initial: 0.15, unit: '%', unlock: 'hiems',
  },
  waterReserve: {
    id: 'waterReserve', name: 'Water reserve', latin: 'Aquae subsidium',
    desc: 'Days of water the Ordo aims to keep: well staffing, the Aestas wish and the industry floor.',
    min: 5, max: 40, step: 1, initial: 15, unit: 'days', unlock: 'stabilitas',
  },
  tradeReserve: {
    id: 'tradeReserve', name: 'Trade reserve', latin: 'Mercatura cauta',
    desc: 'Days of use kept back from exports; contracts pause themselves rather than dip below it.',
    min: 10, max: 90, step: 5, initial: 30, unit: 'days', unlock: 'vicus',
  },
  renovation: {
    id: 'renovation', name: 'Renovation allowance', latin: 'Renovatio',
    desc: 'Share of the unreserved stock that households may use to renovate their homes; the town paves its streets from the rest.',
    min: 0, max: 1, step: 0.05, initial: 0.6, unit: '%', unlock: 'tegulae',
  },
  treasuryFloor: {
    id: 'treasuryFloor', name: 'Treasury floor', latin: 'Aerarium',
    desc: 'Denarii the Ordo never spends below, except to survive.',
    min: 0, max: 3000, step: 50, initial: 150, unit: 'den', unlock: 'pop150',
  },
};

/** Council switches (DESIGN §10.10): the emergency ladder and govern-while-away, both on by default. */
export const SWITCH_DEFS: Record<SwitchId, SwitchDef> = {
  emergency: {
    id: 'emergency', name: 'Lex de annona',
    desc: 'Emergency measures: cut rations, pause water-hungry works, import grain, and call on the Legate\'s relief before anyone starves.',
    initial: true,
  },
  governAway: {
    id: 'governAway', name: 'Govern while I am away',
    desc: 'During time away the Ordo runs every subsystem you keep manual, and reports what it decided in your name.',
    initial: true,
  },
};

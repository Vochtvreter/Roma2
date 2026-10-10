// src/game/data/advisors.ts — DESIGN §11.2 (the mentor), §11.3 (the six advisors). Owner: scaffold.
//
// `order` is the tie order (annonae > aquarum > aedilis > fabrum > quaestor > augur; lower first).
// `portrait` holds the art cues; the sprite names are `pt_<id>_<0|1|2>` (art/index.ts `portrait()`).
// Appointment rules (start / Vicus / first advisory …) live in advisors/engine.ts.
import type { AdvisorDef, AdvisorId } from '../types';

/** The six advisors: office, name, domain, tie order and portrait cues. */
export const ADVISOR_DEFS: Record<AdvisorId, AdvisorDef> = {
  annonae: {
    id: 'annonae', office: 'Praefectus Annonae', name: 'Aulus Annius Frugi', order: 0,
    domain: 'Grain, rations, horrea, winter, oil and wine for homes, famine relief',
    portrait: 'Grey beard, ochre tunic, wheat-ear brooch',
  },
  aquarum: {
    id: 'aquarum', office: 'Curator Aquarum', name: 'Sextus Aquilius Fonteius', order: 1,
    domain: 'Water, wells, cisterns, the summer forecast, the aqueduct',
    portrait: 'Blue-grey cloak, water jar',
  },
  fabrum: {
    id: 'fabrum', office: 'Praefectus Fabrum', name: 'Titus Vibius Faber', order: 3,
    domain: 'Builders, sites, labour, idle hands, materials, the Capitolium flow',
    portrait: 'Leather cap, soot smudge, groma pin',
  },
  quaestor: {
    id: 'quaestor', office: 'Quaestor', name: 'Publius Nonius Arca', order: 4,
    domain: 'Coin, upkeep, taxes, contracts, merchants',
    portrait: 'Bald, toga with a thin stripe, wax tablet',
  },
  aedilis: {
    id: 'aedilis', office: 'Aedilis', name: 'Quintus Sempronius Lepidus', order: 2,
    domain: 'Houses and evolution, beds and Rome\'s roll, morale',
    portrait: 'Young, toga praetexta, city-plan scroll',
  },
  augur: {
    id: 'augur', office: 'Augur', name: 'Servius Volusius Auspex', order: 5,
    domain: 'Pending choices, petitions, omens',
    portrait: 'Veiled head, curved lituus',
  },
};

/** The mentor of the tips: a founding head (Cassius family in the roster, DESIGN §6.2). */
export const MENTOR: { name: string; title: string } = { name: 'Decimus Cassius', title: 'primus pilus emeritus' };

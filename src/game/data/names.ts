// src/game/data/names.ts — DESIGN §6.1 (gentes, naming), §9.6 (colony names); praenomina from rome's
// roman-names.registry.ts (MALE_PRAENOMINA, 36 names). Owner: scaffold.

/** Sons' praenomina: rome's 36-name pool, in rome's order. */
export const PRAENOMINA: string[] = [
  'Aulus', 'Appius', 'Caeso', 'Decimus', 'Faustus', 'Gaius', 'Gnaeus', 'Lucius', 'Manius', 'Marcus', 'Numerius', 'Publius',
  'Quintus', 'Sextus', 'Spurius', 'Titus', 'Tiberius', 'Servius', 'Mamercus', 'Postumus', 'Proculus', 'Vibius', 'Vopiscus',
  'Agrippa', 'Caius', 'Hostus', 'Kaeso', 'Marius', 'Maximus', 'Octavius', 'Opiter', 'Paullus', 'Salvius', 'Statius',
  'Verginius', 'Volusius',
];

/** Daughters' cognomina by birth order: the first is plain (Valeria), then Secunda, Tertia, Quarta, Quinta. */
export const DAUGHTER_COG: string[] = ['', 'Secunda', 'Tertia', 'Quarta', 'Quinta'];

/** The six founding gentes (masculine nomina), in roster order (DESIGN §6.2). */
export const GENTES_FOUNDING: string[] = ['Valerius', 'Antonius', 'Flavius', 'Cassius', 'Aemilius', 'Iulius'];

/** The 14 gentes of veterans at the gate (DESIGN §6.1). */
export const GENTES_VETERAN: string[] = [
  'Pompeius', 'Crassus', 'Sertorius', 'Vitellius', 'Lentulus', 'Metellus', 'Corvinus', 'Silanus', 'Regulus', 'Maximus',
  'Drusus', 'Sabinus', 'Marcellus', 'Scaevola',
];

/** The 30 gentes of immigrant households (DESIGN §6.1). */
export const GENTES_IMMIGRANT: string[] = [
  'Aurelius', 'Cornelius', 'Domitius', 'Fabius', 'Fulvius', 'Herennius', 'Licinius', 'Lucretius', 'Manlius', 'Marius',
  'Minucius', 'Octavius', 'Papirius', 'Petronius', 'Plautius', 'Porcius', 'Quinctius', 'Rutilius', 'Sempronius', 'Sergius',
  'Servilius', 'Sulpicius', 'Terentius', 'Tullius', 'Vettius', 'Vibius', 'Volusius', 'Atilius', 'Calpurnius', 'Hostilius',
];

/** Colony names by legacy level: index 0 is the first colony, later colonies continue down the list (DESIGN §9.6). */
export const COLONY_NAMES: string[] = [
  'Castra Valeria', 'Colonia Valeria Secunda', 'Forum Iulii Novum', 'Aquae Antoniae', 'Castra Flavia', 'Forum Cassii',
  'Colonia Aemilia Equestris', 'Augusta Valeria', 'Colonia Iulia Felix', 'Aquae Flaviae', 'Forum Antonii', 'Castra Aemilia',
];

/** Feminine form of a nomen: '-ius' → '-ia', '-us' → '-a' (Valerius → Valeria, Crassus → Crassa); other endings unchanged. */
export function feminine(gens: string): string {
  if (gens.endsWith('ius')) return gens.slice(0, -3) + 'ia';
  if (gens.endsWith('us')) return gens.slice(0, -2) + 'a';
  return gens;
}

// src/game/balance.ts — every tunable number of DESIGN.md that is not part of a data registry (ARCHITECTURE §7).
// The scaffold transcribes DESIGN; WP-J tunes. Keys may be added inside a group; existing names never change.
// Rank-specific numbers live in data/ranks.ts, per-building numbers in data/buildings.ts, per-tier numbers in
// data/housing.ts and prices/hubs in data/hubs.ts. A few of those are mirrored here (marked "mirror") because
// DESIGN §18.3 lists them as key constants; the registries stay authoritative for the sim.
// This module imports nothing.

/** All balance constants, grouped by system (ARCHITECTURE §7, DESIGN §18.3). */
export const B = {
  LOG_CAP: 400,

  // ───────── time, loop, offline (DESIGN §0, §2.1, §14) ─────────
  time: {
    START_DAY: 90, SPEEDS: [1, 2, 5, 10], DEV_SPEED: 20, DT_CLAMP: 0.1, MAX_STEPS: 8, AUTOSAVE_S: 20,
    OFFLINE_RATE: 0.5, OFFLINE_MAX_DAYS: 1825, OFFLINE_MIN_MS: 60_000, SLICE_MS: 30, SLICE_DAYS: 10, UI_THROTTLE_MS: 200,
    YEAR_DAYS: 365,                                   // aging and annual rates use the 365-day clock (§2.2)
  },

  // ───────── map, survey, roads, aqueduct (DESIGN §3) ─────────
  map: {
    W: 112, H: 84, TILE: 16, PITCH: 5, INTERIOR_W: 31, INTERIOR_H: 21, FOSSA: 3, ROAD_MAX: 40, AQUEDUCT_MAX: 70,
    CASTELLUM_REACH: 18, FARM_SITES_MIN: 25, LOAM_MASK: 4,
    CASTRUM_W: 39, CASTRUM_H: 29,                     // interior + wall + fossa
    BLOCK: 4, PLOT: 2,                                // block 4×4 of four 2×2 plots
    FORUM_BLOCKS: { bx: [2, 3], by: [1, 2] },         // forum 9×9 = these blocks + the streets between
    CAPITOLIUM_BLOCKS: { bx: [2, 3], by: [0, 0] },    // Area Capitolina 9×4
    RING_BLOCKS: [24, 32, 40],                        // blocks per ring (interior, canabae, outer)
    TERRITORY: [20, 26, 34, 44, 999],                 // mirror of RANK_DEFS[].territory (Chebyshev from the castrum rect)
    RINGS: [[0], [0, 1], [0, 1, 2], [0, 1, 2], [0, 1, 2]],   // mirror of RANK_DEFS[].rings
    FERTILITY: { grass: 1.0, meadow: 1.1, loam: 1.25, scrub: 0.75 },
    WOOD_FOREST: 60, WOOD_DENSE: 100,                 // timber per forest tile (§3.2)
    WATER_TABLE_DIST: 12, WATER_TABLE_MOIST: 0.6,     // on the water table: within 12 of the river or moisture > 0.6
    RIVER_LOAM: 2,                                    // land within 2 tiles of the river becomes loam
    LUCUS_DESIR: [3, 3], RIVER_DESIR: [1, 2], PAVED_DESIR: [1, 1],   // [value, range]
    PAVE_STONE: 2,                                    // stone per paved tile
    // the charter streets (§3.7): the rank from which the town paves (PAVE_STONE a pace, at most MONTH paces a
    // Kalends) the camp's cardo and decumanus, every street of the inner city, and those of Ring 1 and across the old wall line
    CHARTER: { axes: 2, inner: 3, outer: 4, MONTH: 24 },
    ROAD_COST: { flat: 1, hills: 1.7, forest: 3, rock: 2.5, street: 0.5, futureBlock: 6 },
    AQUEDUCT_COST: { hills: 0.8, flat: 1.0, forest: 1.4, river: 2.5, road: 1.2, wall: 2, plot: 3 },   // wall: over the vallum/fossa; plot: across an unbuilt surveyed plot
    CASTELLUMS_PER_FONS: 1,
    GEN: {
      ELEV_SCALE: 22, ELEV_OCTAVES: 4, ELEV_FBM: 0.75, TILT: 0.35, MOIST_SCALE: 14, MOIST_OFFSET: 100,
      HILLS_Q: 0.74, ROCK_Q: 0.88, CRAG_Q: 0.96, FOREST_MOIST: 0.56, DENSE_MOIST: 0.68, SCRUB_MOIST: 0.36,
      RIVER_EDGE: 0.15, RIVER_JITTER: 0.03, RIVER_WIDTH: [2, 3],
      SITE_RIVER: [3, 10], POMERIUM_BOX: [61, 51], SITE_MARGIN: 4,
      SCORE_LOAM_R: 20, SCORE_FOREST_R: 24, SCORE_HILLS_R: 28,
      FONS: [1, 2], FONS_DIST: [22, 44], ORE_VEINS: 2, VEIN_TILES: [2, 4], VEIN_QUALITY: [0.7, 1.4], ORE_DIST: [14, 34],
      LUCUS_DIST: [10, 20], RUINS_DIST: [15, 30], CLAY_SHARE: 0.3,
      LUMBER_SITE_WOOD: 60, LUMBER_SITE_R: 4, RETRY_STEP: 1000, RETRIES: 8,
      SITE_TRIES: 6, SITE_SPREAD: 4,                // distinct castrum sites tried per terrain, at least this many tiles apart
      ORE_SPREAD: 8, FONS_SPREAD: 12,               // the two veins / two springs at least this far apart
      GLACIS: [0.85, 0.55, 0.25],                   // chance a wood tile 1, 2, 3 tiles outside the fossa is cleared
      SHAPE: {                                      // the noise and the river course (WP-A)
        WARP_SCALE: 30, WARP_AMP: 14,               // domain warp: organic hill and wood outlines
        ELEV_STRETCH: 0.35, MOIST_STRETCH: 1.3,     // fBm clusters near 0.5; stretch it to use the DESIGN thresholds
        RIVER_OFFSET: [0.22, 0.32],                 // river centre offset from the map centre, share of the cross size
        MEANDER_1: { amp: [0.05, 0.085], len: [34, 56] },   // the big bends (amp: share of the cross size)
        MEANDER_2: { amp: [0.6, 1.5], len: [17, 27] },      // small wiggles, tiles
        MEANDER_NOISE: { amp: 2.5, scale: 9 },
        EDGE_KEEP: 6,                               // the river centre stays this far from the side edges
        CARVE: 0.06, CARVE_R: 6,                    // valley carved along the river (elevation units, tiles)
        WET: 0.1, WET_R: 6,                         // moisture added near the river
        MEADOW_MOIST: 0.48, MEADOW_RIVER: 5,        // meadow: moist lowland, or the river's wet margin
        COPSE_P: 0.02, COPSE_MOIST: 0.44, GLADE_P: 0.03,   // single trees in the fields, glades in the woods
      },
    },
  },

  // ───────── people (DESIGN §6) ─────────
  people: {
    NEED: [0.6, 0.85, 1, 0.75], YOUTH: 12, ADULT: 16, ELDER: 55, RETIRE: 65, BIRTH_RATE: 0.036, FERTILE: [16, 42],   // tuned 0.2 → 0.09 → 0.036 × Rome's favour (§6.6): a splendid town's families thrive
    MARRY_P: 1 / 400, MARRY_MAX: 2, MARRY_M: [18, 50], MARRY_F: [16, 45], REMARRY_DAYS: 180, POP_CAP: 1500,
    HOMELESS_LEAVE: 20, EMIGRATE_MORALE: 25, EMIGRATE_P: 0.02,
    HAZARD: { infant: 0.04, child: 0.006, adult: 0.004, a: 0.01, mid: 55, scale: 7.5, care: 0.35 },
    STARVE_P: 0.012, THIRST_P: 0.015, OFFLINE_STARVE: 0.4, SKILL_XP: 0.004, SKILL_BONUS: 0.04, SKILL_MAX: 10,
    SKILL_LIFETIME: 20, ELDER_OUT: 0.7, HOUSEHOLD_MIX: [0.7, 0.2, 0.1],
    IMM_RATE: [0.0046, 0.0036, 0.002, 0.0025, 0.04],   // mirror of RANK_DEFS[].immRate (households/day; × Rome's favour up to ×3; the Municipium keeps most of its old rate: an old town kept by the Ordo alone cannot outgrow its deaths by births)
    CEILING: [100, 260, 560, 900, 1500],              // mirror of RANK_DEFS[].ceiling (Rome's roll)
    DEATH_AT: 75,                                     // hunger/thirst above this kill (§6.5)
    FOOD_F: [[20, 1], [10, 0.5], [0, 0.1]],           // grain DoH ≥ x → factor (births, immigration)
    WATER_F: [[10, 1], [0, 0.5]],                     // water DoH ≥ x → factor (immigration)
    BIRTH_MORALE: [55, 0.3, 1.3],                     // clamp(morale / 55, 0.3, 1.3)
    BIRTH_BEDS: [[2, 1], [1, 0.5], [0, 0]],           // free beds ≥ x → factor
    ATTRACT: { MORALE: 30, SPAN: 40, MAX: 1.25 },     // clamp((morale − 30) / 40, 0, 1.25)
    CALL: { SOULS: 3, FROM: 1.5, TO: 4.5 },           // Rome's call: households of ~3 souls; a daily roll past 1.5 souls, certain at 4.5
    // Rome's favour (§6.6): immigration (and, × BIRTHS, births) × min(MAX, 1 + K × splendour per home); splendour is the
    // dignitas of the works the Ordo leaves to the player (gardens, paved streets), so a colony kept by the Ordo alone has ×1
    RENOWN: { K: 4, MAX: 3, BIRTHS: 1 },
    COUPLE_KIDS: [0, 3], KID_AGE: [0, 14], CRAFT_SKILL: [1, 3], WIDOW_KIDS: [1, 3],
    // household shapes (§6.6) and the veterans at the gate (§12.2)
    AGES: { coupleHead: [20, 40], coupleWife: [18, 36], craftsman: [18, 40], widow: [24, 45],
            vetHead: [54, 62], vetWife: [50, 58], vetKids: [0, 2], vetKidAge: [4, 14] },
    VET_SKILL: [3, 4], VET_SECOND: [1, 2], VET_SECOND_P: 0.5,
    GIRL_P: 0.5, MOTHER_GAP: 16,                      // a child is at least MOTHER_GAP years younger than its mother
  },

  // ───────── hunger and thirst (DESIGN §8.4–8.5) ─────────
  needs: {
    FULL: [-5, -6], HIGH: [-2, -2], HOLD: 0.6, WORSEN: [5, 7], BAND: [25, 50, 75], FED_ALPHA: 1 / 30, FED_MIN: 0.9,
    HIGH_R: 0.8,                                      // 0.8 ≤ r < 1 → HIGH deltas
  },

  // ───────── production, storage, woods, denarii (DESIGN §8) ─────────
  economy: {
    MULT_CAP: 2.5, PROD_BASE: 0.85, PROD_MORALE: 0.3, TOOL_MULT: 1.2, TOOL_DAYS: 120, TOOL_TARGET: 0.5,
    IDLE_FORAGE: 0.3, IDLE_BUILD: 0.3, COIN_ALPHA: 1 / 30, SHED_ROT: 0.003, EVAPORATION: 0.002, OFF_TABLE: 0.6, UNPAID: 0.5,
    PORTIONS: { largae: 1.15, plenae: 1, parcae: 0.85, arctae: 0.7 },
    WOOD: { REPLANT: 0.003, NATURAL: 0.0005, HIEMS: 0.25, MATURE: 0.5, STUMP: 0.25, FELL_WORK: 1 / 12, CATCHMENT: 4, MIN: 40,
            CATCH_FACTOR: [0.2, 1.3], CATCH_TIMBER: 2400 },   // standing timber within r4 for a ×1.0 lumber camp
    LEGACY: 0.1,                                      // output +10% per finished colony (§9.6)
    HORREUM: 4000,                                    // mirror of BUILDING_DEFS.horreum.storage.grain
    ROT_SEASON: [1, 2, 1, 1],                         // shed rot multiplier by season (×2 Aestas)
    EVAP_SEASON: [0, 1, 0, 0],                        // evaporation only in Aestas
    MARKET_TAX: { taberna: 0.008, macellum: 0.015 },  // den per covered resident per day (tuned from 0.005 / 0.01)
    SERVICE_FULL: 0.5,                                // ≥ ceil(slots × 0.5) workers → full radius
    SERVICE_PARTIAL: 0.6,                             // otherwise floor(0.6 × r)
    SPILL_LOG_DAYS: 30,                               // overflow logged at most once per 30 days per resource
    OPERIBUS_CONCRETE: 1.05,                          // Aquae: Operibus prius — concrete ×1.05 (off the effect bus, §10.9)
  },

  // ───────── houses (DESIGN §7) ─────────
  housing: {
    CHECK_EVERY: 5, OK_DAYS: 15, RENOVATE_DAYS: 8, DECLINE_AFTER: 20, RECOVER_DAYS: 10, DROP_AFTER: 60,
    OFFLINE_DECLINE_STOP: 55, THROTTLE_WINDOW: 10, THROTTLE_PER: 8, DESIR_DOMUS: 10,
    GOODS: { oil: 0.05, wine: 0.05 }, SUPPLY_ALPHA: 0.1, SUPPLIED: 0.8, AQUAE_BEDS: 6, AQUAE_TAX: 1.3, DESIR_CLAMP: [-20, 30],
    DECLINE_TAX: 0.5, AQUAE_DIGNITAS: 1, CONVERT_DAYS: 8, MIN_DROP_LEVEL: 1, RENOVATION_SHARE: 0.6,
  },

  // ───────── morale (DESIGN §8.9) ─────────
  morale: {
    BASE: 50, START: 65, ALPHA: 0.05, GRAIN_TERMS: [[30, 5], [15, 2], [7, -3], [0, -10]],
    RATION_TERMS: { largae: 6, plenae: 0, parcae: -6, arctae: -14 }, SHORT: 20, TIER: 2, RELIGION: 8, BATHS: 5,
    CULTURE: 6, HOMELESS: 20, DECLINING: 10, DEATHS: 2, DEATHS_CAP: 12, LEGACY: 2, LABELS: [75, 50, 30],
    DEATHS_WINDOW: 30, MIN: 0, MAX: 100,
    CAPITOLIUM: 10,                                   // on dedication
    STAGE: 5, STAGE_DAYS: 30,                         // each Capitolium stage
    VETERANS_MIN: 55, MERCHANTS_MIN: 45,
  },

  // ───────── dignitas and the forum (DESIGN §5.2, §8.8, §8.11) ─────────
  dignitas: {
    ROADS: 0.05,                                      // per paved tile
    DEEDS: 1,                                         // per completed milestone
    TEMPLE_FORUM: 1.5,                                // templum touching the forum
    FORUM: [5, 8, 12, 16, 20],                        // principia dignitas by forum stage
  },
  forum: {
    DESIR: [4, 5], DESIR_LATE: [6, 6], LATE_STAGE: 3, // principia desirability [value, range]; stage ≥ 3
    TAX_STAGE: 3, TAX: 1.1,                           // basilica & curia: taxes ×1.10
  },

  // ───────── works (DESIGN §5.3, §9.5) ─────────
  construction: {
    STAKE_DAYS: 5, FULL_REFUND_DAYS: 5, REFUND_CANCEL: 0.75, REFUND_DEMOLISH: 0.25,
    CAP_CREW: 64, CAP_WORK: 320_000, CAP_STAGES: [0.25, 0.5, 0.75, 1],   // CAP_WORK tuned from 160,000 (§9.5)
    CAP_MAT: { stone: 24_000, concrete: 9_000, tiles: 4_000, iron: 1_800, denarii: 160_000 },   // denarii tuned from 40,000
    TRENCH: 0.1,                                      // 0–10% of work shows the foundation trench
    PENNANT_DAYS: 5,
  },

  // ───────── site rules and adjacency (DESIGN §5.1) ─────────
  site: {
    AGER_FERTILE: 7, AGER_RIVER: [0.04, 0.2], AGER_FIELDS: [0.05, 0.1],    // per tile, cap
    VENATIO_WOODED: 10, VENATIO_R: 5, VENATIO_SITE: [0.4, 1.4],
    PABULATIO: [0.05, 1.3],                           // per meadow/forest ring tile, max
    OLIVE_MIN: 5, OLIVE_ALL: 1.15, OLIVE_YOUNG: 0.5, OLIVE_YOUNG_DAYS: 365, OLIVE_SCRUB: 1.15,
    QUARRY_MIN: 3, QUARRY: { base: 0.6, per: 0.1, min: 0.6, max: 1.4 },
    FIGLINA_RIVER: 1.2, CAEMENT_NEAR: [6, 1.15], OFFICINA_NEAR: [4, 1.2],  // [range, mult]
  },

  // ───────── the Ordo (DESIGN §10) ─────────
  ordo: {
    BUILD_EVERY: 2, GROWTH_EVERY: 6, TRADE_EVERY: 10, TRADE_OFFSET: 5, SITES_PER: 40, SITES_MAX: 4, FOOD_CAP: 0.75, FOOD_CAP_HUNGRY: 0.9,
    BUILDERS_MIN: 2, BUILDERS_MAX: 0.3, WATER_BASE: 1.05, WATER_LOW: 1.2, WATER_THIRST: 1.5, WATER_PREFILL: 1.3,
    FOOD_BASE: 1, FOOD_LOW: 1.2, FOOD_HUNGRY: 2, FOOD_HIEMS: 1.4, FOOD_FULL: 0.85, WINTER_FILL: 1.35, REQUESTS_MAX: 3,
    REQUEST_DAYS: 180, TOOLS_PER: 0.5, LUXURY: 1.2, EVOLVE_MIN: 2, EVOLVE_MIN_BLOCK: 3,
    EXPORT_CAP: 0.95, EXPORT_CAP_MERCATURA: 0.6,   // EXPORT_CAP tuned 0.8 → 0.95: no hands worked for export but under Mercatura
    IMPORT_RUNWAY: 90, MERCHANT_RUNWAY: 60, WISH_WAIT: 40, CARGO: 80,
    HUNGER_AT: 25, THIRST_AT: 25,                     // any group above → hungry/thirsty bases
    FOOD_HIEMS_DOH: 10, WINTER_LEAD: 30,              // Hiems base when DoH < 10; stockpile in the last 30 days of Aestas
    PRIORITY_DAYS: 30, ASK_DAYS: 2,
    SURVIVAL_DOH: 30, STORE_FULL: 0.95, MATERIALS_ETA: 30, CAP_RESERVE_DAYS: 30,
    ACCESS_MIN: 2,                                    // wish 5: ≥ 2 houses whose first unmet need is water
    DEFICIT_RESERVE: 0.5,                             // trade 1: grain DoH < Grain reserve × 0.5 with max potential < need
    LUXURY_RUNWAY: 60, MERCHANT_DEAL: 1.1,
    GOODS_FLOOR: 15,                                  // oil and wine: days of the draw kept below every plan (the import floor)
    MIN_EXPORT: 20,                                   // the smallest surplus worth a caravan
    COMING: 30,                                       // days ahead that "the coming season" means for survival food
    STREET_TILES: 4,                                  // road tiles in one "busy street" paved under Urbs
    STORES_PER_RANK: 1,                               // horrea/apothecae for full stores ≤ 1 + rank × this
    STORE_RESERVE: 2,                                 // …more horrea while grain capacity < 2 × the grain reserve × need
    FOCUS: { COPIA_BEDS: 4, COPIA_WINTER: 1.25, MATERIA_BUILDERS: 0.05, MERCATURA_FLOOR: 0.5, URBS_PAVE: 2 },
  },

  // ───────── Ordo site scoring (DESIGN §10.5) ─────────
  score: {
    FELL: -0.12,
    NOTES_MAX: 3,                                     // an Ordo site keeps 2–3 "why here?" notes (§10.6)
    HOUSE: { STEPS: -1, DESIR: 0.5, BLOCK_HOUSES: 2, RETENTURA: 2, INDUSTRY: -3, INDUSTRY_R: 3 },
    SERVICE: { UNBLOCK: 3, COVER: 1, STEPS: -0.3, DISTRICT: 3, TEMPLE_FORUM: 5 },
    STORE: { PRAETENTURA: 3, VIA: 2, HOUSE: -1, HOUSE_R: 3 },
    WATER: { ACCESS: 2, STEPS: -0.2, DROUGHT: 10 },   // DROUGHT: weight of a well's yield when raised for drink, not reach
    AGER: { SITE: 10, DIST: -0.4, FIELDS: 1.5, HOUSE: -2 },
    RURAL: { SITE: 8, DIST: -0.3 },
    EXTRACT: { SITE: 4, DIST: -0.3 },
    WORKSHOP: { BONUS: 4, DIST: -0.3, HOUSE: -1.5, HOUSE_R: 4 },
    CASTELLUM: { HOUSES: 2, ROUTE: -0.2 },
    LACUS: { T4: 2, COVER: 1 },
  },

  // ───────── forecast (DESIGN §11.11) ─────────
  forecast: {
    GRAIN: 1.35, WATER: 1.1, CELLS: 12, BANDS: [30, 15, 7],
    DOH_NONE: 9999,                                   // days on hand reported when nobody needs the essential (finite)
  },

  // ───────── Lex de annona (DESIGN §8.12) ─────────
  emergency: {
    PARCAE: 12, ARCTAE: 6, LIFT: 25, WATER_PAUSE: 8, WATER_RESUME: 15, IMPORT_AT: 8, IMPORT_DAYS: 20,
    IMPORT_COOLDOWN: 90, RELIEF_STRUCT: 10, RELIEF_LOW: 6, RELIEF_DAYS: 30, RELIEF_ARRIVE: 5, RELIEF_PRICE: 2,
    RELIEF_REPAY: 0.25, RELIEF_COOLDOWN: 365,
  },

  // ───────── events and festivals (DESIGN §12) ─────────
  events: {
    START: 300, CHANCE: 1 / 40, CHOICE_GAP: 200, HARMFUL_GAP: 120, CHOICE_DAYS: 30, RELIEF_DAYS: 15,
    CLAMP_RES: 0.3, CLAMP_POP: 0.05, MERCHANT_P: 0.012, MERCHANT_GAP: 60, MERCHANT_STAY: 30,
    BANDIT_P: 0.08, BANDIT_DAYS: 12, BANDIT_LOSS: 0.3, VETERAN_STAY: 30,
    OFFLINE_ROLL: 0.5,                                // benign events offline, on half the days
    HARMFUL_YEAR: 365,                                // a harmful instant event fires at most once a year
    MERCHANT_MANSIO: 1.5, MERCHANT_MANSIO_MAX: 2, MERCHANT_OFFERS: [2, 4], MERCHANT_POP: 20,
    LUSTRUM: { PER_POP: 0.5, EVERY: 5, FROM_AUC: 805 },
    REACT_MIN: 25,                                    // anything that asks the player to react lasts ≥ 25 days (§2.3)
    // the catalogue (§12.2) and the festivals (§12.3)
    DUR: 30,                                          // morale effects "for 30 days" (events and festivals)
    FIVE_YEARS: 1825,
    VET: { FAMILIES: [2, 3], GRANT: 80, MORALE_PER: 3, MORALE_MAX: 9, MORALE_DAYS: 60, FAMA: 2, FAMA_DAYS: 365, POP: 30, BEDS: 8, GRAIN_DOH: 30 },
    LEGATUS: { RANK: 1, DEN: 150, WINE: 20, NO_WINE: 40, FAMA: 6, FEE: 0.85 },
    // fever: 3–6% fall sick for DAYS; each sick person dies over the sickness with p = DEATH × (1 − CARE·care) × (VOW_DEATHS if vowed)
    PEST: { POP: 60, BASE: 0.5, AESTAS: 0.4, SICK: [0.03, 0.06], DAYS: 20, DEATH: 0.12, CARE: 0.5, VOW: 100, VOW_DEATHS: 0.5, VOW_MORALE: 3, ISOLATE: 0.5, ISOLATE_MORALE: -4 },
    ROBIGO: { FIELDS: 2, SACRIFICE: 40, AVERT: 0.7, IDLE: 30, BONUS: 0.1, BONUS_DAYS: 60, KEPT: 0.5 },   // BONUS: additive fraction (Building.bonus)
    SICC: { DAYS: 40, RAIN: 0.3, WELLS: 0.85, STONE: 20, DEN: 30, DEN_MAX: 300, WATER: 0.85, MORALE: -6 },
    ROMA: { RANK: 2, DOH: 120, BIG: { grain: 600, den: 1500, fama: 4 }, SMALL: { grain: 200, den: 450, fama: 1 } },
    IGNIS: { INSULA: 0.2, WORKSHOP: 0.25, MAX: 1.5, DAYS: 30, WATER_DAYS: 15, WET: 0.5 },
    FLOOD: { RIVER: 2, IDLE: 20, BONUS: 0.15, BONUS_DAYS: 365 },                                         // BONUS: additive fraction
    FRIGUS: { FIELDS: 0.8, WELLS: 0.85 },
    NUPTIAE: { POP: 50, MORALE: 4, BIRTHS: 1.2, BIRTH_DAYS: 365 },
    AUGURIUM: { MORALE: 6 },
    MESSIS: { FIELDS: 1.25 },
    COLONI: { FAMILIES: 2 },
    SATURNALIA_BIRTHS: { MUL: 1.2, DAYS: 90 }, LANTERN_DAYS: 7,
  },

  // ───────── trade (DESIGN §13) ─────────
  trade: {
    REVERT: 0.02, IMPACT: 0.0015, CLAMP: [0.6, 1.6], CARGO_PER_DAY: 40, MIN_LEG: 3,
    MERCHANT_BUY: 0.85, MERCHANT_SELL: 1.15, MERCHANT_QTY: [10, 60], MERCHANT_SELL_QTY: [10, 80],
    SLOTS_BASE: 1, SLOTS_MAX: 7, MANSIO_SLOTS: 2, MANSIO_DAYS: 1,
    SLOTS_RANK: [0, 1, 2, 2, 2],                      // extra caravan slots by rank: +1 Vicus, +1 Oppidum (§13.4)
    CARGO_MAX: 80,                                    // a caravan carries at most 80 (§13.4)
    MERCHANT_POP_REF: 150, MERCHANT_SCALE: [0.5, 2],  // merchant quantities × clamp(pop / 150, 0.5, 2)
    MERCHANT_SELL_P: 0.5,                             // chance an offer asks to buy from us
  },

  // ───────── advisors (DESIGN §11.3–11.6) ─────────
  advisors: {
    CLEAR: 1.25, DOWNGRADE_DAYS: 3, MIN_LIFE: 3, HUSH_DAYS: 30, FLAP_WINDOW: 60, FLAP_MAX: 2, BELL_S: 30,
    APPOINT_BLOCKED: 5,                               // Aedilis: a house blocked ≥ 5 days
    RULES: {
      GRAIN_RUNOUT: [10, 25, 60], NET_CLEAR_DAYS: 3, FAMINE_R: 15,
      HIEMS_LEAD: 120, HIEMS_SOON: 45, HIEMS_M: 15,
      MESS_CLEAR_DAYS: 3,
      STORAGE_FULL: 0.97, STORAGE_DAYS: 5, ROT_M: 3, SPILL_C: 10, STORAGE_CLEAR: 0.9, ROT_CLEAR: 1,
      GOODS_DAYS: 30, GOODS_SUPPLY: 0.9, GOODS_LEAD: 90,   // oil/wine: Monitum when the plan runs dry within GOODS_LEAD days, Cave within GOODS_DAYS
      WATER_RUNOUT: [7, 15, 30], AESTAS_LEAD: 90, AESTAS_SOON: 30, AESTAS_M: 10,
      ACCESS_HOUSES: 2,
      IDLE_MIN: 3, IDLE_SHARE: 0.08, IDLE_DAYS: 5, OPEN_SHARE: 0.1,
      STALLED: [20, 40], CAP_ETA: 365,
      COIN_RUNOUT: [15, 45, 120], COIN_WINDOW: 30,
      EVOLVE_HOUSES: 3, DECLINING_P: 0.1,
      BEDS_FREE: 2, BEDS_WINDOW: 30, FAVOUR_LOW: 1.5,
      MORALE: [50, 35, 25], MORALE_FALL: 0.3, MORALE_FALL_DAYS: 10,
      CHOICE_SOON: 7, REMEDY_DAYS: 30, BUY_DAYS: 20,
      // remedy steps: Spare beds +4 · Builder share +5 points · Trade reserve −10 · Ask/Place house plots ×2
      SPARE_BEDS_STEP: 4, BUILDER_SHARE_STEP: 0.05, TRADE_RESERVE_STEP: -10, PLOTS: 2,
    },
    // remedy steps of the setting remedies (one tunable table)
    STEP: { BUILDER_SHARE: 0.05, SPARE_BEDS: 4, TRADE_RESERVE: 10, GRAIN_RESERVE: 15, WATER_RESERVE: 5, SURPLUS_KEEP: 0.3, SURPLUS_MIN: 10 },
  },

  // ───────── mentor tips and reveal (DESIGN §11.7, §11.9, §15.3) ─────────
  guide: { VITALS: 2, ORDO: 5, CHARTER: 10, SPEED: 20, STARVING: 50, STARVING_UNTIL: 20, THIRST_R: 6, THIRST_UNTIL: 12, WANTS_BLOCKED: 5 },
  // the opening lessons (DESIGN §11.13), paced in real seconds of play; a tip read leaves GAP days before the next tip;
  // a job not done after NUDGE_S seconds is pointed out again, and after STUCK_S the player may skip it; the card shows a
  // tip that is not urgent only TIP_GAP_S real seconds after the last one read (or the lessons' end): at 10× six game
  // days are 0.6 s; the first lesson asks for FIELD_HANDS on the fields
  intro: { GAP: 6, NUDGE_S: 45, STUCK_S: 120, TIP_GAP_S: 40, FIELD_HANDS: 4 },
  // the council's duties (DESIGN §10.2): a colony run by hand starts with START_BUILDERS builders; under the Lex de
  // annona idle hands go to the fields and wells when grain or water would run out within HANDS_AT days (or any group
  // hungers or thirsts past NEED_AT), until both stores hold HANDS_LIFT days again
  duties: { START_BUILDERS: 2, HANDS_AT: 12, HANDS_LIFT: 25, NEED_AT: 25 },
  reveal: { BUILD_ELAPSED: 20, PEOPLE_ELAPSED: 10, TERRA_ELAPSED: 30 },

  // ───────── milestones and petitions (DESIGN §9.1, §9.4) ─────────
  progress: {
    FED_DAYS: 30,
    STAB: { GRAIN: 30, WATER: 10, MORALE: 55, DAYS: 10 },
    POP: { pop50: 50, pop150: 150, pop500: 500, pop1200: 1200 },
    TEGULAE: 10, IRON: 60, SATURNALIA: 10, HUBS_ALL: 6,
    PETITION: {
      vicus: { POP: 50 },
      oppidum: { POP: 180, T2_HOUSES: 10, COVERAGE: 0.7, HUBS: 2 },
      municipium: { POP: 400, T3_HOUSES: 16, T4_HOUSES: 4, IRON: 60 },
      colonia: { POP: 700, T4_HOUSES: 12, HUBS: 5 },
    },
    LEGACY_IMPERIUM: 0.05,                            // Imperium: next colony +5% legacy
  },

  // ───────── the growing town (DESIGN §3.9): footfall, the town wall, the castrum razed, renewal ─────────
  urbs: {
    TRAFFIC: {
      ALPHA: 0.5,                                     // monthly average: this month's count weighs half
      FORUM: 0.25,                                    // a household's daily errand to the forum, per resident
      VIA: [2, 3],                                    // carts on the via a day: base + per rank
      MIN: 0.5,                                       // footfall below this is forgotten
      MAX_STEPS: 160,                                 // a commute is followed this far along the roads
      WEAR: [4, 14, 40],                              // walkers a day: grassy track < 4 ≤ track < 14 ≤ road < 40 ≤ highway
    },
    MOENIA: {
      RANK: 3,                                        // the player may lay out the town wall from Municipium;
      ORDO_RANK: 4,                                   // the Ordo waits for the colonial charter (a colonia walled itself) …
      OUTER: 1,                                       // … and for the homes beyond the camp's walls to outnumber the camp's
      LINE: 16,                                       // its line: tiles from the castrum interior (one past the outer ring's street)
      WORK: 30,                                       // builder-days per wall tile
      MAT: { stone: 5, denarii: 6 },                  // per wall tile, drawn as the work proceeds, from stock above the saving target
      CREW: 8,                                        // builders' worth of the day's spare work it may take (before the Capitolium)
      DIGNITAS: 8, MORALE: 2, BANDITS: 0.6,           // a walled town: dignitas, spirits, and the watch on the roads
      SALVAGE: 2,                                     // stone back per tile of the razed castrum wall (stone from Oppidum, else timber)
      PASSES: 80,                                     // the survey goes round works and along roads at most this many times
    },
    RENEW: {
      WELL_MARGIN: 0.5,                               // a well is filled only if no house beside it falls within this of its tier's need
      WELL_AGE: 365,                                  // … and only an old one (days since it was finished)
      CARRY: 1.1,                                     // the aqueduct carries the town: its Aestas flow covers the draw × this
      COTTAGE_LEVEL: 2,                               // homes up to this tier (tentoria, casa, tegulata) may be bought out for a civic block
      SPARE: 2,                                       // beds left free elsewhere once the families are rehoused
      GAP: 60,                                        // days between two renewals
    },
    LINE_REACH: 8,                                    // a fountain may draw from the aqueduct where it runs through the pomerium
    AQUAE_REACH: 4,                                   // the Ordo pipes water to the great houses where one fountain reaches this many
  },

  // ───────── starting state (DESIGN §18.1) ─────────
  start: {
    RES: { denarii: 600, grain: 480, water: 240, timber: 80, stone: 40, tools: 4 },
    MARKET: 1,
    FED: 1,
  },

  // ───────── presentation (DESIGN §15–§17; render/UI only) ─────────
  ui: {
    TOASTS_MAX: 4, TICKER_S: 6, RANK_BANNER_S: 8, LONG_PRESS_MS: 450, TOOLTIP_MS: 80, CLICK_GUARD_MS: 300,
    SFX_GAIN: 0.22, SFX_THROTTLE_MS: 70, NAME_MAX: 24, FASTI_MAX: 50, LIFE_SFX_S: 10, MINIMAP_MS: 500,
    PARTICLES: [600, 300], WALKERS: [220, 120], SIDE_W: 380, SHEET_VH: 46, DESKTOP: 1100, MOBILE: 900, COMPACT: 560,
    ZOOM_LEVELS: [1, 2, 3, 4, 5], ZOOM_DEFAULT: 3, ZOOM_SMALL: 2, ZOOM_SMALL_W: 700,   // §3.1 (× devicePixelRatio)
    RUNWAY_WEEKS: 21, RUNWAY_MONTHS: 120,             // stores shown in days < 3 weeks ≤ weeks < 4 months ≤ months (§8.6)
    NEWS_SPEED: 2,                                    // "Slow for news": a new choice card drops the speed to 2× (§2.1)
    FLASH_MS: 2000, PULSE_MS: 3000, CONFIRM_MS: 8000, TOAST_BATCH_MS: 1500, SEASON_FADE_MS: 2000,
    CONFIRM_MIN_MS: 400,                              // a confirm ignores a press this soon after arming (a double-click); one
                                                      // armed with no mouse on it drains for CONFIRM_MS (§15.5)
    ROSTER: 60, BEDS_LOW: 2,                          // Populus roster of the 60 oldest; souls chip amber below 2 free beds
    NEW_DAYS: 30,                                     // a NEW sticker stays this many days after a reveal
  },
} as const;

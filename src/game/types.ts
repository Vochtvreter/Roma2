// src/game/types.ts — FROZEN after the scaffold.

// ───────────────────────────── ids ─────────────────────────────
export const RESOURCES = ['denarii', 'grain', 'water', 'timber', 'stone', 'tiles', 'concrete', 'ore', 'iron', 'tools', 'oil', 'wine'] as const;
export type ResId = (typeof RESOURCES)[number];
export type Res = Record<ResId, number>;
export type Cost = Partial<Record<ResId, number>>;
export const TRADE_RES = ['grain', 'timber', 'stone', 'tiles', 'iron', 'oil', 'wine'] as const;
export type TradeRes = (typeof TRADE_RES)[number];
export type Essential = 'grain' | 'water';

export const BUILDINGS = [
  'area', 'principia', 'capitolium',
  'ager', 'venatio', 'pabulatio', 'olivetum', 'horreum', 'apotheca',
  'puteus', 'cisterna', 'castellum', 'lacus',
  'lignarius', 'lapicidina', 'figlina', 'caementarium', 'fodina', 'officina', 'fabrica',
  'taberna', 'macellum', 'mansio', 'lararium', 'templum', 'balneum', 'thermae', 'theatrum', 'hortus',
] as const;
export type BuildingId = (typeof BUILDINGS)[number];
export type PlaceClass = 'plot' | 'half' | 'block' | 'rural' | 'fixed';
export type BuildCat = 'domus' | 'annona' | 'aqua' | 'materia' | 'officinae' | 'mercatus' | 'religio' | 'salus' | 'ornamenta' | 'civitas';
export type SiteRule = 'none' | 'fertile' | 'woods' | 'wood' | 'rocky' | 'clay' | 'ore' | 'scrubHills' | 'via' | 'nearCastellum' | 'fixed';

export const HOUSE_TIERS = ['tentoria', 'casa', 'tegulata', 'domusParva', 'insula', 'domus'] as const;
export type HouseTierId = (typeof HOUSE_TIERS)[number];
export type HousePref = 'auto' | 'insula' | 'domus';

export const RANK_IDS = ['castra', 'vicus', 'oppidum', 'municipium', 'colonia'] as const;
export type RankId = (typeof RANK_IDS)[number];
export type RankIndex = 0 | 1 | 2 | 3 | 4;

export const SEASONS = ['ver', 'aestas', 'autumnus', 'hiems'] as const;
export type SeasonId = (typeof SEASONS)[number];
export type SeasonIndex = 0 | 1 | 2 | 3;
export type Quad = [number, number, number, number];          // per season or per stage

export const STAGES = ['child', 'youth', 'adult', 'elder'] as const;
export type StageId = (typeof STAGES)[number];
export type StageIndex = 0 | 1 | 2 | 3;

export const SKILLS = ['agri', 'aqua', 'silva', 'lapis', 'ferrum', 'fabri', 'officium'] as const;
export type SkillId = (typeof SKILLS)[number];

export const LABOR_CATS = ['water', 'food', 'materials', 'industry', 'services', 'builders'] as const;
export type LaborCat = (typeof LABOR_CATS)[number];

export const LAYERS = ['water', 'fountain', 'shrine', 'temple', 'market', 'macellum', 'baths', 'culture'] as const;
export type CoverageLayerId = (typeof LAYERS)[number];

export const NEEDS = ['street', 'water', 'fed', 'religion', 'market', 'temple', 'desirability', 'baths', 'macellum', 'oil', 'wine', 'rank', 'materials'] as const;
export type NeedId = (typeof NEEDS)[number];

export const FOCUSES = ['concordia', 'copia', 'materia', 'mercatura', 'urbs'] as const;
export type FocusId = (typeof FOCUSES)[number];
export const EDICTS = ['rationes', 'tributum', 'opera', 'hospites', 'horae', 'nundinae', 'feriae', 'silvae', 'aquae'] as const;
export type EdictId = (typeof EDICTS)[number];
export const SETTINGS = ['spareBeds', 'grainReserve', 'builderShare', 'waterReserve', 'tradeReserve', 'renovation', 'treasuryFloor'] as const;
export type SettingId = (typeof SETTINGS)[number];
export const SWITCHES = ['emergency', 'governAway'] as const;
export type SwitchId = (typeof SWITCHES)[number];
export const PATH_DECISIONS = ['charter', 'path1', 'path2', 'path3', 'path4'] as const;
export type PathDecisionId = (typeof PATH_DECISIONS)[number];
export const PATH_OPTIONS = [
  'veterani', 'agricolae', 'mercatores', 'canabae', 'pagus', 'coloni', 'arsFabrilis', 'pietas', 'viaMilitaris',
  'iusLatii', 'annonaPublica', 'aquaeSalutares', 'iuppiter', 'aeternitas', 'imperium',
] as const;
export type PathOptionId = (typeof PATH_OPTIONS)[number];
export const ORDO_AREAS = ['labour', 'build', 'trade'] as const;
export type OrdoArea = (typeof ORDO_AREAS)[number];
/** The council's duties (DESIGN §10.2): each is the player's until learned by doing it by hand, then theirs to hand to
 *  the Ordo or keep. Staffing and trade are the labour and trade areas; the rest divide the Ordo's building. */
export const DUTIES = ['labour', 'water', 'food', 'homes', 'services', 'materials', 'plan', 'trade'] as const;
export type DutyId = (typeof DUTIES)[number];
/** The duties that divide the Ordo's building (granted: `ordo.on.build` and `ordo.works[id]`). */
export const WORK_DUTIES = ['water', 'food', 'homes', 'services', 'materials', 'plan'] as const;
export type WorkDuty = (typeof WORK_DUTIES)[number];

export const ADVISORS = ['annonae', 'aquarum', 'fabrum', 'quaestor', 'aedilis', 'augur'] as const;
export type AdvisorId = (typeof ADVISORS)[number];
export const RULES = [
  'annonae.grain.runout', 'annonae.famine', 'annonae.hiems.forecast', 'annonae.mess', 'annonae.storage', 'annonae.goods',
  'aquarum.water.runout', 'aquarum.aestas.forecast', 'aquarum.access', 'aquarum.aqueduct',
  'fabrum.labour', 'fabrum.stalled', 'fabrum.capitolium', 'fabrum.agenda',
  'quaestor.coin', 'quaestor.contract', 'quaestor.merchant',
  'aedilis.evolve', 'aedilis.declining', 'aedilis.beds', 'aedilis.morale', 'aedilis.favour',
  'augur.choice', 'augur.petition',
] as const;
export type RuleId = (typeof RULES)[number];
export const TIPS = [
  'welcome', 'starving', 'thirst', 'event', 'petition', 'vitals', 'ordo', 'charter', 'counsel', 'speed',
  'build', 'aestas', 'wants', 'autumn', 'edicts', 'reins', 'trade', 'fork', 'aqueduct', 'away',
] as const;
export type TipId = (typeof TIPS)[number];
export const MILESTONE_IDS = [
  'firstWork', 'charter', 'fed30', 'horreum', 'hiems', 'pop50', 'stabilitas', 'vicus', 'caravan', 'tegulae',
  'pop150', 'oppidum', 'templum', 'fork', 'iron60', 'municipium', 'aqua', 'pop500', 'colonia', 'capitolium',
  'pop1200', 'allT3', 'sixHubs', 'saturnalia10',
] as const;
export type MilestoneId = (typeof MILESTONE_IDS)[number];
export const EVENTS = [
  'veterani', 'legatus', 'mutuum', 'pestilentia', 'robigo', 'siccitas', 'annonaRomae',
  'ignis', 'inundatio', 'frigus', 'latrones', 'nuptiae', 'augurium', 'messis', 'mercator', 'coloni',
] as const;
export type EventId = (typeof EVENTS)[number];
export const FESTIVALS = ['parilia', 'robigalia', 'floralia', 'ludiRomani', 'saturnalia', 'lustrum'] as const;
export type FestivalId = (typeof FESTIVALS)[number];
export const HUBS = ['metellianus', 'durii', 'silvanum', 'narbo', 'massilia', 'augusta'] as const;
export type HubId = (typeof HUBS)[number];
export const TABS = ['council', 'advisors', 'build', 'people', 'trade', 'annals'] as const;
export type TabId = (typeof TABS)[number];
export const OVERLAYS = ['none', 'aqua', 'domus', 'officia', 'desir', 'terra'] as const;
export type OverlayId = (typeof OVERLAYS)[number];
export type ToolId = 'pin' | 'road' | 'pave' | 'reserve' | 'demolish';
export type SectionId = 'focus' | 'edicts' | 'settings' | 'switches' | 'manual' | 'story';
export type Severity = 0 | 1 | 2 | 3;                     // Nota, Monitum, Cave, Periculum
export type Owner = 'start' | 'player' | 'ordo';
export type GateId = 'praetoria' | 'decumana' | 'principalisN' | 'principalisS';

// ───────────────────────────── terrain ─────────────────────────────
export const T = { grass: 0, meadow: 1, loam: 2, scrub: 3, forest: 4, dense: 5, hills: 6, rock: 7, crag: 8, river: 9 } as const;
export type Terrain = (typeof T)[keyof typeof T];
export const F = { none: 0, clay: 1, ore: 2, fons: 3, lucus: 4, ruins: 5 } as const;
export type Feature = (typeof F)[keyof typeof F];

export interface Rect { x: number; y: number; w: number; h: number }

export interface Block {
  id: number;                    // index in Survey.blocks
  ring: 0 | 1 | 2 | 3;           // 0 = castrum interior; 3 = the castrum's wall and ditch, urban once the walls are razed
  bx: number; by: number;        // block grid coords (castrum interior bx 0..5, by 0..3)
  x: number; y: number;          // top-left map tile of the 4×4 block
  masked: boolean;               // river/crag/rock/lucus/ruins/>4 loam/off-map
  reserved: 'forum' | 'capitolium' | null;
  district: 'praetentura' | 'latera' | 'retentura' | 'canabae' | 'vallum';
  touchesVia: boolean;           // a block side lies on the via/decumanus line
  touchesForum: boolean;
}
export interface Survey {
  ix: number; iy: number;        // castrum interior origin tile (castrum coords 0,0)
  viaDir: 'E' | 'W';             // side of the Porta Praetoria
  castrum: Rect;                 // interior + wall + fossa (39 × 29)
  interior: Rect;                // 31 × 21
  forum: Rect;                   // 9 × 9
  capitolium: Rect;              // 9 × 4 (Area Capitolina)
  blocks: Block[];
  blockAt: Int16Array;           // tile → block id or −1
  street: Uint8Array;            // 1 = survey street-line tile (rings 0–2, not masked water)
  streetRing: Int8Array;         // ring of the street tile (0..3; 3 = across the castrum's wall and ditch) or −1
  wall: Uint8Array;              // 1 wall, 2 gate
  fossa: Uint8Array;             // 1 = ditch tile
  gates: { id: GateId; tile: number }[];
  via: number[];                 // via tiles from the Porta Praetoria outward to the map edge
  bridge: number[];              // via tiles that are bridge (over river)
  sacredWay: number[];           // cardo tiles inside the Area Capitolina (never streets)
}
export interface WorldMap {
  seed: number; W: number; H: number;
  terrain: Uint8Array;           // Terrain per tile
  feature: Uint8Array;           // Feature per tile
  elev: Float32Array; moist: Float32Array;
  woodMax: Float32Array;         // initial timber per tile (0 if not wooded)
  vein: Float32Array;            // ore quality (0 if no ore)
  waterTable: Uint8Array;        // 1 = on the water table
  riverDist: Uint8Array;         // Chebyshev distance to river, capped at 255
  fontes: number[];              // spring tiles
  startAger: { x: number; y: number };
  survey: Survey;
}

// ───────────────────────────── effects ─────────────────────────────
export const MUL_KEYS = [
  'grainUse', 'waterUse', 'tax', 'marketTax', 'labour', 'builders', 'renovation',
  'fields', 'hunting', 'forage', 'olives', 'wells', 'rain', 'timber', 'quarry', 'industry',
  'immigration', 'births', 'veterans', 'merchants', 'tradePrice', 'tripDays', 'bandits',
  'horreaCap', 'disease', 'blight', 'regrow', 'toolDays', 'festivalCost', 'templeDignitas', 'dignitas',
  'capWork', 'capMat', 'castellumCost', 'lacusCost', 'petitionFee',
] as const;
export type MulKey = (typeof MUL_KEYS)[number];
export const ADD_KEYS = [
  'morale', 'hiemsMorale', 'shrineRadius', 'marketRadius', 'bathsRadius', 'caravanSlots',
  'lowCap', 'insulaCap', 'care', 'hiemsFields', 'fama',
] as const;
export type AddKey = (typeof ADD_KEYS)[number];
export interface Effects { mul?: Partial<Record<MulKey, number>>; add?: Partial<Record<AddKey, number>> }

// ───────────────────────────── data definitions ─────────────────────────────
export interface ResourceDef { id: ResId; name: string; latin: string; unit: string; baseCap: number; trade: number | null; icon: string; desc: string }

export interface ServiceDef { layer: CoverageLayerId; radius: number }
export interface BuildingDef {
  id: BuildingId; name: string; latin: string; desc: string; benefit: string; hint: string;
  cat: BuildCat;
  place: PlaceClass[];                       // allowed placement classes (e.g. puteus: ['plot','rural'])
  size: [number, number];                    // rural footprint w,h (urban classes imply 2×2/4×2/4×4)
  cost: Cost; work: number; rank: RankIndex;
  perTile?: { cost: Cost; work: number };    // castellum aqueduct route
  slots: number; labor: LaborCat | null; skill: SkillId | null;
  slotsFrom?: readonly [RankIndex, number];         // from this rank the work takes this many hands (data/buildings.slotsOf)
  output?: { res: ResId; perWorker: number };
  inputs?: Partial<Record<ResId, number>>;   // per worker-day (processing)
  passive?: { res: ResId; perDay: number };
  seasons?: Quad;                            // output season multipliers [Ver, Aestas, Autumnus, Hiems]
  fxKey?: MulKey;                            // output effect key (fields, hunting, …)
  service?: ServiceDef[];
  storage?: Cost;
  waterDraw?: number;                        // baths, per day
  upkeep: number;
  desir: [value: number, range: number];
  dignitas: number;
  rule: SiteRule;
  tool: boolean;                             // eligible for tool kits
  maxCount?: number;
}
export interface HouseTierDef {
  id: HouseTierId; level: 0 | 1 | 2 | 3 | 4; name: string; latin: string;
  beds: number; tax: number; needs: NeedId[]; desirMin: number | null;
  renovation: Cost; rank: RankIndex; dignitas: number; patrician: boolean;
  desir: [number, number];                   // the house's own desirability influence
}
export interface RankDef {
  index: RankIndex; id: RankId; name: string; title: string;
  fee: Cost; dignitas: number;               // petition fee and dignitas threshold (to ENTER this rank)
  ceiling: number; territory: number; rings: number[]; immRate: number; subsidy: number;
  unlocks: BuildingId[]; hubs: HubId[]; forumStage: number;
}
export interface DecisionOption { id: string; name: string; desc: string; fx: Effects; visible?: string }
export interface EdictDef { id: EdictId; name: string; latin: string; prompt: string; options: DecisionOption[]; initial: string; unlock: MilestoneId; situational: string }
export interface PathDef { id: PathDecisionId; name: string; prompt: string; grants: RankIndex; options: (DecisionOption & { id: PathOptionId })[] }
export interface FocusDef { id: FocusId; name: string; latin: string; desc: string; plan: [BuildingId, number][]; split: Partial<Record<LaborCat, number>> }
export interface SettingDef { id: SettingId; name: string; latin: string; desc: string; min: number; max: number; step: number; initial: number; unit: string; unlock: MilestoneId }
export interface SwitchDef { id: SwitchId; name: string; desc: string; initial: boolean }
export interface HubQuirk { buy?: number | 'refused'; sell?: number | 'refused' }
export interface HubDef { id: HubId; name: string; desc: string; days: number; buy: number; sell: number; quirks: Partial<Record<TradeRes, HubQuirk>>; rank: RankIndex }
export interface AdvisorDef { id: AdvisorId; office: string; name: string; domain: string; order: number; portrait: string }
export type UnlockRef =
  | { kind: 'edict'; id: EdictId } | { kind: 'setting'; id: SettingId } | { kind: 'switch'; id: SwitchId }
  | { kind: 'tool'; id: ToolId } | { kind: 'overlay'; id: OverlayId } | { kind: 'section'; id: SectionId }
  | { kind: 'cosmetic'; id: string; label: string } | { kind: 'victory' };
export interface MilestoneDef { id: MilestoneId; text: string; hint: string; progress(s: GameState): [number, number]; unlocks: UnlockRef[]; postVictory?: boolean }
export interface GuideStep {
  id: TipId; title: string; text(s: GameState): string;
  when(s: GameState): boolean; after?: TipId; until?(s: GameState): boolean;
  target?: string; tab?: TabId; urgent?: boolean;
}

// ───────────────────────────── people ─────────────────────────────
export const BUILDER = -1;                    // Person.work value while on construction
export interface Person {
  id: number; prae: string; gens: string;     // gens stored in masculine form ('Valerius')
  ord?: number; cog?: string; female: boolean;
  born: number;                               // absolute game day
  family: number; spouse: number | null; mother: number | null; father: number | null;
  home: number | null;                        // house building id
  work: number | null;                        // building id, BUILDER, or null (idle/not working)
  skills: Partial<Record<SkillId, number>>;
  vet?: boolean; sickUntil?: number; widowedDay?: number; homelessSince?: number; arrived?: number;
}
export interface Family { id: number; gens: string; head: number; home: number | null }

// ───────────────────────────── buildings ─────────────────────────────
export type SiteStatus = 'plan' | 'staked' | 'building' | 'done';
export type NoteCode = 'river' | 'loam' | 'fields' | 'forum' | 'woods' | 'rock' | 'clay' | 'vein' | 'quarryNear' | 'mineNear' | 'district' | 'covers' | 'unblocks' | 'felling' | 'water' | 'via';
export interface SiteNote { code: NoteCode; value?: number }
export interface HouseState {
  tier: HouseTierId; pref: HousePref;
  okDays: number; badDays: number; recoverDays: number;
  declining: boolean; declineDays: number;
  renovating: { until: number; to: HouseTierId } | null;
  oil: number; wine: number;                  // supply EMA 0..1
}
export interface Building {
  id: number; type: BuildingId; x: number; y: number;   // top-left tile
  owner: Owner; status: SiteStatus;
  placed: number;                             // day placed
  progress: number;                           // 0..1
  work: number;                               // total work incl. felling and aqueduct route
  paid: boolean;                              // cost paid (false only for 'plan')
  order: number;                              // works-queue order (lower first)
  open: boolean; prio: 0 | 1 | 2;             // staffing enabled; priority low/normal/high
  reason?: Reason; notes?: SiteNote[];
  house?: HouseState;
  doneDay?: number; toolUntil?: number; vein?: number; youngUntil?: number;
  idleUntil?: number; bonus?: number; bonusUntil?: number; damagedUntil?: number;
  route?: number[];                           // castellum: aqueduct tiles, fons first
  matUsed?: Cost;                             // capitolium: gradual materials consumed
  unpaid?: boolean;                           // upkeep unpaid today
}

// ───────────────────────────── Ordo, decisions, guidance ─────────────────────────────
export type ReasonCode =
  | 'request' | 'pin' | 'survivalFood' | 'survivalWater' | 'aestasWater' | 'hiemsStore' | 'storageFull' | 'beds'
  | 'waterAccess' | 'evolve' | 'rank' | 'materials' | 'luxury' | 'focusPlan' | 'beauty' | 'capitolium'
  | 'needWater' | 'needFood' | 'reserveTopup' | 'requiredService' | 'builderShare' | 'monument' | 'pendingInput'
  | 'winterStock' | 'tools' | 'luxuryStaff' | 'serviceFull' | 'focusSplit' | 'leftover' | 'priority'
  | 'deficitImport' | 'luxuryImport' | 'wishImport' | 'surplusExport' | 'merchantDeal'
  | 'emergencyRations' | 'emergencyWater' | 'emergencyHands' | 'emergencyImport' | 'relief' | 'saving' | 'aquae' | 'renewal';
export interface Reason { code: ReasonCode; params: Record<string, number | string> }

export interface DecisionState {
  focus: FocusId;
  edicts: Record<EdictId, string>;
  edictLock: Partial<Record<EdictId, number>>;      // first day the edict may change again
  paths: Partial<Record<PathDecisionId, PathOptionId>>;
  pathDays: Partial<Record<PathDecisionId, number>>;
  settings: Record<SettingId, number>;
  switches: Record<SwitchId, boolean>;
}
export interface OrdoState {
  on: Record<OrdoArea, boolean>;
  manual: Record<LaborCat, number>;                  // manual labour targets per category
  requests: { type: BuildingId; day: number; house?: number }[];   // "Ask the Ordo", max 3; house: the home a house card asked for
  pin: BuildingId | null;
  reserved: number[];                                // reserved block ids (sorted)
  priorities: { cat: LaborCat; until: number }[];    // temporary "X first for N days"
  emergency: { rations: 'none' | 'parcae' | 'arctae'; waterPause: boolean; lastImport: number; lastRelief: number; freeReliefYear: number; hands: boolean };
  works: Record<WorkDuty, boolean>;                  // which kinds of work the Ordo may raise (with on.build)
  learned: DutyId[];                                 // duties the player has done by hand: theirs to hand over (DUTIES order)
  answered: DutyId[];                                // learned duties the player has handed over or chosen to keep
}
export interface Metric { label: string; value: number; unit: 'days' | 'houses' | 'den' | 'pct' | 'souls' }
export interface AdvisoryMemo {
  rule: RuleId; active: boolean; sev: Severity; since: number;
  lowerSince: number | null;                          // day the evaluated severity first fell below sev
  params: Record<string, number | string>; metric?: Metric;
  snoozeUntil?: number; flips: number[];             // days it was raised or cleared (last 60 days)
  snoozeSev?: Severity;                               // severity when hushed: the hush outlives a clear, and only a graver one breaks it
}
/** Jobs of the opening lessons the UI notes (a speed chosen, an overlay opened, the advisors heard, Populus opened, an edict set). */
export const PRACTICE = ['speed', 'overlay', 'advisors', 'people', 'edict'] as const;
export type PracticeId = (typeof PRACTICE)[number];
/** The opening lessons (intro.ts, DESIGN §11.13). Paced in real play time (stats.playMs), never in game days. */
export interface IntroState {
  lesson: number;                                     // index into LESSONS; -1 when none runs (finished, skipped, or an older colony)
  done: boolean;                                      // the lesson's job is done: its breather runs
  at: number;                                         // stats.playMs when the lesson began or, once done, when its job was done
  practice: PracticeId[];                             // jobs the UI noted during this lesson
}
export interface GuidanceState {
  advisories: Partial<Record<RuleId, AdvisoryMemo>>;
  muted: RuleId[]; appointed: AdvisorId[];
  tips: TipId[];                                      // seen tip ids
  tipDay: number;                                     // the day a tip was last read ("Understood"); NEVER before the first
  tipAt: number;                                      // stats.playMs then (or when the lessons ended): tips are spaced in real time too
  objective: number;                                  // index into MILESTONES
  milestoneDays: Partial<Record<MilestoneId, number>>;
  intro: IntroState;
}

// ───────────────────────────── trade, events ─────────────────────────────
export type PauseCode = 'reserve' | 'stock' | 'denarii' | 'storage' | 'refused';
export interface ContractSpec { hub: HubId; mode: 'export' | 'import'; res: TradeRes; qty: number; repeat: boolean }
export interface Contract extends ContractSpec {
  id: number; owner: 'player' | 'ordo'; status: 'idle' | 'travelling' | 'paused';
  pause?: PauseCode; reason?: Reason; trips: number; created: number;
}
export interface Caravan {
  id: number; contract: number | null; hub: HubId; mode: 'export' | 'import'; res: TradeRes; qty: number;
  value: number;                                     // denarii paid (import) or to be received (export)
  depart: number; arrive: number;                    // arrive = return day
  kind: 'contract' | 'emergency' | 'relief';
}
export interface MerchantOffer { id: number; kind: 'buy' | 'sell'; res: TradeRes; qty: number; price: number; taken: boolean; declined?: boolean }   // taken: closed (struck, or declined when declined is set)
export interface Merchant { name: string; arrived: number; until: number; offers: MerchantOffer[] }
export interface TradeState {
  market: Record<TradeRes, number>; contracts: Contract[]; caravans: Caravan[];
  merchant: Merchant | null; lastMerchant: number; hubsTraded: HubId[]; debt: number;
}
export interface ChoiceOption { label: string; note: string; key: string; cost?: Cost; gain?: Cost }
export interface PendingChoice {
  event: EventId; kicker: string; title: string; text: string;
  options: ChoiceOption[]; defaultIndex: number;
  created: number; expires: number;
  data?: Record<string, number | string>;
}
export interface GateParty { families: { family: Family; people: Person[] }[]; until: number }
export interface Modifier {
  id: string; label: string; until: number; fx: Effects; benign: boolean;
  source: EventId | FestivalId | 'emergency' | 'stage' | 'legatus';
}

// ───────────────────────────── log, stats ─────────────────────────────
export type LogKind = 'info' | 'good' | 'bad' | 'build' | 'birth' | 'death' | 'ordo' | 'trade' | 'event' | 'advisor' | 'rank' | 'milestone' | 'ledger' | 'emergency' | 'fasti';
export type LogTag = 'highlight' | 'decided';
export interface LogEntry { day: number; kind: LogKind; text: string; tags?: LogTag[]; ref?: number }
export type DeathCause = 'age' | 'hunger' | 'thirst' | 'fever' | 'fire' | 'other';
export interface Counters {
  fedStreak: number; stabStreak: number; ironMade: number; tilesMade: number; caravansReturned: number;
  festivalsKept: Partial<Record<FestivalId, number>>; robigaliaYear: number;
  lastArrivalBlocked: number; lastBirthBlocked: number;
  immCall: number;                                   // souls Rome's roll has called and not yet sent (DESIGN §6.6)
  renovWindow: { start: number; count: number };
  lastChoiceDay: number; lastHarmfulDay: number; lastFireDay: number;
  coinEma: number;                                   // 30-day EMA of net denarii/day (accrual basis)
  mentorDiedDay: number | null;
}
export interface Stats {
  births: number; deaths: number; deathsBy: Record<DeathCause, number>;
  immigrants: number; emigrants: number; peakPop: number;
  built: number; builtBy: Partial<Record<BuildingId, number>>;
  evolved: number; evolvedBy: Partial<Record<HouseTierId, number>>; devolved: number;
  denariiTaxed: number; playMs: number; startedAt: number; victoryDay: number | null;
  atVictory?: VictoryStats;                          // the figures of the dedication day (set with victoryDay; older saves lack it)
}
/** The colony on the day its Capitolium was dedicated: the Victory dispatch reads these, also when read again later. */
export interface VictoryStats { pop: number; peakPop: number; births: number; immigrants: number; built: number; evolved: number; playMs: number }

// ───────────────────────────── the growing town (urbs.ts) ─────────────────────────────
/** The town wall: surveyed around the whole town at Municipium, raised by the builders, then the castrum is razed. */
export interface Moenia {
  tiles: number[];                                   // wall tiles in building order (from the Porta Praetoria round the town)
  gates: number[];                                   // gate tiles (sorted): where a road crosses the line
  surveyed: number;                                  // day the groma laid the line
  work: number; progress: number;                    // total builder-days and the share done (0..1)
  matUsed: Cost;                                     // stone and coin drawn so far
  done: number | null;                               // day finished
}
export interface UrbsState {
  traffic: Record<number, number>;                   // sparse: road tile → footfall (walkers a day, monthly average)
  moenia: Moenia | null;                             // the town wall, once surveyed
  razed: number | null;                              // day the castrum's vallum came down and its fossa was filled
  renewed: number;                                   // last day the Ordo renewed a quarter (cottages bought out for a civic block)
}

// ───────────────────────────── the save ─────────────────────────────
export interface GameState {
  version: number; seed: number; rng: number; nextId: number;
  name: string; day: number; legacy: number; legacyBonus: number;
  rank: RankIndex; victory: boolean; defeat: boolean;
  res: Res; taxAccrued: number;
  people: Person[];                                  // living, sorted by id
  families: Family[];                                // sorted by id
  buildings: Building[];                             // sorted by id
  roads: number[]; paved: number[];                  // sorted tile indices (paved ⊆ roads)
  wood: Record<number, number>;                      // sparse: forest tiles below their max
  urbs: UrbsState;                                   // footfall, the town wall and the castrum's fate
  needs: { hunger: Quad; thirst: Quad };             // per stage group, 0..100
  fed: number;                                       // fed index (30-day EMA), 0..1
  morale: number;
  decisions: DecisionState; ordo: OrdoState; trade: TradeState;
  choice: PendingChoice | null; gate: GateParty | null;
  eventDays: Partial<Record<EventId, number>>;       // last day each event fired
  modifiers: Modifier[];
  guidance: GuidanceState;
  counters: Counters; stats: Stats;
  log: LogEntry[];                                   // capped at B.LOG_CAP (400)
  lastSave: number;                                  // wall-clock ms written by save.ts; never read by the sim
}

// ───────────────────────────── tick context ─────────────────────────────
export type RateSource =
  | BuildingId | 'eating' | 'drinking' | 'idleForage' | 'renovation' | 'construction' | 'capitolium'
  | 'upkeep' | 'taxes' | 'marketTax' | 'subsidy' | 'trade' | 'merchant' | 'rot' | 'evaporation' | 'spill'
  | 'festival' | 'event' | 'baths' | 'relief' | 'debt' | 'felling' | 'goods';
export interface Rates {
  prod: Record<ResId, Partial<Record<RateSource, number>>>;
  cons: Record<ResId, Partial<Record<RateSource, number>>>;
}
export type FxEvent =
  | { kind: 'built'; id: number; short?: number }   // short: by hand, the hands its category's target lacked for it as it was finished
  | { kind: 'evolved'; id: number; tier: HouseTierId }
  | { kind: 'declined'; id: number }
  | { kind: 'birth'; home: number | null }
  | { kind: 'death'; home: number | null }
  | { kind: 'arrive'; family: number; n: number; home: number | null }
  | { kind: 'leave'; n: number }
  | { kind: 'caravanOut'; caravan: number; hub: HubId }
  | { kind: 'caravanIn'; caravan: number; hub: HubId; denarii: number }
  | { kind: 'taxes'; amount: number }
  | { kind: 'rank'; rank: RankIndex }
  | { kind: 'milestone'; id: MilestoneId }
  | { kind: 'fire'; id: number }
  | { kind: 'stage'; id: number; stage: number }
  | { kind: 'season'; season: SeasonIndex }
  | { kind: 'event'; id: EventId }
  | { kind: 'advisory'; rule: RuleId; sev: Severity }
  | { kind: 'ordoPlaced'; id: number }
  | { kind: 'learned'; duty: DutyId }
  | { kind: 'walls'; stage: 'surveyed' | 'raised' }
  | { kind: 'renewed'; tiles: number[] }
  | { kind: 'victory' };
export interface TickContext { fx: FxEvent[]; rates: Rates; offline: boolean }

// ───────────────────────────── derived views (memoised, never saved) ─────────────────────────────
export interface Derived {
  buildingAt: Int32Array;            // tile → building id (0 = none); includes sites and plans
  road: Uint8Array;                  // 0 none, 1 dirt, 2 paved
  pomerium: Uint8Array;              // 1 = tile of an active (current-rank ring) unmasked block or active street
  territory: Uint8Array;             // 1 = inside current territory
  reservedTile: Uint8Array;          // 1 = reserved (aqueduct route under construction, Area Capitolina)
  wall: Uint8Array;                  // standing or surveyed fortifications: 1 wall or ditch, 2 gate (castrum until razed; town wall)
  plotOwner: Int32Array;             // (blockId*4 + plot) → building id or 0
  counts: Partial<Record<BuildingId, number>>;   // finished buildings
  all: Partial<Record<BuildingId, number>>;      // including plans and sites
  houses: number[];                  // finished house ids (area with house state), sorted
  sites: number[];                   // unfinished (plan/staked/building) ids in works order
  castellumActive: boolean;
  stepsToForum: Int16Array;          // road-BFS steps from the forum's road ring (−1 unreachable)
}
export interface Coverage {
  layers: Record<CoverageLayerId, Uint8Array>;   // per tile: 1 = covered road tile
  houseMask: Map<number, number>;                // house id → bitmask over LAYERS (bit i = LAYERS[i])
  key: string;
}
export interface Census {
  day: number; pop: number; byStage: Quad; adults: number;
  workforce: number;                 // able workers (adults + elders < 65, not patricii, not sick)
  idle: number[];                    // ids of able workers without work, sorted
  beds: number; freeBeds: number; homeless: number; roll: number;
  need: Record<Essential, number>;   // per day at current portions
  groupNeed: { grain: Quad; water: Quad };
  caps: Res; horreaCap: number;
  slots: Record<number, number>;     // building id → effective slots (closed/unfinished = 0)
  staffed: Record<number, number>;
  catSlots: Record<LaborCat, number>; catStaffed: Record<LaborCat, number>;
  houses: number; byTier: Record<HouseTierId, number>; declining: number; patricii: number;
}
export interface MonthCell { month: number; year: number; season: SeasonIndex; minDoh: number; endStock: number }
export interface CrunchForecast { season: SeasonIndex; startsIn: number; lowestDoh: number; lowestDay: number; emptyDay: number | null; needInStore: number }
export interface EssentialForecast {
  stock: number; cap: number; need: number;
  prod: number; cons: number; net: number; net3: number;      // today and 3-day average net
  doh: number; runout: number | null; room: number;
  maxPotential: number; structural: boolean;
  months: MonthCell[];                                          // 12 cells from the current month
  lowestDoh: number; lowestDay: number;
  crunch: CrunchForecast | null;                                // Hiems for grain, Aestas for water (next or current)
}
export interface Forecast { day: number; grain: EssentialForecast; water: EssentialForecast; coin: { stock: number; net30: number; runout: number | null } }
export interface SimView { readonly d: Derived; readonly c: Census; readonly f: Forecast; readonly cov: Coverage }

export interface LabourLine { cat: LaborCat; target: number; have: number; slots: number; reason: Reason }
export interface LabourPlan { perBuilding: Record<number, number>; builders: number; lines: LabourLine[] }
export interface WishView {
  type: BuildingId; state: 'staked' | 'building' | 'saving' | 'waiting' | 'paced' | 'proposed';
  reason: Reason; lacking?: Cost; eta?: number; siteId?: number; tile?: number;
}
export interface CouncilReport {
  day: number; labour: LabourLine[]; agenda: WishView[];
  saving: { cost: Cost; for: 'petition' | 'plan' | 'pin' | 'request' | 'wish' } | null;
  trade: { contract: number; reason: Reason }[];
  would: { labour: Partial<Record<LaborCat, number>>; build: WishView | null; trade: Reason | null };
  ticker: Reason[];
}

// ───────────────────────────── advisors ─────────────────────────────
export interface AdvisoryEval { rule: RuleId; severity: Severity; metric?: Metric; params: Record<string, number | string> }
export interface AdvisorRule {
  id: RuleId; advisor: AdvisorId; supersedes?: RuleId[];
  evaluate(s: GameState, v: SimView): AdvisoryEval | null;               // pure, in-tick, cheap
  clear?(s: GameState, v: SimView, memo: AdvisoryMemo): boolean;           // hysteresis release (default: metric beyond threshold × 1.25)
  title(s: GameState, a: AdvisoryMemo): string;                             // render-time
  text(s: GameState, v: SimView, a: AdvisoryMemo): string;                  // render-time; may name people and places
  remedies(s: GameState, v: SimView, a: AdvisoryMemo): Remedy[];            // render-time; 1–3
}
export interface ActiveAdvisory { rule: RuleId; advisor: AdvisorId; memo: AdvisoryMemo }
export type Remedy =
  | { kind: 'ask'; building: BuildingId }
  | { kind: 'place'; building: BuildingId; tile?: number }
  | { kind: 'priority'; cat: LaborCat; days: number }
  | { kind: 'assign'; cat: LaborCat; n: number }
  | { kind: 'edict'; edict: EdictId; option: string }
  | { kind: 'setting'; setting: SettingId; value: number }
  | { kind: 'switch'; sw: SwitchId; value: boolean }
  | { kind: 'focus'; focus: FocusId }
  | { kind: 'contract'; spec: ContractSpec }
  | { kind: 'buyNow'; res: TradeRes; qty: number }
  | { kind: 'relief' }
  | { kind: 'toggleOrdo'; area: OrdoArea; on: boolean }
  | { kind: 'building'; op: 'open' | 'close' | 'prioritise' | 'center'; id: number }
  | { kind: 'clear'; building: BuildingId; tile: number; ids: number[] }   // pull down `ids` on the block at `tile`, then place `building` there
  | { kind: 'open'; tab: TabId; anchor?: string }
  | { kind: 'overlay'; overlay: OverlayId; layer?: CoverageLayerId }
  | { kind: 'tool'; tool: Exclude<ToolId, 'pin'> };      // a map tool to start (the Pave brush, DESIGN §6.6)

// ───────────────────────────── results ─────────────────────────────
export type PlaceFail =
  | 'offMap' | 'outsideTerritory' | 'castrum' | 'reserved' | 'notInPomerium' | 'notOnSlot' | 'occupied'
  | 'street' | 'road' | 'water' | 'crag' | 'sacred' | 'terrain' | 'futureRing' | 'noRoad'
  | 'noCastellum' | 'noFons' | 'needsVia' | 'rankLocked' | 'maxCount';
export type FailCode =
  | PlaceFail | PauseCode
  | 'locked' | 'unaffordable' | 'window' | 'notReady' | 'chosen' | 'invalid' | 'notFound' | 'notOwner'
  | 'manualOnly' | 'ordoOnly' | 'full' | 'noSlots' | 'noChoice';
export type ActionResult = { ok: true; id?: number } | { ok: false; code: FailCode; reason: string };
export type PlaceCheck =
  | { ok: true; x: number; y: number; mult: number; notes: SiteNote[]; fell: number; cost: Cost; work: number; warn?: string; route?: number[] }
  | { ok: false; code: PlaceFail; reason: string };
export interface PlaceOpts { owner?: Owner; replaceId?: number; noStake?: boolean; reason?: Reason; ignoreCost?: boolean }

// ───────────────────────────── offline, prefs ─────────────────────────────
export interface Snapshot {
  day: number; pop: number; rank: RankIndex; morale: number; res: Res; grainDoh: number; waterDoh: number; births: number; deaths: number; immigrants: number; emigrants: number; built: number; evolvedBy: Partial<Record<HouseTierId, number>>; builtBy: Partial<Record<BuildingId, number>>;
  petition: { rank: RankIndex; met: number; of: number; items: number[] } | null;   // the next rank's checklist (decisions.ts nextRankNeeds); null at Colonia
                                                                   // items: each line's progress 0..1 in checklist order (a yes/no line 0 or 1)
  capitolium: number | null;                                       // the Capitolium's progress 0..1; null before its works begin
}
export interface AwayReport {
  awayMs: number; daysPlanned: number; days: number;
  before: Snapshot; after: Snapshot;
  decided: string[]; highlights: LogEntry[];
  lowest: { grain: { doh: number; day: number }; water: { doh: number; day: number } };
  awaiting: {
    petition: RankIndex | null;
    readySince: number | null;                                      // the day the ready petition became ready (the Augur's Opportunitas raised)
    stalled: { rank: RankIndex | null; lacking: string[] } | null;  // nothing moved toward the next rank: its unmet items, or (rank null) the Capitolium
    advisories: RuleId[];
  };
}
export interface OfflineRun { days: number; progress(): number; step(n: number): boolean; report(): AwayReport }
export type Speed = 1 | 2 | 5 | 10 | 20;
export interface Prefs { sound: boolean; volume: number; speed: Speed; paused: boolean; tips: boolean; slowForNews: boolean; pauseOnCritical: boolean }
export interface FastiEntry { name: string; seed: number; legacy: number; founded: number; dedicated: number | null; peakPop: number; paths: PathOptionId[]; playMs: number }

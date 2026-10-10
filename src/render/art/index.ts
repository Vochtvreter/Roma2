// src/render/art/index.ts — registerAllArt and the sprite-name helpers everyone uses (ARCHITECTURE §12.3). Owner: WP-G.
// The naming convention is frozen: WP-F and the UI reference only names produced here or listed in REQUIRED_SPRITES.
import { ADVISORS, BUILDINGS, HOUSE_TIERS, NEEDS, OVERLAYS, RESOURCES, TABS } from '../../game/types';
import type { AdvisorId, Building, BuildingId, GameState, HouseTierId, NeedId, ResId, SeasonIndex, ToolId } from '../../game/types';
import { hash2 } from '../../game/rng';
import { isAquae } from '../../game/housing';
import { capitoliumStage } from '../../game/construction';
import { RANK_DEFS } from '../../game/data/ranks';
import { hasSprite } from '../sprites';
import { registerHousing } from './housing';
import { registerCivic } from './civic';
import { registerRural } from './rural';
import { registerProcedural } from './procedural';
import { registerNature } from './nature';
import { registerActors } from './actors';
import { registerIcons } from './icons';
import { registerPortraits } from './portraits';
import { registerFrames } from './frames';
import { registerDecor } from './decor';

const TOOLS: readonly ToolId[] = ['pin', 'road', 'pave', 'reserve', 'demolish'];
const SEASONS4 = [0, 1, 2, 3] as const;
const NOT_SPRITED: readonly BuildingId[] = ['area', 'principia', 'capitolium'];
const AQUAE_TIERS: readonly HouseTierId[] = ['insula', 'domus'];
const SEASONAL_REQUIRED: readonly string[] = ['b_ager', 'b_olivetum', 'n_oak_0', 'n_oak_1', 'n_oak_2'];

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const withSeasons = (name: string): string[] => [name, ...SEASONS4.map((k) => `${name}@${k}`)];

function required(): string[] {
  const out: string[] = [];
  const add = (...names: string[]): void => { out.push(...names); };
  // houses
  for (const t of HOUSE_TIERS) add(`h_${t}_0`, `h_${t}_1`);
  add('h_insula_aquae', 'h_domus_aquae');
  // buildings (seasonal variants required for ager and olivetum)
  for (const b of BUILDINGS) {
    if (NOT_SPRITED.includes(b)) continue;
    const name = `b_${b}`;
    if (SEASONAL_REQUIRED.includes(name)) add(...withSeasons(name).slice(1));
    add(name);
  }
  add('b_lignarius_logs');
  // forum and Capitolium
  for (const k of range(0, 4)) add(`p_forum_${k}`);
  for (const k of range(1, 4)) add(`p_capitolium_${k}`);
  add('p_crown_iuppiter', 'p_crown_aeternitas', 'p_crown_imperium', 'n_altar');
  // building overlays
  add('ov_scaffold', 'ov_cracks', 'ov_lanterns', 'ov_pegs', 'ov_trench');
  // linear
  for (const w of ['vallum', 'murus']) for (const d of ['h', 'v', 'c']) add(`l_${w}_${d}`);
  for (const m of ['timber', 'stone']) for (const d of ['h', 'v']) add(`l_gate_${m}_${d}`);
  add('l_aqua_ew', 'l_aqua_ns', 'l_aqua_pier', 'l_bridge', 'n_milestone');
  // nature
  for (const k of range(0, 2)) add(...withSeasons(`n_oak_${k}`));
  add('n_pine', 'n_cypress', 'n_stump', 'n_rock_0', 'n_rock_1', 'n_reeds', 'n_ruins', 'n_lucus', 'n_spring');
  // actors
  add('a_person_idle', 'a_person_walk0', 'a_person_walk1', 'a_person_work');
  for (const who of ['child', 'elder', 'patrician']) add(`a_${who}_idle`, `a_${who}_walk0`, `a_${who}_walk1`);
  for (const who of ['legionary', 'priest', 'oxcart', 'mules', 'wagon', 'ox', 'bird']) add(`a_${who}_0`, `a_${who}_1`);
  add('a_vettent', 'a_sheep', 'a_fish');
  // icons 12×12
  for (const r of RESOURCES) add(`i_${r}`);
  for (const k of range(0, 4)) add(`i_face_${k}`);
  add('i_laurel');
  for (const k of SEASONS4) add(`i_season_${k}`);
  for (const n of NEEDS) add(`i_want_${n}`);
  add('i_seal', 'i_plan', 'i_stake', 'i_closed', 'i_unpaid', 'i_unstaffed', 'i_request', 'i_souls', 'i_beds');
  for (const t of TABS) add(`i_tab_${t}`);
  for (const t of TOOLS) add(`i_tool_${t}`);
  for (const o of OVERLAYS) if (o !== 'none') add(`i_ov_${o}`);
  add('i_star');
  // portraits 24×24
  for (const a of ADVISORS) for (const m of range(0, 2)) add(`pt_${a}_${m}`);
  add('pt_mentor', 'pt_mentor_notes', 'pt_silhouette');
  // frames
  add('f_meander', 'f_seal', 'f_aquila');
  return out;
}

/** Every sprite name of the frozen naming table (ARCHITECTURE §12.3), expanded; art.test.ts checks each is registered. */
export const REQUIRED_SPRITES: readonly string[] = Object.freeze(required());

let registered = false;

/** Registers every art group once (idempotent); main.ts calls it at boot. No canvas work happens here. */
export function registerAllArt(): void {
  if (registered) return;
  registered = true;
  registerHousing();
  registerCivic();
  registerRural();
  registerProcedural();
  registerNature();
  registerActors();
  registerIcons();
  registerPortraits();
  registerFrames();
  registerDecor();
}

/** `name@season` when that seasonal variant is registered, else `name`. */
export function seasonal(name: string, season: SeasonIndex): string {
  const v = `${name}@${season}`;
  return hasSprite(v) ? v : name;
}

/** The house sprite: `h_<tier>_aquae` for aquae insulae/domus, else `h_<tier>_<0|1>` by hash2(x, y). */
export function houseSprite(tier: HouseTierId, aquae: boolean, x: number, y: number): string {
  if (aquae && AQUAE_TIERS.includes(tier)) return `h_${tier}_aquae`;
  return `h_${tier}_${hash2(x, y) < 0.5 ? 0 : 1}`;
}

/** The finished look of any building: house tier, forum stage of the rank, Capitolium stage being raised, or `b_<id>` (seasonal). */
export function buildingSprite(s: GameState, b: Building, season: SeasonIndex): string {
  switch (b.type) {
    case 'area':
      return b.house ? houseSprite(b.house.tier, isAquae(s, b), b.x, b.y) : houseSprite('tentoria', false, b.x, b.y);
    case 'principia':
      return `p_forum_${RANK_DEFS[s.rank].forumStage}`;
    case 'capitolium':
      return `p_capitolium_${b.status === 'done' ? 4 : Math.min(4, Math.max(1, capitoliumStage(b) + 1))}`;
    default:
      return seasonal(`b_${b.type}`, season);
  }
}

/** The 12×12 icon of a resource. */
export function resIcon(r: ResId): string {
  return `i_${r}`;
}

/** The 12×12 want-bubble icon of a house need. */
export function wantIcon(n: NeedId): string {
  return `i_want_${n}`;
}

/** The spirits face: 5 moods split at morale 20/40/60/80 (0 = gloomiest). */
export function faceIcon(morale: number): string {
  const k = morale < 20 ? 0 : morale < 40 ? 1 : morale < 60 ? 2 : morale < 80 ? 3 : 4;
  return `i_face_${k}`;
}

/** A 24×24 portrait: `pt_<advisor>_<mood>`, `pt_mentor`, `pt_mentor_notes` or `pt_silhouette`. */
export function portrait(a: AdvisorId | 'mentor' | 'notes' | 'silhouette', mood: 0 | 1 | 2 = 0): string {
  if (a === 'mentor') return 'pt_mentor';
  if (a === 'notes') return 'pt_mentor_notes';
  if (a === 'silhouette') return 'pt_silhouette';
  return `pt_${a}_${mood}`;
}

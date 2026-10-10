// src/game/reveal.ts — progressive reveal predicates, unlock lookups and the next-unlock teaser (ARCHITECTURE §8.5,
// DESIGN §15.3, §11.9, §10.10, §9.4). Owner: WP-D.
// Things gated by a milestone are revealed when that milestone is done (MILESTONES' unlock lists are the one source of
// truth); the rest follow the reveal columns of DESIGN §15.3 / §11.9. Reveals never depend on the UI.
import { B as B$ } from './balance';
import type { BuildingId, CoverageLayerId, GameState, OverlayId, ResId, SectionId, SwitchId, TabId, ToolId, TradeRes, UnlockRef } from './types';
import { elapsed as elapsed$, toRoman as toRoman$ } from './calendar';
import { derived as derived$ } from './derived';
import { MILESTONES, milestoneDone, milestoneUnlocking, unlockLabel } from './objectives';
import { NEVER } from './state';
import { BUILDING_DEFS as BUILDING_DEFS$ } from './data/buildings';
import { EDICT_DEFS as EDICT_DEFS$, SETTING_DEFS as SETTING_DEFS$ } from './data/decisions';
import { HUB_DEFS as HUB_DEFS$ } from './data/hubs';
import { EDICTS as EDICTS$, HUBS as HUBS$, RESOURCES as RESOURCES$, SETTINGS as SETTINGS$, SWITCHES as SWITCHES$ } from './types';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, elapsed = elapsed$, toRoman = toRoman$, derived = derived$, BUILDING_DEFS = BUILDING_DEFS$,
  EDICT_DEFS = EDICT_DEFS$, SETTING_DEFS = SETTING_DEFS$, HUB_DEFS = HUB_DEFS$, EDICTS = EDICTS$, HUBS = HUBS$,
  RESOURCES = RESOURCES$, SETTINGS = SETTINGS$, SWITCHES = SWITCHES$;

const VICUS = 1;
const MONITUM = 1;
/** Coverage layers the Officia overlay shows (water and fountains belong to Aqua). */
const OFFICIA_LAYERS: readonly CoverageLayerId[] = ['shrine', 'temple', 'market', 'macellum', 'baths', 'culture'];
/** Resource → the building that produces it (a producer reveals the HUD chip, DESIGN §15.2). */
const PRODUCER: Partial<Record<ResId, BuildingId>> = { tiles: 'figlina', concrete: 'caementarium', ore: 'fodina', iron: 'officina', tools: 'fabrica', oil: 'olivetum' };
const ALWAYS: readonly ResId[] = ['denarii', 'grain', 'water', 'timber', 'stone'];

/** True when the milestone gating `ref` is done (or nothing gates it). */
function viaMilestone(s: GameState, ref: UnlockRef): boolean {
  const ms = milestoneUnlocking(ref);
  return ms === null || milestoneDone(s, ms.id);
}

/** Some Ordo toggle is off (the player took the reins somewhere). */
function anyToggleOff(s: GameState): boolean {
  return !s.ordo.on.labour || !s.ordo.on.build || !s.ordo.on.trade;
}

/** The emergency ladder has acted at least once (its traces in the Ordo state or the Annales). */
function emergencySeen(s: GameState): boolean {
  const e = s.ordo.emergency;
  return e.rations !== 'none' || e.waterPause || e.lastImport > NEVER || e.lastRelief > NEVER
    || s.log.some((x) => x.kind === 'emergency');
}

/** Whether a council switch is shown: Lex de annona at M5 or the first emergency; Govern while away at Vicus, any toggle off, or after the first away report. */
export function switchRevealed(s: GameState, id: SwitchId): boolean {
  if (id === 'emergency') return viaMilestone(s, { kind: 'switch', id }) || emergencySeen(s);
  return s.rank >= VICUS || anyToggleOff(s) || s.guidance.tips.includes('away');
}

/** Whether a side-panel tab is revealed (DESIGN §15.3). */
export function tabRevealed(s: GameState, tab: TabId): boolean {
  switch (tab) {
    case 'council': return true;
    case 'advisors': return advisorySeen(s);
    case 'build': return s.buildings.some((b) => b.owner !== 'start' && b.status === 'done') || elapsed(s) >= B.reveal.BUILD_ELAPSED;
    case 'people': return elapsed(s) >= B.reveal.PEOPLE_ELAPSED;
    case 'trade': return s.rank >= VICUS || s.decisions.paths.charter === 'mercatores';
    case 'annals': return milestoneDone(s, 'firstWork');
  }
}

/** Some advisory has ever reached Monitum (memos persist after they clear). */
function advisorySeen(s: GameState): boolean {
  for (const k of Object.keys(s.guidance.advisories) as (keyof typeof s.guidance.advisories)[]) {
    const a = s.guidance.advisories[k];
    if (a && a.sev >= MONITUM) return true;
  }
  return false;
}

/** Whether any open hub would sell us a good. */
function tradeable(s: GameState, res: TradeRes): boolean {
  const canTrade = s.rank >= VICUS || s.decisions.paths.charter === 'mercatores';
  return canTrade && HUBS.some((h) => HUB_DEFS[h].rank <= s.rank && HUB_DEFS[h].quirks[res]?.buy !== 'refused');
}

/** Whether a resource is shown in the HUD strip: the basics always; others once produced, unlocked or in stock. */
export function resourceRevealed(s: GameState, res: ResId): boolean {
  if (ALWAYS.includes(res) || s.res[res] > 0) return true;
  if (res === 'wine') return tradeable(s, 'wine');
  const producer = PRODUCER[res];
  if (!producer) return false;
  if ((derived(s).all[producer] ?? 0) > 0) return true;
  return res === 'oil' && BUILDING_DEFS.olivetum.rank <= s.rank;
}

/** Whether a council section (focus, edicts, settings, switches, manual, story) is revealed. */
export function sectionRevealed(s: GameState, sec: SectionId): boolean {
  switch (sec) {
    case 'focus': return viaMilestone(s, { kind: 'section', id: 'focus' });
    case 'edicts': return EDICTS.some((e) => milestoneDone(s, EDICT_DEFS[e].unlock));
    case 'settings': return SETTINGS.some((k) => milestoneDone(s, SETTING_DEFS[k].unlock));
    case 'switches': return SWITCHES.some((k) => switchRevealed(s, k));
    case 'manual': return viaMilestone(s, { kind: 'section', id: 'manual' }) || anyToggleOff(s);
    case 'story': return Object.keys(s.decisions.paths).length > 0;
  }
}

/** A house has been blocked: its next tier is wanted but a need fails (or it is declining). */
function houseBlocked(s: GameState): boolean {
  return s.buildings.some((b) => b.house !== undefined && (b.house.badDays > 0 || b.house.declining));
}

/** Whether an overlay is available (DESIGN §11.9). */
export function overlayRevealed(s: GameState, o: OverlayId): boolean {
  switch (o) {
    case 'none': case 'aqua': return true;
    case 'domus': return viaMilestone(s, { kind: 'overlay', id: o }) || houseBlocked(s);
    case 'officia': return s.buildings.some((b) => b.status === 'done' && b.type !== 'principia'
      && (BUILDING_DEFS[b.type].service ?? []).some((sv) => OFFICIA_LAYERS.includes(sv.layer)));
    case 'desir': return viaMilestone(s, { kind: 'overlay', id: o });
    case 'terra': return elapsed(s) >= B.reveal.TERRA_ELAPSED;
  }
}

/** Whether a map tool is available: road and demolish always; Build next (M1), Reserve block (M12), paving (M13). */
export function toolRevealed(s: GameState, t: ToolId): boolean {
  return viaMilestone(s, { kind: 'tool', id: t });
}

/** Whether a building card is visible (hidden when ≥ 2 ranks ahead). */
export function buildingVisible(s: GameState, type: BuildingId): boolean {
  return BUILDING_DEFS[type].rank < s.rank + 2;
}

/** Whether an unlock is in effect, through the reveal predicate of its kind (edicts and settings by their milestone). */
export function revealedRef(s: GameState, ref: UnlockRef): boolean {
  switch (ref.kind) {
    case 'edict': return milestoneDone(s, EDICT_DEFS[ref.id].unlock);
    case 'setting': return milestoneDone(s, SETTING_DEFS[ref.id].unlock);
    case 'switch': return switchRevealed(s, ref.id);
    case 'tool': return toolRevealed(s, ref.id);
    case 'overlay': return overlayRevealed(s, ref.id);
    case 'section': return sectionRevealed(s, ref.id);
    case 'cosmetic': return viaMilestone(s, ref);
    case 'victory': return s.victory;
  }
}

/** The day a milestone-gated unlock arrived (for NEW stickers), or null when it is not gated or not yet unlocked. */
export function unlockDay(s: GameState, ref: UnlockRef): number | null {
  const ms = milestoneUnlocking(ref);
  return ms ? s.guidance.milestoneDays[ms.id] ?? null : null;
}

/** One-line teaser of the next unlock: what the next milestone with unlocks opens, and that milestone. */
export function nextTeaser(s: GameState): { label: string; at: string } | null {
  for (let i = s.guidance.objective; i < MILESTONES.length; i++) {
    const ms = MILESTONES[i];
    if (ms.unlocks.length === 0 || milestoneDone(s, ms.id)) continue;
    return { label: ms.unlocks.map(unlockLabel).join(' · '), at: `Res Gestae ${toRoman(i + 1)}: ${ms.text}` };
  }
  return null;
}

/** Every resource the HUD strip currently shows, in RESOURCES order. */
export function revealedResources(s: GameState): ResId[] {
  return RESOURCES.filter((r) => resourceRevealed(s, r));
}

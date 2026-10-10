// src/ui/types.ts — the Game interface (implemented by App in main.ts) and the panel contract (ARCHITECTURE §13.2–13.3).
// Owner: S (scaffold); frozen after the scaffold.
import type { MapView, PlacingState } from '../render/view';   // type-only imports from render are allowed in src/ui
import type { ActionResult, ContractSpec, GameState, Prefs, Rates, Remedy, Speed, TabId } from '../game/types';

export type { Prefs } from '../game/types';
export type { PlacingState } from '../render/view';

/** What the app is doing: the title screen, the running game, or the offline catch-up veil. */
export type Mode = 'title' | 'game' | 'catchup';

/** Every synthesized sound (DESIGN §17). */
export type SfxName = 'click' | 'place' | 'build' | 'birth' | 'death' | 'discover' | 'event' | 'error' | 'victory'
  | 'coin' | 'cornu' | 'lyre' | 'tink' | 'crackle' | 'splash' | 'tintinnabulum' | 'gate';

/** What the inspector shows. */
export type InspectTarget = { kind: 'building'; id: number } | { kind: 'tile'; tile: number } | { kind: 'block'; block: number };

/** The surface every UI module uses to talk to the running game (implemented by App, src/main.ts). */
export interface Game {
  readonly state: GameState;          // in title mode: the save (or a fresh seed) drifting behind the title
  readonly view: MapView;
  readonly prefs: Prefs;
  readonly rates: Rates;              // last tick's ledger (previewRates after a load)
  readonly speed: Speed; readonly paused: boolean; readonly mode: Mode; readonly modalOpen: boolean;
  setSpeed(sp: Speed): void;          // also unpauses; stores prefs.speed
  togglePause(): void;
  setPaused(p: boolean): void;
  changed(): void;                    // something changed outside a tick: panels re-check signatures now
  act(r: ActionResult, opts?: { okSfx?: SfxName; okToast?: string }): ActionResult;   // standard result handling: error toast with r.reason + 'error' sfx, or ok sfx; then changed()
  startPlacing(p: PlacingState): void; cancelPlacing(): void;
  placeAt(tile: number, shift: boolean): void;   // actions.place(owner 'player', replaceId) → act(); keeps placing if shift (desktop) else cancels
  inspect(t: InspectTarget | null, sticky: boolean): void;
  inspecting(): boolean;              // a clicked inspector card (building, block or ground) is pinned
  select(id: number | null): void;    // view.select + inspect building
  focusTile(tile: number): void;      // centre + flash
  openTab(tab: TabId, anchor?: string): void;
  prefillContract(spec: ContractSpec): void;   // opens 'trade' with the new-contract form filled
  applyRemedy(r: Remedy): void;       // §13.6
  newGame(opts?: { afterVictory?: boolean }): void;
  continueGame(): void;
  toTitle(): void;                    // saves first
  save(): boolean;
  exportSave(): string;
  importSave(text: string): boolean;
  setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void;
  sfx(name: SfxName): void;
}

/** A refresh closure for volatile text inside a built panel (run every UI_THROTTLE_MS when the signature is unchanged). */
export type Updater = () => void;

/** One side-panel tab (each tabs/*.ts exports `panel`). */
export interface Panel {
  id: TabId; label: string; sub: string; icon: string; hotkey: string;   // label Latin, sub English, icon = sprite name
  signature(g: Game): string;                     // discrete data only: ids, counts, statuses, unlocks, filters — never stocks or progress
  build(g: Game, body: HTMLElement, up: Updater[]): void;   // full rebuild; push closures that refresh volatile text in place
  badge?(g: Game): { text: string; kind: 'info' | 'warn' | 'bad' | 'gold' } | null;
  scrollTo?(anchor: string, body: HTMLElement): void;
}

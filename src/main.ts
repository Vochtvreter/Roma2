// src/main.ts — App implements Game: the fixed-step loop, speeds, autosave, offline catch-up, title/game modes
// (ARCHITECTURE §11.4–11.5, §13.2, §13.8). Owner: WP-H.
// The loop turns on animation frames while the map shows, and on a COVERED_HZ timer while the UI covers all of it
// (layout.ts mapCovered → view.suspend: nothing is drawn, the browser may skip its frames); its clock (game/loop.ts)
// counts whole wall µs either way, so the colony runs at the chosen speed whatever the rate.
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/silkscreen/400.css';
import './styles/index.css';

// A browser fetches a font face (a weight, a character subset) only when text first needs it, and the line it sits on
// changes height when it arrives: mid-game that nudged the side panel the first time a bold name or a '≈' showed.
// Fetch every bundled face up front, while the title screen is up.
if (typeof document !== 'undefined' && document.fonts) for (const f of document.fonts) f.load().catch(() => {});

import type { ActionResult, ContractSpec, FxEvent, GameState, OfflineRun, Prefs, Rates, Remedy, Speed, TabId } from './game/types';
import { B } from './game/balance';
import { newGame } from './game/state';
import { newCtx, previewRates, tick, emptyRates } from './game/sim';
import { nextColonyLegacy } from './game/decisions';
import { introStep, introduced } from './game/intro';
import {
  KEYS, addFasti, claimSave, exportText, fastiEntry, hasSave, importText, loadGame, loadPrefs, ownsSave, saveGame, savePrefs,
} from './game/save';
import { offlineRun, simulateOffline, wonWhileAway } from './game/offline';
import { drainActionFx } from './game/memo';
import { COVERED_DT_CLAMP, COVERED_HZ, advance, startClock, zeroOwed } from './game/loop';
import type { Clock } from './game/loop';
import { hashStr } from './game/rng';
import { getBuilding } from './game/state';
import { idx, tx, ty } from './game/map';
import { BUILDING_DEFS } from './game/data/buildings';
import { blockOfTile, derived } from './game/derived';
import { resolvePlaceAt } from './game/site';
import * as actions from './game/actions';
import { applyRemedy as applySimRemedy, checkRemedy, clearPrompt } from './game/advisors/remedies';
import { MapView } from './render/view';
import type { PlacingState } from './render/view';
import { registerAllArt } from './render/art/index';
import { footprintRect } from './render/buildings';
import { UI } from './ui/index';
import { initTooltips } from './ui/dom';
import { initKeys } from './ui/keys';
import { initBack } from './ui/history';
import { setTitleNotice } from './ui/title';
import { setAudio, sfx as playSfx } from './ui/audio';
import { toast } from './ui/toasts';
import { closeAllModals, exportDue, modalCount, openConfirm } from './ui/modals';
import { prefill } from './ui/tabs/commercium';
import { afterPlace, keepPlacing, keepable, openPlacing, startAt } from './ui/mapbar';
import { lastTouch, touchInput } from './ui/pointer';
import type { Game, InspectTarget, Mode, SfxName } from './ui/types';
import type { OpenFrom } from './ui/layout';
import { isPhone, slimBanner } from './ui/layout';
import { askPersist, keepCopyWhy, platform, registerWorker } from './ui/platform';

const DEV = /[?&]dev\b/.test(location.search);
const TITLE_SEED = 42;
const SAVE_FAIL = 'Could not save: storage is full or blocked. Use Menu → Export.';
const CLEAR_LIFT = 140;        // CSS px a block to clear rises above the middle of the map, clear of the question
const CLEAR_FLASH_MS = 3000;   // how long it flashes while the question is asked
const BROKEN = 'Something went wrong and the clock stopped. Use Menu → Export to keep a copy of the colony, then reload.';

/** The running application: owns the state, the loop and the mode; the UI talks to it through Game. */
class App implements Game {
  state: GameState;
  readonly view: MapView;
  readonly prefs: Prefs;
  rates: Rates = emptyRates();
  speed: Speed;
  paused = true;
  mode: Mode = 'title';
  /** The UI root (public for ?dev inspection). */
  readonly ui: UI;
  private clock: Clock = startClock(0);
  private timer = 0;   // the covered loop's next turn (schedule), 0 while the loop runs on animation frames
  private saveTimer = 0;
  private hiddenAt = 0;
  private fxBuf: FxEvent[] = [];
  private run: OfflineRun | null = null;
  private saveWarned = false;
  private pathCount = 0;
  /** This page's claim on the save: another tab that enters a game takes it, and this one yields (R02). */
  private readonly sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  /** Set when the loop threw: nothing is saved over the last good save (R55). */
  private broken = false;
  private titleFailed = false;
  private nudged = false;

  constructor() {
    registerAllArt();
    this.prefs = loadPrefs();
    // The 20× dev speed (key 5 in ?dev) is stored in prefs like any other; outside ?dev it falls back to the top speed.
    if (!DEV && this.prefs.speed === B.time.DEV_SPEED) this.prefs.speed = B.time.SPEEDS[B.time.SPEEDS.length - 1];
    this.speed = this.prefs.speed;
    setAudio(this.prefs.sound, this.prefs.volume);
    initTooltips();
    const canvas = document.getElementById('map') as HTMLCanvasElement;
    const minimap = document.getElementById('minimap') as HTMLCanvasElement | null;
    this.state = loadGame() ?? this.titleState();
    this.view = new MapView(canvas, minimap, {
      onHover: (tile, id) => this.onHover(tile, id),
      onClick: (tile, id, e) => this.onClick(tile, id, e.shift),
      onDrag: (kind, tiles, done) => this.onDrag(kind, tiles, done),
      onCancel: () => (this.view.placing ? this.cancelPlacing() : this.select(null)),
      onPlacementPreview: (check) => this.ui.showPlaceBanner(this.view.placing, check),
    });
    this.ui = new UI(this);
    this.ui.build();
    initBack(this);
    initKeys(this, DEV);
    try { this.view.attach(this.state); } catch (e) {   // a save that loads but cannot be drawn: a fresh map behind the title
      console.error('[castra] the saved colony could not be shown', e);
      this.state = this.titleState();
      this.view.attach(this.state);
    }
    window.addEventListener('resize', () => this.view.resize());
    // iOS ignores user-scalable=no: a pinch on the chrome would zoom the page (the map's own pinch is pointer events)
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => { if (this.mode === 'game') this.write(false); });
    // another tab entered a game: it owns the save now (R02); a page restored from the back-forward cache checks too
    window.addEventListener('storage', (e) => { if (e.key === KEYS.owner && this.mode !== 'title' && !ownsSave(this.sid)) this.yieldToOtherTab(); });
    window.addEventListener('pageshow', (e) => { if (e.persisted && this.mode !== 'title' && !ownsSave(this.sid)) this.yieldToOtherTab(); });
    // the map shows again (a detent, the free map): a turn waiting on the covered timer runs at the next frame instead
    this.ui.layout.onChange(() => this.wake());
    // the map's labels are Silkscreen: a paused, idle map drawn before the face arrived draws again with it
    try { document.fonts?.addEventListener?.('loadingdone', () => this.view.invalidate()); } catch { /* no font events */ }
    // an app from the Home Screen asks at once to keep its storage (WebKit grants it there; the Menu shows the answer)
    if (platform().standalone) askPersist();
    // the offline worker (public/sw.js): built pages only, the dev server serves the sources
    if (import.meta.env.PROD) registerWorker(import.meta.url, () => toast('A new version of the game is ready: it runs from the next launch.', 'info', 'i_seal', 8000));
    this.ui.showTitle();
    requestAnimationFrame((t) => { this.clock = startClock(t); this.frame(t); });
  }

  // ───────────────────────────── Game ─────────────────────────────
  get modalOpen(): boolean {
    return modalCount() > 0;
  }

  setSpeed(sp: Speed): void {
    if (!introduced(this.state, 'speed')) sp = 1;   // the faster speeds come with their lesson (§11.13)
    else if (sp > 1) actions.notePractice(this.state, 'speed');
    this.speed = sp;
    this.paused = false;
    this.prefs.speed = sp;
    savePrefs(this.prefs);
    this.changed();
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.changed();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.changed();
  }

  changed(): void {
    this.ui.changed();
    this.view.invalidate();   // a paused map draws what an action changed (view.frame skips its idle frames)
  }

  act(r: ActionResult, opts?: { okSfx?: SfxName; okToast?: string }): ActionResult {
    if (!r.ok) {
      toast(r.reason, 'bad');
      this.sfx('error');
    } else {
      if (opts?.okSfx) this.sfx(opts.okSfx);
      if (opts?.okToast) toast(opts.okToast, 'good');
    }
    this.changed();
    return r;
  }

  startPlacing(p: PlacingState): void {
    if (this.mode !== 'game') return;
    this.sfx('click');
    this.beginPlacing(p);
  }

  /** Placing starts (or goes on to the next plot: placeAt). A finger's ghost, or any on a phone host, starts on the
   *  best plot when none was given (startAt), so Place shows at once. The banner opens first (mapbar.openPlacing): a
   *  pre-positioned ghost reports its verdict from view.startPlacing (onPlacementPreview), and on touch that verdict
   *  carries the Place button, which a banner drawn after it would wipe. */
  private beginPlacing(p: PlacingState): void {
    const at = startAt(p, touchInput(), isPhone(this.ui.layout.host), () => (p.kind === 'building' ? resolvePlaceAt(this.state, p.type) : undefined));
    openPlacing(this.view, (q, check) => this.ui.showPlaceBanner(q, check), at, this.state);
  }

  cancelPlacing(): void {
    this.view.cancelPlacing();
    this.ui.showPlaceBanner(null, null);
  }

  placeAt(tile: number, shift: boolean): void {
    const p = this.view.placing;
    if (!p || p.kind !== 'building') return;
    const r = this.act(actions.place(this.state, p.type, tile, { owner: 'player', replaceId: p.replaceId }), { okSfx: 'place' });
    const touch = lastTouch();   // the press of this Place: a finger's Place button, or a mouse's click
    // ⟳ is the slim banners' (the phones' and the tablet's, mapbar.ts): on the desktop a finger's Place ends the placing,
    // as it always did
    const next = afterPlace({ ok: r.ok, shift, touch, keep: keepPlacing() && keepable(p.type) && slimBanner(this.ui.layout.host), moving: p.replaceId !== undefined });
    if (next === 'end') { this.ui.placed(); this.cancelPlacing(); }   // placed: a phone's panel stays closed (no spring back)
    else if (next === 'more' && touch) {
      // ⟳ on touch: the ghost goes on to the free plot nearest the one just taken (a mouse's ghost follows the mouse)
      const [w, hh] = BUILDING_DEFS[p.type].size;
      const near = resolvePlaceAt(this.state, p.type, undefined, 'player', { near: { x: tx(tile), y: ty(tile), w, h: hh } });
      this.beginPlacing({ kind: 'building', type: p.type, at: near });
    }
  }

  inspect(t: InspectTarget | null, sticky: boolean): void {
    this.ui.inspector.show(t, sticky);
  }

  inspecting(): boolean {
    return this.ui.inspector.pinned;
  }

  select(id: number | null): void {
    if (id !== null) this.showOnMap();
    this.view.select(id);
    this.inspect(id === null ? null : { kind: 'building', id }, true);
  }

  /** Centres a tile, or the building on it (its whole footprint), in the free map, and flashes it. */
  focusTile(tile: number): void {
    this.showOnMap();
    const id = derived(this.state).buildingAt[tile] ?? 0;
    const b = id > 0 ? getBuilding(this.state, id) : undefined;
    if (b) {
      const r = footprintRect(this.state, b);
      this.view.centerOn(r);
      this.view.flash(idx(r.x, r.y), r.w, r.h);
    } else {
      this.view.centerOn(tile);
      this.view.flash(tile, 1, 1);
    }
  }

  /** The map is asked to show something (a selection, a centred tile: an Annales line, a remedy's Look, a ledger row): on a
   *  tablet or the desktop the panel makes room first (layout.route focus: the DOCK's wide pane under 960 px, which leaves
   *  no map, docks), so the centring and the popup land in the map that shows. A phone routes its context card itself
   *  (UI inspector.onPin), and its centring stays as it was. */
  private showOnMap(): void {
    const L = this.ui.layout;
    if (L && !isPhone(L.host)) L.go({ kind: 'focus' });
  }

  openTab(tab: TabId, anchor?: string, from?: OpenFrom, shift?: boolean): void {
    this.ui.side.open(tab, anchor, from, shift);
  }

  prefillContract(spec: ContractSpec): void {
    prefill(spec);
    this.openTab('trade', 'new-contract');
  }

  applyRemedy(r: Remedy): void {
    const s = this.state;
    const check = checkRemedy(s, r);
    if (!check.ok) { toast(check.reason, 'bad'); this.sfx('error'); return; }
    switch (r.kind) {
      case 'place':   // a remedy's tile can be taken since it was rendered (the Ordo built there): the best slot instead
        this.startPlacing({ kind: 'building', type: r.building, at: resolvePlaceAt(s, r.building, r.tile) });
        return;
      case 'open': this.openTab(r.tab, r.anchor, 'remedy'); return;
      case 'overlay': this.view.setOverlay(r.overlay, r.layer); return;
      case 'contract': this.prefillContract(r.spec); return;
      case 'building':
        if (r.op === 'center') {
          const b = getBuilding(s, r.id);
          if (b) this.focusTile(idx(b.x, b.y));
          return;
        }
        this.act(applySimRemedy(s, r));
        return;
      case 'clear': this.clearBlock(r); return;
      default: this.act(applySimRemedy(s, r));
    }
  }

  /** A block to clear for a work (DESIGN §11.5): the block is shown on the map and the player is asked, naming what
   *  comes down; on yes the sim remedy pulls it down (the demolish action) and the work's ghost waits on the cleared
   *  block, as a place remedy's does. */
  private clearBlock(r: Extract<Remedy, { kind: 'clear' }>): void {
    const n = B.map.BLOCK, x = tx(r.tile), y = ty(r.tile);
    this.showOnMap();
    this.view.centerOn({ x, y, w: n, h: n });
    // the question opens in the middle of the screen: the block glides up above it, in sight while the player decides
    const box = this.view.screenRect(x, y, n, n);
    this.view.panBy(0, -((box.bottom - box.top) / 2 + CLEAR_LIFT));
    this.view.flash(r.tile, n, n, CLEAR_FLASH_MS);
    const q = clearPrompt(this.state, r);
    openConfirm({
      kicker: 'AEDILIS', title: q.title, text: q.text, yes: q.yes, no: 'Keep the block',
      onYes: () => {
        if (!this.act(applySimRemedy(this.state, r), { okSfx: 'place' }).ok) return;
        this.startPlacing({ kind: 'building', type: r.building, at: r.tile });
        this.view.flash(r.tile, n, n);
      },
    });
  }

  newGame(opts?: { afterVictory?: boolean }): void {
    void opts;   // legacy follows the previous colony itself (WP-D): +1 after a dedication, unchanged when abandoned
    const prev = hasSave() ? loadGame() : null;
    const { legacy, legacyBonus } = prev ? nextColonyLegacy(prev) : { legacy: 0, legacyBonus: 0 };
    const now = Date.now();
    const s = newGame({ seed: hashStr(String(now)), legacy, legacyBonus, now, intro: true });   // the opening lessons (§11.13)
    this.enter(s);
    this.paused = true;
    this.write(false);
    this.ui.showDispatch('founding');
  }

  continueGame(): void {
    const s = loadGame();
    if (!s) { toast('The saved colony could not be read.', 'bad'); return; }
    this.enter(s);
    this.paused = true;
    if (this.broken) return;   // it loaded but cannot be shown: the toast says to export it
    // the standard was never raised: the founding letter again, and no catch-up of a colony that never started (R09)
    if (s.day === B.time.START_DAY) { this.ui.showDispatch('founding'); return; }
    const awayMs = Math.max(0, Date.now() - s.lastSave);
    const run = offlineRun(s, awayMs);
    if (run) this.startCatchup(run);
    else { this.setSpeed(this.prefs.speed); this.remindExport(); }
  }

  toTitle(): void {
    if (this.mode === 'game') this.write(false);
    closeAllModals();
    this.cancelPlacing();
    this.select(null);
    this.mode = 'title';
    this.paused = true;
    this.view.setInputEnabled(true);
    this.ui.showTitle();
  }

  /** A save the player asked for (Menu → Save, Save & quit): a failure is reported every time. */
  save(): boolean {
    return this.write(true);
  }

  exportSave(): string {
    return exportText(this.state);
  }

  importSave(text: string): boolean {
    const s = importText(text);
    if (!s) { toast('That text is not a Castra Valeria save.', 'bad'); this.sfx('error'); return false; }
    closeAllModals();
    this.enter(s);
    this.paused = true;
    this.write(false);
    toast(`${s.name} restored.`, 'good');
    return true;
  }

  setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
    this.prefs[k] = v;
    savePrefs(this.prefs);
    if (k === 'tips' && v === false && this.mode !== 'title') actions.skipIntro(this.state);   // no mentor, no paced introduction
    setAudio(this.prefs.sound, this.prefs.volume);
    this.changed();
  }

  sfx(name: SfxName): void {
    playSfx(name);
  }

  // ───────────────────────────── modes ─────────────────────────────
  /** Switches to a game state (new, continued or imported): attach the view, preview the ledger, game mode. */
  private enter(s: GameState): void {
    closeAllModals();
    if (!this.prefs.tips) actions.skipIntro(s);   // tips are off: the whole interface from the first day
    this.state = s;
    this.mode = 'game';
    this.broken = false;
    claimSave(this.sid);
    setTitleNotice(null);
    this.clock = zeroOwed(this.clock);
    this.saveTimer = 0;
    this.fxBuf = [];
    drainActionFx();
    this.run = null;
    this.pathCount = Object.keys(s.decisions.paths).length;
    try { this.rates = previewRates(s); } catch { this.rates = emptyRates(); }
    // the chrome first: the view centres and picks its zoom for the map the HUD, the panel and the column leave free
    this.ui.hideTitle();
    try { this.view.attach(s); } catch (e) { this.fail(e); }   // a save that loads but cannot be drawn: stop, offer Export
    this.view.setInputEnabled(true);
    this.ui.showPlaceBanner(null, null);
    this.inspect(null, true);
  }

  private startCatchup(run: OfflineRun): void {
    this.run = run;
    this.mode = 'catchup';
    this.paused = true;
    this.cancelPlacing();
    this.view.setInputEnabled(false);
    this.ui.showVeil(run, () => { run.step(run.days); });
  }

  private finishCatchup(run: OfflineRun): void {
    const report = run.report();
    this.run = null;
    this.ui.hideVeil();
    drainActionFx();
    this.fxBuf = [];
    // The catch-up ticks drop their fx; a dedication while away is replayed so the next frame opens the Victory dispatch
    // over the letter and onVictory writes the Fasti entry (construction raises it only once).
    if (wonWhileAway(this.state, report)) this.fxBuf.push({ kind: 'victory' });
    try { this.rates = previewRates(this.state); } catch { this.rates = emptyRates(); }
    this.mode = 'game';
    this.paused = true;
    this.view.setInputEnabled(true);
    this.write(false);
    if (report.days >= 1) this.ui.showDispatch('away', report);   // the letter carries its own keep-a-copy line
    else { this.setSpeed(this.prefs.speed); this.remindExport(); }
    this.changed();
  }

  private onVisibility(): void {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      if (this.mode === 'game') this.write(false);
      return;
    }
    // the loop's clock starts again from now: the time away is the catch-up's (below), never also the first turn's
    this.clock = advance(this.clock, performance.now(), 0, { run: false, clamp: 0 }).clock;
    const away = this.hiddenAt > 0 ? Date.now() - this.hiddenAt : 0;
    this.hiddenAt = 0;
    if (this.mode === 'title') { this.ui.showTitle(); return; }   // another tab may have saved meanwhile: re-read the save
    if (!ownsSave(this.sid)) { this.yieldToOtherTab(); return; }   // R02: never catch up a stale copy
    // R09: a colony whose standard is not yet raised (the founding letter is open) does not run while hidden
    if (this.mode === 'game' && !this.broken && away > 0 && this.state.day !== B.time.START_DAY) {
      const run = offlineRun(this.state, away);
      if (run) this.startCatchup(run);
    }
  }

  /** Writes the save. Not on the title, after a crash, or once another tab owns the save (this tab then yields).
   *  `loud`: report every failure (the player asked); otherwise the failure toast shows once until a save succeeds. */
  private write(loud: boolean): boolean {
    if (this.mode !== 'game') return false;
    if (this.broken) { if (loud) toast(BROKEN, 'bad', undefined, 8000); return false; }
    if (!ownsSave(this.sid)) { this.yieldToOtherTab(); return false; }
    const ok = saveGame(this.state, Date.now());
    savePrefs(this.prefs);
    if (!ok && (loud || !this.saveWarned)) toast(SAVE_FAIL, 'bad', undefined, 8000);
    this.saveWarned = !ok;
    this.saveTimer = 0;
    if (ok) askPersist();   // ask the browser (once) not to evict the only copy (Safari drops idle sites' storage)
    return ok;
  }

  /** Another tab entered a game and owns the save now: stop at once (nothing more is saved here) and show the title,
   *  whose Continue loads that tab's colony and plays it here instead (R02). */
  private yieldToOtherTab(): void {
    if (this.mode === 'title') return;
    this.mode = 'title';   // first: nothing below may save
    this.run = null;
    this.hiddenAt = 0;
    this.ui.hideVeil();
    closeAllModals();
    this.cancelPlacing();
    this.select(null);
    this.paused = true;
    this.view.setInputEnabled(true);
    setTitleNotice('This colony is now open in another tab. Press Continue to play it here instead.');
    this.ui.showTitle();
  }

  /** Once a session, two real days after the last exported copy (or the founding): remind to keep one (R54). */
  private remindExport(): void {
    if (this.nudged || this.mode !== 'game' || !exportDue(this.state)) return;
    this.nudged = true;
    // Safari's week only in a Safari tab: an app from the Home Screen keeps its own storage (platform.ts)
    toast('Keep a copy of the colony: Menu → Export.', 'info', 'i_seal', 10_000, keepCopyWhy(platform()));
  }

  /** The state drifting behind the title when there is no readable save. */
  private titleState(): GameState {
    return newGame({ seed: TITLE_SEED, now: Date.now() });
  }

  /** The loop threw: stop the clock, keep the last good save, and say how to keep the colony (R55). */
  private fail(e: unknown): void {
    if (this.mode === 'title') {   // the colony behind the title cannot be drawn: a fresh map instead (once)
      if (this.titleFailed) return;
      this.titleFailed = true;
      console.error('[castra] the title map failed', e);
      try { this.state = this.titleState(); this.view.attach(this.state); } catch { /* the title stays usable without its map */ }
      return;
    }
    if (this.mode === 'catchup') { this.mode = 'game'; this.run = null; this.ui.hideVeil(); this.view.setInputEnabled(true); }
    this.paused = true;
    if (this.broken) return;
    console.error('[castra] the loop stopped', e);
    this.broken = true;
    toast(BROKEN, 'bad', undefined, 60_000);
  }

  // ───────────────────────────── map callbacks ─────────────────────────────
  private onHover(tile: number | null, id: number | null): void {
    if (this.mode !== 'game' || this.view.placing) return;
    this.inspect(id !== null ? { kind: 'building', id } : tile !== null ? { kind: 'tile', tile } : null, false);
  }

  private onClick(tile: number, id: number | null, shift: boolean): void {
    if (this.mode !== 'game' || this.modalOpen) return;
    const p = this.view.placing;
    const s = this.state;
    if (p) {
      switch (p.kind) {
        case 'building': this.placeAt(tile, shift); return;
        case 'reserve': {
          const blk = blockOfTile(s, tile);
          if (!blk) { toast('Choose a surveyed block.', 'bad'); this.sfx('error'); return; }
          this.act(actions.toggleReserveBlock(s, blk.id), { okSfx: 'click' });
          return;
        }
        case 'demolish':
          if (id !== null) this.act(actions.demolish(s, id), { okSfx: 'place' });
          return;
        default: return;
      }
    }
    if (id !== null) { this.sfx('click'); this.select(id); return; }
    this.select(null);
    const blk = blockOfTile(s, tile);
    this.inspect(blk ? { kind: 'block', block: blk.id } : { kind: 'tile', tile }, true);
  }

  private onDrag(kind: 'road' | 'pave', tiles: number[], done: boolean): void {
    if (!done || this.mode !== 'game') return;
    const s = this.state;
    this.act(kind === 'road' ? actions.buildRoad(s, tiles) : actions.pave(s, tiles), { okSfx: 'place' });
  }

  // ───────────────────────────── the loop ─────────────────────────────
  /** One turn of the loop at wall time `t` (ms): the clock (game/loop.ts) says how many ticks are due, then step(). */
  private frame(t: number): void {
    this.schedule();   // queued first: a throw below cannot stop the loop
    // hidden (only the covered timer still turns then): no time counts here, the catch-up counts it (onVisibility)
    if (document.hidden) { this.clock = advance(this.clock, t, 0, { run: false, clamp: 0 }).clock; return; }
    const run = this.mode === 'game' && !this.paused && !this.modalOpen && !this.broken;
    const turn = advance(this.clock, t, this.speed, { run, clamp: this.view.suspended ? COVERED_DT_CLAMP : B.time.DT_CLAMP });
    this.clock = turn.clock;
    try {
      this.step(t, turn.dt, turn.ticks);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Queues the next turn: the next animation frame while the map shows; while the UI covers all of it
   *  (view.suspended), a timer at COVERED_HZ (≥ 12 Hz), which leaves the browser free to skip its frames (nothing on the
   *  canvas changes) and still runs the colony at full rate (game/loop.ts: its turns lose no sim time). Not during a
   *  catch-up: its slices run once a turn, and the time away should pass as fast as frames come. */
  private schedule(): void {
    if (this.view.suspended && this.mode !== 'catchup') this.timer = window.setTimeout(() => { this.timer = 0; this.frame(performance.now()); }, 1000 / COVERED_HZ);
    else requestAnimationFrame((n) => this.frame(n));
  }

  /** The map shows again: a turn waiting on the covered timer runs at the next animation frame instead (one loop
   *  only: the timer it replaces is the loop's next turn). */
  private wake(): void {
    if (!this.timer) return;
    window.clearTimeout(this.timer);
    this.timer = 0;
    requestAnimationFrame((n) => this.frame(n));
  }

  /** Asks the layout whether the UI covers all of the map (layout.ts mapCovered: the SHEET or the DRAWER full, the DOCK's
   *  wide pane under 960 px, a phone's modal sheet) and suspends the map's drawing while it does; shown again, the loop
   *  goes back to animation frames at once. */
  private cover(): void {
    const on = this.ui.layout?.covered(this.modalOpen) ?? false;
    if (on === this.view.suspended) return;
    this.view.suspend(on);
    if (!on) this.wake();
  }

  private step(t: number, dt: number, ticks: number): void {
    const s = this.state;
    this.cover();
    if (this.mode === 'catchup' && this.run) {
      const run = this.run;
      const t0 = performance.now();
      let done = false;
      while (!done && performance.now() - t0 < B.time.SLICE_MS) done = run.step(B.time.SLICE_DAYS);
      this.view.frame(dt * 1000, s, this.speed, true);
      this.ui.frame(t);
      if (done) this.finishCatchup(run);
      return;
    }
    // the ticks the clock found due (game/loop.ts: a game, not paused, no modal, not broken)
    for (let i = 0; i < ticks; i++) {
      const ctx = newCtx();
      tick(s, ctx);
      this.rates = ctx.rates;
      for (const e of ctx.fx) this.fxBuf.push(e);
    }
    if (this.mode === 'title') this.view.titleDrift(dt * 1000, s);
    for (const e of drainActionFx()) this.fxBuf.push(e);
    if (this.fxBuf.length) {
      const fx = this.fxBuf;
      this.fxBuf = [];
      this.view.handleFx(fx, s);
      if (this.mode === 'game') {
        this.ui.onFx(fx);
        if (fx.some((e) => e.kind === 'victory')) this.onVictory();
        else if (fx.some((e) => e.kind === 'rank')) this.write(false);
      }
    }
    this.view.setInputEnabled(!this.modalOpen && this.mode !== 'catchup');
    this.view.frame(dt * 1000, s, this.speed, this.paused || this.modalOpen);
    this.ui.frame(t);
    if (this.mode === 'game') {
      if (!document.hidden) s.stats.playMs += dt * 1000;
      const lesson = introStep(s);   // the opening lessons are paced in real play time, whatever the speed
      if (lesson) this.ui.onLesson(lesson);
      const paths = Object.keys(s.decisions.paths).length;   // autosave right after a path choice (§11.4)
      if (paths !== this.pathCount) { this.pathCount = paths; this.write(false); }
      this.saveTimer += dt;
      if (this.saveTimer >= B.time.AUTOSAVE_S) this.write(false);
    }
  }

  private onVictory(): void {
    const s = this.state;
    addFasti(fastiEntry(s));
    this.write(false);
  }

  /** ?dev: simulates an absence of `minutes` on the live colony (simulateOffline) and opens its Litterae Ordinis. */
  awayFixture(minutes: number): void {
    if (this.mode !== 'game') return;
    const report = simulateOffline(this.state, Math.max(0, minutes) * 60_000);
    drainActionFx();
    if (report && wonWhileAway(this.state, report)) this.fxBuf.push({ kind: 'victory' });
    try { this.rates = previewRates(this.state); } catch { this.rates = emptyRates(); }
    this.paused = true;
    if (report) this.ui.showDispatch('away', report);
    this.changed();
  }

  /** ?dev: runs `days` online ticks synchronously (fx discarded). */
  skip(days: number): void {
    const s = this.state;
    for (let i = 0; i < days; i++) {
      const ctx = newCtx();
      tick(s, ctx);
      this.rates = ctx.rates;
    }
    drainActionFx();
    this.changed();
  }
}

declare global {
  interface Window { cv?: App; skip?: (days: number) => void; away?: (minutes: number) => void }
}

const app = new App();
if (DEV) {
  window.cv = app;
  window.skip = (days: number) => app.skip(Math.max(0, Math.floor(days)));
  window.away = (minutes: number) => app.awayFixture(minutes);
}

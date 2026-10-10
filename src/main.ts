// src/main.ts — App implements Game: the fixed-step loop, speeds, autosave, offline catch-up, title/game modes
// (ARCHITECTURE §11.4–11.5, §13.2, §13.8). Owner: WP-H.
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/silkscreen/400.css';
import './styles/index.css';

import type { ActionResult, ContractSpec, FxEvent, GameState, OfflineRun, Prefs, Rates, Remedy, Speed, TabId } from './game/types';
import { B } from './game/balance';
import { newGame } from './game/state';
import { newCtx, previewRates, tick, emptyRates } from './game/sim';
import { addFasti, exportText, hasSave, importText, loadGame, loadPrefs, saveGame, savePrefs } from './game/save';
import { offlineRun } from './game/offline';
import { drainActionFx } from './game/memo';
import { hashStr } from './game/rng';
import { getBuilding } from './game/state';
import { idx } from './game/map';
import { blockOfTile, derived } from './game/derived';
import { bestSlot } from './game/site';
import * as actions from './game/actions';
import { applyRemedy as applySimRemedy, checkRemedy } from './game/advisors/remedies';
import { MapView } from './render/view';
import type { PlacingState } from './render/view';
import { registerAllArt } from './render/art/index';
import { footprintRect } from './render/buildings';
import { UI } from './ui/index';
import { initTooltips } from './ui/dom';
import { initKeys } from './ui/keys';
import { setAudio, sfx as playSfx } from './ui/audio';
import { toast } from './ui/toasts';
import { closeAllModals, modalCount } from './ui/modals';
import { prefill } from './ui/tabs/commercium';
import type { Game, InspectTarget, Mode, SfxName } from './ui/types';

const DEV = /[?&]dev\b/.test(location.search);
const TITLE_SEED = 42;
const SAVE_FAIL = 'Could not save: storage is full or blocked. Use Menu → Export.';

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
  private acc = 0;
  private last = 0;
  private saveTimer = 0;
  private hiddenAt = 0;
  private fxBuf: FxEvent[] = [];
  private run: OfflineRun | null = null;
  private saveWarned = false;
  private pathCount = 0;

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
    this.state = loadGame() ?? newGame({ seed: TITLE_SEED, now: Date.now() });
    this.view = new MapView(canvas, minimap, {
      onHover: (tile, id) => this.onHover(tile, id),
      onClick: (tile, id, e) => this.onClick(tile, id, e.shift),
      onDrag: (kind, tiles, done) => this.onDrag(kind, tiles, done),
      onCancel: () => (this.view.placing ? this.cancelPlacing() : this.select(null)),
      onPlacementPreview: (check) => this.ui.showPlaceBanner(this.view.placing, check),
    });
    this.ui = new UI(this);
    this.ui.build();
    initKeys(this, DEV);
    this.view.attach(this.state);
    window.addEventListener('resize', () => this.view.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => { if (this.mode === 'game') this.save(); });
    this.ui.showTitle();
    requestAnimationFrame((t) => { this.last = t; this.frame(t); });
  }

  // ───────────────────────────── Game ─────────────────────────────
  get modalOpen(): boolean {
    return modalCount() > 0;
  }

  setSpeed(sp: Speed): void {
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
    this.view.startPlacing(p, this.state);
    this.ui.showPlaceBanner(p, null);
  }

  cancelPlacing(): void {
    this.view.cancelPlacing();
    this.ui.showPlaceBanner(null, null);
  }

  placeAt(tile: number, shift: boolean): void {
    const p = this.view.placing;
    if (!p || p.kind !== 'building') return;
    const r = this.act(actions.place(this.state, p.type, tile, { owner: 'player', replaceId: p.replaceId }), { okSfx: 'place' });
    if (r.ok && !shift) this.cancelPlacing();
  }

  inspect(t: InspectTarget | null, sticky: boolean): void {
    this.ui.inspector.show(t, sticky);
  }

  select(id: number | null): void {
    this.view.select(id);
    this.inspect(id === null ? null : { kind: 'building', id }, true);
  }

  focusTile(tile: number): void {
    this.view.centerOn(tile);
    const id = derived(this.state).buildingAt[tile] ?? 0;
    const b = id > 0 ? getBuilding(this.state, id) : undefined;
    if (b) {
      const r = footprintRect(this.state, b);
      this.view.flash(idx(r.x, r.y), r.w, r.h);
    } else this.view.flash(tile, 1, 1);
  }

  openTab(tab: TabId, anchor?: string): void {
    this.ui.side.open(tab, anchor);
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
      case 'place': this.startPlacing({ kind: 'building', type: r.building, at: r.tile ?? bestSlot(s, r.building, { owner: 'player' })?.tile }); return;
      case 'open': this.openTab(r.tab, r.anchor); return;
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
      default: this.act(applySimRemedy(s, r));
    }
  }

  newGame(opts?: { afterVictory?: boolean }): void {
    const prev = hasSave() ? loadGame() : null;
    const won = !!opts?.afterVictory && !!prev?.victory;
    const legacy = (prev?.legacy ?? 0) + (won ? 1 : 0);
    const imperium = won && prev ? Object.values(prev.decisions.paths).includes('imperium') : false;
    const legacyBonus = (prev?.legacyBonus ?? 0) + (imperium ? 0.05 : 0);
    const now = Date.now();
    const s = newGame({ seed: hashStr(String(now)), legacy, legacyBonus, now });
    this.enter(s);
    this.paused = true;
    this.save();
    this.ui.showDispatch('founding');
  }

  continueGame(): void {
    const s = loadGame();
    if (!s) { toast('The saved colony could not be read.', 'bad'); return; }
    this.enter(s);
    this.paused = true;
    const awayMs = Math.max(0, Date.now() - s.lastSave);
    const run = offlineRun(s, awayMs);
    if (run) this.startCatchup(run);
    else this.setSpeed(this.prefs.speed);
  }

  toTitle(): void {
    if (this.mode === 'game') this.save();
    closeAllModals();
    this.cancelPlacing();
    this.select(null);
    this.mode = 'title';
    this.paused = true;
    this.view.setInputEnabled(true);
    this.ui.showTitle();
  }

  save(): boolean {
    if (this.mode !== 'game') return false;
    const ok = saveGame(this.state, Date.now());
    savePrefs(this.prefs);
    if (!ok && !this.saveWarned) { this.saveWarned = true; toast(SAVE_FAIL, 'bad', undefined, 8000); }
    if (ok) this.saveWarned = false;
    this.saveTimer = 0;
    return ok;
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
    this.save();
    toast(`${s.name} restored.`, 'good');
    return true;
  }

  setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
    this.prefs[k] = v;
    savePrefs(this.prefs);
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
    this.state = s;
    this.mode = 'game';
    this.acc = 0;
    this.saveTimer = 0;
    this.fxBuf = [];
    drainActionFx();
    this.run = null;
    this.pathCount = Object.keys(s.decisions.paths).length;
    this.view.attach(s);
    this.view.setInputEnabled(true);
    try { this.rates = previewRates(s); } catch { this.rates = emptyRates(); }
    this.ui.hideTitle();
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
    try { this.rates = previewRates(this.state); } catch { this.rates = emptyRates(); }
    this.mode = 'game';
    this.paused = true;
    this.view.setInputEnabled(true);
    this.save();
    if (report.days >= 1) this.ui.showDispatch('away', report);
    else this.setSpeed(this.prefs.speed);
    this.changed();
  }

  private onVisibility(): void {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      if (this.mode === 'game') this.save();
      return;
    }
    if (this.mode === 'game' && this.hiddenAt > 0) {
      const run = offlineRun(this.state, Date.now() - this.hiddenAt);
      if (run) this.startCatchup(run);
    }
    this.hiddenAt = 0;
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
  private frame(t: number): void {
    const dt = Math.min(B.time.DT_CLAMP, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    const s = this.state;
    if (this.mode === 'catchup' && this.run) {
      const run = this.run;
      const t0 = performance.now();
      let done = false;
      while (!done && performance.now() - t0 < B.time.SLICE_MS) done = run.step(B.time.SLICE_DAYS);
      this.view.frame(dt * 1000, s, this.speed, true);
      this.ui.frame(t);
      if (done) this.finishCatchup(run);
      requestAnimationFrame((n) => this.frame(n));
      return;
    }
    if (this.mode === 'game' && !this.paused && !this.modalOpen) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= 1 && steps < B.time.MAX_STEPS) {
        const ctx = newCtx();
        tick(s, ctx);
        this.rates = ctx.rates;
        for (const e of ctx.fx) this.fxBuf.push(e);
        this.acc -= 1;
        steps++;
      }
      if (steps === B.time.MAX_STEPS) this.acc = 0;
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
        else if (fx.some((e) => e.kind === 'rank')) this.save();
      }
    }
    this.view.setInputEnabled(!this.modalOpen && this.mode !== 'catchup');
    this.view.frame(dt * 1000, s, this.speed, this.paused || this.modalOpen);
    this.ui.frame(t);
    if (this.mode === 'game') {
      if (!document.hidden) s.stats.playMs += dt * 1000;
      const paths = Object.keys(s.decisions.paths).length;   // autosave right after a path choice (§11.4)
      if (paths !== this.pathCount) { this.pathCount = paths; this.save(); }
      this.saveTimer += dt;
      if (this.saveTimer >= B.time.AUTOSAVE_S) this.save();
    }
    requestAnimationFrame((n) => this.frame(n));
  }

  private onVictory(): void {
    const s = this.state;
    addFasti({
      name: s.name, seed: s.seed, legacy: s.legacy, founded: B.time.START_DAY, dedicated: s.stats.victoryDay ?? s.day,
      peakPop: s.stats.peakPop, paths: Object.values(s.decisions.paths).filter((p): p is NonNullable<typeof p> => !!p), playMs: s.stats.playMs,
    });
    this.save();
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
  interface Window { cv?: App; skip?: (days: number) => void }
}

const app = new App();
if (DEV) {
  window.cv = app;
  window.skip = (days: number) => app.skip(Math.max(0, Math.floor(days)));
}

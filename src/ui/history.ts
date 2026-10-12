// src/ui/history.ts — the layer stack that Back and Esc walk (DESIGN §15.8). Android's back button, a browser's Back and
// Safari's edge swipe close what the player opened, top first, and never drop a colony by surprise. Owner: WP-H.
// Layers register with a rank (a modal 100 › placing 50 › the selection 40 › the panel above its host's default detent
// 30, layout.ts: the Esc chain of keys.ts; later layers such as the context card and the tray slot in between). While a
// game is up, one sentinel entry sits
// on the session history. Back pops it (popstate): the open layer of the highest rank closes and the sentinel goes back
// on. With nothing open, the first Back saves and says 'Back again to leave · the colony is saved', and the sentinel
// stays off for LEAVE_MS: a second Back is then the browser's own, which leaves (or closes the tab, or the installed
// app, when nothing lies behind the game). The title screen sets no trap, and a letter that must be answered (the
// founding letter) goes back to the title. A sentinel left on the history by a reload is taken as ours, never stacked
// on. backStep() and rearm() are the pure decisions (tests/history.test.ts).
import type { Game } from './types';
import { closeTopModal, modalCount, topModalClosable } from './modals';
import { toast } from './toasts';

/** One layer Back (and Esc) can close: `open()` says whether it shows now, `close()` shuts it. */
export interface BackLayer { rank: number; open(): boolean; close(): void }

/** The ranks of the layers every host has; a later layer takes a rank between them. */
export const BACK_RANK = { modal: 100, placing: 50, selection: 40, detent: 30 } as const;
/** How long the 'Back again to leave' warning stands: a second Back within it leaves. */
export const LEAVE_MS = 3000;
const KEY = 'castraBack';

/** What one Back does. */
export type BackStep = { kind: 'close'; layer: number } | { kind: 'warn' } | { kind: 'leave' };

/** The pure decision for one Back: close the open layer of the highest rank (the first registered on a tie); with none
 *  open, warn, or leave while a warning shown less than LEAVE_MS ago still stands. */
export function backStep(layers: readonly { rank: number; open: boolean }[], now: number, warnedAt: number): BackStep {
  let top = -1;
  for (let i = 0; i < layers.length; i++) if (layers[i].open && (top < 0 || layers[i].rank > layers[top].rank)) top = i;
  if (top >= 0) return { kind: 'close', layer: top };
  return now - warnedAt < LEAVE_MS ? { kind: 'leave' } : { kind: 'warn' };
}

/** Whether the sentinel goes back on now it is off in a game: not while a 'Back again to leave' warning stands (that
 *  Back must reach the browser), unless the player opened a layer meanwhile (Back closes it first again). */
export function rearm(now: number, warnedAt: number, layerOpen: boolean): boolean {
  return layerOpen || now - warnedAt >= LEAVE_MS;
}

const layers: BackLayer[] = [];

/** Registers a layer Back and Esc can close; returns its unregister. */
export function registerBack(layer: BackLayer): () => void {
  layers.push(layer);
  return () => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); };
}

/** Closes the open layer of the highest rank; false when none is open. */
export function closeTopLayer(): boolean {
  const step = backStep(layers.map((l) => ({ rank: l.rank, open: l.open() })), 0, -Infinity);
  if (step.kind !== 'close') return false;
  layers[step.layer].close();
  return true;
}

let armed = false;           // our sentinel is the current history entry
let warnedAt = -Infinity;    // when 'Back again to leave' was shown
let ignore = 0;              // popstates of our own history.back() (the sentinel taken down on the way to the title)

function ours(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[KEY] === true;
}

function push(): void {
  if (ours(history.state)) { armed = true; return; }   // a sentinel is up already (Forward, a reload): never two
  try { history.pushState({ [KEY]: true }, ''); armed = true; } catch { /* a sandboxed frame: Back behaves as the browser's */ }
}

/** Installs the default layers (the Esc chain) and the popstate handling. Once, from main.ts. */
export function initBack(g: Game): void {
  // a letter that must be answered (the founding letter) is not closed by Back: Back takes it to the title, saved, where
  // Continue opens it again and a further Back leaves
  registerBack({ rank: BACK_RANK.modal, open: () => modalCount() > 0, close: () => { if (!topModalClosable() || !closeTopModal()) g.toTitle(); } });
  registerBack({ rank: BACK_RANK.placing, open: () => g.mode === 'game' && g.view.placing !== null, close: () => g.cancelPlacing() });
  registerBack({ rank: BACK_RANK.selection, open: () => g.mode === 'game' && (g.view.selected !== null || g.inspecting()),
    close: () => { g.select(null); g.inspect(null, true); } });   // also a pinned ground or block card
  if (typeof window === 'undefined') return;
  armed = ours(history.state);   // a reload keeps the entry it was on: a sentinel there is ours (the title takes it down)
  window.addEventListener('popstate', (e) => {
    if (ours(e.state)) { armed = true; return; }   // Forward onto a sentinel left behind
    armed = false;
    if (ignore > 0) { ignore--; return; }
    if (g.mode === 'title') return;                // the title sets no trap
    const step = backStep(layers.map((l) => ({ rank: l.rank, open: l.open() })), performance.now(), warnedAt);
    if (step.kind === 'close') {
      layers[step.layer].close();
      g.sfx('click');
      if ((g.mode as string) !== 'title') push();   // the founding letter's close went to the title: no sentinel there
      return;
    }
    if (step.kind === 'warn') {   // the sentinel stays off while the warning stands (syncBack): the next Back leaves
      warnedAt = performance.now();
      const saved = g.save();
      toast(saved ? 'Back again to leave · the colony is saved' : 'Back again to leave', 'info', 'i_seal', LEAVE_MS);
      return;
    }
    history.back();   // leave: Back landed on an entry of this page behind the game; go on past it
  });
  window.addEventListener('pageshow', (e) => {   // back from the browser's cache after leaving: the guard is up again
    if (!e.persisted) return;
    warnedAt = -Infinity;
    armed = ours(history.state);
  });
}

/** Every frame: in a game (or its catch-up) the sentinel is on, save while a 'Back again to leave' warning stands; on
 *  the title it comes off again. */
export function syncBack(inGame: boolean): void {
  if (typeof history === 'undefined') return;
  if (inGame && !armed) {
    if (rearm(performance.now(), warnedAt, layers.some((l) => l.open()))) push();
  } else if (!inGame && armed) {
    armed = false;
    if (ours(history.state)) { ignore++; history.back(); }
  }
}

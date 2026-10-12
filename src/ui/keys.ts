// src/ui/keys.ts — the global keyboard (DESIGN §15.8, ARCHITECTURE §13.8). Owner: WP-H.
// Space pause · 1–4 speeds (5 = 20× in ?dev) · E V B P T L tabs (with Shift: wide, on a tablet's dock and the desktop) ·
// C M I the views Urbs, Mensa and Tabularium (the panel folded, docked, wide; layout.ts keyAction) · O / Shift+O overlays
// · R road · H forum · WASD/arrows pan smoothly while held · + / − zoom · Esc chain: modal → placing → selection → the
// panel above its host's default detent (on the dock: the spine or the wide pane, back to docked; layout.ts) → menu (the
// layers of history.ts, which Back walks too). Ignored inside inputs and on the title (Esc still closes modals).
import { OVERLAYS } from '../game/types';
import type { OverlayId, Speed } from '../game/types';
import type { Game } from './types';
import { closeTopModal, modalCount, openMenu } from './modals';
import { closeTopLayer } from './history';
import { overlayRevealed, toolRevealed } from '../game/reveal';
import { shows, tabShown } from './intro';
import { notePractice } from '../game/actions';
import { B } from '../game/balance';
import { currentHost, keyAction, moveDetent } from './layout';

const PAN_PX_S = 520;                       // CSS px per second while a pan key is held
const PAN: Record<string, [number, number]> = {
  w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [1, 0], arrowleft: [1, 0], d: [-1, 0], arrowright: [-1, 0],
};
const SPEEDS: readonly Speed[] = B.time.SPEEDS as readonly Speed[];

function typing(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

/** The Esc chain: close the top modal → the open layer of the highest rank (history.ts: placing, then the selection,
 *  also a pinned ground card; Back walks the same layers) → open the menu. A letter that must be answered swallows Esc. */
export function escape(g: Game): void {
  if (modalCount() > 0) { closeTopModal(); return; }
  if (g.mode !== 'game') return;
  if (closeTopLayer()) return;
  g.sfx('click');
  openMenu(g);
}

/** Installs the global key handler and the smooth pan loop. */
export function initKeys(g: Game, dev: boolean): void {
  const held = new Set<string>();
  let raf = 0, lastT = 0;
  const loop = (t: number): void => {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    let dx = 0, dy = 0;
    for (const k of held) { const v = PAN[k]; if (v) { dx += v[0]; dy += v[1]; } }
    if ((dx || dy) && g.mode === 'game' && modalCount() === 0) g.view.panBy(dx * PAN_PX_S * dt, dy * PAN_PX_S * dt);
    raf = held.size ? requestAnimationFrame(loop) : 0;
  };
  window.addEventListener('keyup', (e) => { held.delete(e.key.toLowerCase()); });
  window.addEventListener('blur', () => held.clear());
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.defaultPrevented) return;   // a focused control (side tabs' arrow keys, a slider) already handled it
    if (e.key === 'Escape') { e.preventDefault(); escape(g); return; }
    if (typing(e.target) || g.mode !== 'game' || modalCount() > 0) return;
    const k = e.key.toLowerCase();
    if (PAN[k]) {
      e.preventDefault();
      if (!held.has(k)) {
        held.add(k);
        if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(loop); }
      }
      return;
    }
    if (e.repeat) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();   // no double action on a focused button
      g.togglePause();
      return;
    }
    if (k >= '1' && k <= '4') { g.setSpeed(SPEEDS[Number(k) - 1]); return; }
    if (k === '5' && dev) { g.setSpeed(B.time.DEV_SPEED as Speed); return; }
    // a tab's letter (Shift: wide), or a view's (C, M, I: the panel folded, docked, wide on the dock and the desktop)
    const act = keyAction(k, e.shiftKey, currentHost() ?? 'columns');
    if (act?.kind === 'tab') { if (tabShown(g.state, act.tab)) g.openTab(act.tab, undefined, 'key', act.wide); return; }   // progressive reveal: no hotkey for a hidden tab
    if (act?.kind === 'view') {
      if (document.getElementById('side')?.classList.contains('empty')) return;   // no tab yet: no panel to move
      g.sfx('click');
      moveDetent(act.detent);
      return;
    }
    if (k === 'o') {
      if (!shows(g, 'overlays')) return;   // the overlay bar is not introduced yet
      if (e.shiftKey) { g.view.setOverlay('none'); g.changed(); return; }
      const list: OverlayId[] = OVERLAYS.filter((o) => o === 'none' || overlayRevealed(g.state, o));
      const i = list.indexOf(g.view.overlay);
      const next = list[(i + 1) % list.length];
      g.view.setOverlay(next);
      if (next !== 'none') notePractice(g.state, 'overlay');
      g.changed();
      return;
    }
    if (k === 'r') { if (toolRevealed(g.state, 'road')) g.startPlacing({ kind: 'road' }); return; }
    if (k === 'h') { g.view.centerOnForum(); return; }
    if (e.key === '+' || e.key === '=') { g.view.zoomBy(1); return; }
    if (e.key === '-' || e.key === '_') { g.view.zoomBy(-1); return; }
  });
}

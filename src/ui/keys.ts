// src/ui/keys.ts — the global keyboard (DESIGN §15.8, ARCHITECTURE §13.8). Owner: WP-H.
// Space pause · 1–4 speeds (5 = 20× in ?dev) · E V B P T L tabs · O / Shift+O overlays · R road · H forum ·
// WASD/arrows pan smoothly while held · + / − zoom · Esc chain: modal → placing → selection → menu. Ignored inside
// inputs and on the title (Esc still closes modals).
import { OVERLAYS } from '../game/types';
import type { OverlayId, Speed, TabId } from '../game/types';
import type { Game } from './types';
import { closeTopModal, modalCount, openMenu } from './modals';
import { overlayRevealed } from '../game/reveal';
import { B } from '../game/balance';

const PAN_PX_S = 520;                       // CSS px per second while a pan key is held
const TAB_KEYS: Record<string, TabId> = { e: 'council', v: 'advisors', b: 'build', p: 'people', t: 'trade', l: 'annals' };
const PAN: Record<string, [number, number]> = {
  w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [1, 0], arrowleft: [1, 0], d: [-1, 0], arrowright: [-1, 0],
};
const SPEEDS: readonly Speed[] = B.time.SPEEDS as readonly Speed[];

function typing(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

/** The Esc chain: close the top modal → cancel placing → clear the selection → open the menu. */
export function escape(g: Game): void {
  if (modalCount() > 0) { closeTopModal(); return; }
  if (g.mode !== 'game') return;
  if (g.view.placing) { g.cancelPlacing(); return; }
  if (g.view.selected !== null) { g.select(null); g.inspect(null, true); return; }
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
    const tab = TAB_KEYS[k];
    if (tab) { g.openTab(tab); return; }
    if (k === 'o') {
      if (e.shiftKey) { g.view.setOverlay('none'); g.changed(); return; }
      const list: OverlayId[] = OVERLAYS.filter((o) => o === 'none' || overlayRevealed(g.state, o));
      const i = list.indexOf(g.view.overlay);
      g.view.setOverlay(list[(i + 1) % list.length]);
      g.changed();
      return;
    }
    if (k === 'r') { g.startPlacing({ kind: 'road' }); return; }
    if (k === 'h') { g.view.centerOnForum(); return; }
    if (e.key === '+' || e.key === '=') { g.view.zoomBy(1); return; }
    if (e.key === '-' || e.key === '_') { g.view.zoomBy(-1); return; }
  });
}

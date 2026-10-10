// src/ui/keys.ts — the global keyboard (DESIGN §15.8, ARCHITECTURE §13.8). Owner: WP-H.
// Space pause · 1–4 speeds (5 = 20× in ?dev) · E V B P T L tabs · O / Shift+O overlays · R road · H forum ·
// WASD/arrows pan · + / − zoom · Esc chain: modal → placing → selection → menu. Ignored inside inputs (Esc excepted).
import { OVERLAYS } from '../game/types';
import type { OverlayId, Speed, TabId } from '../game/types';
import type { Game } from './types';
import { closeTopModal, modalCount, openMenu } from './modals';
import { overlayRevealed } from '../game/reveal';
import { B } from '../game/balance';

const PAN_PX = 64;
const TAB_KEYS: Record<string, TabId> = { e: 'council', v: 'advisors', b: 'build', p: 'people', t: 'trade', l: 'annals' };
const SPEEDS: readonly Speed[] = B.time.SPEEDS as readonly Speed[];

function typing(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

/** Installs the global key handler. */
export function initKeys(g: Game, dev: boolean): void {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (modalCount() > 0) { closeTopModal(); return; }
      if (g.mode !== 'game') return;
      if (g.view.placing) { g.cancelPlacing(); return; }
      if (g.view.selected !== null) { g.select(null); g.inspect(null, true); return; }
      openMenu(g);
      return;
    }
    if (typing(e.target) || g.mode !== 'game' || modalCount() > 0) return;
    const k = e.key.toLowerCase();
    if (e.key === ' ') {
      e.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();   // no double action on a focused button
      g.togglePause();
      return;
    }
    if (k >= '1' && k <= '4') { g.setSpeed(SPEEDS[Number(k) - 1]); return; }
    if (k === '5' && dev) { g.setSpeed(B.time.DEV_SPEED); return; }
    const tab = TAB_KEYS[k];
    if (tab) { g.openTab(tab); return; }
    if (k === 'o') {
      if (e.shiftKey) { g.view.setOverlay('none'); return; }
      const list: OverlayId[] = OVERLAYS.filter((o) => o === 'none' || overlayRevealed(g.state, o));
      const i = list.indexOf(g.view.overlay);
      g.view.setOverlay(list[(i + 1) % list.length]);
      return;
    }
    if (k === 'r') { g.startPlacing({ kind: 'road' }); return; }
    if (k === 'h') { g.view.centerOnForum(); return; }
    if (k === 'w' || e.key === 'ArrowUp') { e.preventDefault(); g.view.panBy(0, PAN_PX); return; }
    if (k === 's' || e.key === 'ArrowDown') { e.preventDefault(); g.view.panBy(0, -PAN_PX); return; }
    if (k === 'a' || e.key === 'ArrowLeft') { e.preventDefault(); g.view.panBy(PAN_PX, 0); return; }
    if (k === 'd' || e.key === 'ArrowRight') { e.preventDefault(); g.view.panBy(-PAN_PX, 0); return; }
    if (e.key === '+' || e.key === '=') { g.view.zoomBy(1); return; }
    if (e.key === '-' || e.key === '_') { g.view.zoomBy(-1); return; }
  });
}

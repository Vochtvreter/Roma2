// src/ui/banner.ts — rank and stage banners: non-blocking, 8 s (DESIGN §15.4). Owner: WP-H.
// SCAFFOLD: one banner at a time in #banner; unlock chips and the meander frame are WP-H's.
import { clear, h } from './dom';

const BANNER_MS = 8000;
let timer = 0;

/** Shows the banner ("AUC DCCCVII · CASTRA VALERIA FIT OPPIDVM") with an optional sub-line; replaces any current one. */
export function showBanner(kicker: string, title: string, sub?: string, ms: number = BANNER_MS): void {
  const root = document.getElementById('banner');
  if (!root) return;
  window.clearTimeout(timer);
  clear(root);
  root.appendChild(h('div', { class: 'banner-box', onclick: () => hideBanner() },
    h('div', { class: 'kicker banner-kicker' }, kicker),
    h('div', { class: 'banner-title' }, title),
    sub ? h('div', { class: 'banner-sub' }, sub) : null));
  root.classList.add('show');
  timer = window.setTimeout(hideBanner, ms);
}

/** Hides the banner. */
export function hideBanner(): void {
  const root = document.getElementById('banner');
  if (!root) return;
  root.classList.remove('show');
  clear(root);
}

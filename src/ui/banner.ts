// src/ui/banner.ts — rank and Capitolium-stage banners (DESIGN §15.4): non-blocking, B.ui.RANK_BANNER_S seconds, click to
// dismiss, meander frame, path line and unlock chips. One banner at a time in #banner. Owner: WP-H.
import { clear, h, img } from './dom';
import { B } from '../game/balance';

let timer = 0;

/** What a banner shows. */
export interface BannerSpec { kicker: string; title: string; sub?: string; chips?: string[]; icon?: string; ms?: number }

/** Shows the banner ("AUC DCCCVII · CASTRA VALERIA FIT OPPIDVM"); replaces any current one. */
export function showBanner(b: BannerSpec): void {
  const root = document.getElementById('banner');
  if (!root) return;
  window.clearTimeout(timer);
  clear(root);
  root.appendChild(h('div', { class: 'banner-box meander-frame', role: 'status', onclick: () => hideBanner() },
    h('div', { class: 'banner-inner' },
      b.icon ? img(b.icon, 2, 'banner-ico') : null,
      h('div', { class: 'banner-kicker' }, b.kicker),
      h('div', { class: 'banner-title' }, b.title),
      b.sub ? h('div', { class: 'banner-sub' }, b.sub) : null,
      b.chips?.length ? h('div', { class: 'banner-chips' }, b.chips.map((c) => h('span', { class: 'chip gold' }, c))) : null)));
  root.classList.remove('out');
  root.classList.add('show');
  timer = window.setTimeout(hideBanner, b.ms ?? B.ui.RANK_BANNER_S * 1000);
}

/** Hides the banner (fades out). */
export function hideBanner(): void {
  const root = document.getElementById('banner');
  if (!root || !root.classList.contains('show')) return;
  window.clearTimeout(timer);
  root.classList.add('out');
  timer = window.setTimeout(() => { root.classList.remove('show', 'out'); clear(root); }, 450);
}

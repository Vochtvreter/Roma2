// src/ui/toasts.ts — toasts (ARCHITECTURE §13.4; DESIGN §15.1: completions, evolutions, milestones, rank-ups and errors
// only — Annales lines go to the ticker). Max B.ui.TOASTS_MAX visible, the oldest dropped; repeats batch within 1.5 s.
// A toast does not expire while the mouse rests on the stack, so the one being read or clicked never slides away.
// Owner: WP-H.
import { h, img } from './dom';
import { B } from '../game/balance';

const DEFAULT_MS = 4000;
const BATCH_MS = 1500;
const FADE_MS = 300;
const RETRY_MS = 500;
const ICON: Record<Kind, string> = { info: 'i_seal', good: 'i_star', bad: 'i_unpaid', gold: 'i_laurel' };

type Kind = 'info' | 'good' | 'bad' | 'gold';

function remove(el: HTMLElement): void {
  if (el.classList.contains('toast-out')) return;
  el.classList.add('toast-out');
  window.setTimeout(() => el.remove(), FADE_MS);
}

/** Removes a toast when its time is up, or once the mouse leaves the stack. */
function expire(el: HTMLElement): void {
  if (el.parentElement?.matches(':hover') && matchMedia('(hover: hover)').matches) { window.setTimeout(() => expire(el), RETRY_MS); return; }
  remove(el);
}

function show(text: string, kind: Kind, icon: string | undefined, ms: number, sub?: string): HTMLElement | null {
  const root = document.getElementById('toasts');
  if (!root) return null;
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'bad' ? 'alert' : 'status' },
    img(icon ?? ICON[kind], 2, 'toast-ico'),
    h('div', { class: 'toast-body' }, h('span', { class: 'toast-text' }, text), sub ? h('span', { class: 'toast-sub' }, sub) : null));
  el.addEventListener('click', () => remove(el));
  root.appendChild(el);
  const live = Array.from(root.children).filter((c) => !c.classList.contains('toast-out')) as HTMLElement[];
  for (const old of live.slice(0, Math.max(0, live.length - B.ui.TOASTS_MAX))) remove(old);
  window.setTimeout(() => expire(el), ms);
  return el;
}

/** Shows a toast (max 4 visible, the oldest dropped). `sub` adds a second, smaller line. */
export function toast(text: string, kind: Kind = 'info', icon?: string, ms: number = DEFAULT_MS, sub?: string): void {
  show(text, kind, icon, ms, sub);
}

const batches = new Map<string, { n: number; el: HTMLElement | null; until: number; text: (n: number) => string }>();

/** A toast that coalesces repeats of the same key within 1.5 s into one line ("3 works finished"). */
export function toastBatch(key: string, text: (n: number) => string, kind: 'info' | 'good' | 'gold' = 'good', icon?: string): void {
  const now = performance.now();
  const b = batches.get(key);
  if (b && now < b.until && b.el?.isConnected && !b.el.classList.contains('toast-out')) {
    b.n += 1;
    b.until = now + BATCH_MS;
    const span = b.el.querySelector('.toast-text');
    if (span) span.textContent = b.text(b.n);
    b.el.classList.remove('toast-bump');
    void b.el.offsetWidth;
    b.el.classList.add('toast-bump');
    return;
  }
  const el = show(text(1), kind, icon, DEFAULT_MS);
  batches.set(key, { n: 1, el, until: now + BATCH_MS, text });
}

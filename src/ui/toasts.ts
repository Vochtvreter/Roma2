// src/ui/toasts.ts — toasts (ARCHITECTURE §13.4; DESIGN §15.1: completions, evolutions, milestones, rank-ups, errors only). Owner: WP-H.
import { h, img } from './dom';

const MAX_VISIBLE = 4;
const DEFAULT_MS = 4000;
const BATCH_MS = 1500;
const FADE_MS = 250;

type Kind = 'info' | 'good' | 'bad' | 'gold';

function root(): HTMLElement | null {
  return document.getElementById('toasts');
}

function remove(el: HTMLElement): void {
  el.classList.add('toast-out');
  window.setTimeout(() => el.remove(), FADE_MS);
}

function show(text: string, kind: Kind, icon: string | undefined, ms: number): HTMLElement | null {
  const r = root();
  if (!r) return null;
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, icon ? img(icon, 2, 'toast-ico') : null, h('span', { class: 'toast-text' }, text));
  el.addEventListener('click', () => remove(el));
  r.appendChild(el);
  const live = [...r.children].filter((c) => !c.classList.contains('toast-out')) as HTMLElement[];
  for (const old of live.slice(0, Math.max(0, live.length - MAX_VISIBLE))) remove(old);
  window.setTimeout(() => remove(el), ms);
  return el;
}

/** Shows a toast (max 4 visible, the oldest dropped). */
export function toast(text: string, kind: Kind = 'info', icon?: string, ms: number = DEFAULT_MS): void {
  show(text, kind, icon, ms);
}

const batches = new Map<string, { n: number; el: HTMLElement | null; until: number; text: (n: number) => string }>();

/** A toast that coalesces repeats of the same key within 1.5 s into one line ("3 works finished"). */
export function toastBatch(key: string, text: (n: number) => string, kind: 'info' | 'good' | 'gold' = 'good', icon?: string): void {
  const now = performance.now();
  const b = batches.get(key);
  if (b && now < b.until && b.el?.isConnected) {
    b.n += 1;
    b.until = now + BATCH_MS;
    const span = b.el.querySelector('.toast-text');
    if (span) span.textContent = b.text(b.n);
    return;
  }
  const el = show(text(1), kind, icon, DEFAULT_MS);
  batches.set(key, { n: 1, el, until: now + BATCH_MS, text });
}

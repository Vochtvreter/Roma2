// src/ui/modals.ts — modal stack, menu, export/import, how-to-play, rename (ARCHITECTURE §13.4, DESIGN §15.5). Owner: WP-H.
// The sim pauses while any modal is open (App.modalOpen reads modalCount()). Esc (keys.ts) closes the top closable modal.
// SCAFFOLD: working minimal versions; parchment styling and the meander frame are WP-H's.
import type { Game } from './types';
import { h } from './dom';
import { toast } from './toasts';
import { renameColony } from '../game/actions';

interface Entry { el: HTMLElement; closable: boolean; close: () => void; prevFocus: Element | null }
const stack: Entry[] = [];
const ARM_MS = 3000;
const NAME_MAX = 24;

/** Number of open modals. */
export function modalCount(): number {
  return stack.length;
}

/** Closes the top modal if it is closable; true when one was closed. */
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top || !top.closable) return false;
  top.close();
  return true;
}

/** Closes every modal (new game, back to the title). */
export function closeAllModals(): void {
  while (stack.length) stack[stack.length - 1].close();
}

function focusables(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((e) => !e.hasAttribute('disabled') && !e.hidden);
}

/** Opens a modal over the stack; returns close(). Focus is trapped inside; Esc closes it when closable (default). */
export function openModal(content: Node, opts?: { kicker?: string; title?: string; closable?: boolean; wide?: boolean;
  parchment?: boolean; onClose?: () => void }): () => void {
  const root = document.getElementById('modal-root') ?? document.body;
  const closable = opts?.closable ?? true;
  const cls = ['modal', opts?.wide ? 'wide' : '', opts?.parchment ? 'parchment' : ''].filter(Boolean).join(' ');
  let closed = false;
  const entry: Entry = { el: h('div'), closable, close: () => undefined, prevFocus: document.activeElement };
  const close = (): void => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    entry.el.remove();
    if (entry.prevFocus instanceof HTMLElement) entry.prevFocus.focus();
    opts?.onClose?.();
  };
  entry.close = close;
  const box = h('div', { class: cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts?.title ?? opts?.kicker ?? 'Dialog' },
    closable ? h('button', { class: 'btn ghost small modal-x', 'aria-label': 'Close', onclick: close }, '✕') : null,
    opts?.kicker ? h('div', { class: 'kicker modal-kicker' }, opts.kicker) : null,
    opts?.title ? h('h2', { class: 'modal-title' }, opts.title) : null,
    h('div', { class: 'modal-body' }, content),
  );
  const back = h('div', { class: 'modal-back' }, box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back && closable) close(); });
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = focusables(box);
    if (!f.length) return;
    const first = f[0], lastEl = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  });
  entry.el = back;
  stack.push(entry);
  root.appendChild(back);
  const f = focusables(box);
  (f.find((e) => !e.classList.contains('modal-x')) ?? f[0])?.focus();
  return close;
}

/** Two-click confirm: the first click arms the button with `armedLabel` for 3 s, the second runs fn. */
export function confirm2(btn: HTMLButtonElement, armedLabel: string, fn: () => void): void {
  const label = btn.textContent ?? '';
  let timer = 0;
  btn.addEventListener('click', () => {
    if (btn.dataset.armed === '1') {
      window.clearTimeout(timer);
      btn.dataset.armed = '';
      btn.textContent = label;
      btn.classList.remove('armed');
      fn();
      return;
    }
    btn.dataset.armed = '1';
    btn.textContent = armedLabel;
    btn.classList.add('armed');
    timer = window.setTimeout(() => {
      btn.dataset.armed = '';
      btn.textContent = label;
      btn.classList.remove('armed');
    }, ARM_MS);
  });
}

function toggleRow(label: string, on: boolean, set: (v: boolean) => void): HTMLElement {
  const box = h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) });
  return h('label', { class: 'modal-row' }, box, h('span', null, label));
}

/** The game menu: resume, save, how to play, export/import, sound, prefs, save & quit, abandon. */
export function openMenu(g: Game): void {
  let close: () => void = () => undefined;
  const vol = h('input', {
    type: 'range', min: '0', max: '1', step: '0.05', value: String(g.prefs.volume),
    oninput: (e: Event) => g.setPref('volume', Number((e.target as HTMLInputElement).value)),
  });
  const abandon = h('button', { class: 'btn danger' }, 'Abandon this colony');
  confirm2(abandon, 'Click again to abandon', () => { close(); g.newGame(); });
  const body = h('div', { class: 'modal-menu' },
    h('button', { class: 'btn primary', onclick: () => close() }, 'Resume'),
    h('button', { class: 'btn', onclick: () => { if (g.save()) toast('Saved.', 'good'); } }, 'Save'),
    h('button', { class: 'btn', onclick: () => openHowTo(g) }, 'How to play'),
    h('button', { class: 'btn', onclick: () => openExportImport(g) }, 'Export / Import'),
    toggleRow('Sound', g.prefs.sound, (v) => g.setPref('sound', v)),
    h('label', { class: 'modal-row' }, h('span', null, 'Volume'), vol),
    toggleRow('Mentor tips', g.prefs.tips, (v) => g.setPref('tips', v)),
    toggleRow('Slow for news (2× when a choice arrives)', g.prefs.slowForNews, (v) => g.setPref('slowForNews', v)),
    toggleRow('Pause on Periculum', g.prefs.pauseOnCritical, (v) => g.setPref('pauseOnCritical', v)),
    h('button', { class: 'btn', onclick: () => { close(); g.toTitle(); } }, 'Save & quit to title'),
    abandon,
  );
  close = openModal(body, { kicker: 'MENV', title: g.state.name });
}

/** Export (base64 text, Copy) and import (paste, Load with a two-click confirm). */
export function openExportImport(g: Game): void {
  let close: () => void = () => undefined;
  const area = h('textarea', { class: 'modal-text', rows: '6', spellcheck: 'false', value: g.mode === 'game' ? g.exportSave() : '' });
  const status = h('div', { class: 'muted modal-status' });
  const load = h('button', { class: 'btn primary' }, 'Load');
  confirm2(load, 'Replace the current colony?', () => {
    if (g.importSave(area.value)) close();
    else status.textContent = 'That text is not a Castra Valeria save.';
  });
  const copy = h('button', { class: 'btn', onclick: () => {
    area.select();
    void navigator.clipboard?.writeText(area.value).then(() => { status.textContent = 'Copied.'; }, () => { status.textContent = 'Select the text and copy it.'; });
  } }, 'Copy');
  const body = h('div', null,
    h('p', { class: 'muted' }, 'Copy this text to keep your colony safe, or paste a saved text and press Load.'),
    area, h('div', { class: 'modal-actions' }, copy, load), status);
  close = openModal(body, { kicker: 'TABVLAE', title: 'Export / Import', wide: true });
}

/** How to play: five short sections (DESIGN §15.5). */
export function openHowTo(_g: Game): void {
  const sec = (t: string, p: string): HTMLElement => h('section', { class: 'modal-sec' }, h('h3', null, t), h('p', null, p));
  openModal(h('div', null,
    sec('You decide, the Ordo acts', 'The Ordo Decurionum staffs, builds and trades every day, even while you are away, and always says why. You set its course with the charter, paths, focus and edicts, and you may build anything yourself.'),
    sec('Grain and water in days', 'The two tablets count days on hand, with a twelve-month forecast beneath. Keep both above a month and the colony thrives.'),
    sec('Build where you like', 'Pick a building and click a glowing plot. Gold plots give a bonus. Shift-click places more; Esc or right-click cancels.'),
    sec('Seasons and the two crunches', 'Hiems starves the fields; Aestas dries the wells. Fill the horrea before the Kalends of December and the cisterns before June.'),
    sec('Time away', 'Time away passes at half speed, up to five years. The Ordo governs and writes you a report.'),
  ), { kicker: 'QVOMODO', title: 'How to play', wide: true });
}

/** Rename the colony (≤ 24 characters). */
export function openRename(g: Game): void {
  let close: () => void = () => undefined;
  const input = h('input', { type: 'text', maxlength: String(NAME_MAX), value: g.state.name, class: 'modal-input' });
  const ok = (): void => {
    const r = g.act(renameColony(g.state, input.value.trim().slice(0, NAME_MAX)));
    if (r.ok) close();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  const body = h('div', null, input, h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: ok }, 'Rename')));
  close = openModal(body, { kicker: 'NOMEN', title: 'Name the colony' });
  input.select();
}

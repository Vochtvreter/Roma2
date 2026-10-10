// src/ui/modals.ts — the modal stack, menu, export/import, how-to-play and rename (ARCHITECTURE §13.4, DESIGN §15.5). Owner: WP-H.
// The sim pauses while any modal is open (App.modalOpen reads modalCount()). Esc (keys.ts) closes the top closable modal.
// Focus is trapped in the top modal (Tab cycles; focus that escapes is pulled back) and restored on close.
import type { Game } from './types';
import { h } from './dom';
import type { Kid } from './dom';
import { toast } from './toasts';
import { renameColony } from '../game/actions';
import { B } from '../game/balance';

interface Entry { el: HTMLElement; box: HTMLElement; closable: boolean; close: () => void; prevFocus: Element | null }
const stack: Entry[] = [];
const ARM_MS = 3000;
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => !e.hasAttribute('disabled') && !e.hidden && e.offsetParent !== null);
}

let trapping = false;
/** Focus that leaves the top modal (click on the backdrop of a lower one, programmatic focus) is pulled back. Installed
 *  on the first modal, so importing this module does no DOM work (headless tests import the panels that import it). */
function trapFocus(): void {
  if (trapping) return;
  trapping = true;
  document.addEventListener('focusin', (e) => {
    const top = stack[stack.length - 1];
    if (top && e.target instanceof Node && !top.box.contains(e.target)) (focusables(top.box)[0] ?? top.box).focus();
  });
}

/** Opens a modal over the stack; returns close(). Focus is trapped inside; Esc closes it when closable (default). */
export function openModal(content: Node, opts?: { kicker?: string; title?: string; closable?: boolean; wide?: boolean;
  parchment?: boolean; onClose?: () => void }): () => void {
  trapFocus();
  const root = document.getElementById('modal-root') ?? document.body;
  const closable = opts?.closable ?? true;
  const cls = ['modal', opts?.wide ? 'wide' : '', opts?.parchment ? 'parchment' : 'dark'].filter(Boolean).join(' ');
  let closed = false;
  const box = h('div', { class: cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts?.title ?? opts?.kicker ?? 'Dialog', tabindex: '-1' },
    closable ? h('button', { class: 'modal-x', 'aria-label': 'Close (Esc)' }, '✕') : null,
    opts?.kicker ? h('div', { class: 'modal-kicker' }, opts.kicker) : null,
    opts?.title ? h('h2', { class: 'modal-title' }, opts.title) : null,
    h('div', { class: 'modal-body' }, content));
  const back = h('div', { class: 'modal-back' }, box);
  const entry: Entry = { el: back, box, closable, close: () => undefined, prevFocus: document.activeElement };
  const close = (): void => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    back.classList.add('modal-out');
    window.setTimeout(() => back.remove(), 160);
    // focus goes back where it was: the button that opened this modal (also inside the modal underneath), else that
    // modal's first control
    const next = stack[stack.length - 1];
    const prev = entry.prevFocus instanceof HTMLElement && entry.prevFocus.isConnected ? entry.prevFocus : null;
    if (next) (prev && next.box.contains(prev) ? prev : focusables(next.box).find((x) => !x.classList.contains('modal-x')) ?? focusables(next.box)[0] ?? next.box).focus();
    else prev?.focus();
    opts?.onClose?.();
  };
  entry.close = close;
  box.querySelector('.modal-x')?.addEventListener('click', close);
  back.addEventListener('pointerdown', (e) => { if (e.target === back && closable) close(); });
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = focusables(box);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  stack.push(entry);
  root.appendChild(back);
  const f = focusables(box);
  (box.querySelector<HTMLElement>('[data-autofocus]') ?? f.find((x) => !x.classList.contains('modal-x')) ?? f[0] ?? box).focus({ preventScroll: true });
  box.scrollTop = 0;
  return close;
}

/** Two-click confirm: the first click arms the button with `armedLabel` for 3 s, the second runs fn. */
export function confirm2(btn: HTMLButtonElement, armedLabel: string, fn: () => void): void {
  const label = btn.textContent ?? '';
  let timer = 0;
  const disarm = (): void => { btn.dataset.armed = ''; btn.textContent = label; btn.classList.remove('armed'); };
  btn.addEventListener('click', () => {
    if (btn.dataset.armed === '1') { window.clearTimeout(timer); disarm(); fn(); return; }
    btn.dataset.armed = '1';
    btn.textContent = armedLabel;
    btn.classList.add('armed');
    timer = window.setTimeout(disarm, ARM_MS);
  });
}

/** A labelled on/off switch row. */
function toggleRow(label: string, sub: string, on: boolean, set: (v: boolean) => void): HTMLElement {
  const box = h('input', { type: 'checkbox', class: 'modal-switch', checked: on, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) });
  return h('label', { class: 'modal-row' }, h('span', { class: 'modal-row-text' }, h('span', null, label), h('small', null, sub)), box);
}

/** The game menu: resume, save, how to play, export/import, sound and volume, prefs, save & quit, abandon. */
export function openMenu(g: Game): void {
  let close: () => void = () => undefined;
  const volLabel = h('span', { class: 'num modal-vol-n' }, `${Math.round(g.prefs.volume * 100)}%`);
  const vol = h('input', {
    type: 'range', min: '0', max: '1', step: '0.05', value: String(g.prefs.volume), class: 'modal-range', 'aria-label': 'Volume',
    oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); g.setPref('volume', v); volLabel.textContent = `${Math.round(v * 100)}%`; },
    onchange: () => g.sfx('coin'),
  });
  const abandon = h('button', { class: 'btn danger' }, 'Abandon this colony');
  confirm2(abandon, 'Click again: the colony is lost', () => { close(); g.newGame(); });
  const body = h('div', { class: 'modal-menu' },
    h('div', { class: 'modal-col' },
      h('button', { class: 'btn primary', onclick: () => close() }, 'Resume'),
      h('button', { class: 'btn', onclick: () => { if (g.save()) toast('Saved.', 'good', 'i_seal'); } }, 'Save'),
      h('button', { class: 'btn', onclick: () => openHowTo(g) }, 'How to play'),
      h('button', { class: 'btn', onclick: () => openExportImport(g) }, 'Export / Import'),
      h('button', { class: 'btn', onclick: () => openRename(g) }, 'Rename the colony'),
      h('button', { class: 'btn', onclick: () => { close(); g.toTitle(); } }, 'Save & quit to title'),
      abandon),
    h('div', { class: 'modal-col' },
      toggleRow('Sound', 'Synthesised effects', g.prefs.sound, (v) => { g.setPref('sound', v); if (v) g.sfx('click'); }),
      h('label', { class: 'modal-row' }, h('span', { class: 'modal-row-text' }, h('span', null, 'Volume'), volLabel), vol),
      toggleRow('Mentor tips', 'Decimus Cassius explains new things', g.prefs.tips, (v) => g.setPref('tips', v)),
      toggleRow('Slow for news', '2× when a choice arrives', g.prefs.slowForNews, (v) => g.setPref('slowForNews', v)),
      toggleRow('Pause on Periculum', 'Stop the clock on a critical warning', g.prefs.pauseOnCritical, (v) => g.setPref('pauseOnCritical', v))));
  close = openModal(body, { kicker: 'MENV', title: g.state.name, wide: true });
}

/** Export (base64 text, Copy) and import (paste, Load with a two-click confirm). */
export function openExportImport(g: Game): void {
  let close: () => void = () => undefined;
  const area = h('textarea', { class: 'modal-text', rows: '6', spellcheck: 'false', 'aria-label': 'Save text', value: g.mode === 'game' ? g.exportSave() : '' });
  const status = h('div', { class: 'modal-status', role: 'status' });
  const load = h('button', { class: 'btn primary' }, 'Load');
  confirm2(load, 'Replace the current colony?', () => {
    if (g.importSave(area.value)) close();
    else status.textContent = 'That text is not a Castra Valeria save.';
  });
  const copy = h('button', { class: 'btn', onclick: () => {
    area.select();
    const done = (): void => { status.textContent = 'Copied. Keep it somewhere safe.'; };
    if (navigator.clipboard) void navigator.clipboard.writeText(area.value).then(done, () => { status.textContent = 'Select the text and copy it.'; });
    else status.textContent = 'Select the text and copy it.';
  } }, 'Copy');
  const body = h('div', null,
    h('p', { class: 'modal-p' }, 'Copy this text to keep your colony safe, or paste a saved text and press Load.'),
    area, h('div', { class: 'modal-actions' }, copy, load), status);
  close = openModal(body, { kicker: 'TABVLAE', title: 'Export / Import', wide: true });
  area.select();
}

const kbd = (k: string): HTMLElement => h('kbd', { class: 'kbd' }, k);
const sec = (title: string, ...kids: Kid[]): HTMLElement => h('section', { class: 'modal-sec' }, h('h3', null, title), ...kids);

/** How to play: five short sections and the controls (DESIGN §15.5). */
export function openHowTo(_g: Game): void {
  openModal(h('div', { class: 'modal-howto' },
    sec('You decide, the Ordo acts', h('p', null, 'The Ordo Decurionum staffs, builds and trades every day, even while you are away, and always says why on the ticker. You set its course with the charter, the paths, the focus and the edicts, and you may build anything yourself: your works are raised first.')),
    sec('Grain and water in days', h('p', null, 'The two tablets count days on hand, with the year ahead beneath: green is safe, gold is thin, red is danger. Every warning comes with a remedy.')),
    sec('Build where you like', h('p', null, 'Pick a work in Aedificia and click a glowing plot. Gold means a bonus; the laurel marks the Ordo’s own choice. Shift-click places more; Esc or right-click cancels.')),
    sec('Seasons and the two crunches', h('p', null, 'Aestas dries the wells; Hiems starves the fields. Fill the cisterns in Ver and the horrea before the Kalends of December.')),
    sec('Time away', h('p', null, 'Time away passes at half speed, up to five years. The Ordo governs and writes you a letter. Nothing is ever lost while you sleep.')),
    sec('Controls', h('ul', { class: 'modal-keys' },
      h('li', null, kbd('Space'), ' pause · ', kbd('1'), kbd('2'), kbd('3'), kbd('4'), ' speed'),
      h('li', null, kbd('E'), kbd('V'), kbd('B'), kbd('P'), kbd('T'), kbd('L'), ' panels · ', kbd('O'), ' overlays · ', kbd('R'), ' road'),
      h('li', null, kbd('W'), kbd('A'), kbd('S'), kbd('D'), ' pan · ', kbd('+'), kbd('−'), ' zoom · ', kbd('H'), ' the forum'),
      h('li', null, kbd('Esc'), ' close · cancel · menu · touch: hold for a tooltip'))),
  ), { kicker: 'QVOMODO LVDITVR', title: 'How to play', wide: true });
}

/** Rename the colony (≤ B.ui.NAME_MAX characters). */
export function openRename(g: Game): void {
  let close: () => void = () => undefined;
  const input = h('input', { type: 'text', maxlength: String(B.ui.NAME_MAX), value: g.state.name, class: 'modal-input', 'aria-label': 'Colony name' });
  const ok = (): void => {
    const r = g.act(renameColony(g.state, input.value.trim().slice(0, B.ui.NAME_MAX)), { okSfx: 'click' });
    if (r.ok) close();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  const body = h('div', null, input, h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: ok }, 'Rename')));
  close = openModal(body, { kicker: 'NOMEN COLONIAE', title: 'Name the colony' });
  input.select();
}

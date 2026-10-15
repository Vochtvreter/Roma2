// src/ui/modals.ts — the modal stack, menu, export/import, how-to-play and rename (ARCHITECTURE §13.4, DESIGN §15.5). Owner: WP-H.
// The sim pauses while any modal is open (App.modalOpen reads modalCount()). Esc (keys.ts) closes the top closable modal.
// Focus is trapped in the top modal (Tab cycles; focus that escapes is pulled back) and restored on close; a parchment
// letter holds it on itself (restingFocus), so a key pressed by reflex never closes it unread. On the phone
// hosts (the SHEET and the DRAWER) every modal is a full-screen sheet within the safe areas (sheet.css): its head (✕,
// kicker, title) sticks to the top and its actions to the foot while the body scrolls between them; a letter keeps its
// parchment and pinned foot. The Menu carries the platform's entries (platform.ts menuEntries): in an iPhone's or an
// iPad's browser tab, Copy save for the Home Screen app (that app's storage is apart from the tab's); on an Android-like
// touch device, Full screen; everywhere the browser can say, whether it keeps the colony (persistent storage).
import type { Game } from './types';
import { h } from './dom';
import type { Kid } from './dom';
import { toast } from './toasts';
import { renameColony } from '../game/actions';
import { B } from '../game/balance';
import { lastExported, markExported } from '../game/save';
import type { GameState } from '../game/types';
import { finePointer, pressWord, touchInput } from './pointer';
import { tabShown } from './intro';
import type { InputClass } from './layout';
import { TEXT_SIZES, TEXT_SIZE_LABEL, setTextSize, textSize } from './textsize';
import { copyText, inFullscreen, keepCopyWhy, menuEntries, persistLine, platform, storagePersisted, toggleFullscreen } from './platform';
import type { Hands } from './platform';

/** A phone host is up, the SHEET or the DRAWER (layout.ts writes it on #app; read from there, as layout.ts reaches
 *  modals through history.ts). */
function sheetHost(): boolean {
  const host = typeof document !== 'undefined' ? document.getElementById('app')?.dataset.host : undefined;
  return host === 'sheet' || host === 'drawer';
}

interface Entry { el: HTMLElement; box: HTMLElement; closable: boolean; letter: boolean; close: () => void; prevFocus: Element | null }
const stack: Entry[] = [];
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const EXPORT_DUE_MS = 2 * 24 * 3_600_000;   // real time without an exported copy before the game reminds you to keep one

/** Two real days since the last exported copy (or the founding): the save in this browser is the only copy (R54). */
export function exportDue(s: GameState): boolean {
  return Date.now() - Math.max(lastExported(), s.stats.startedAt) >= EXPORT_DUE_MS;
}

/** Number of open modals. */
export function modalCount(): number {
  return stack.length;
}

/** True when a modal is open and the top one may be closed (Esc, ✕, Back); the founding letter may not. */
export function topModalClosable(): boolean {
  return stack[stack.length - 1]?.closable ?? false;
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

/** Where focus rests in a modal as it opens, or comes back to it (pure; tests/letters.test.ts). A parchment letter (the
 *  Founding, Litterae Ordinis and Victory dispatches) holds it on the dialog itself: Space (the pause key) or Enter
 *  pressed by reflex as it opens presses none of its buttons (nor scrolls it: openModal), so it is never closed unread;
 *  Tab reaches them, the arrows scroll a long letter. Any other modal: its data-autofocus control, else its first
 *  control but ✕. */
export function restingFocus<T>(letter: boolean, box: T, autofocus: T | null, controls: readonly T[], isX: (c: T) => boolean): T {
  if (letter) return box;
  return autofocus ?? controls.find((c) => !isX(c)) ?? controls[0] ?? box;
}

function rest(e: Entry): HTMLElement {
  return restingFocus(e.letter, e.box, e.box.querySelector<HTMLElement>('[data-autofocus]'), focusables(e.box), (c) => c.classList.contains('modal-x'));
}

let trapping = false;
/** Focus that leaves the top modal (click on the backdrop of a lower one, programmatic focus) is pulled back. Installed
 *  on the first modal, so importing this module does no DOM work (headless tests import the panels that import it). */
function trapFocus(): void {
  if (trapping) return;
  trapping = true;
  document.addEventListener('focusin', (e) => {
    const top = stack[stack.length - 1];
    if (top && e.target instanceof Node && !top.box.contains(e.target)) rest(top).focus();
  });
}

/** Opens a modal over the stack; returns close(). Focus is trapped inside (a letter's on itself: restingFocus); Esc
 *  closes it when closable (default). */
export function openModal(content: Node, opts?: { kicker?: string; title?: string; closable?: boolean; wide?: boolean;
  parchment?: boolean; onClose?: () => void }): () => void {
  trapFocus();
  const root = document.getElementById('modal-root') ?? document.body;
  const closable = opts?.closable ?? true;
  const cls = ['modal', opts?.wide ? 'wide' : '', opts?.parchment ? 'parchment' : 'dark'].filter(Boolean).join(' ');
  let closed = false;
  // the head is one box (it sticks on a phone's full-screen sheet); without a style of its own elsewhere it lays out
  // as its parts always did
  const box = h('div', { class: cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts?.title ?? opts?.kicker ?? 'Dialog', tabindex: '-1' },
    h('div', { class: 'modal-head' },
      closable ? h('button', { class: 'modal-x', 'aria-label': 'Close (Esc)' }, '✕') : null,
      opts?.kicker ? h('div', { class: 'modal-kicker' }, opts.kicker) : null,
      opts?.title ? h('h2', { class: 'modal-title' }, opts.title) : null),
    h('div', { class: 'modal-body' }, content));
  const back = h('div', { class: 'modal-back' }, box);
  const entry: Entry = { el: back, box, closable, letter: !!opts?.parchment, close: () => undefined, prevFocus: document.activeElement };
  const close = (): void => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    back.classList.add('modal-out');
    window.setTimeout(() => back.remove(), 160);
    // focus goes back where it was: the button that opened this modal (also inside the modal underneath), else where
    // that modal rests it
    const next = stack[stack.length - 1];
    const prev = entry.prevFocus instanceof HTMLElement && entry.prevFocus.isConnected ? entry.prevFocus : null;
    if (next) (prev && next.box.contains(prev) ? prev : rest(next)).focus();
    else prev?.focus();
    opts?.onClose?.();
  };
  entry.close = close;
  box.querySelector('.modal-x')?.addEventListener('click', close);
  // a press on the backdrop closes it, but not the second half of the double-click (or double tap) that opened it
  const openedAt = performance.now();
  back.addEventListener('pointerdown', (e) => { if (e.target === back && closable && performance.now() - openedAt >= B.ui.CONFIRM_MIN_MS) close(); });
  box.addEventListener('keydown', (e) => {
    // on the letter itself Space does nothing: not even scroll a long one past what waits at its head (the arrows do)
    if (e.key === ' ' && e.target === box && entry.letter) { e.preventDefault(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(box);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  stack.push(entry);
  root.appendChild(back);
  rest(entry).focus({ preventScroll: true });
  box.scrollTop = 0;
  return close;
}

/** A question with two answers in a modal (the cleared-block remedy, main.ts): the safe answer has the focus, so Enter
 *  keeps things as they are, and `yes` closes it and runs onYes. Asked as a permanent choice is (confirmChoice): no
 *  timeout, and a press within B.ui.CONFIRM_MIN_MS of its opening does nothing. */
export function openConfirm(o: { kicker: string; title: string; text: string; yes: string; no: string; onYes: () => void }): void {
  confirmChoice({ kicker: o.kicker, title: o.title, lines: [o.text], ok: o.yes, cancel: o.no, danger: true }, o.onYes);
}

/** What a press on a two-step confirm does (pure; tests/confirm.test.ts): the first arms it; one within
 *  B.ui.CONFIRM_MIN_MS of the arming (the second click of a double-click, a double tap) changes nothing; a later one
 *  runs it. A confirm dialog counts from its opening the same way (confirmChoice). */
export function confirmPress(armedAt: number | null, now: number): 'arm' | 'wait' | 'run' {
  if (armedAt === null) return 'arm';
  return now - armedAt < B.ui.CONFIRM_MIN_MS ? 'wait' : 'run';
}

const armed = new Map<HTMLButtonElement, () => void>();   // the armed two-step confirms, each with its disarm
let escWatch = false;

/** Esc disarms the armed confirms before anything else answers it (keys.ts skips a key already handled). Installed with
 *  the first confirm, so importing this module does no DOM work. */
function watchEsc(): void {
  if (escWatch) return;
  escWatch = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && [...armed.keys()].some((b) => b.isConnected)) { e.preventDefault(); for (const off of [...armed.values()]) off(); }
  });
}

/** True while a two-step confirm inside `root` is armed: the side panel and the inspector hold their rebuilds, so the
 *  armed button keeps its state and its place. */
export function armedWithin(root: Element): boolean {
  return [...armed.keys()].some((b) => b.isConnected && root.contains(b));
}

/** True while any two-step confirm is armed: the counsel card holds still (no tip unfolds above an armed button). */
export function anyArmed(): boolean {
  return [...armed.keys()].some((b) => b.isConnected);
}

/** Two-step confirm (DESIGN §15.5): the first press arms the button with `armedLabel` ('Click again…' says Tap to a
 *  finger), the second runs fn. A mouse keeps it armed while it rests on the button; it disarms when the mouse leaves,
 *  at a press anywhere else, or on Esc. Armed with no mouse over it (a finger, a pen, a key) it drains along its foot for
 *  B.ui.CONFIRM_MS and disarms. A second press within B.ui.CONFIRM_MIN_MS of arming does nothing: a double-click never
 *  confirms. A button whose armed label wraps it away from a still mouse drains rather than disarming. */
export function confirm2(btn: HTMLButtonElement, armedLabel: string, fn: () => void): void {
  watchEsc();
  const label = btn.textContent ?? '';
  let armedAt: number | null = null;
  let timer = 0;
  let over = false;   // a mouse rests on the button
  let at = '';        // where it last moved there
  const outside = (e: PointerEvent): void => { if (!(e.target instanceof Node && btn.contains(e.target))) disarm(); };
  const disarm = (): void => {
    if (armedAt === null) return;
    armedAt = null;
    window.clearTimeout(timer);
    armed.delete(btn);
    document.removeEventListener('pointerdown', outside, true);
    btn.dataset.armed = '';
    btn.textContent = label;
    btn.classList.remove('armed', 'draining');
  };
  const drain = (): void => {
    if (armedAt === null || btn.classList.contains('draining')) return;
    btn.style.setProperty('--drain-ms', `${B.ui.CONFIRM_MS}ms`);
    btn.classList.add('draining');
    timer = window.setTimeout(disarm, B.ui.CONFIRM_MS);
  };
  const track = (e: PointerEvent): void => { if (e.pointerType === 'mouse') { over = true; at = `${e.clientX},${e.clientY}`; } };
  btn.addEventListener('pointerenter', track);
  btn.addEventListener('pointermove', track);
  btn.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    over = false;
    if (`${e.clientX},${e.clientY}` === at) drain(); else disarm();
  });
  btn.addEventListener('click', () => {
    const now = performance.now();
    const step = confirmPress(armedAt, now);
    if (step === 'wait') return;
    if (step === 'run') { disarm(); fn(); return; }
    armedAt = now;
    armed.set(btn, disarm);
    document.addEventListener('pointerdown', outside, true);
    btn.dataset.armed = '1';
    btn.textContent = pressWord(armedLabel);   // 'Click again…' says Tap to a finger
    btn.classList.add('armed');
    if (!over) drain();
  });
}

/** A permanent choice asked by name (confirmChoice): the kicker and the question ('Proclaim Colonia veteranorum?'), the
 *  lines that say what follows, and the two buttons' words. */
export interface ChoiceAsk { kicker: string; title: string; lines: readonly string[]; ok: string; cancel: string; danger?: boolean }

/** A permanent choice (the charter, a path, abandoning the colony, quitting unsaved) asked as a dialog that names it
 *  (DESIGN §15.5), with `cancel` (focused) and `ok`, and no timeout; the sim waits while it stands, as under any modal.
 *  A press on `ok` within B.ui.CONFIRM_MIN_MS of the opening does nothing (the second half of a double-click or a double
 *  tap that opened it, landing where the button now stands). Returns close(). */
export function confirmChoice(q: ChoiceAsk, fn: () => void): () => void {
  const opened = performance.now();
  let close: () => void = () => undefined;
  const ok = h('button', { class: `btn ${q.danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => {
    if (confirmPress(opened, performance.now()) !== 'run') return;
    close();
    fn();
  } }, q.ok);
  const body = h('div', { class: 'modal-confirm' }, q.lines.map((t) => h('p', { class: 'modal-p' }, t)),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', 'data-autofocus': '', onclick: () => close() }, q.cancel), ok));
  close = openModal(body, { kicker: q.kicker, title: q.title });
  return close;
}

/** A labelled on/off switch row. */
function toggleRow(label: string, sub: string, on: boolean, set: (v: boolean) => void): HTMLElement {
  const box = h('input', { type: 'checkbox', class: 'modal-switch', checked: on, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) });
  return h('label', { class: 'modal-row' }, h('span', { class: 'modal-row-text' }, h('span', null, label), h('small', null, sub)), box);
}

/** The Text size row: Normal or Large, pressed in place (textsize.ts: a choice of this browser's, not the save's). */
function textSizeRow(g: Game): HTMLElement {
  const btns = TEXT_SIZES.map((t) => h('button', { class: 'btn small modal-seg-btn', type: 'button', onclick: () => { g.sfx('click'); setTextSize(t); sync(); } }, TEXT_SIZE_LABEL[t]));
  const sync = (): void => btns.forEach((b, i) => { const on = TEXT_SIZES[i] === textSize(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  sync();
  return h('div', { class: 'modal-row modal-row-seg', role: 'group', 'aria-label': 'Text size' },
    h('span', { class: 'modal-row-text' }, h('span', null, 'Text size'), h('small', null, 'Larger type in every panel and card')),
    h('div', { class: 'modal-seg' }, btns));
}

/** The hands the layout found (#app's data-input), else the last pointer's (How to play's words, the Menu's entries). */
function hands(): Hands {
  const v = typeof document !== 'undefined' ? document.getElementById('app')?.dataset.input : undefined;
  return v === 'touch' || v === 'mixed' || v === 'mouse' ? v : touchInput() ? (finePointer() ? 'mixed' : 'touch') : 'mouse';
}

const COPY_LABEL = 'Copy save for the Home Screen app';
const COPIED_MS = 4000;

/** Menu → Copy save for the Home Screen app: the colony's text to the clipboard in one tap (counted as an exported copy),
 *  the button saying so; with no clipboard (or a refusal) the Export / Import sheet shows the text to copy by hand. */
async function copySave(g: Game, btn: HTMLButtonElement): Promise<void> {
  g.sfx('click');
  if (!(await copyText(g.exportSave()))) { openExportImport(g); return; }
  markExported(Date.now());
  btn.textContent = 'Copied: open the Home Screen app';   // (no longer than the label: the entry keeps its lines)
  window.setTimeout(() => { btn.textContent = COPY_LABEL; }, COPIED_MS);
}

/** Menu → Full screen (Android-like touch devices: menuEntries): the whole page, or back; the words follow
 *  document.fullscreenElement, also when the browser leaves it by itself (Back, a swipe). Returns the listener's undo. */
function fullscreenButton(g: Game): { btn: HTMLButtonElement; off: () => void } {
  const btn = h('button', { class: 'btn', onclick: () => { g.sfx('click'); void toggleFullscreen(); } });
  const sync = (): void => { btn.textContent = inFullscreen() ? 'Leave full screen' : 'Full screen'; };
  sync();
  document.addEventListener('fullscreenchange', sync);
  return { btn, off: () => document.removeEventListener('fullscreenchange', sync) };
}

/** The Menu's storage line: whether the browser keeps this colony (navigator.storage.persisted), filled in once it says. */
function storageRow(): HTMLElement {
  const sub = h('small', null, '…');
  void storagePersisted().then((p) => { sub.textContent = persistLine(p); });
  return h('div', { class: 'modal-row' }, h('span', { class: 'modal-row-text' }, h('span', null, 'Storage'), sub));
}

/** The game menu: resume, save, how to play, export/import (and in an iOS tab, copy the save for the Home Screen app;
 *  on an Android-like device, full screen), sound and volume, prefs, text size, storage, save & quit, abandon. */
export function openMenu(g: Game): void {
  let close: () => void = () => undefined;
  const plat = menuEntries(platform(), hands(), typeof navigator !== 'undefined' && typeof navigator.storage?.persisted === 'function');
  const copy = plat.copy ? h('button', { class: 'btn' }, COPY_LABEL) : null;
  copy?.addEventListener('click', () => { void copySave(g, copy); });
  const full = plat.fullscreen ? fullscreenButton(g) : null;
  const volLabel = h('span', { class: 'num modal-vol-n' }, `${Math.round(g.prefs.volume * 100)}%`);
  const vol = h('input', {
    type: 'range', min: '0', max: '1', step: '0.05', value: String(g.prefs.volume), class: 'modal-range', 'aria-label': 'Volume',
    oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); g.setPref('volume', v); volLabel.textContent = `${Math.round(v * 100)}%`; },
    onchange: () => g.sfx('coin'),
  });
  // for good: asked by name, never on a timer (DESIGN §15.5)
  const abandon = h('button', { class: 'btn danger', onclick: () => confirmChoice({ kicker: 'RELINQVERE', title: `Abandon ${g.state.name}?`,
    lines: ['The colony is lost for good: a new one is founded in its place.', 'To keep a copy, choose Export / Import first.'],
    ok: 'Abandon it', cancel: 'Keep governing', danger: true }, () => { close(); g.newGame(); }) }, 'Abandon this colony');
  const body = h('div', { class: 'modal-menu' },
    h('div', { class: 'modal-col' },
      h('button', { class: 'btn primary', onclick: () => close() }, 'Resume'),
      // the phone bar has no Annales slot (nor a short spine): the chronicle opens here too (and by key L, the ACTA
      // lines, the Breviarium)
      sheetHost() && tabShown(g.state, 'annals') ? h('button', { class: 'btn', onclick: () => { close(); g.openTab('annals'); } }, 'Annales · the chronicle') : null,
      h('button', { class: 'btn', onclick: () => { if (g.save()) toast('Saved.', 'good', 'i_seal'); } }, 'Save'),
      h('button', { class: 'btn', onclick: () => openHowTo(g) }, 'How to play'),
      h('button', { class: 'btn', onclick: () => openExportImport(g) }, 'Export / Import'),
      copy,
      full?.btn ?? null,
      h('button', { class: 'btn', onclick: () => openRename(g) }, 'Rename the colony'),
      // a failed save never drops the colony silently: keep a copy first (R24); another tab owning the save is no failure
      h('button', { class: 'btn', onclick: () => { close(); if (g.save()) g.toTitle(); else if (g.mode === 'game') openUnsaved(g); } }, 'Save & quit to title'),
      abandon),
    h('div', { class: 'modal-col' },
      toggleRow('Sound', 'Synthesised effects', g.prefs.sound, (v) => { g.setPref('sound', v); if (v) g.sfx('click'); }),
      h('label', { class: 'modal-row' }, h('span', { class: 'modal-row-text' }, h('span', null, 'Volume'), volLabel), vol),
      toggleRow('Mentor tips', 'Decimus Cassius explains new things', g.prefs.tips, (v) => g.setPref('tips', v)),
      toggleRow('Slow for news', '2× when a choice arrives', g.prefs.slowForNews, (v) => g.setPref('slowForNews', v)),
      toggleRow('Pause on Periculum', 'Stop the clock on a critical warning', g.prefs.pauseOnCritical, (v) => g.setPref('pauseOnCritical', v)),
      textSizeRow(g),
      plat.persist ? storageRow() : null));
  close = openModal(body, { kicker: 'MENV', title: g.state.name, wide: true, onClose: () => full?.off() });
}

/** The export text area with its Copy button and status line; a copy (button or by hand) is recorded for the
 *  keep-a-copy reminder. The status goes with the actions in one .modal-foot (no box of its own, but the foot that sticks
 *  on a phone's full-screen sheet: what Copy or Load says is never under the bar). */
function exportBlock(g: Game): { area: HTMLTextAreaElement; copy: HTMLButtonElement; status: HTMLElement } {
  const area = h('textarea', { class: 'modal-text', rows: '6', spellcheck: 'false', 'aria-label': 'Save text', value: g.mode === 'game' ? g.exportSave() : '' });
  const status = h('div', { class: 'modal-status', role: 'status' });
  area.addEventListener('copy', () => markExported(Date.now()));
  const copy = h('button', { class: 'btn', onclick: () => {
    area.select();
    const done = (): void => { markExported(Date.now()); status.textContent = 'Copied. Keep it somewhere safe.'; };
    if (navigator.clipboard) void navigator.clipboard.writeText(area.value).then(done, () => { status.textContent = 'Select the text and copy it.'; });
    else status.textContent = 'Select the text and copy it.';
  } }, 'Copy');
  return { area, copy, status };
}

/** Export (base64 text, Copy) and import (paste, Load with a two-click confirm). */
export function openExportImport(g: Game): void {
  let close: () => void = () => undefined;
  const { area, copy, status } = exportBlock(g);
  const load = h('button', { class: 'btn primary' }, 'Load');
  confirm2(load, 'Replace the current colony?', () => {
    if (g.importSave(area.value)) close();
    else status.textContent = 'That text is not a Castra Valeria save.';
  });
  const body = h('div', null,
    h('p', { class: 'modal-p' }, 'Copy this text to keep your colony safe, or paste a saved text and press Load.'),
    area, h('div', { class: 'modal-foot' }, h('div', { class: 'modal-actions' }, copy, load), status));
  close = openModal(body, { kicker: 'TABVLAE', title: 'Export / Import', wide: true });
  area.select();
}

/** Save & quit could not save: the colony's text to copy, back to the game, or quit and lose it (asked by name). */
function openUnsaved(g: Game): void {
  let close: () => void = () => undefined;
  const { area, copy, status } = exportBlock(g);
  const quit = h('button', { class: 'btn danger', onclick: () => confirmChoice({ kicker: 'TABVLAE', title: 'Quit without saving?',
    lines: ['What was not saved is lost for good, unless you copied the colony\'s text.'],
    ok: 'Quit and lose it', cancel: 'Keep governing', danger: true }, () => { close(); g.toTitle(); }) }, 'Quit without saving');
  const body = h('div', null,
    h('p', { class: 'modal-p' }, 'The colony could not be saved. Copy the text below and keep it: Import a save on the title brings the colony back.'),
    area, h('div', { class: 'modal-foot' }, h('div', { class: 'modal-actions' }, copy, h('button', { class: 'btn primary', 'data-autofocus': '', onclick: () => close() }, 'Keep governing'), quit), status));
  close = openModal(body, { kicker: 'TABVLAE', title: 'The colony is not saved', wide: true });
}

const kbd = (k: string): HTMLElement => h('kbd', { class: 'kbd' }, k);
const sec = (title: string, ...kids: Kid[]): HTMLElement => h('section', { class: 'modal-sec' }, h('h3', null, title), ...kids);

/** What How to play says about the controls (pure; tests/layout.test.ts), by the window's input class (#app's
 *  data-input: layout.ts classify): a finger alone (touch) gets the gestures and tap-to-preview placing; a mouse the keys
 *  and click placing; a tablet with a trackpad or a touch laptop (mixed) both. `views`: the host carries the view
 *  control (the DOCK, the COLUMNS), so the keys include C, M, I and Shift with a panel's key. */
export function howToControls(input: InputClass, views: boolean): { gestures: boolean; keys: boolean; views: boolean; build: 'touch' | 'mouse' | 'both' } {
  const keys = input !== 'touch';
  return { gestures: input !== 'mouse', keys, views: keys && views, build: input === 'touch' ? 'touch' : input === 'mouse' ? 'mouse' : 'both' };
}

const BUILD_TEXT: Readonly<Record<'touch' | 'mouse' | 'both', string>> = {
  touch: 'Pick a work in Aedificia, tap a glowing plot to preview it, then press Place. Gold means a bonus; the laurel marks the Ordo’s own choice. Cancel (or a two-finger tap) stops placing.',
  mouse: 'Pick a work in Aedificia and click a glowing plot. Gold means a bonus; the laurel marks the Ordo’s own choice. Shift-click places more; Esc or right-click cancels.',
  both: 'Pick a work in Aedificia. With a finger, tap a glowing plot to preview it, then press Place; with a mouse, click it (Shift-click places more). Gold means a bonus; the laurel marks the Ordo’s own choice. Cancel, a two-finger tap, Esc or a right-click stops placing.',
};

/** How to play: five short sections and the controls (DESIGN §15.5). The words follow the window's input class
 *  (howToControls: #app's data-input, written by the layout; the last pointer before it runs): the gestures for a
 *  finger, the keys for a mouse, both for mixed hands; the views' keys wherever the view control stands (layout.ts
 *  VIEW_HOSTS, read off #app: layout.ts imports this module's Back chain). */
export function openHowTo(_g: Game): void {
  const app = typeof document !== 'undefined' ? document.getElementById('app')?.dataset : undefined;
  const input: InputClass = hands();
  const c = howToControls(input, ['dock', 'columns'].includes(app?.host ?? 'columns'));
  const build = BUILD_TEXT[c.build];
  const gestures = c.gestures ? [
    h('li', null, 'Drag to pan · pinch to zoom'),
    h('li', null, 'Tap a building to inspect it · hold a control for its tooltip'),
    h('li', null, 'Two-finger tap to cancel placing')] : [];
  const shortcuts = c.keys ? [
    h('li', null, kbd('Space'), ' pause · ', kbd('1'), kbd('2'), kbd('3'), kbd('4'), ' speed'),
    h('li', null, kbd('E'), kbd('V'), kbd('B'), kbd('P'), kbd('T'), kbd('L'), ' panels · ', kbd('O'), ' overlays (', kbd('Shift'), '+', kbd('O'), ' off) · ', kbd('R'), ' road'),
    // the views of a tablet and a desktop (layout.ts VIEWS): the panel folded, docked or wide; Shift with a panel's key: wide
    ...(c.views ? [h('li', null, kbd('C'), ' Urbs · city · ', kbd('M'), ' Mensa · map & ledger · ', kbd('I'), ' Tabularium · ledgers · ',
      kbd('Shift'), '+', kbd('E'), '…', kbd('L'), ' a panel wide')] : []),
    h('li', null, kbd('W'), kbd('A'), kbd('S'), kbd('D'), ' pan · ', kbd('+'), kbd('−'), ' zoom · ', kbd('H'), ' the forum'),
    h('li', null, kbd('Esc'), c.views ? ' close · cancel · dock the panel · menu' : ' close · cancel · menu')] : [];
  const controls = h('ul', { class: 'modal-keys' }, gestures, shortcuts);
  openModal(h('div', { class: 'modal-howto' },
    sec('By your hand, then the Ordo\'s', h('p', null, 'You run a new camp by hand: who works where, what is raised, what is traded. Each chore you have done yourself becomes a duty you may hand to the Ordo Decurionum (Edicta → Mandata), or keep; it then does it every day, even while you are away, and says why on the ticker. Take a duty back whenever you like. You set its course with the charter, the paths, the focus and the edicts, and your own works are always raised first.')),
    sec('Grain and water in days', h('p', null, 'The two tablets count days on hand, with the year ahead beneath: green is safe, gold is thin, red is danger. Every warning comes with a remedy.')),
    sec('Build where you like', h('p', null, build)),
    sec('Seasons and the two crunches', h('p', null, 'Aestas dries the wells; Hiems starves the fields. Fill the cisterns in Ver and the horrea before the Kalends of December.')),
    sec('Time away', h('p', null, `Time away passes at half speed, up to five years. The Ordo governs and writes you a letter. ${keepCopyWhy(platform())} Keep a copy with Menu → Export.`)),
    sec('Controls', controls),
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

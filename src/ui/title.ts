// src/ui/title.ts — the title screen over the live drifting map, and the Fasti coloniarum (DESIGN §15.6, §9.6). Owner: WP-H.
// main.ts keeps calling view.titleDrift behind it. Continue / Found a new colony (over a save, a dialog names the colony
// it replaces and offers its export first) / Restore the previous colony (for B.ui.PREVIOUS_DAYS real days after a new
// colony or an import replaced it) / How to play / Import a save; an unreadable save explains itself and offers its raw
// text. Opened as an iOS Home Screen app (platform.ts) with no colony yet, it first offers to bring one from Safari, whose
// storage is apart: the save the tab's Menu copied is read from the clipboard, or pasted by hand where the clipboard
// cannot be read.
import { PATH_DECISIONS } from '../game/types';
import type { FastiEntry, GameState, PathOptionId } from '../game/types';
import type { Game } from './types';
import { clear, fmt, h, img, plural } from './dom';
import { confirm2, openHowTo, openModal } from './modals';
import { B } from '../game/balance';
import { deserialize, exportText, hasSave, importText, loadBackup, loadFasti, markExported, rawSave } from '../game/save';
import { aucYear, formatRoman, toRoman } from '../game/calendar';
import { PATH_DEFS } from '../game/data/decisions';
import { RANK_DEFS } from '../game/data/ranks';
import { hasSprite } from '../render/sprites';
import { awayTime } from './dispatch';
import { bringLabel, copyText, pasteText, platform } from './platform';

const DEV = typeof location !== 'undefined' && /[?&]dev\b/.test(location.search);
const FASTI_SHOWN = 8;
const FADE_MS = 650;
const DOUBLE_CLICK_MS = 500;   // the longest double click a system allows: its second press never answers the dialog it opened

function pathName(id: PathOptionId): string {
  for (const d of PATH_DECISIONS) {
    const o = PATH_DEFS[d].options.find((x) => x.id === id);
    if (o) return o.name;
  }
  return id;
}

/** A save-text modal: shows `text` to copy (with Copy), or (with onLoad) takes a pasted save. With `confirmLabel`, Load
 *  asks for a second click first, as every other replacement of a stored colony does (ARCHITECTURE §11.3). `ask`: its
 *  own words above the text area. */
function textModal(kicker: string, title: string, text: string, onLoad?: (t: string) => boolean, confirmLabel?: string, ask?: string): void {
  let close: () => void = () => undefined;
  const area = h('textarea', { class: 'modal-text', rows: '6', spellcheck: 'false', 'aria-label': 'Save text', value: text });
  const status = h('div', { class: 'modal-status', role: 'status' });
  let load: HTMLButtonElement | null = null;
  if (onLoad) {
    const run = (): void => { if (onLoad(area.value)) close(); else status.textContent = 'That text is not a Castra Valeria save.'; };
    load = h('button', { class: 'btn primary' }, 'Load');
    if (confirmLabel) confirm2(load, confirmLabel, run); else load.addEventListener('click', run);
  }
  // a copy to keep: one tap where the clipboard allows (counted as an exported copy), else the text is selected
  const copy = onLoad ? null : h('button', { class: 'btn', onclick: () => {
    void copyText(area.value).then((ok) => {
      if (ok) markExported(Date.now()); else area.select();
      status.textContent = ok ? 'Copied. Keep it somewhere safe.' : 'Select the text and copy it.';
    });
  } }, 'Copy');
  const prompt = ask ?? (!onLoad ? 'Keep this text: a newer version of the game may read it.'
    : confirmLabel ? 'Paste the text of an exported colony. Loading it replaces the colony saved in this browser.' : 'Paste the text of an exported colony.');
  close = openModal(h('div', null, h('p', { class: 'modal-p' }, prompt), area, h('div', { class: 'modal-foot' }, h('div', { class: 'modal-actions' }, copy, load), status)), { kicker, title, wide: true });
  area.focus();
}

/** A stored colony's text read, or null when there is none or it cannot be read (the title then offers its raw text). */
function readColony(raw: string | null): GameState | null {
  if (raw === null) return null;
  try {
    return deserialize(raw);
  } catch (e) {
    console.error('[title] the saved colony could not be read', e);
    return null;
  }
}

/** The line of a colony on a title button: name · rank · date · souls (Continue, Restore the previous colony). */
function summary(s: GameState): string {
  return `${s.name} · ${RANK_DEFS[s.rank].name} · ${formatRoman(s.day, { year: true })} · ${fmt(s.people.length)} souls`;
}

/** A colony as a dialog names it: 'Castra Valeria — Vicus, 56 souls'. */
function colonyName(s: GameState): string {
  return `${s.name} — ${RANK_DEFS[s.rank].name}, ${plural(s.people.length, 'soul', 'souls')}`;
}

/** What Found a new colony asks over a stored colony, naming it: 'Replace Castra Valeria — Vicus, 56 souls?' (null: a
 *  save that cannot be read). */
export function replaceQuestion(s: GameState | null): string {
  return s ? `Replace ${colonyName(s)}?` : 'Replace the save that cannot be read?';
}

/** Asks before the stored colony is replaced (a new colony, a restore): `title` asks it, `text` says what follows;
 *  Export a copy first shows the stored colony's text to keep (the raw save when it cannot be read), `go` confirms.
 *  A dialog of its own, never a button clicked twice: no double click can cost a colony. */
function askReplace(g: Game, kicker: string, title: string, text: string, go: string, run: () => void): void {
  let close: () => void = () => undefined;
  const opened = performance.now();
  const keep = (): void => {
    g.sfx('click');
    const raw = rawSave() ?? '';
    const s = readColony(raw);
    textModal('TABVLAE', 'A copy to keep', s ? exportText(s) : raw, undefined, undefined,
      s ? 'Copy this text and keep it somewhere safe: Import a save brings the colony back.' : undefined);
  };
  close = openModal(h('div', null,
    h('p', { class: 'modal-p' }, text),
    h('div', { class: 'modal-foot' }, h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: keep }, 'Export a copy first'),
      h('button', { class: 'btn', 'data-autofocus': '', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn danger', onclick: () => {
        if (performance.now() - opened < DOUBLE_CLICK_MS) return;
        close(); g.sfx('click'); run();
      } }, go)))), { kicker, title });
}

function fastiRow(f: FastiEntry): HTMLElement {
  const when = f.dedicated !== null ? `AUC ${toRoman(aucYear(f.founded))}–${toRoman(aucYear(f.dedicated))}` : `founded AUC ${toRoman(aucYear(f.founded))}`;
  return h('li', { class: 'title-fasti-row' },
    h('span', { class: 'title-fasti-name' }, f.name, f.legacy ? h('span', { class: 'title-stars' }, ' ' + '★'.repeat(Math.min(5, f.legacy))) : null),
    h('span', { class: 'title-fasti-meta' }, `${when} · ${fmt(f.peakPop)} souls · ${awayTime(f.playMs).replace(/ \d+ s$/, '')}`),
    f.paths.length ? h('span', { class: 'title-fasti-paths' }, f.paths.map(pathName).join(' · ')) : null);
}

let notice: string | null = null;
/** A line above the title's buttons (toasts are hidden on the title), kept until it is cleared: another tab took the colony. */
export function setTitleNotice(text: string | null): void {
  notice = text;
}

/** The title screen in #title-screen. */
export class TitleScreen {
  private hideTimer = 0;
  private bringing = false;   // a clipboard read for Bring your colony is under way

  constructor(private readonly g: Game, private readonly root: HTMLElement) {}

  /** Builds and shows the title (re-reads the save each time). */
  show(): void {
    const g = this.g;
    window.clearTimeout(this.hideTimer);
    clear(this.root);
    this.root.classList.remove('gone');
    const exists = hasSave();
    const saved = exists ? readColony(rawSave()) : null;
    const btns = h('div', { class: 'title-btns' });
    if (notice) btns.appendChild(h('div', { class: 'title-warn', role: 'status' }, notice));
    if (saved) {
      btns.appendChild(h('button', { class: 'btn primary big title-continue', onclick: () => { g.sfx('click'); g.continueGame(); } },
        h('span', null, 'Continue'),
        h('span', { class: 'title-info' }, summary(saved))));
    } else if (exists) {
      btns.appendChild(h('div', { class: 'title-warn' }, 'The saved colony could not be read: it may come from a newer version, or be damaged. Founding a new colony replaces it.'));
      btns.appendChild(h('button', { class: 'btn', onclick: () => textModal('TABVLAE', 'The raw save', rawSave() ?? '') }, 'Export raw save'));
    }
    // opened as an iOS Home Screen app with no colony: the one most likely wanted is Safari's (platform.ts bringLabel)
    const bring = bringLabel(platform(), exists);
    if (bring) {
      btns.appendChild(h('button', { class: 'btn primary big title-continue', onclick: () => { void this.bringIn(); } },
        h('span', null, bring),
        h('span', { class: 'title-info' }, 'There first: Menu → Copy save for the Home Screen app')));
    }
    const legacy = saved?.victory ? saved.legacy + 1 : saved?.legacy ?? 0;
    btns.appendChild(h('button', { class: exists || bring ? 'btn big' : 'btn primary big', onclick: () => { g.sfx('click'); this.found(); } },
      legacy > 0 ? `Found a new colony · Legacy ${legacy}` : 'Found a new colony'));
    // the colony a new one (or an import) replaced, for a while; restored, today's takes its place there
    const back = loadBackup(Date.now());
    const prior = back ? readColony(back.raw) : null;
    if (back && prior) {
      btns.appendChild(h('button', { class: 'btn title-continue title-restore', onclick: () => { g.sfx('click'); this.restore(back.raw, prior); } },
        h('span', null, 'Restore the previous colony'),
        h('span', { class: 'title-info' }, `${summary(prior)} · ${plural(back.days, 'day', 'days')} left`)));
    }
    btns.append(
      h('div', { class: 'title-row' },
        h('button', { class: 'btn', onclick: () => { g.sfx('click'); openHowTo(g); } }, 'How to play'),
        h('button', { class: 'btn', onclick: () => {
          g.sfx('click');
          textModal('TABVLAE', 'Import a save', '', (t) => g.importSave(t), exists ? 'Click again: replace the saved colony' : undefined);
        } }, 'Import a save')));
    const fasti = loadFasti();
    const aquila = hasSprite('f_aquila') ? img('f_aquila', 4, 'title-aquila') : h('img', { class: 'pix title-aquila', src: 'favicon.svg', alt: '', draggable: 'false' });
    this.root.appendChild(h('div', { class: 'title-box' },
      aquila,
      h('div', { class: 'title-kicker' }, 'AB CASTRIS AD COLONIAM'),
      h('h1', { class: 'title-logo' }, 'CASTRA', h('span', { class: 'title-dot' }, '·'), 'VALERIA'),
      h('div', { class: 'title-sub' }, "From a legion's camp to a colonia of Rome"),
      btns,
      fasti.length ? h('div', { class: 'title-fasti' }, h('div', { class: 'title-fasti-k' }, 'FASTI COLONIARVM'),
        h('ol', null, fasti.slice(0, FASTI_SHOWN).map(fastiRow))) : null,
      h('div', { class: 'title-foot' }, 'A Roman city-builder · saves automatically · v1.0', DEV ? ' · DEV' : '')));
    this.root.hidden = false;
  }

  /** Found a new colony: over a stored colony a dialog first names it and offers its export; the new colony replaces it
   *  only once its standard is raised (main.ts), and the title can restore it for B.ui.PREVIOUS_DAYS days after. */
  private found(): void {
    const g = this.g;
    if (!hasSave()) { g.newGame(); return; }
    const cur = readColony(rawSave());   // read now: another tab may have saved since the title was drawn
    askReplace(g, 'COLONIA NOVA', replaceQuestion(cur), cur
      ? `The new colony takes its place when you raise its standard. The title can then restore ${cur.name} for ${plural(B.ui.PREVIOUS_DAYS, 'day', 'days')}; to keep it for good, export a copy first.`
      : 'It may come from a newer version, or be damaged. The new colony takes its place when you raise its standard: to keep it, export it first.',
    'Found the new colony', () => g.newGame({ afterVictory: !!cur?.victory }));
  }

  /** Restore the previous colony: asked first, as every replacement of the stored colony; it comes back as an import,
   *  which keeps the colony it replaces as the previous one in turn (the two change places). */
  private restore(raw: string, prior: GameState): void {
    const g = this.g;
    const run = (): void => { if (!g.importSave(raw)) this.show(); };
    if (!hasSave()) { run(); return; }
    const cur = readColony(rawSave());
    askReplace(g, 'COLONIA PRIOR', `Restore ${colonyName(prior)}?`, cur
      ? `It takes the place of ${colonyName(cur)}, which the title can then restore in turn for ${plural(B.ui.PREVIOUS_DAYS, 'day', 'days')}.`
      : 'It takes the place of the save that cannot be read: to keep that one, export it first.',
    'Restore it', run);
  }

  /** Bring your colony from Safari: the save its Menu copied, read from the clipboard and loaded (an app holds no colony
   *  when this shows: nothing is replaced); where the clipboard cannot be read, or holds no colony, the Import sheet takes
   *  it pasted by hand. The read may wait on the browser's prompt: a colony founded (or loaded) meanwhile is left alone. */
  private async bringIn(): Promise<void> {
    const g = this.g;
    if (this.bringing) return;
    g.sfx('click');
    this.bringing = true;
    const text = await pasteText().finally(() => { this.bringing = false; });
    if (g.mode !== 'title' || hasSave()) return;
    if (text && importText(text) && g.importSave(text)) return;
    textModal('TABVLAE', 'Bring your colony', '', (t) => g.importSave(t), undefined,
      `${text ? 'The clipboard holds no colony. ' : ''}In Safari, open the game and press Menu → Copy save for the Home Screen app; then paste the text here and press Load.`);
  }

  /** Fades the title out and removes it. */
  hide(): void {
    if (this.root.hidden) return;
    this.root.classList.add('gone');
    this.hideTimer = window.setTimeout(() => { this.root.hidden = true; this.root.classList.remove('gone'); clear(this.root); }, FADE_MS);
  }
}

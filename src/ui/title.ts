// src/ui/title.ts — the title screen over the live drifting map, and the Fasti coloniarum (DESIGN §15.6, §9.6). Owner: WP-H.
// main.ts keeps calling view.titleDrift behind it. Continue / Found a new colony (two-click over a save) / How to play /
// Import a save; an unreadable save explains itself and offers its raw text. Opened as an iOS Home Screen app
// (platform.ts) with no colony yet, it first offers to bring one from Safari, whose storage is apart: the save the tab's
// Menu copied is read from the clipboard, or pasted by hand where the clipboard cannot be read.
import { PATH_DECISIONS } from '../game/types';
import type { FastiEntry, PathOptionId } from '../game/types';
import type { Game } from './types';
import { clear, fmt, h, img } from './dom';
import { confirm2, openHowTo, openModal } from './modals';
import { KEYS, hasSave, importText, loadFasti, loadGame } from '../game/save';
import { aucYear, formatRoman, toRoman } from '../game/calendar';
import { PATH_DEFS } from '../game/data/decisions';
import { RANK_DEFS } from '../game/data/ranks';
import { hasSprite } from '../render/sprites';
import { awayTime } from './dispatch';
import { bringLabel, pasteText, platform } from './platform';

const DEV = typeof location !== 'undefined' && /[?&]dev\b/.test(location.search);
const FASTI_SHOWN = 8;
const FADE_MS = 650;

function rawSave(): string {
  try { return localStorage.getItem(KEYS.save) ?? ''; } catch { return ''; }
}

function pathName(id: PathOptionId): string {
  for (const d of PATH_DECISIONS) {
    const o = PATH_DEFS[d].options.find((x) => x.id === id);
    if (o) return o.name;
  }
  return id;
}

/** A save-text modal: shows `text` to copy, or (with onLoad) takes a pasted save. With `confirmLabel`, Load asks for a
 *  second click first, as every other replacement of a stored colony does (ARCHITECTURE §11.3). `ask`: its own words
 *  above the text area. */
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
  const prompt = ask ?? (!onLoad ? 'Keep this text: a newer version of the game may read it.'
    : confirmLabel ? 'Paste the text of an exported colony. Loading it replaces the colony saved in this browser.' : 'Paste the text of an exported colony.');
  close = openModal(h('div', null, h('p', { class: 'modal-p' }, prompt), area, h('div', { class: 'modal-foot' }, h('div', { class: 'modal-actions' }, load), status)), { kicker, title, wide: true });
  area.focus();
}

/** The Continue line of a stored save, or null when it cannot be read or summed up (the title then offers its raw text). */
function readSave(): { summary: string; victory: boolean; legacy: number } | null {
  try {
    const s = loadGame();
    if (!s) return null;
    return { summary: `${s.name} · ${RANK_DEFS[s.rank].name} · ${formatRoman(s.day, { year: true })} · ${fmt(s.people.length)} souls`, victory: s.victory, legacy: s.legacy };
  } catch (e) {
    console.error('[title] the saved colony could not be read', e);
    return null;
  }
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
    const saved = exists ? readSave() : null;
    const btns = h('div', { class: 'title-btns' });
    if (notice) btns.appendChild(h('div', { class: 'title-warn', role: 'status' }, notice));
    if (saved) {
      btns.appendChild(h('button', { class: 'btn primary big title-continue', onclick: () => { g.sfx('click'); g.continueGame(); } },
        h('span', null, 'Continue'),
        h('span', { class: 'title-info' }, saved.summary)));
    } else if (exists) {
      btns.appendChild(h('div', { class: 'title-warn' }, 'The saved colony could not be read: it may come from a newer version, or be damaged. Founding a new colony replaces it.'));
      btns.appendChild(h('button', { class: 'btn', onclick: () => textModal('TABVLAE', 'The raw save', rawSave()) }, 'Export raw save'));
    }
    // opened as an iOS Home Screen app with no colony: the one most likely wanted is Safari's (platform.ts bringLabel)
    const bring = bringLabel(platform(), exists);
    if (bring) {
      btns.appendChild(h('button', { class: 'btn primary big title-continue', onclick: () => { void this.bringIn(); } },
        h('span', null, bring),
        h('span', { class: 'title-info' }, 'There first: Menu → Copy save for the Home Screen app')));
    }
    const legacy = saved?.victory ? saved.legacy + 1 : saved?.legacy ?? 0;
    const found = h('button', { class: exists || bring ? 'btn big' : 'btn primary big' }, legacy > 0 ? `Found a new colony · Legacy ${legacy}` : 'Found a new colony');
    if (exists) confirm2(found, 'Click again: replace the saved colony', () => { g.sfx('click'); g.newGame({ afterVictory: !!saved?.victory }); });
    else found.addEventListener('click', () => { g.sfx('click'); g.newGame(); });
    btns.append(found,
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

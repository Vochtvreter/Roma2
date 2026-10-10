// src/ui/title.ts — the title screen over the live drifting map, and the Fasti coloniarum (DESIGN §15.6, §9.6). Owner: WP-H.
// main.ts keeps calling view.titleDrift behind it. Continue / Found a new colony (two-click over a save) / How to play /
// Import a save; an unreadable save explains itself and offers its raw text.
import { PATH_DECISIONS } from '../game/types';
import type { FastiEntry, PathOptionId } from '../game/types';
import type { Game } from './types';
import { clear, fmt, h, img } from './dom';
import { confirm2, openHowTo, openModal } from './modals';
import { KEYS, hasSave, loadFasti, loadGame } from '../game/save';
import { aucYear, formatRoman, toRoman } from '../game/calendar';
import { PATH_DEFS } from '../game/data/decisions';
import { RANK_DEFS } from '../game/data/ranks';
import { hasSprite } from '../render/sprites';
import { awayTime } from './dispatch';

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

function textModal(kicker: string, title: string, text: string, onLoad?: (t: string) => boolean): void {
  let close: () => void = () => undefined;
  const area = h('textarea', { class: 'modal-text', rows: '6', spellcheck: 'false', 'aria-label': 'Save text', value: text });
  const status = h('div', { class: 'modal-status', role: 'status' });
  const load = onLoad ? h('button', { class: 'btn primary', onclick: () => {
    if (onLoad(area.value)) close(); else status.textContent = 'That text is not a Castra Valeria save.';
  } }, 'Load') : null;
  close = openModal(h('div', null,
    h('p', { class: 'modal-p' }, onLoad ? 'Paste the text of an exported colony.' : 'Keep this text: a newer version of the game may read it.'),
    area, h('div', { class: 'modal-actions' }, load), status), { kicker, title, wide: true });
  area.focus();
}

function fastiRow(f: FastiEntry): HTMLElement {
  const when = f.dedicated !== null ? `AUC ${toRoman(aucYear(f.founded))}–${toRoman(aucYear(f.dedicated))}` : `founded AUC ${toRoman(aucYear(f.founded))}`;
  return h('li', { class: 'title-fasti-row' },
    h('span', { class: 'title-fasti-name' }, f.name, f.legacy ? h('span', { class: 'title-stars' }, ' ' + '★'.repeat(Math.min(5, f.legacy))) : null),
    h('span', { class: 'title-fasti-meta' }, `${when} · ${fmt(f.peakPop)} souls · ${awayTime(f.playMs).replace(/ \d+ s$/, '')}`),
    f.paths.length ? h('span', { class: 'title-fasti-paths' }, f.paths.map(pathName).join(' · ')) : null);
}

/** The title screen in #title-screen. */
export class TitleScreen {
  private hideTimer = 0;

  constructor(private readonly g: Game, private readonly root: HTMLElement) {}

  /** Builds and shows the title (re-reads the save each time). */
  show(): void {
    const g = this.g;
    window.clearTimeout(this.hideTimer);
    clear(this.root);
    this.root.classList.remove('gone');
    const exists = hasSave();
    const saved = exists ? loadGame() : null;
    const btns = h('div', { class: 'title-btns' });
    if (saved) {
      btns.appendChild(h('button', { class: 'btn primary big title-continue', onclick: () => { g.sfx('click'); g.continueGame(); } },
        h('span', null, 'Continue'),
        h('span', { class: 'title-info' }, `${saved.name} · ${RANK_DEFS[saved.rank].name} · ${formatRoman(saved.day, { year: true })} · ${fmt(saved.people.length)} souls`)));
    } else if (exists) {
      btns.appendChild(h('div', { class: 'title-warn' }, 'The saved colony could not be read: it may come from a newer version, or be damaged. Founding a new colony replaces it.'));
      btns.appendChild(h('button', { class: 'btn', onclick: () => textModal('TABVLAE', 'The raw save', rawSave()) }, 'Export raw save'));
    }
    const legacy = saved?.victory ? saved.legacy + 1 : saved?.legacy ?? 0;
    const found = h('button', { class: exists ? 'btn big' : 'btn primary big' }, legacy > 0 ? `Found a new colony · Legacy ${legacy}` : 'Found a new colony');
    if (exists) confirm2(found, 'Click again: replace the saved colony', () => { g.sfx('click'); g.newGame({ afterVictory: !!saved?.victory }); });
    else found.addEventListener('click', () => { g.sfx('click'); g.newGame(); });
    btns.append(found,
      h('div', { class: 'title-row' },
        h('button', { class: 'btn', onclick: () => { g.sfx('click'); openHowTo(g); } }, 'How to play'),
        h('button', { class: 'btn', onclick: () => { g.sfx('click'); textModal('TABVLAE', 'Import a save', '', (t) => g.importSave(t)); } }, 'Import a save')));
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
      h('div', { class: 'title-foot' }, 'An idle Roman city · saves automatically · v1.0', DEV ? ' · DEV' : '')));
    this.root.hidden = false;
  }

  /** Fades the title out and removes it. */
  hide(): void {
    if (this.root.hidden) return;
    this.root.classList.add('gone');
    this.hideTimer = window.setTimeout(() => { this.root.hidden = true; this.root.classList.remove('gone'); clear(this.root); }, FADE_MS);
  }
}

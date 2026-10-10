// src/ui/title.ts — the title screen and the Fasti coloniarum (DESIGN §15.6). Owner: WP-H.
// The live map of the save (or a fresh seed) drifts behind it (main.ts calls view.titleDrift).
// SCAFFOLD: working buttons; the logo extrusion, bobbing aquila and styling are WP-H's.
import type { Game } from './types';
import { clear, h, plural } from './dom';
import { confirm2, openHowTo, openModal } from './modals';
import { KEYS, hasSave, loadFasti, loadGame } from '../game/save';
import { formatRoman } from '../game/calendar';
import { RANK_DEFS } from '../game/data/ranks';

const DEV = typeof location !== 'undefined' && /[?&]dev\b/.test(location.search);

function rawSave(): string {
  try { return localStorage.getItem(KEYS.save) ?? ''; } catch { return ''; }
}

function textModal(kicker: string, title: string, text: string, onLoad?: (t: string) => boolean): void {
  let close: () => void = () => undefined;
  const area = h('textarea', { class: 'modal-text', rows: '6', spellcheck: 'false', value: text });
  const status = h('div', { class: 'muted modal-status' });
  const actions = h('div', { class: 'modal-actions' });
  if (onLoad) {
    actions.appendChild(h('button', { class: 'btn primary', onclick: () => {
      if (onLoad(area.value)) close(); else status.textContent = 'That text is not a Castra Valeria save.';
    } }, 'Load'));
  }
  close = openModal(h('div', null, area, actions, status), { kicker, title, wide: true });
}

/** The title screen in #title-screen. */
export class TitleScreen {
  constructor(private readonly g: Game, private readonly root: HTMLElement) {}

  /** Builds and shows the title (re-reads the save each time). */
  show(): void {
    const g = this.g;
    clear(this.root);
    const exists = hasSave();
    const saved = exists ? loadGame() : null;
    const btns = h('div', { class: 'title-btns' });
    if (saved) {
      const info = `${saved.name} · ${RANK_DEFS[saved.rank].name} · ${formatRoman(saved.day, { year: true })} · ${plural(saved.people.length, 'soul', 'souls')}`;
      btns.appendChild(h('button', { class: 'btn primary big', onclick: () => { g.sfx('click'); g.continueGame(); } }, 'Continue'));
      btns.appendChild(h('div', { class: 'title-info' }, info));
    } else if (exists) {
      btns.appendChild(h('div', { class: 'title-info bad' }, 'The saved colony could not be read (it may come from a newer version, or be damaged).'));
      btns.appendChild(h('button', { class: 'btn', onclick: () => textModal('TABVLAE', 'Raw save', rawSave()) }, 'Export raw save'));
    }
    const legacy = saved ? saved.legacy : 0;
    const found = h('button', { class: exists ? 'btn big' : 'btn primary big' }, legacy > 0 ? `Found a new colony (Legacy ${legacy})` : 'Found a new colony');
    if (exists) confirm2(found, 'Replace the saved colony?', () => { g.sfx('click'); g.newGame(); });
    else found.addEventListener('click', () => { g.sfx('click'); g.newGame(); });
    btns.appendChild(found);
    btns.appendChild(h('button', { class: 'btn', onclick: () => openHowTo(g) }, 'How to play'));
    btns.appendChild(h('button', { class: 'btn', onclick: () => textModal('TABVLAE', 'Import a save', '', (t) => g.importSave(t)) }, 'Import a save'));
    const fasti = loadFasti();
    this.root.appendChild(h('div', { class: 'title-box' },
      h('div', { class: 'kicker title-kicker' }, 'AB CASTRIS AD COLONIAM'),
      h('h1', { class: 'title-logo' }, 'CASTRA·VALERIA'),
      h('div', { class: 'title-sub' }, "From a legion's camp to a colonia of Rome"),
      btns,
      fasti.length ? h('div', { class: 'title-fasti' }, h('div', { class: 'kicker' }, 'FASTI COLONIARVM'),
        h('ol', null, fasti.slice(0, 10).map((f) => h('li', null, `${f.name} · ${plural(f.peakPop, 'soul', 'souls')}${f.dedicated !== null ? ` · dedicated ${formatRoman(f.dedicated, { year: true })}` : ''}`)))) : null,
      h('div', { class: 'title-foot' }, 'An idle Roman city · saves automatically · v1.0', DEV ? ' · DEV' : ''),
    ));
    this.root.hidden = false;
  }

  /** Hides the title. */
  hide(): void {
    this.root.hidden = true;
    clear(this.root);
  }
}

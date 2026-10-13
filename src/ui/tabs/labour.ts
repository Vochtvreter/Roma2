// src/ui/tabs/labour.ts — labour by category: have / target / posts with the Ordo's reason; manual targets (± a tap,
// Shift or a long press ±5, held: ±5 again every 300 ms), "Ordo would", Apply once, and "first for 30 days" priorities
// (DESIGN §10.2, §10.4, §15.3). Shared by Populus, Aedificia (builders), the phone's context card (a work's own
// category) and its first lesson's card (Annona). Owner: WP-I.
import { LABOR_CATS } from '../../game/types';
import type { GameState, LaborCat } from '../../game/types';
import type { Game, Updater } from '../types';
import { h, tip } from '../dom';
import * as A from '../../game/actions';
import { census } from '../../game/census';
import { derived } from '../../game/derived';
import { councilReport } from '../../game/ordo/index';
import { reasonText } from '../../game/ordo/reasons';
import { B } from '../../game/balance';
import { btn } from './common';
import { focusOfLabour } from '../focusrow';

/** Latin and English label of each labour category. */
export const CAT_LABEL: Record<LaborCat, [string, string]> = {
  water: ['Aquarii', 'Water'], food: ['Annona', 'Food'], materials: ['Materia', 'Materials'],
  industry: ['Officinae', 'Industry'], services: ['Officia', 'Services'], builders: ['Fabri', 'Builders'],
};
const SHIFT_STEP = 5;
/** A held ±: the long press (the tooltip's 450 ms, dom.ts) steps ±5, and every REPEAT_MS more while it is held. */
export const HOLD = { LONG_MS: 450, REPEAT_MS: 300, STEP: SHIFT_STEP } as const;
const HOLD_POLL_MS = 50;

/** How many ±5 steps a press held `ms` has made (pure; tests/sheet.test.ts): none before the long press, one at it, then
 *  one every REPEAT_MS while held. A press let go sooner is a tap: its click steps ±1 (Shift ±5). +12 hands is a long press
 *  and two taps, not twelve. */
export function holdSteps(ms: number): number {
  return ms < HOLD.LONG_MS ? 0 : 1 + Math.floor((ms - HOLD.LONG_MS) / HOLD.REPEAT_MS);
}

/** Writes a line only when its words change: the lines refresh on every UI tick, and an unchanged write is still a DOM
 *  mutation (the phones' voice line observes its slot for them, and would measure the layout again five times a
 *  second while lesson I's card carries this block). */
function put(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** A ± button: a tap (or Enter) steps by one, Shift by five; a finger's or a pen's press held past the long press steps
 *  by five, again and again while held, and its click is then no tap (a mouse's press is a click, however long). The widget around it holds its rebuilds while the press lasts
 *  (steady.ts PointerHold, the side panel's own guard), so the button stays under the finger. */
function stepBtn(g: Game, cat: LaborCat, dir: 1 | -1): HTMLButtonElement {
  const fire = (n: number): void => {
    const s = g.state;
    g.act(A.setManualTarget(s, cat, Math.max(0, s.ordo.manual[cat] + dir * n)), { okSfx: 'click' });
  };
  let t0 = 0, done = 0, timer = 0, long = false, mouse = false;
  const stop = (): void => { window.clearInterval(timer); timer = 0; };
  const b = h('button', { class: 'btn small ghost tab-lab-pm', type: 'button', 'aria-label': `${dir < 0 ? 'Fewer' : 'More'} ${CAT_LABEL[cat][1]} hands` }, dir < 0 ? '−' : '+');
  b.addEventListener('pointerdown', (e) => {
    mouse = e.pointerType === 'mouse';
    if (e.button !== 0 || mouse) return;   // a finger's or a pen's hold: a mouse clicks ±1, Shift ±5
    stop();
    t0 = performance.now();
    done = 0;
    long = false;
    timer = window.setInterval(() => {
      if (!b.isConnected) { stop(); return; }
      const n = holdSteps(performance.now() - t0);
      if (n > done) { long = true; fire(HOLD.STEP * (n - done)); done = n; }
    }, HOLD_POLL_MS);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(ev, stop);
  b.addEventListener('contextmenu', (e) => { if (!mouse) e.preventDefault(); });   // a long press is the button's, not the browser's menu (a mouse's right-click keeps it)
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (long) { long = false; return; }   // the long press has stepped already
    fire(e.shiftKey ? SHIFT_STEP : 1);
  });
  return b;
}

/** Whether a category has anything to show: posts, hands, a target, or (builders) works in hand; manual shows all. */
export function labourShown(s: GameState, cat: LaborCat): boolean {
  if (!s.ordo.on.labour) return true;
  const c = census(s);
  if (cat === 'builders') return c.catStaffed.builders > 0 || derived(s).sites.length > 0;
  return c.catSlots[cat] > 0 || c.catStaffed[cat] > 0;
}

/** The discrete key of the labour block (which lines show) for panel signatures. */
export function labourKey(s: GameState): string {
  return `${+s.ordo.on.labour}${LABOR_CATS.map((c) => +labourShown(s, c)).join('')}`;
}

/** Labour lines for `cats`; in manual labour each line gets ± targets and the Ordo's ghost, and the block an Apply once. */
export function labourEl(g: Game, up: Updater[], cats: readonly LaborCat[] = LABOR_CATS): HTMLElement {
  const manual = !g.state.ordo.on.labour;
  const box = h('div', { class: 'tab-labour', 'data-guide': 'labour' });
  const hidden = cats.filter((c) => !labourShown(g.state, c));
  for (const cat of cats.filter((c) => labourShown(g.state, c))) {
    const count = h('span', { class: 'tab-lab-count num' });
    const why = h('div', { class: 'tab-why' });
    const prio = h('span', { class: 'tab-lab-prio' });
    const ctl = h('div', { class: 'tab-lab-ctl' },
      manual ? stepBtn(g, cat, -1) : null,
      tip(count, () => countTip(g, cat)),
      manual ? stepBtn(g, cat, 1) : null,
      cat === 'builders' ? null : btn(g, 'First', () => A.setLabourPriority(g.state, cat, B.ordo.PRIORITY_DAYS),
        { cls: 'ghost', tip: `${CAT_LABEL[cat][1]} first for ${B.ordo.PRIORITY_DAYS} days: staffed right after water and food.` }));
    box.append(h('div', { class: 'tab-lab', 'data-cat': cat, 'data-key': `lab-${cat}`, 'data-focus': focusOfLabour(cat) },
      h('div', { class: 'tab-lab-name' }, h('b', null, CAT_LABEL[cat][0]), h('span', { class: 'ed-en' }, CAT_LABEL[cat][1]), prio), ctl, why));
    const refresh = (): void => {
      const s = g.state;
      const c = census(s);
      const rep = councilReport(s);
      const line = rep.labour.find((l) => l.cat === cat);
      const have = c.catStaffed[cat];
      const target = manual ? s.ordo.manual[cat] : line?.target ?? have;
      put(count, cat === 'builders' ? `${have} / ${target}` : `${have} / ${target} · ${c.catSlots[cat]}`);
      count.classList.toggle('short', have < target);
      const would = rep.would.labour[cat];
      put(why, manual ? (would !== undefined ? `The Ordo would assign ${would}.` : '') : line ? reasonText(line.reason) : '');
      const p = s.ordo.priorities.find((x) => x.cat === cat && x.until > s.day);
      put(prio, p ? `first, ${p.until - s.day} d` : '');
    };
    refresh();
    up.push(refresh);
  }
  if (hidden.length && cats.length > 1) box.append(h('div', { class: 'tab-note' }, `No posts yet for ${hidden.map((c) => CAT_LABEL[c][1].toLowerCase()).join(', ')}.`));
  const idle = h('div', { class: 'tab-note' });
  const refreshIdle = (): void => {
    const n = census(g.state).idle.length;
    put(idle, n ? `${n} able ${n === 1 ? 'hand stands' : 'hands stand'} idle: they forage a little grain and help the builders.` : 'No able hand stands idle.');
  };
  refreshIdle();
  up.push(refreshIdle);
  box.append(idle);
  if (manual && cats.length > 1) {
    box.append(h('div', { class: 'tab-row-end' }, h('span', { class: 'tab-note' }, 'Labour is yours: targets per category, High posts first.'),
      btn(g, 'Apply once', () => A.applyOnce(g.state, 'labour'), { cls: 'primary', tip: 'Copy the Ordo\'s plan into your targets, this once.' })));
  }
  return box;
}

function countTip(g: Game, cat: LaborCat): string {
  const s = g.state;
  const c = census(s);
  const line = councilReport(s).labour.find((l) => l.cat === cat);
  const target = s.ordo.on.labour ? line?.target ?? c.catStaffed[cat] : s.ordo.manual[cat];
  return `${CAT_LABEL[cat][0]} · ${CAT_LABEL[cat][1]}\n${c.catStaffed[cat]} at work · ${target} wanted${cat === 'builders' ? '' : ` · ${c.catSlots[cat]} posts in open buildings`}`
    + (line && s.ordo.on.labour ? `\nWhy: ${reasonText(line.reason)}` : '');
}

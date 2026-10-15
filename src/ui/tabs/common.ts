// src/ui/tabs/common.ts — shared pieces of the side-panel tabs and the inspector: sections, segmented controls,
// disabled-with-reason buttons, runways from the ledger, the Ordo's Agenda (DESIGN §10.6, §15.3). Owner: WP-I.
import { RESOURCES } from '../../game/types';
import type { ActionResult, BuildingId, CouncilReport, Cost, GameState, Remedy, ResId, WishView } from '../../game/types';
import type { Game, Panel, Updater } from '../types';
import { fmtCost, h, img, sentence, tip } from '../dom';
import type { Kid } from '../dom';
import { pressWord } from '../pointer';
import * as A from '../../game/actions';
import { councilReport } from '../../game/ordo/index';
import { DUTY_DEFS, wishDuty } from '../../game/ordo/duties';
import { checkRemedy } from '../../game/advisors/remedies';
import { reasonText } from '../../game/ordo/reasons';
import { formatRoman } from '../../game/calendar';
import { getBuilding, missing } from '../../game/state';
import { B } from '../../game/balance';
import { steadyNet } from '../../game/sim';
import { BUILDING_DEFS } from '../../game/data/buildings';
import { RANK_DEFS } from '../../game/data/ranks';
import { focusOfWish } from '../focusrow';

/** A tab panel; `focus` lets openTab(tab, anchor) set panel state (a filter, a form) before the rebuild. */
export interface TabPanel extends Panel {
  focus?(anchor: string): void;
}

/** Days a newly unlocked thing wears its NEW marker. */
export const NEW_DAYS = B.ui.NEW_DAYS;

/** Inscription caps with V for U ('CONSILIVM'). */
export function caps(s: string): string {
  return s.toUpperCase().replace(/U/g, 'V');
}

/** 'a' or 'an' before a word. */
export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

/** True while something unlocked on `day` is still fresh. */
export function fresh(s: GameState, day: number | undefined): boolean {
  return day !== undefined && s.day - day < NEW_DAYS;
}

/** A NEW sticker. */
export function newMark(): HTMLElement {
  return h('span', { class: 'new tab-new' }, 'NEW');
}

/** A titled section: Latin kicker in inscription caps with an English sub-label; optional guide target and anchor. */
export function section(latin: string, english: string, opts?: { guide?: string; anchor?: string; note?: Kid; extra?: Kid }): HTMLElement {
  return h('section', { class: 'tab-sec', 'data-guide': opts?.guide, 'data-anchor': opts?.anchor },
    h('div', { class: 'tab-sec-head' }, h('span', { class: 'tab-sec-latin' }, caps(latin)), h('span', { class: 'tab-sec-en' }, english), opts?.extra ?? null),
    opts?.note ? h('div', { class: 'tab-note' }, opts.note) : null);
}

/** Options of a button: a disabled reason (shown as tooltip, refused with a toast), tooltip, class. */
export interface BtnOpts { cls?: string; reason?: string | null; tip?: string | (() => Node | string); sfx?: boolean }

/**
 * A button that routes its click through `run` (an action → Game.act). When `reason` is set it is disabled with that
 * reason: it still receives hover (tooltips work on it) and a click explains the refusal instead of acting.
 */
export function btn(g: Game, label: Kid, run: () => ActionResult | void, o: BtnOpts = {}): HTMLButtonElement {
  const off = !!o.reason;
  const b = h('button', { class: `btn small ${o.cls ?? ''}${off ? ' is-off' : ''}`, 'aria-disabled': off ? 'true' : null, type: 'button' }, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (o.reason) { g.act({ ok: false, code: 'locked', reason: o.reason }); return; }
    const r = run();
    if (r) g.act(r, { okSfx: o.sfx === false ? undefined : 'click' });
  });
  if (o.reason) tip(b, o.reason);
  else if (o.tip) tip(b, o.tip);
  return b;
}

const ARM_MS = 3000;

/** Two-click confirm for a button with rich content: the first click arms it and shows `note`, the second runs `fn`. */
export function confirmRich(b: HTMLButtonElement, note: string, fn: () => void): HTMLButtonElement {
  let timer = 0;
  const tag = h('span', { class: 'tab-confirm' }, note);
  const disarm = (): void => { window.clearTimeout(timer); b.classList.remove('armed'); tag.remove(); };
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.classList.contains('armed')) { disarm(); fn(); return; }
    b.classList.add('armed');
    tag.textContent = pressWord(note);   // 'Click again…' says Tap to a finger
    b.append(tag);
    timer = window.setTimeout(disarm, ARM_MS);
  });
  return b;
}

/** A segmented control of mutually exclusive options; the current one glows; disabled options carry a reason. */
export function seg<T extends string>(g: Game, items: { id: T; label: Kid; tip?: string | (() => Node | string); reason?: string | null; mark?: Kid }[],
  cur: T, pick: (id: T) => ActionResult): HTMLElement {
  return h('div', { class: 'tab-seg', role: 'radiogroup' }, items.map((it) => {
    const b = btn(g, [it.label, it.mark ?? null], () => (it.id === cur ? undefined : pick(it.id)),
      { cls: `tab-seg-btn${it.id === cur ? ' sel' : ''}`, reason: it.id === cur ? null : it.reason, tip: it.tip });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(it.id === cur));
    return b;
  }));
}

/** A labelled on/off toggle routed through an action. */
export function toggle(g: Game, on: boolean, labels: [string, string], set: (on: boolean) => ActionResult, reason?: string | null): HTMLButtonElement {
  const b = btn(g, on ? labels[0] : labels[1], () => set(!on), { cls: `tab-toggle ${on ? 'on' : 'off'}`, reason });
  b.setAttribute('aria-pressed', String(on));
  return b;
}

/** Net change of a resource per day from the last tick's ledger (steady flows; one-day lumps left out). */
export function netRate(g: Game, r: ResId): number {
  return steadyNet(g.rates, r);
}

/** Days until the stores gather `lack` at today's net rates; null when some lacking good is not growing. */
export function etaDays(g: Game, lack: Cost): number | null {
  let worst = 0;
  for (const r of RESOURCES) {
    const n = lack[r] ?? 0;
    if (n <= 0) continue;
    const rate = netRate(g, r);
    if (rate <= 0) return null;
    worst = Math.max(worst, n / rate);
  }
  return Math.ceil(worst);
}

/** '120 stone (≈ 9 days)' or '120 stone (not gathering yet)'. */
export function lackLine(g: Game, lack: Cost): string {
  const eta = etaDays(g, lack);
  return `${fmtCost(lack)} (${eta === null ? 'not gathering yet' : `≈ ${eta} ${eta === 1 ? 'day' : 'days'}`})`;
}

/** What a cost still lacks against the stores, or null when it is covered. */
export function lacking(s: GameState, cost: Cost): Cost | null {
  const m = missing(s, cost);
  return RESOURCES.some((r) => (m[r] ?? 0) > 0) ? m : null;
}

/** A wish's state as the ticker and the focus line name it ('Raising: Lumber camp'). */
export const WISH_STATE: Record<WishView['state'], string> = {
  staked: 'Staked', building: 'Raising', saving: 'Saving for', waiting: 'Waiting on', paced: 'Later', proposed: 'Next',
};

type Saving = NonNullable<CouncilReport['saving']>;
const SAVING_FOR: Record<Saving['for'], string> = { petition: 'the petition', plan: 'your plan', pin: 'your pinned work', request: 'your request', wish: 'the next work' };

/** What the Ordo saves for, in words ('the petition', 'your pinned work'). */
export function savingFor(sv: Saving): string {
  return SAVING_FOR[sv.for] ?? `the ${sv.for}`;
}

/** The saving line: what the target still lacks with an ETA ('Saving for the petition: 40 stone (≈ 9 days)'), or, once
 *  the stores cover it, that it is set aside ('Set aside for the petition: 250 den · 100 timber, ready'). Never the whole
 *  target as if it were lacking. */
export function savingLine(g: Game, sv: Saving): string {
  const lack = lacking(g.state, sv.cost);
  return lack ? `Saving for ${savingFor(sv)}: ${lackLine(g, lack)}` : `Set aside for ${savingFor(sv)}: ${fmtCost(sv.cost)}, ready`;
}

/** A remedy's discrete identity for a panel signature: a building remedy's type, its target tile and whether it (and the
 *  "Ask the Ordo" beside it) can be used — all structural, so the card rebuilds when the best plot moves or is taken —
 *  any other remedy by its kind only; never live numbers. */
export function remedyKey(s: GameState, x: { remedy: Remedy; check: ActionResult }): string {
  const r = x.remedy;
  if (r.kind === 'clear') return `clear:${r.building}@${r.tile}:${r.ids.join('.')}:${x.check.ok ? 1 : 0}`;   // another block, or the same one changed
  if (r.kind !== 'place' && r.kind !== 'ask') return r.kind;
  const ask = r.kind === 'ask' ? x.check.ok : s.ordo.on.build && checkRemedy(s, { kind: 'ask', building: r.building }).ok;
  return `${r.kind}:${r.building}@${r.kind === 'place' ? r.tile ?? '' : ''}:${x.check.ok ? 1 : 0}${ask ? 1 : 0}`;
}

/** Sprite name of a building type's card image. */
export function typeSprite(type: BuildingId): string {
  return type === 'area' ? 'h_tentoria_0' : type === 'principia' ? 'p_forum_0' : type === 'capitolium' ? 'p_capitolium_4' : `b_${type}`;
}

/** 'Rome grants this to an Oppidum.' when the rank is not yet reached. */
export function rankReason(s: GameState, type: BuildingId): string | null {
  const r = BUILDING_DEFS[type].rank;
  return r > s.rank ? `Rome grants this to ${article(RANK_DEFS[r].name)}.` : null;
}

/** A wish's state in words: 'staked: starts in 3 d', 'building 40%', 'saving: 40 stone ≈ 9 d', … */
export function wishState(g: Game, w: WishView): string {
  const s = g.state;
  const site = w.siteId !== undefined ? getBuilding(s, w.siteId) : undefined;
  switch (w.state) {
    case 'staked': return site ? `staked: builders start in ${Math.max(0, site.placed + B.construction.STAKE_DAYS - s.day)} d` : 'staked';
    case 'building': return `building ${Math.round((site?.progress ?? 0) * 100)}%`;
    case 'saving': return w.lacking ? `saving: ${fmtCost(w.lacking)}${w.eta !== undefined ? ` ≈ ${Math.max(0, Math.round(w.eta))} d` : ''}` : 'saving';
    case 'waiting': return 'waiting for builders';
    case 'paced': return `the Ordo raises it in ${Math.max(1, w.eta ?? 1)} d: raise it yourself for sooner`;
    case 'proposed': return 'proposed';
  }
}

/** The Agenda Ordinis: the next wishes with state and reason, the saving line, requests and the pin (DESIGN §10.6). */
export function agendaEl(g: Game, up: Updater[]): HTMLElement {
  const s = g.state;
  const rep = councilReport(s);
  const manual = !s.ordo.on.build;
  const would = rep.would.build;   // the Ordo's next work among the duties it does not hold (§10.2)
  const box = h('div', { class: 'tab-agenda' });
  if (!rep.agenda.length && !would) {
    box.append(h('div', { class: 'tab-quiet' }, manual ? 'Building is yours, and the Ordo would add nothing today.'
      : `The Ordo has nothing in hand. It keeps the colony every ${B.ordo.BUILD_EVERY} days, and grows it by one work every ${B.ordo.GROWTH_EVERY}: raise more yourself to grow faster.`));
  }
  // a work the player keeps is theirs to raise: the Ordo saves for none of it, so its line says what it still needs
  const yours = (w: WishView): string => (w.lacking ? `needs ${fmtCost(w.lacking)}` : 'yours to raise now');
  const row = (w: WishView, i: number, mine = false): HTMLElement => {
    const state = h('span', { class: 'tab-agenda-state' });
    const say = (): string => (mine ? yours(w) : wishState(g, w));
    up.push(() => { state.textContent = say(); });
    state.textContent = say();
    const el = h('div', { class: 'tab-agenda-row', 'data-key': `w-${w.type}-${w.tile ?? i}` },
      h('span', { class: 'tab-agenda-n num' }, String(i + 1)), img(typeSprite(w.type), 1, 'tab-agenda-img'),
      h('div', { class: 'tab-agenda-main' }, h('div', null, h('b', null, BUILDING_DEFS[w.type].name), ' · ', state),
        h('div', { class: 'tab-why' }, reasonText(w.reason))));
    if (w.tile !== undefined) {
      const t = w.tile;
      el.dataset.focus = focusOfWish(w.type, t);   // the focus row on a tablet (focusrow.ts)
      el.classList.add('click');
      el.addEventListener('click', () => g.focusTile(t));
    }
    return el;
  };
  rep.agenda.forEach((w, i) => box.append(row(w, i)));
  if (would) {
    const d = wishDuty(would.reason);
    box.append(h('div', { class: 'tab-note' }, manual ? 'Building is yours. The Ordo would raise:'
      : `${d ? DUTY_DEFS[d].latin : 'This work'} is in your hands. The Ordo would raise:`));
    box.append(row(would, rep.agenda.length, true));
    box.append(btn(g, 'Apply once', () => A.applyOnce(g.state, 'build'), { cls: 'primary', tip: 'Place the Ordo\'s wish now as your own site.' }));
  }
  const saving = h('div', { class: 'tab-agenda-save' });
  const refreshSave = (): void => {
    const sv = councilReport(g.state).saving;
    saving.hidden = !sv;
    if (sv) saving.textContent = savingLine(g, sv);
  };
  refreshSave();
  up.push(refreshSave);
  box.append(saving);
  if (s.ordo.pin) {
    box.append(h('div', { class: 'tab-agenda-pin' }, img('i_tool_pin', 1), `Build next, by your order: ${BUILDING_DEFS[s.ordo.pin].name}`,
      btn(g, '✕', () => A.pinBuild(g.state, null), { cls: 'ghost', tip: 'Release the pin.' })));
  }
  for (const r of s.ordo.requests) {
    box.append(h('div', { class: 'tab-agenda-pin' }, img('i_request', 1), sentence(`You asked for ${article(BUILDING_DEFS[r.type].name.toLowerCase())} on ${formatRoman(r.day)}`)));
  }
  return box;
}

/** A thin progress bar; `kind` colours it (trench grey, building gold, waiting purple, staked chalk). */
export function bar(kind = ''): { el: HTMLElement; set(frac: number, k?: string): void } {
  const fill = h('i');
  const el = h('div', { class: `tab-bar ${kind}` }, fill);
  return { el, set(frac: number, k?: string) { fill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`; if (k !== undefined) el.className = `tab-bar ${k}`; } };
}

/** A small key → value row. */
export function kv(k: Kid, v: Kid, cls = ''): HTMLElement {
  return h('div', { class: `tab-kv ${cls}` }, h('span', { class: 'tab-kv-k' }, k), h('span', { class: 'tab-kv-v' }, v));
}

/** '+12%' / '−8%' for a multiplier. */
export function pct(mult: number): string {
  const p = Math.round((mult - 1) * 100);
  return p >= 0 ? `+${p}%` : `−${-p}%`;
}

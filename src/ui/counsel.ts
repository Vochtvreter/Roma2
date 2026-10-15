// src/ui/counsel.ts — the portrait strip and the ONE counsel card (ARCHITECTURE §13.5, DESIGN §15.1, §11.1–11.7). Owner: WP-H.
// Exactly one item by priority: Periculum advisory › urgent tip › lesson › Cave advisory › duties to hand over › tip
// (prefs.tips) › Monitum / Opportunitas advisory › calm line. Signature-diffed; the advisory's title and text re-render once a day; the card is never rebuilt
// under the pointer within B.ui.CLICK_GUARD_MS of a click, nor while the mouse rests on it (unless to answer a click
// there): what the player is reading or aiming at is never swapped or moved under the cursor. Only a new item slides in.
// Nor while a two-step confirm is armed anywhere (modals.ts anyArmed): a tip that unfolds would push the armed button
// away between the two presses (on a phone the card heads the panel), so it waits until the confirm runs or disarms.
// On a phone (the SHEET and the DRAWER: layout.ts, sheet.ts) the card is the voice line at the panel's head (afloat at the
// bottom-left of the map while the DRAWER's pane is closed): folded, its head is two rows (portrait, kicker and title)
// with the one action chip of voiceAction and a '+n' pip for what else waits; a tap on the line unfolds the card inside
// the panel, at half (Layout.lift), and a closed panel folds it again. There a dispatch (an event to answer) comes
// through the line too, right after a Periculum: 'NVNTIVS · … · 28 d' with Read, which opens the event card in the
// phone's slot (choice.ts); and on the SHEET lesson I's card carries the Annona labour line, so its job is done in the
// card itself (layout.ts CARD_LESSONS). On a tablet (the DOCK) the card is the same line (voiceLine), heading the docked
// pane under the Res Gestae (afloat top-right over the map while the pane is folded to its spine): it unfolds in place, at
// most 40% of the pane, and scrolls (dock.css); dispatches keep their own card in the free map there.
import { ADVISORS } from '../game/types';
import type { ActiveAdvisory, ActionResult, AdvisorId, BuildingId, DutyId, GameState, GuideStep, LaborCat, PathDecisionId, PendingChoice, RankIndex, Remedy, TabId } from '../game/types';
import type { Game, Updater } from './types';
import { clear, fmtDays, h, img, scrollWithin, tip } from './dom';
import { caps } from './tipkit';
import { PointerHold } from './steady';
import { dangerLabel } from './objective';
import { activeAdvisories, advisorMood, renderAdvisory } from '../game/advisors/engine';
import { checkRemedy } from '../game/advisors/remedies';
import { beginNextLesson, dismissTip, handOverAll, hush, keepDuties, mute, setDuty, skipIntro, skipLesson } from '../game/actions';
import { DUTY_DEFS, pendingOffers } from '../game/ordo/duties';
import { LESSONS, currentLesson, introduced, lessonAge, lessonPointer } from '../game/intro';
import type { Lesson, LessonId } from '../game/intro';
import { toRoman } from '../game/calendar';
import { mentorKicker, nextTip } from '../game/guide';
import { currentMilestone } from '../game/objectives';
import { forecast } from '../game/forecast';
import { petitionNeeds } from '../game/decisions';
import { view } from '../game/sim';
import { ADVISOR_DEFS } from '../game/data/advisors';
import { BUILDING_DEFS } from '../game/data/buildings';
import { B } from '../game/balance';
import { portrait } from '../render/art/index';
import { shows, tabShown } from './intro';
import { CARD_LESSONS, CARD_ROWS, bringTarget, currentHost, hostPointer, isPhone, lessonFolds, registerBringer, revealTarget, routeIntent } from './layout';
import type { Host, Layout } from './layout';
import { labourEl } from './tabs/labour';
import { anyArmed } from './modals';

/** Whether the counsel is drawn as the voice line (pure): its folded two rows with the one action chip and the '+n' pip,
 *  on the phones (the SHEET, the DRAWER) and the tablet's DOCK, whose pane it heads; the desktop keeps the card. */
export function voiceLine(host: Host | null): boolean {
  return isPhone(host) || host === 'dock';
}

/** The one item the card shows ('event': a dispatch to answer, on a phone only: elsewhere its own card floats). */
export type CounselItem = { kind: 'advisory'; a: ActiveAdvisory } | { kind: 'tip'; t: GuideStep }
  | { kind: 'lesson'; l: Lesson; index: number; done: boolean; nudge: boolean; stuck: boolean }
  | { kind: 'offer'; duties: DutyId[] } | { kind: 'event'; c: PendingChoice } | { kind: 'calm' };

/** One thing that waits on the player: a row of the Breviarium's "Awaiting you" (tray.ts), and what the phone's voice
 *  line counts in its '+n' pip. A Periculum or Cave advisory, a dispatch to answer (s.choice), the opening lesson under
 *  way (a Periculum or a Cave can hold the line over it, and a phone has no other place for it), chores learned and not
 *  yet answered, or a petition Rome would hear. */
export type AwaitItem = { kind: 'advisory'; a: ActiveAdvisory }
  | { kind: 'event'; title: string; expires: number }
  | { kind: 'lesson'; l: Lesson; index: number; done: boolean }
  | { kind: 'offer'; duties: DutyId[] }
  | { kind: 'petition'; decision: PathDecisionId; rank: RankIndex | null; affordable: boolean };

/** The one action an item offers (the voice line's chip, an "Awaiting you" row's button): a remedy to run ('Place' for a
 *  building, with its check), a tab to open ('Review' the Mandata, 'Petition'), a lesson to show, the dispatch to read. */
export type VoiceAction = { kind: 'remedy'; label: string; remedy: Remedy; ok: boolean; reason: string }
  | { kind: 'open'; label: string; tab: TabId; anchor?: string }
  | { kind: 'lesson'; label: string; lesson: LessonId }
  | { kind: 'begin'; label: string }
  | { kind: 'event'; label: string };

/** An advisory's remedies as renderAdvisory gives them (label and check). */
export type RenderedRemedy = { remedy: Remedy; label: string; check: ActionResult };

const SEV_NAME = ['Nota', 'Monitum', 'Cave', 'Periculum'] as const;
const OPPORTUNITAS = 'augur.petition';
const PULSE_MS = 3000;
const PULSE_TRIES = 20;
/** The labour line a lesson card carries on the SHEET (CARD_LESSONS): lesson I's hands go on the fields there. */
const CARD_LABOUR: Partial<Record<LessonId, LaborCat>> = { fields: 'food' };

/** A kicker with each ' · ' glued to the word before it (a no-break space, as wide as a space in Silkscreen): where the
 *  line wraps (the tablet's pane head lets it: dock.css) it breaks after the dot, 'MONITVM ·' over 'AQVARVM' and
 *  'DISCIPLINA ·' over 'I / X', never before it. */
export function glueKicker(k: string): string {
  return k.replace(/ · /g, '\u00a0· ');
}

const APPOINTED_AT: Partial<Record<AdvisorId, string>> = {
  quaestor: 'Appointed at Vicus, or with the first coin trouble', aedilis: 'Appointed at Vicus, or when a house is stuck or colonists come slowly',
  augur: 'Appointed with the first omen, or on Kal. Sept.',
};

/** The counsel priority rule (DESIGN §15.1): exactly one item. `events` (a phone, by default when one is the host): a
 *  dispatch to answer comes through the card (the voice line) right after a Periculum, before anything else: it
 *  expires, and its own card no longer floats over the map there. */
export function pickCounsel(g: Game, events = isPhone(currentHost())): CounselItem {
  const s = g.state;
  const adv = activeAdvisories(s, { forCard: true });
  const tipStep = nextTip(s);
  const bySev = (sev: number): ActiveAdvisory | undefined => adv.find((a) => a.memo.sev === sev && a.rule !== OPPORTUNITAS);
  const peril = bySev(3);
  if (peril) return { kind: 'advisory', a: peril };
  if (events && s.choice) return { kind: 'event', c: s.choice };
  if (tipStep?.urgent) return { kind: 'tip', t: tipStep };
  // an opening lesson (§11.13) holds the card until its job is done, then shows its payoff for a few seconds
  const cur = currentLesson(s);
  const age = cur ? lessonAge(s) : 0;
  const waited = cur && !cur.done && !cur.lesson.progress?.(s) ? age : 0;   // a work already rising needs no nudge
  const lesson = (): CounselItem => ({ kind: 'lesson', l: cur!.lesson, index: cur!.index, done: cur!.done,
    nudge: waited >= B.intro.NUDGE_S * 1000, stuck: waited >= B.intro.STUCK_S * 1000 });
  if (cur && !cur.done) return lesson();
  const cave = bySev(2);
  if (cave) return { kind: 'advisory', a: cave };
  if (cur) return lesson();   // the breather: the payoff, the next lesson's name, and Begin now
  const offers = pendingOffers(s);   // duties the player has learned: theirs to hand to the Ordo or keep (§10.2)
  if (offers.length) return { kind: 'offer', duties: offers };
  const spaced = s.stats.playMs - s.guidance.tipAt >= B.intro.TIP_GAP_S * 1000;   // tips spaced in real time, whatever the speed
  if (tipStep && g.prefs.tips && spaced) return { kind: 'tip', t: tipStep };
  const low = adv.find((a) => a.memo.sev >= 1);   // Monitum or Opportunitas (ranks as Monitum, never above Cave)
  if (low) return { kind: 'advisory', a: low };
  return { kind: 'calm' };
}

/** What waits on the player, most pressing first (pure; tests/voice.test.ts): Periculum advisories, a dispatch to answer
 *  (it expires), the opening lesson under way, Cave advisories, the lesson's breather (its payoff and Begin now), the
 *  chores learned and not yet answered, and a petition Rome would hear: the lesson where pickCounsel ranks it. The
 *  chores and the petition wait only once Edicta, where they are answered, is on the bar, and the chores once its
 *  Mandata are (the lessons bring both: a chore learned in lesson I waits for lesson IV). Opportunitas and the gentler
 *  counsel stay on the card alone. */
export function awaitingItems(s: GameState): AwaitItem[] {
  const adv = activeAdvisories(s, { forCard: true }).filter((a) => a.rule !== OPPORTUNITAS);
  const out: AwaitItem[] = adv.filter((a) => a.memo.sev === 3).map((a) => ({ kind: 'advisory', a }));
  if (s.choice) out.push({ kind: 'event', title: s.choice.title, expires: s.choice.expires });
  const cur = currentLesson(s);
  const lesson = cur ? { kind: 'lesson' as const, l: cur.lesson, index: cur.index, done: cur.done } : null;
  if (lesson && !lesson.done) out.push(lesson);
  for (const a of adv) if (a.memo.sev === 2) out.push({ kind: 'advisory', a });
  if (lesson?.done) out.push(lesson);
  const edicta = tabShown(s, 'council');
  const offers = edicta && introduced(s, 'mandates') ? pendingOffers(s) : [];
  if (offers.length) out.push({ kind: 'offer', duties: offers });
  const pn = edicta ? petitionNeeds(s, view(s)) : null;
  if (pn?.ready) out.push({ kind: 'petition', decision: pn.decision, rank: pn.rank, affordable: pn.affordable });
  return out;
}

/** A building remedy (ask the Ordo or place it) as the remedy the player runs: Place, at the remedy's own tile when the
 *  list carries one for that building (the counsel card's "Place it myself"). */
function placeOf(list: readonly RenderedRemedy[], r: Remedy): Remedy | null {
  if (r.kind === 'place') return r;
  if (r.kind !== 'ask') return null;
  return list.find((y) => y.remedy.kind === 'place' && y.remedy.building === r.building)?.remedy ?? { kind: 'place', building: r.building };
}

/** The chip an advisory's remedies give (pure; tests/voice.test.ts). `first`: the first remedy whatever it is (an
 *  "Awaiting you" row), a building one as Place; else only a building remedy, as Place (the voice line: a spatial verb or
 *  nothing). The check is the remedy's own, so the chip can show disabled with the reason. */
export function remedyChip(list: readonly RenderedRemedy[], first: boolean, s: GameState): VoiceAction | null {
  const pick = first ? list[0] : list.find((x) => x.remedy.kind === 'place' || x.remedy.kind === 'ask');
  if (!pick) return null;
  const place = placeOf(list, pick.remedy);
  const remedy = place ?? pick.remedy;
  const check = place ? checkRemedy(s, place) : pick.check;
  return { kind: 'remedy', label: place ? 'Place' : pick.label, remedy, ok: check.ok, reason: check.ok ? '' : check.reason };
}

/** The voice line's one action chip for an item (pure; tests/voice.test.ts): a Periculum or Cave advisory with a building
 *  remedy → Place (runs it); chores to hand over → Review (Edicta at the Mandata); a lesson under way with something to
 *  point at → Show me; a dispatch → Read; a petition → Petition (Edicta at the petition). Anything else (a tip, the calm
 *  line, a Monitum, an advisory whose remedies are not spatial) has none: the line shows ▾ and opens the card. */
export function voiceAction(item: CounselItem | AwaitItem, s: GameState): VoiceAction | null {
  switch (item.kind) {
    case 'advisory':
      if (item.a.memo.sev < 2 || item.a.rule === OPPORTUNITAS) return null;
      return remedyChip(renderAdvisory(s, view(s), item.a).remedies, false, s);
    case 'offer': return { kind: 'open', label: 'Review', tab: 'council', anchor: 'mandates' };
    case 'lesson': return !item.done && (item.l.tab || item.l.target) ? { kind: 'lesson', label: 'Show me', lesson: item.l.id } : null;
    case 'event': return { kind: 'event', label: 'Read' };
    case 'petition': return { kind: 'open', label: 'Petition', tab: 'council', anchor: 'petition' };
    default: return null;
  }
}

/** How many waiting items (awaitingItems) the voice line's '+n' pip counts beside the one it shows (pure;
 *  tests/voice.test.ts): all of them, less the shown item when it is one of them (the same advisory, or the chores). */
export function waitingBeyond(items: readonly AwaitItem[], shown: CounselItem): number {
  const own = items.some((x) => (x.kind === 'advisory' && shown.kind === 'advisory' && x.a.rule === shown.a.rule) || (x.kind === 'offer' && shown.kind === 'offer')
    || (x.kind === 'event' && shown.kind === 'event') || (x.kind === 'lesson' && shown.kind === 'lesson'));
  return items.length - (own ? 1 : 0);
}

/** An "Awaiting you" row's action (pure): an advisory offers its first remedy (a building one as Place), a lesson's
 *  breather Begin now (when a lesson follows); every other item the voice line's chip. */
export function awaitAction(item: AwaitItem, s: GameState): VoiceAction | null {
  if (item.kind === 'advisory') return remedyChip(renderAdvisory(s, view(s), item.a).remedies, true, s);
  if (item.kind === 'lesson' && item.done) return LESSONS[item.index + 1] ? { kind: 'begin', label: 'Begin now' } : null;
  return voiceAction(item, s);
}

/** The card's signature: the portrait strip, the shown item and, for an advisory, its remedies' labels and availability
 *  — a place remedy with its tile, so once the Ordo builds on the best plot the button aims at the next one; a block
 *  to clear with its tile and what stands there. */
export function counselSig(g: Game, item: CounselItem): string {
  const s = g.state;
  const strip = shows(g, 'portraits') ? ADVISORS.map((a) => (s.guidance.appointed.includes(a) ? `${a}${advisorMood(s, a)}` : '-')).join(',') : 'x';
  let key = 'c';
  if (item.kind === 'tip') key = `t:${item.t.id}`;
  if (item.kind === 'lesson') key = `l:${item.index}:${item.done ? 1 : 0}:${item.nudge ? 1 : 0}${item.stuck ? 1 : 0}:${item.l.progress?.(s) ?? ''}:${item.l.id === 'ordo' ? pendingOffers(s).join(',') : ''}`;
  if (item.kind === 'offer') key = `o:${item.duties.join(',')}`;
  if (item.kind === 'event') key = `e:${item.c.event}:${item.c.created}`;
  if (item.kind === 'advisory') {
    const r = renderAdvisory(s, view(s), item.a);
    const at = (x: Remedy): string => (x.kind === 'place' ? `@${x.tile ?? ''}` : x.kind === 'clear' ? `@${x.tile}:${x.ids.join('.')}` : '');
    key = `a:${item.a.rule}:${item.a.memo.sev}:${s.ordo.on.build ? 1 : 0}:${r.remedies.map((x) => `${x.label}${x.check.ok ? 1 : 0}${at(x.remedy)}`).join(',')}`;
  }
  // the voice line also counts what else waits ('+n'), and is built afresh for another host (the SHEET, the DRAWER and
  // the DOCK draw the same line, but only the SHEET's lesson card carries a labour line)
  const host = currentHost();
  const phone = voiceLine(host) ? `|${host === 'sheet' ? 'S' : host === 'drawer' ? 'D' : 'K'}${waitingBeyond(awaitingItems(s), item)}` : '';
  return `${strip}|${key}|${g.prefs.tips ? 1 : 0}${phone}`;
}

/** "Show me" for a lesson (its card's button, the voice line's chip, an "Awaiting you" row): its tab opens on its anchor
 *  where the lessons' table routes it (or the panel makes way for the map: a map lesson), the host brings a target it
 *  hides into view (the SHEET's Mappae popover for the overlay bar, its lesson card for the row the card carries:
 *  hostPointer), and the target glows. */
export function showLesson(g: Game, l: Lesson): void {
  const ptr = hostPointer(l, currentHost() ?? 'columns');
  if (ptr.open) g.openTab(ptr.open, ptr.anchor, 'lesson');
  else routeIntent({ kind: 'lesson', lesson: l.id });
  if (ptr.glow) { bringTarget(ptr.glow); pulseTarget(ptr.glow); }
}

/** Pulses a selector's element for 3 s (retries while a freshly opened tab builds); one in the side panel's body (or in a
 *  phone lesson card's body) is scrolled into view there, and nothing else ever scrolls (dom.scrollWithin: the chrome
 *  stays put). A target the host hides glows its proxy instead (layout.reveal: the Mappae button for the overlay bar on
 *  a phone, from P2). */
export function pulseTarget(target: string): void {
  const selector = revealTarget(target);
  let tries = 0;
  const go = (): void => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) { if (++tries < PULSE_TRIES) window.setTimeout(go, 60); return; }
    el.classList.add('guide-glow');
    // the box it scrolls in: the tab body, or a phone lesson card's own body (the row it carries: CARD_ROWS)
    const body = el.closest<HTMLElement>('#tab-body') ?? el.closest<HTMLElement>('#counsel .counsel-body');
    // a frame later: the card that unfolds with a lesson (a phone's sheet, above its tab body) has taken its room by then.
    // And again while it glows, whenever the body, the row or the tab's content changes size (the sheet coming to rest, a
    // line the panel adds once the day turns): the row the lesson points at stays whole in view
    if (body) {
      const bring = (): void => { if (body.contains(el)) scrollWithin(body, el, 'nearest', true); };
      requestAnimationFrame(bring);
      if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => bring());
        for (const x of [body, el, body.firstElementChild]) if (x) ro.observe(x);
        window.setTimeout(() => ro.disconnect(), PULSE_MS);
      }
    }
    window.setTimeout(() => el.classList.remove('guide-glow'), PULSE_MS);
  };
  go();
}

/** The portrait strip and the counsel card in #counsel (signature-diffed). */
export class Counsel {
  private sig = '';
  private textDay = -1;
  private readonly hold: PointerHold;
  private shownKey = '';                      // the shown item (not its remedies): a new one slides in, a refresh does not
  private refresh: (() => void) | null = null;
  private open = false;                       // mobile: the card is expanded from its portrait chip
  private autoOpen = false;                   // … and it was a tip or lesson that unfolded it
  private skipArmed = false;                  // "Skip the lessons" asks once more before it skips
  private live: Updater[] = [];               // live parts of the card (a lesson's labour line): refreshed every update
  private item: CounselItem = { kind: 'calm' };   // the item on the card
  /** The layout (UI.build): on a phone an unfolded card raises a closed panel to half and lets it drop again. */
  layout: Pick<Layout, 'lift' | 'drop' | 'detent'> | null = null;
  /** The voice line's '+n' pip: the UI root opens the Breviarium at "Awaiting you". */
  onAwaiting: (() => void) | null = null;
  /** The voice line's Read chip: the UI root unfolds the event card (false when none is pending). */
  onRead: (() => boolean) | null = null;

  constructor(private readonly g: Game, private readonly root: HTMLElement) {
    this.hold = new PointerHold(root);
    // "Show me" on a row a lesson's card carries on the SHEET (CARD_ROWS): the card unfolds, and its row glows
    for (const sel of Object.keys(CARD_ROWS.sheet)) registerBringer(sel, () => this.unfoldLesson());
  }

  /** Unfolds a card lesson's card on the SHEET (CARD_LESSONS); true when the card shows the lesson. */
  private unfoldLesson(): boolean {
    const it = this.item;
    if (currentHost() !== 'sheet' || it.kind !== 'lesson' || !CARD_LESSONS.includes(it.l.id)) return false;
    if (!this.open) this.toggleOpen();
    return true;
  }

  /** True while the mouse rests on the card or the strip: the Res Gestae above holds still too (objective.ts). */
  get held(): boolean {
    return this.hold.holds();
  }

  /** Rebuilds when the shown item, the strip or the remedies' availability change; refreshes the text daily. */
  update(): void {
    const g = this.g;
    const s = g.state;
    const item = pickCounsel(g);
    const sig = counselSig(g, item);
    if (sig !== this.sig && !this.hold.holds() && !anyArmed()) {
      this.sig = sig;
      this.item = item;
      this.build(item);
      this.textDay = s.day;
      return;
    }
    if (this.refresh && s.day !== this.textDay) {
      this.textDay = s.day;
      this.refresh();
    }
    for (const u of this.live) { try { u(); } catch (e) { console.error('[counsel] updater', e); } }
  }

  /** The sheet came down to closed (the player, Back, placing): the card folds into its line. */
  fold(): void {
    if (!this.open) return;
    this.open = false;
    this.autoOpen = false;
    this.root.classList.remove('open');
    this.root.querySelector('.voice-fold')?.setAttribute('aria-expanded', 'false');
  }

  private build(item: CounselItem): void {
    clear(this.root);
    this.refresh = null;
    this.live = [];
    const host = currentHost(), phone = isPhone(host), line = voiceLine(host);
    const key = item.kind === 'advisory' ? `a:${item.a.rule}:${item.a.memo.sev}` : item.kind === 'tip' ? `t:${item.t.id}`
      : item.kind === 'lesson' ? `l:${item.index}:${item.done ? 1 : 0}` : item.kind === 'offer' ? `o:${item.duties[0]}`
        : item.kind === 'event' ? `e:${item.c.event}:${item.c.created}` : 'c';
    const enter = key !== this.shownKey;
    const wasOffer = this.shownKey.startsWith('o:');
    this.shownKey = key;
    // a phone shows the card folded to its title: a new tip or lesson unfolds it (the next waits on it), and once it is
    // read or its payoff has shown the card folds again. A duty offer never unfolds by itself: eight chores with two
    // buttons each would cover the whole map; its title says what waits and a tap opens it. Answering one of its chores
    // brings the same offer back shorter: an unfolded card stays unfolded
    // On the SHEET a lesson whose job is a build tray card arrives folded (lessonFolds: the tray needs the half whole)
    const folds = host !== null && item.kind === 'lesson' && !item.done && lessonFolds(item.l, host);
    if (enter && folds) { this.open = false; this.autoOpen = false; }
    else if (enter && (item.kind === 'tip' || item.kind === 'lesson')) { this.open = true; this.autoOpen = true; }
    else if (enter && ((item.kind === 'offer' && !wasOffer) || this.autoOpen)) { this.open = false; this.autoOpen = false; }
    if (item.kind === 'event') { this.open = false; this.autoOpen = false; }   // its line's Read opens the event card itself
    // on a phone the card unfolds inside the panel: a new lesson raises a closed panel to half (it is to be read and
    // done; a card standing in the phone's slot keeps the panel closed, and the lesson waits folded in its line), a tip
    // waits folded in the voice line while the panel is closed (the map first), and a card that folds lets the panel it
    // raised drop again
    const L = phone ? this.layout : null;
    if (L) {
      if (this.open && enter && item.kind === 'lesson') L.lift('counsel');
      if (this.open && L.detent === 'closed') { this.open = false; this.autoOpen = false; }
      if (!this.open) L.drop('counsel');
    }
    this.root.className = `counsel-${item.kind}${this.open ? ' open' : ''}`;
    // the portraits come with the advisors' tip (the paced introduction); until then the card stands alone
    if (shows(this.g, 'portraits')) this.root.appendChild(h('div', { class: 'counsel-strip' }, ADVISORS.map((a) => this.portraitBtn(a))));
    if (item.kind === 'calm') { this.root.appendChild(this.calm()); return; }
    const card = item.kind === 'tip' ? this.tipCard(item.t) : item.kind === 'lesson' ? this.lessonCard(item)
      : item.kind === 'offer' ? this.offerCard(item.duties) : item.kind === 'event' ? this.eventCard(item.c) : this.advisoryCard(item.a);
    if (enter) card.classList.add('enter');
    if (line) card.querySelector('.counsel-head')?.append(this.voiceActs(item));
    else card.prepend(h('button', { class: 'counsel-toggle', 'aria-label': 'Show or hide the counsel', onclick: () => this.toggleOpen() }, '▾'));
    this.root.appendChild(card);
  }

  private toggleOpen(): void {
    this.open = !this.open;
    this.root.classList.toggle('open', this.open);
    this.root.querySelector('.voice-fold')?.setAttribute('aria-expanded', String(this.open));
    const L = isPhone(currentHost()) ? this.layout : null;
    if (L) { if (this.open) L.lift('counsel'); else L.drop('counsel'); }
  }

  /** The voice line's right end on a phone (DESIGN §15.7): the '+n' pip when more waits than the line says (it opens
   *  the Breviarium at "Awaiting you"), then the item's one action chip (voiceAction: Place, Review, Show me, Read), or
   *  ▾ to unfold the card when it has none. Their taps are theirs: the line's own tap unfolds the card. */
  private voiceActs(item: CounselItem): HTMLElement {
    const g = this.g;
    const s = g.state;
    const own = (fn: () => void) => (e: Event): void => { e.stopPropagation(); g.sfx('click'); fn(); };
    const n = waitingBeyond(awaitingItems(s), item);
    const pip = n > 0 ? h('button', { class: 'voice-pip', type: 'button', 'aria-label': `${n} more ${n === 1 ? 'matter waits' : 'matters wait'}: open the accounts`,
      onclick: own(() => this.onAwaiting?.()) }, h('span', null, `+${n}`)) : null;
    const act = voiceAction(item, s);
    let chip: HTMLElement;
    if (act) {
      const off = act.kind === 'remedy' && !act.ok;
      chip = h('button', { class: `btn small primary voice-chip${off ? ' is-off' : ''}`, type: 'button', 'aria-disabled': off ? 'true' : null,
        onclick: own(() => this.runAction(act)) }, act.label);
      if (off && act.kind === 'remedy') tip(chip, act.reason);
    } else {
      chip = h('button', { class: 'voice-fold', type: 'button', 'aria-label': 'Show or hide the counsel', 'aria-expanded': String(this.open),
        onclick: (e: Event) => { e.stopPropagation(); this.toggleOpen(); } }, '▾');
    }
    return h('div', { class: 'voice-acts' }, pip, chip);
  }

  /** The voice line's chip: a remedy runs (one that cannot says why, as the tray's rows and the card's buttons do: a
   *  dimmed chip's tap is a refusal with its reason, never a start), a tab opens part-way, a lesson shows (and its card
   *  folds), the dispatch unfolds. */
  private runAction(a: VoiceAction): void {
    const g = this.g;
    switch (a.kind) {
      case 'remedy':
        if (!a.ok) { g.act({ ok: false, code: 'locked', reason: a.reason }); return; }
        g.applyRemedy(a.remedy);
        return;
      case 'open': g.openTab(a.tab, a.anchor, 'chip'); return;
      case 'event': if (!this.onRead?.()) g.openTab('council', 'choice', 'chip'); return;
      case 'begin': g.act(beginNextLesson(g.state)); return;
      case 'lesson': {
        const l = LESSONS.find((x) => x.id === a.lesson);
        if (!l) return;
        showLesson(g, l);
        // on a phone the card folds into its line once it has shown where the job is: the tab (or the map, the frame)
        // takes the panel's room. A lesson whose card carries its job (on the SHEET) stays open
        const host = currentHost();
        if (isPhone(host) && this.open && !(host === 'sheet' && CARD_LESSONS.includes(l.id))) this.toggleOpen();
        return;
      }
    }
  }

  private portraitBtn(a: AdvisorId): HTMLElement {
    const g = this.g;
    const s = g.state;
    const def = ADVISOR_DEFS[a];
    if (!s.guidance.appointed.includes(a)) {
      const el = h('span', { class: 'counsel-pt vacant' }, img(portrait('silhouette'), 1));
      tip(el, `${def.office} · ${APPOINTED_AT[a] ?? 'Not yet appointed'}`);
      return el;
    }
    const worst = activeAdvisories(s).filter((x) => x.advisor === a).reduce((m, x) => Math.max(m, x.memo.sev), -1);
    const el = h('button', { class: 'counsel-pt', 'aria-label': `${def.office}: open the advisors`, onclick: () => { g.sfx('click'); g.openTab('advisors', a, 'chip'); } },
      img(portrait(a, advisorMood(s, a)), 1), worst >= 1 ? h('i', { class: `pip sev-bg-${worst}` }) : null);
    tip(el, () => {
      const n = activeAdvisories(g.state).filter((x) => x.advisor === a).length;
      return `${def.office} · ${def.name}\n${def.domain}.\n${n ? `${n} ${n === 1 ? 'matter' : 'matters'} to raise.` : 'Quiet.'}`;
    });
    return el;
  }

  private calm(): HTMLElement {
    const g = this.g;
    const line = h('span');
    const set = (): void => {
      const f = forecast(g.state);
      const m = currentMilestone(g.state);
      const cur = currentLesson(g.state);
      const lesson = cur ? LESSONS[cur.index + 1] : undefined;   // in a breather between lessons: what comes next
      const next = lesson ? ` Next lesson: ${lesson.title}.` : m ? ` Next: ${m.text}.` : ' The council is content.';
      line.textContent = `All is well: grain ${fmtDays(f.grain.doh)}, water ${fmtDays(f.water.doh)}.${next}`;
    };
    set();
    this.refresh = set;
    return h('div', { class: 'counsel-calm' }, img('i_seal', 1, 'counsel-seal'), line);
  }

  private tipCard(t: GuideStep): HTMLElement {
    const g = this.g;
    const s = g.state;
    const text = h('p', { class: 'counsel-text' }, t.text(s));
    this.refresh = () => { text.textContent = t.text(g.state); };
    const notes = s.counters.mentorDiedDay !== null;
    const done = (): void => { this.open = false; g.act(dismissTip(g.state, t.id), { okSfx: 'click' }); };
    const showMe = t.tab || t.target ? h('button', { class: 'btn small', onclick: () => {
      g.sfx('click');
      if (t.tab) g.openTab(t.tab, undefined, 'chip');
      if (t.target) { bringTarget(t.target); pulseTarget(t.target); }
    } }, 'Show me') : null;
    return h('div', { class: `counsel-card tip${t.urgent ? ' urgent' : ''}`, role: 'note' },
      h('div', { class: 'counsel-head', onclick: () => this.toggleOpen() }, img(portrait(notes ? 'notes' : 'mentor'), 2, 'counsel-face'),
        h('div', { class: 'counsel-who' }, h('span', { class: 'counsel-kicker' }, mentorKicker(s)), h('span', { class: 'counsel-title' }, t.title))),
      h('div', { class: 'counsel-body' }, text,
        h('div', { class: 'counsel-actions' },
          h('button', { class: 'btn small primary', onclick: done }, 'Understood'), showMe,
          t.urgent ? null : h('button', { class: 'counsel-link', onclick: () => { g.setPref('tips', false); } }, 'Hide tips'))));
  }

  /** An opening lesson (§11.13): the reason and the job (with its progress), and what comes after; once done, the
   *  payoff, the next lesson's name and "Begin now", so the breather is never an empty wait. */
  private lessonCard(x: Extract<CounselItem, { kind: 'lesson' }>): HTMLElement {
    const g = this.g;
    const s = g.state;
    const l = x.l;
    const next = LESSONS[x.index + 1];
    const text = h('p', { class: 'counsel-text' }, x.done ? l.reward : l.text(s));
    const prog = !x.done ? l.progress?.(s) ?? null : null;
    const job = h('div', { class: `lesson-job${x.done ? ' done' : ''}` }, h('span', { class: 'lesson-box', 'aria-hidden': 'true' }, x.done ? '✓' : ''),
      h('span', null, l.job), prog ? h('span', { class: 'lesson-prog' }, prog) : null);
    const show = (): void => {
      g.sfx('click');
      showLesson(g, l);
    };
    const skip = h('button', { class: 'counsel-link', onclick: () => {
      if (!this.skipArmed) { this.skipArmed = true; skip.textContent = 'Skip every lesson?'; return; }
      this.skipArmed = false;
      g.act(skipIntro(g.state), { okSfx: 'click' });
    } }, 'Skip the lessons');
    let acts: HTMLElement;
    if (x.done) {
      acts = h('div', { class: 'counsel-actions' },
        next ? h('button', { class: 'btn small primary', onclick: () => { g.act(beginNextLesson(g.state)); } }, 'Begin now') : null,
        h('span', { class: 'lesson-next' }, next ? `Next: ${next.title}` : 'The lessons are done.'));
    } else if (l.id === 'ordo' && pendingOffers(s).length) {
      // the Ordo's lesson: the duties learned so far, each to hand over here; or keep them all (Edicta can later)
      acts = h('div', { class: 'counsel-actions' },
        pendingOffers(s).map((d) => h('button', { class: 'btn small primary', onclick: () => { g.act(setDuty(g.state, d, true), { okSfx: 'click' }); } },
          `Hand over: ${DUTY_DEFS[d].name}`)),
        h('button', { class: 'counsel-link', onclick: () => { g.act(keepDuties(g.state), { okSfx: 'click' }); } }, 'Keep them all mine'),
        skip);
    } else {
      acts = h('div', { class: 'counsel-actions' },
        l.tab || l.target ? h('button', { class: 'btn small primary lesson-show', onclick: show }, 'Show me') : null,
        x.stuck ? h('button', { class: 'counsel-link', onclick: () => { g.act(skipLesson(g.state), { okSfx: 'click' }); } }, 'Skip this step') : null,
        skip);
    }
    const then = !x.done && next ? h('div', { class: 'lesson-then' }, `Then: ${next.title}`) : null;
    if (x.nudge && !x.done) { const glow = lessonPointer(l).glow ?? (l.tab ? `#tab-${l.tab}` : null); if (glow) pulseTarget(glow); }
    // the phone carries the job's own row in the card (CARD_LESSONS): lesson I's hands go on the fields here, ± held to
    // repeat, without opening Populus
    const cat = currentHost() === 'sheet' && !x.done && CARD_LESSONS.includes(l.id) ? CARD_LABOUR[l.id] : undefined;
    const labour = cat ? h('div', { class: 'lesson-labour' }, labourEl(g, this.live, [cat])) : null;
    const notes = s.counters.mentorDiedDay !== null;
    const kicker = h('span', { class: 'counsel-kicker' }, glueKicker(`DISCIPLINA · ${toRoman(x.index + 1)} / ${toRoman(LESSONS.length)}`));
    const title = h('span', { class: 'counsel-title' }, l.title);
    // the phone's voice line: 'DISCIPLINA · I / X' and the job's count (1 of 4, 41%) over the title; the job line itself
    // heads the unfolded card under it
    const count = prog ? /\d+ of \d+|\d+%/.exec(prog)?.[0] : undefined;
    const who = voiceLine(currentHost())
      ? h('div', { class: 'counsel-who' }, h('div', { class: 'counsel-krow' }, kicker, count ? h('span', { class: 'voice-prog' }, count) : x.done ? h('span', { class: 'voice-prog done' }, '✓') : null), title)
      : h('div', { class: 'counsel-who' }, kicker, title);
    return h('div', { class: `counsel-card tip lesson${x.done ? ' done' : ''}${x.nudge ? ' nudge' : ''}`, role: 'note' },
      h('div', { class: 'counsel-head', onclick: () => this.toggleOpen() }, img(portrait(notes ? 'notes' : 'mentor'), 2, 'counsel-face'), who),
      h('div', { class: 'counsel-body' }, text, job, labour, acts, then));
  }

  /** A dispatch to answer, as the phone's voice line (DESIGN §15.7): its kicker ('NVNTIVS · VETERANI AD PORTAM') and the
   *  days left over its title, and Read (voiceAction), which opens the event card in the sheet's slot (choice.ts); a tap
   *  on the line reads it too. The days count down once a day. */
  private eventCard(c: PendingChoice): HTMLElement {
    const g = this.g;
    const days = h('span', { class: 'voice-prog voice-days num' });
    const tick = (): void => {
      const d = Math.max(0, c.expires - g.state.day);
      days.textContent = `${d} d`;
      days.classList.toggle('bad', d <= B.advisors.RULES.CHOICE_SOON);
    };
    tick();
    this.refresh = tick;
    const read = (): void => { g.sfx('click'); if (!this.onRead?.()) g.openTab('council', 'choice', 'chip'); };
    return h('div', { class: 'counsel-card event', role: 'alert' },
      h('div', { class: 'counsel-head', onclick: read }, img('f_seal', 2, 'counsel-face'),
        h('div', { class: 'counsel-who' }, h('div', { class: 'counsel-krow' }, h('span', { class: 'counsel-kicker' }, glueKicker(caps(c.kicker))), days),
          h('span', { class: 'counsel-title' }, c.title))));
  }

  /** Duties the player has learned (§10.2): each to hand to the Ordo or keep; Edicta's Mandata can change it later. */
  private offerCard(duties: DutyId[]): HTMLElement {
    const g = this.g;
    const s = g.state;
    const one = duties.length === 1 ? DUTY_DEFS[duties[0]] : null;
    const text = one ? `${one.done} From now on the Ordo can see to ${one.does} for you, even while you sleep.`
      : 'You have learned these chores by your own hand. The Ordo can carry any of them for you, even while you sleep.';
    const rows = duties.map((d) => h('div', { class: 'counsel-rem duty' },
      h('div', { class: 'counsel-rem-main' }, h('span', { class: 'counsel-rem-name' }, DUTY_DEFS[d].name),
        h('div', { class: 'counsel-rem-btns' },
          h('button', { class: 'btn small primary', onclick: () => { g.act(setDuty(g.state, d, true), { okSfx: 'click' }); } }, 'Hand to the Ordo'),
          h('button', { class: 'btn small', onclick: () => { g.act(keepDuties(g.state, [d]), { okSfx: 'click' }); } }, 'Keep it mine')))));
    const notes = s.counters.mentorDiedDay !== null;
    return h('div', { class: 'counsel-card tip offer', role: 'note' },
      h('div', { class: 'counsel-head', onclick: () => this.toggleOpen() }, img(portrait(notes ? 'notes' : 'mentor'), 2, 'counsel-face'),
        h('div', { class: 'counsel-who' }, h('span', { class: 'counsel-kicker' }, 'MANDATA'),
          h('span', { class: 'counsel-title' }, one ? `The Ordo can take up ${one.name.toLowerCase()}` : 'The Ordo can take up your chores'))),
      h('div', { class: 'counsel-body' }, h('p', { class: 'counsel-text' }, text), h('div', { class: 'counsel-remedies' }, rows),
        h('div', { class: 'counsel-foot' },
          h('span', { class: 'counsel-name' }, 'Edicta · Mandata keeps them all'),
          duties.length > 1 ? h('button', { class: 'counsel-link', onclick: () => { g.act(handOverAll(g.state, duties), { okSfx: 'click' }); } }, 'Hand over all') : null,
          duties.length > 1 ? h('button', { class: 'counsel-link', onclick: () => { g.act(keepDuties(g.state), { okSfx: 'click' }); } }, 'Keep them all') : null)));
  }

  private advisoryCard(a: ActiveAdvisory): HTMLElement {
    const g = this.g;
    const s = g.state;
    const def = ADVISOR_DEFS[a.advisor];
    const sev = a.memo.sev;
    const opp = a.rule === OPPORTUNITAS;
    const r = renderAdvisory(s, view(s), a);
    const title = h('span', { class: 'counsel-title' }, r.title);
    const text = h('p', { class: 'counsel-text' }, r.text);
    const metric = a.memo.metric ? h('span', { class: `chip counsel-metric sev-c${sev}` }, dangerLabel(a)) : null;
    this.refresh = () => {
      const st = g.state;
      const live = activeAdvisories(st).find((x) => x.rule === a.rule);
      if (!live) return;
      const rr = renderAdvisory(st, view(st), live);
      title.textContent = rr.title;
      text.textContent = rr.text;
      if (metric) metric.textContent = dangerLabel(live);
    };
    // the phone's voice line keeps its kicker to one row beside the chip: the office by its last word ('Praefectus
    // Annonae' → ANNONAE, 'Curator Aquarum' → AQVARVM); sheet.css cuts what still does not fit
    const office = voiceLine(currentHost()) ? def.office.split(' ').pop() ?? def.office : def.office;
    const kicker = `${opp ? 'OPPORTVNITAS' : caps(SEV_NAME[sev])} · ${caps(office)}`;
    return h('div', { class: `counsel-card adv sev-${sev}${opp ? ' opp' : ''}`, role: sev >= 2 ? 'alert' : 'note' },
      h('div', { class: 'counsel-head', onclick: () => this.toggleOpen() }, img(portrait(a.advisor, advisorMood(s, a.advisor)), 2, 'counsel-face'),
        h('div', { class: 'counsel-who' }, h('div', { class: 'counsel-krow' }, h('span', { class: 'counsel-kicker' }, glueKicker(kicker)), metric), title)),
      h('div', { class: 'counsel-body' }, text, this.remedies(r.remedies),
        h('div', { class: 'counsel-foot' },
          h('span', { class: 'counsel-name' }, def.name),
          sev < 3 && !opp ? h('button', { class: 'counsel-link', onclick: () => { g.act(hush(g.state, a.rule), { okSfx: 'click' }); } }, `Hush ${B.advisors.HUSH_DAYS} d`) : null,
          sev === 0 ? h('button', { class: 'counsel-link', onclick: () => { g.act(mute(g.state, a.rule), { okSfx: 'click' }); } }, 'Mute') : null)));
  }

  /** Up to three remedy groups; a building remedy renders as Ask the Ordo + Place it myself (only the latter with Ordo building off). */
  private remedies(list: { remedy: Remedy; label: string; check: ActionResult }[]): HTMLElement {
    const g = this.g;
    const s = g.state;
    const rows: HTMLElement[] = [];
    const seen = new Set<BuildingId>();
    for (const x of list) {
      if (rows.length >= 3) break;
      const rem = x.remedy;
      if (rem.kind === 'ask' || rem.kind === 'place') {
        if (seen.has(rem.building)) continue;
        seen.add(rem.building);
        const place: Remedy = rem.kind === 'place' ? rem : list.find((y) => y.remedy.kind === 'place' && y.remedy.building === rem.building)?.remedy ?? { kind: 'place', building: rem.building };
        const ask: Remedy = { kind: 'ask', building: rem.building };
        const btns = [s.ordo.on.build ? this.remedyBtn(ask, 'Ask the Ordo', checkRemedy(s, ask), true) : null, this.remedyBtn(place, 'Place it myself', checkRemedy(s, place), false)];
        const sprite = rem.building === 'area' ? 'h_tentoria_0' : `b_${rem.building}`;
        rows.push(h('div', { class: 'counsel-rem build' }, img(sprite, 1, 'counsel-rem-ico'),
          h('div', { class: 'counsel-rem-main' }, h('span', { class: 'counsel-rem-name' }, BUILDING_DEFS[rem.building].name), h('div', { class: 'counsel-rem-btns' }, btns))));
      } else {
        rows.push(h('div', { class: 'counsel-rem' }, this.remedyBtn(rem, x.label, x.check, rows.length === 0)));
      }
    }
    return h('div', { class: 'counsel-remedies' }, rows);
  }

  private remedyBtn(r: Remedy, label: string, check: ActionResult, primary: boolean): HTMLElement {
    const g = this.g;
    const btn = h('button', { class: primary ? 'btn small primary' : 'btn small', disabled: !check.ok, onclick: () => { g.sfx('click'); g.applyRemedy(r); } }, label);
    if (check.ok) return btn;
    const why = h('span', { class: 'counsel-why' }, check.reason);
    const wrap = h('span', { class: 'counsel-btnwrap' }, btn, why);
    tip(wrap, check.reason);
    return wrap;
  }
}

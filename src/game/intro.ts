// src/game/intro.ts — the opening lessons (DESIGN §11.13): the colony's systems arrive one at a time, each with a small
// job the player does by hand. A lesson brings the parts of the interface its job needs; once the job is done, the next
// lesson waits a breather of real play time (stats.playMs: never game days, so speeding up does not rush the player).
// A colony with the lessons is run by hand (ordo/duties.ts, DESIGN §10.2): each job teaches a duty, and the Ordo's
// lesson asks the player to hand it one of the duties they have learned. This module only says what the player is shown:
// everything else the colony does stays as it is, and the UI asks reveal.ts too (a tab shows when reveal.ts reveals it
// and a lesson brought it).
import { B } from './balance';
import { DUTIES } from './types';
import type { ActionResult, BuildingId, GameState, PracticeId, TabId, TipId } from './types';
import { census } from './census';
import { granted, learnAll } from './ordo/duties';

/** A part of the interface a lesson brings: a HUD chip or widget, the faster speeds, or a side-panel tab. */
export type IntroPart = 'ticker' | 'portraits' | 'souls' | 'coin' | 'materials' | 'goals' | 'dignitas' | 'overlays' | 'speed'
  | 'catalog'   // every work in Aedificia, with the tools, the categories and the Ordo's buttons (before: the taught works only)
  | 'mandates'  // the duties in Edicta: what the Ordo holds, what the player has learned (before: none)
  | 'edicts'    // all of Edicta: focus, edicts, settings, switches (before: the duties and the charter alone)
  | TabId;
export type LessonId = 'fields' | 'water' | 'homes' | 'ordo' | 'charter' | 'advisors' | 'speed' | 'works' | 'overlays' | 'edicts';

/** One opening lesson: the mentor's words, the job, the parts it brings and the breather after it. */
export interface Lesson {
  id: LessonId;
  title: string;
  text(s: GameState): string;          // one reason and one imperative, about a dozen words (DESIGN §11.13)
  job: string;                         // the job as a checkbox line
  done(s: GameState): boolean;         // the job concluded: a work raised, not only staked; a speed chosen …
  progress?(s: GameState): string | null;   // the job under way ("Rising · 41%")
  brings: readonly IntroPart[];        // shown from the moment the lesson begins: what the job needs (≤ 3)
  rewardBrings?: readonly IntroPart[]; // shown once the job is done, as its reward
  reward: string;                      // the payoff, said when the job is done
  breather: number;                    // real seconds of play after the job before the next lesson ("Begin now" skips it)
  tab?: TabId; anchor?: string; target?: string;   // "Show me", also run when the lesson begins
  find?: true;                         // the job is to open `tab`: Show me points at its button, the click stays the player's
}

const practised = (p: PracticeId) => (s: GameState): boolean => s.guidance.intro.practice.includes(p);
/** The player's own works of `type` (placed by hand: not the Ordo's, nor a request the Ordo raised for them). */
const mine = (s: GameState, type: string) => s.buildings.filter((b) => b.type === type && b.owner === 'player' && b.reason?.code !== 'request');
/** A work of `type` the player placed and saw raised: the payoff is part of the job. */
const raised = (type: string) => (s: GameState): boolean => mine(s, type).some((b) => b.status === 'done');
/** How far the player's work of `type` has come, while it rises. */
const rising = (type: string) => (s: GameState): string | null => {
  const b = mine(s, type).find((x) => x.status !== 'done');
  if (!b) return null;
  if (b.status === 'plan') return 'Planned: waiting for the coin and materials';
  if (b.status === 'staked') return 'Staked: builders come soon';
  return `Rising · ${Math.min(99, Math.floor(100 * b.progress))}%`;
};

/** The opening lessons in order (DESIGN §11.13). Each ends on something the player does or sees happen, never on
 *  "Understood": reading alone teaches little. */
export const LESSONS: readonly Lesson[] = [
  {
    id: 'fields', title: 'Hands to the fields',
    text: () => 'Our grain falls every day. Put more hands on the fields.',
    job: 'Put hands on the fields', done: (s) => census(s).catStaffed.food >= B.intro.FIELD_HANDS,
    progress: (s) => `Hands on the fields: ${census(s).catStaffed.food} of ${B.intro.FIELD_HANDS}`, brings: ['people'],
    reward: 'The grain climbs. Who works where is yours to choose.',
    breather: 40, tab: 'people', anchor: 'labour', target: '.tab-lab[data-cat="food"]',
  },
  {
    id: 'water', title: 'Water for the dry season',
    text: () => 'Our one well will not last the summer. Raise a cistern.',
    job: 'Raise a cistern', done: raised('cisterna'), progress: rising('cisterna'), brings: ['build', 'coin', 'materials'],
    reward: 'Its rain will carry us through Aestas. Watch the water days climb.',
    breather: 45, tab: 'build', anchor: 'b-cisterna',
  },
  {
    id: 'homes', title: 'Beds for newcomers',
    text: () => 'Rome sends families only to free beds. Lay out a house plot.',
    job: 'Lay out a house plot', done: raised('area'), progress: rising('area'), brings: ['souls'],
    reward: 'New beds stand ready. Souls and beds now show above.',
    breather: 45, tab: 'build', anchor: 'b-area',
  },
  {
    id: 'ordo', title: 'The Ordo takes up the work',
    text: () => 'The Ordo can take up any chore you have mastered. Hand it one.',
    job: 'Hand the Ordo a duty',
    done: (s) => s.ordo.answered.length > 0 || DUTIES.some((d) => granted(s, d)) || s.ordo.learned.length === 0,   // none learned: nothing to hand
    brings: ['ticker', 'council', 'mandates'],
    reward: 'It works in your name, even while you sleep. Take a duty back anytime.',
    breather: 45, tab: 'council', anchor: 'mandates',
  },
  {
    id: 'charter', title: 'The founding law',
    text: () => 'Rome awaits our founding law. Choose it in Edicta: it is for good.',
    job: 'Proclaim the charter', done: (s) => s.decisions.paths.charter !== undefined, brings: ['goals'],
    rewardBrings: ['dignitas'],
    reward: 'Our first deed. The laurel above is Rome\'s regard: works, homes and deeds raise it.',
    breather: 45, tab: 'council', target: '.path-card',
  },
  {
    id: 'advisors', title: 'Your advisors',
    text: () => 'Advisors warn of trouble, each with a remedy. Hear them out.',
    job: 'Open the advisors', done: practised('advisors'), brings: ['portraits', 'advisors'],
    reward: 'A portrait with a pip has something to say.',
    breather: 40, tab: 'advisors', find: true,
  },
  {
    id: 'speed', title: 'Time is yours',
    text: () => 'Hurry the days when all is well, or pause to think.',
    job: 'Choose a faster speed', done: practised('speed'), brings: ['speed'],
    reward: 'Space pauses; 1 to 4 set the speed.',
    breather: 40, target: '#speed',
  },
  {
    id: 'works', title: 'Every work is yours',
    text: () => 'All of Rome\'s works are open to you now. Raise one of your choosing.',
    job: 'Place a work you choose', done: (s) => s.buildings.some((b) => b.owner === 'player' && !TAUGHT.includes(b.type) && b.reason?.code !== 'request'),
    brings: ['catalog'], reward: 'Each kind of work you raise, the Ordo can learn to raise.', breather: 40, tab: 'build',
  },
  {
    id: 'overlays', title: 'Maps of the land',
    text: () => 'Lay a map over the land: water, soil, what houses lack.',
    job: 'Open a map overlay', done: practised('overlay'), brings: ['overlays'],
    reward: 'Placing a work picks the right map by itself.', breather: 40, target: '#overlay-bar',
  },
  {
    id: 'edicts', title: 'The council\'s course',
    text: () => 'The council takes standing orders from you. Change one in Edicta.',
    job: 'Change an edict or order', done: practised('edict'), brings: ['edicts'], rewardBrings: ['annals'],
    reward: 'The Annales keep our story. The colony is yours now, Praefecte.', breather: 8, tab: 'council', anchor: 'focus',
  },
];

/** The works the lessons ask for by hand, in order, each in plain words: until the full list opens, Aedificia offers
 *  only these, without the numbers (those come with the full list). */
const PLAIN: Partial<Record<BuildingId, string>> = {
  cisterna: 'Catches rain to drink through the dry summer.',
  area: 'Beds for new families: tents at first, homes later.',
};
const TAUGHT: readonly string[] = Object.keys(PLAIN);

/** A taught work in plain words, for its card while the lessons run. */
export function plainWork(type: BuildingId): string | undefined {
  return PLAIN[type];
}

/** The mentor's tips the lessons teach in their place: read once the lessons end, so they are not told twice. */
export const INTRO_TIPS: readonly TipId[] = ['welcome', 'vitals', 'ordo', 'counsel', 'speed', 'build', 'charter', 'edicts'];
/** The lesson that brings each part, and whether it comes as the lesson's reward (once its job is done). */
const BROUGHT = new Map<IntroPart, { at: number; reward: boolean }>();
LESSONS.forEach((l, i) => {
  for (const p of l.brings) if (!BROUGHT.has(p)) BROUGHT.set(p, { at: i, reward: false });
  for (const p of l.rewardBrings ?? []) if (!BROUGHT.has(p)) BROUGHT.set(p, { at: i, reward: true });
});

/** The works Aedificia offers while the full list is not yet open: those the lessons so far have asked for. */
export function taughtWorks(s: GameState): BuildingId[] {
  const it = s.guidance.intro;
  const upto = it.lesson < 0 ? LESSONS.length - 1 : it.lesson;
  return LESSONS.slice(0, upto + 1).map((l) => l.anchor).filter((a): a is string => !!a && a.startsWith('b-')).map((a) => a.slice(2) as BuildingId);
}

/** What "Show me" does for a lesson: open its tab on its anchor and glow its target, or, when the job is to find the
 *  tab, glow the tab's button only. */
export function lessonPointer(l: Lesson): { open: TabId | null; anchor?: string; glow: string | null } {
  if (l.find && l.tab) return { open: null, glow: `#tab-${l.tab}` };
  return { open: l.tab ?? null, anchor: l.anchor, glow: l.target ?? null };
}

/** Whether the opening lessons run. */
export function introRunning(s: GameState): boolean {
  return s.guidance.intro.lesson >= 0;
}

/** Whether `part` shows: no lesson runs, or the current lesson (or an earlier one) brought it. */
export function introduced(s: GameState, part: IntroPart): boolean {
  const it = s.guidance.intro;
  if (it.lesson < 0) return true;
  const b = BROUGHT.get(part);
  return b === undefined || b.at < it.lesson || (b.at === it.lesson && (!b.reward || it.done));
}

/** Whether a part is one the lessons bring at all (the rest show as they always did). */
export function introBrings(part: IntroPart): boolean {
  return BROUGHT.has(part);
}

/** The current lesson, its index and state, or null when none runs. */
export function currentLesson(s: GameState): { lesson: (typeof LESSONS)[number]; index: number; done: boolean } | null {
  const it = s.guidance.intro;
  if (it.lesson < 0 || it.lesson >= LESSONS.length) return null;
  return { lesson: LESSONS[it.lesson], index: it.lesson, done: it.done };
}

/** Real play time (ms) since the current lesson began, or since its job was done. */
export function lessonAge(s: GameState): number {
  return Math.max(0, s.stats.playMs - s.guidance.intro.at);
}

/** What changed on this call: the job just got done, a new lesson began, or the lessons ended. */
export type IntroStep = 'done' | 'next' | 'end' | null;

/** Advances the lessons (called every frame with the live colony): marks the job done, and after the breather begins
 *  the next lesson. */
export function introStep(s: GameState): IntroStep {
  const it = s.guidance.intro;
  let step: IntroStep = null;
  if (it.lesson >= 0 && it.lesson < LESSONS.length) {
    const l = LESSONS[it.lesson];
    if (!it.done && l.done(s)) {
      it.done = true;
      it.at = s.stats.playMs;
      step = 'done';
    } else if (it.done && lessonAge(s) >= l.breather * 1000) {
      it.lesson++;
      it.done = false;
      it.at = s.stats.playMs;
      it.practice = [];
      if (it.lesson >= LESSONS.length) { finish(s); step = 'end'; } else step = 'next';
    }
  }
  return step;
}

/** The lessons end: the tips they taught are read, and every part shows. */
function finish(s: GameState): void {
  const it = s.guidance.intro;
  it.lesson = -1;
  it.done = false;
  it.practice = [];
  s.guidance.tipAt = s.stats.playMs;   // the mentor's tips resume after a quiet spell, not on the heels of the last lesson
  for (const t of INTRO_TIPS) if (!s.guidance.tips.includes(t)) s.guidance.tips.push(t);
}

/** The UI notes a job done by hand (a speed chosen, an overlay opened, the advisors heard). */
export function notePractice(s: GameState, p: PracticeId): ActionResult {
  const it = s.guidance.intro;
  if (it.lesson < 0) return { ok: true };
  if (!it.practice.includes(p)) it.practice.push(p);
  return { ok: true };
}

/** "Begin now": the player pulls the next lesson in before its breather is over. */
export function beginNextLesson(s: GameState): ActionResult {
  const it = s.guidance.intro;
  if (it.lesson < 0 || !it.done) return { ok: false, code: 'invalid', reason: 'No lesson is waiting.' };
  it.at = s.stats.playMs - LESSONS[it.lesson].breather * 1000;
  introStep(s);
  return { ok: true };
}

/** "Skip this step" (offered once a job has waited B.intro.STUCK_S): the job counts as done, so no lesson traps the player. */
export function skipLesson(s: GameState): ActionResult {
  const it = s.guidance.intro;
  if (it.lesson < 0 || it.done) return { ok: false, code: 'invalid', reason: 'No lesson to skip.' };
  it.done = true;
  it.at = s.stats.playMs;
  return { ok: true };
}

/** Skips the lessons: every part shows, every duty counts as learned (the player knows the camp: theirs to hand to the
 *  Ordo, which the counsel offers at once), and the tips the lessons would have taught count as read. */
export function skipIntro(s: GameState): ActionResult {
  if (s.guidance.intro.lesson >= 0) learnAll(s);
  finish(s);
  return { ok: true };
}

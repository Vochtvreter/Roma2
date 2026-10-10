// src/game/guide.ts — the mentor's tips (Decimus Cassius) (ARCHITECTURE §8.6, DESIGN §11.7). Owner: WP-E.
// Ported from IdleSettlement's GuideStep engine: each tip shows once per colony; list order is priority; a tip is due
// when its `after` tip has been seen, its `when` holds and its `until` does not; `until` also prunes unseen tips — but
// never an urgent one, whose `until` only says "not now" (founding grain is above the starving tip's 20 days, and
// pruning it on the first tick meant it could never warn of a famine later).
// Text is generated from state and data (names, days, options), never from stale copy.
import { B } from './balance';
import { TIPS } from './types';
import type { ActionResult, GameState, GuideStep, TipId } from './types';
import { elapsed, seasonOf } from './calendar';
import { forecast } from './forecast';
import { derived } from './derived';
import { seasonMult } from './economy';
import { petitionNeeds } from './decisions';
import { milestoneDone } from './objectives';
import { sectionRevealed, tabRevealed } from './reveal';
import { view } from './sim';
import { activeAdvisories } from './advisors/engine';
import { blockedHouses, days, fractionWord, listJoin, needWord, rankWord, runway, wasAway } from './advisors/util';
import { ADVISOR_DEFS, MENTOR } from './data/advisors';
import { BUILDING_DEFS } from './data/buildings';
import { PATH_DEFS } from './data/decisions';

const G = B.guide;
const AESTAS = 1, AUTUMNUS = 2, HIEMS = 3;
const OPPIDUM = 2, MUNICIPIUM = 3;
const GROUPS = ['the children', 'the youths', 'the adults', 'the elders'] as const;

/** Days of grain or water on hand today (from the day's forecast). */
function doh(s: GameState, res: 'grain' | 'water'): number {
  return forecast(s)[res].doh;
}

/** An advisory's current severity, or −1 when it is not raised. */
function sev(s: GameState, rule: 'annonae.hiems.forecast' | 'aquarum.aestas.forecast'): number {
  const m = s.guidance.advisories[rule];
  return m?.active ? m.sev : -1;
}

/** The houses whose next tier has waited ≥ WANTS_BLOCKED days on something the city can give (not a charter). */
function blocked(s: GameState): ReturnType<typeof blockedHouses> {
  return blockedHouses(s, view(s), G.WANTS_BLOCKED).filter((w) => w.want !== 'rank');
}

/** The mentor's tips in priority order (DESIGN §11.7). */
export const GUIDE: GuideStep[] = [
  {
    id: 'welcome', title: 'Salve, Praefecte',
    text: (s) => `I am ${MENTOR.name}, once ${MENTOR.title.replace(/ emeritus$/, '')}. The Ordo runs ${s.name} day by day, even while you sleep. `
      + 'You set its course, and you may build whatever you like yourself. I will speak when something new matters.',
    when: () => true,
  },
  // ─────────── urgent, whenever they happen ───────────
  {
    id: 'starving', title: 'The bellies are empty', urgent: true, after: 'welcome', target: '#vital-grain',
    text(s) {
      const h = s.needs.hunger;
      const worst = h.indexOf(Math.max(...h));
      return `${GROUPS[worst].charAt(0).toUpperCase()}${GROUPS[worst].slice(1)} go hungry, and grain lasts ${days(doh(s, 'grain'))}. `
        + 'The Ordo cuts rations before anyone starves. Raise fields, buy grain, or set rations yourself in Edicta.';
    },
    when: (s) => s.needs.hunger.some((x) => x > G.STARVING),
    until: (s) => doh(s, 'grain') > G.STARVING_UNTIL,
  },
  {
    id: 'thirst', title: 'The amphorae run dry', urgent: true, after: 'welcome', target: '#vital-water',
    text(s) {
      const w = forecast(s).water;
      const office = ADVISOR_DEFS.aquarum.office.split(' ')[0];
      return `Water lasts ${days(runway(w.stock, w.net3) ?? w.doh)}. A well by the river draws best. The ${office}'s card has a remedy.`;
    },
    when(s) {
      const w = forecast(s).water;
      const r = runway(w.stock, w.net3);
      return r !== null && r < G.THIRST_R;
    },
    until: (s) => doh(s, 'water') > G.THIRST_UNTIL,
  },
  {
    id: 'event', title: 'A dispatch arrives', urgent: true, after: 'welcome', target: '#choice',
    text(s) {
      const c = s.choice;
      const opt = c ? c.options[c.defaultIndex] : undefined;
      const left = c ? ` ${days(c.expires - s.day)} remain.` : '';
      return `Decide before the timer ends, or the Ordo takes the cautious path${opt ? `: ${opt.label}` : ''}.${left}`;
    },
    when: (s) => s.choice !== null,
  },
  {
    id: 'petition', title: 'Petition to Rome', urgent: true, after: 'welcome', target: '.path-card', tab: 'council',
    text(s) {
      const pn = petitionNeeds(s, view(s));
      const to = pn?.rank !== null && pn?.rank !== undefined ? ` for ${rankWord(pn.rank)}` : '';
      return `Every requirement${to} is met. The path you choose is permanent and shapes the town.`;
    },
    when(s) {
      const pn = petitionNeeds(s, view(s));
      return pn !== null && pn.ready && pn.rank !== null;
    },
    until: (s) => s.rank >= 1,
  },
  // ─────────── the first days ───────────
  {
    id: 'vitals', title: 'Two numbers keep us alive', after: 'welcome', target: '#vital-grain',
    text: (s) => `Grain and Water, counted in days: ${days(doh(s, 'grain'))} and ${days(doh(s, 'water'))} today. `
      + 'The strip beneath each shows the year ahead: Aestas is our thirsty season, Hiems our hungry one.',
    when: (s) => elapsed(s) >= G.VITALS,
  },
  {
    id: 'ordo', title: 'The Ordo explains itself', after: 'vitals', target: '#ticker',
    text: () => 'This line says what the Ordo does and why. Disagree? Steer it in Edicta, or build yourself.',
    when: (s) => elapsed(s) >= G.ORDO,
  },
  {
    id: 'charter', title: 'Your first decision', after: 'ordo', target: '.path-card', tab: 'council',
    text: (s) => `By what law is ${s.name} founded? ${listJoin(PATH_DEFS.charter.options.map((o) => o.name))}: the charter is permanent.`,
    when: (s) => elapsed(s) >= G.CHARTER,
    until: (s) => s.decisions.paths.charter !== undefined,
  },
  {
    id: 'counsel', title: 'Your advisors', after: 'vitals', target: '#counsel',
    text(s) {
      const top = activeAdvisories(s, { forCard: true })[0];
      const now = top ? ` The ${ADVISOR_DEFS[top.advisor].office} speaks now.` : '';
      return `Each advisor keeps one part of the ledger and speaks only when something needs you.${now} Every warning comes with a remedy.`;
    },
    when: (s) => activeAdvisories(s, { forCard: true }).length > 0,
  },
  {
    id: 'speed', title: 'Time', after: 'charter', target: '#speed',
    text: () => 'One day passes each heartbeat. Speed it up, or pause to think: Space, 1–4.',
    when: (s) => elapsed(s) >= G.SPEED,
  },
  {
    id: 'build', title: 'Build with your own hands', after: 'speed', tab: 'build',
    text: () => 'Pick a work and a plot. Gold means a bonus; the laurel marks the Ordo\'s choice. Your works are raised first.',
    when: (s) => tabRevealed(s, 'build'),
    // a work the player placed: not a site the Ordo raised for an "Ask the Ordo" request or a pin (player-owned too),
    // nor the Capitolium
    until: (s) => s.buildings.some((b) => b.owner === 'player' && b.type !== 'capitolium' && b.reason?.code !== 'request' && b.reason?.code !== 'pin'),
  },
  {
    id: 'aestas', title: 'The thirsty season', after: 'welcome', target: '#vital-water',
    text: () => 'Cisterns catch little rain in Aestas and wells draw less. Fill the cisterns in Ver.',
    when: (s) => seasonOf(s.day) === AESTAS || sev(s, 'aquarum.aestas.forecast') >= 2,
  },
  {
    id: 'wants', title: 'What a house wants', after: 'build', target: '#overlay-bar',
    text(s) {
      const b = blocked(s);
      const first = b.find((w) => w.want !== null);
      const lead = first?.want ? `${b.length} ${b.length === 1 ? 'house waits' : 'houses wait'}; the first wants ${needWord(first.want)}. ` : '';
      // the shrine sentence only when a shrine is what the first house wants
      const r = BUILDING_DEFS.lararium.service?.[0].radius ?? 0;
      const shrine = first?.want === 'religion' ? ` A shrine within ${r} steps is often all it takes.` : '';
      return `${lead}Hover a house to see what it needs next, or open the Domus overlay.${shrine}`;
    },
    when: (s) => blocked(s).length > 0,
  },
  {
    id: 'autumn', title: 'Hiems is coming', after: 'welcome', target: '#vital-grain',
    text: (s) => `In Hiems our fields give ${fractionWord(seasonMult(s, 'ager', HIEMS))}. Open sheds hold weeks and rot; a Horreum keeps `
      + 'grain for months. If grain runs low the Ordo cuts rations before anyone starves.',
    when: (s) => seasonOf(s.day) === AUTUMNUS || sev(s, 'annonae.hiems.forecast') >= 1,
    until: (s) => (derived(s).counts.horreum ?? 0) > 0 && sev(s, 'annonae.hiems.forecast') < 0,
  },
  // ─────────── after the first milestones ───────────
  {
    id: 'edicts', title: 'Your first edict', after: 'charter', target: '[data-guide=edicts]', tab: 'council',
    text: () => 'Edicts trade one good for another. Each may change once a season; the window opens on the season\'s Kalends.',
    when: (s) => milestoneDone(s, 'fed30'),
  },
  {
    id: 'reins', title: 'Taking the reins', after: 'edicts', target: '[data-guide=manual]', tab: 'council',
    text: () => 'You may take labour, building or trade from the Ordo. Leaving it all to them works just as well.',
    when: (s) => sectionRevealed(s, 'manual'),
  },
  {
    id: 'trade', title: 'Caravans and contracts', after: 'edicts', tab: 'trade',
    text: () => 'Far markets pay more and sell cheaper, but take longer. A standing contract repeats on its own and pauses itself if it would hurt us.',
    when: (s) => tabRevealed(s, 'trade'),
    until: (s) => s.trade.contracts.some((c) => c.owner === 'player'),   // the Ordo's own contracts teach the player nothing
  },
  // ─────────── the town, when it comes about ───────────
  {
    id: 'fork', title: 'Insula or domus?', after: 'wants', target: '#overlay-bar',
    text: () => 'A stone house rises two ways: near shops and noise it becomes an insula, many hands for work; near gardens, temples and '
      + 'fountains a domus, few hands but rich taxes and prestige. Each house has a preference in its inspector.',
    when: (s) => s.rank >= OPPIDUM && s.buildings.some((b) => b.house?.tier === 'domusParva'),
  },
  {
    id: 'aqueduct', title: 'Water from the hills', after: 'trade', tab: 'build',
    text: () => 'Place a castellum in town; the arches find their own way from the spring.',
    when: (s) => s.rank >= MUNICIPIUM,
    until: (s) => s.buildings.some((b) => b.type === 'castellum'),
  },
  {
    id: 'away', title: 'The years passed', after: 'welcome', tab: 'annals',
    text: () => `Time away passes at half speed, up to ${Math.round(B.time.OFFLINE_MAX_DAYS / B.time.YEAR_DAYS)} years. The Ordo kept the city and wrote you this.`,
    when: (s) => wasAway(s),
  },
];

function seen(s: GameState, id: TipId): boolean {
  return s.guidance.tips.includes(id);
}

/** Marks unseen tips whose `until` already holds as seen, so they never show late; urgent tips are kept for their moment. */
export function pruneGuide(s: GameState): void {
  for (const g of GUIDE) if (!g.urgent && !seen(s, g.id) && g.until?.(s)) s.guidance.tips.push(g.id);
}

/** The highest-priority unseen tip whose `after` is seen, whose `when` holds and whose `until` does not; or null. */
export function nextTip(s: GameState): GuideStep | null {
  for (const g of GUIDE) {
    if (seen(s, g.id)) continue;
    if (g.after && !seen(s, g.after)) continue;
    if (g.until?.(s)) continue;
    if (g.when(s)) return g;
  }
  return null;
}

/** Marks a tip as seen ("Understood"). */
export function dismissTip(s: GameState, id: TipId): ActionResult {
  if (!TIPS.includes(id)) return { ok: false, code: 'invalid', reason: 'No such counsel.' };
  if (!seen(s, id)) s.guidance.tips.push(id);
  return { ok: true };
}

/** The tip card's kicker: 'DECIMVS CASSIVS ADVISES', or 'FROM THE NOTES OF DECIMVS CASSIVS' once he has died. */
export function mentorKicker(s: GameState): string {
  const name = MENTOR.name.toUpperCase().replace(/U/g, 'V');
  return s.counters.mentorDiedDay !== null ? `FROM THE NOTES OF ${name}` : `${name} ADVISES`;
}

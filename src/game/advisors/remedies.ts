// src/game/advisors/remedies.ts — typed, pre-checked remedies (ARCHITECTURE §8.6, §13.6, DESIGN §11.5). Owner: WP-E.
// checkRemedy says whether a remedy can run now and, if not, why (the button stays visible, disabled with that reason);
// applyRemedy runs sim remedies through the frozen action API; UI remedies (place, open, overlay, contract,
// building:center) are executed by App.applyRemedy and only checked here. Nothing here throws.
import { B } from '../balance';
import type { ActionResult, BuildingId, EdictId, FailCode, GameState, LaborCat, OrdoArea, OverlayId, Remedy, TabId } from '../types';
import * as act from '../actions';
import { aucYear, formatRoman } from '../calendar';
import { census } from '../census';
import { derived } from '../derived';
import { edictOption, edictWindow, isUnlocked, settingValue, switchOn } from '../decisions';
import { triggerRelief } from '../events';
import { pushActionFx } from '../memo';
import { MILESTONES } from '../objectives';
import { canPlace, validSlots } from '../place';
import { overlayRevealed, tabRevealed } from '../reveal';
import { newCtx, view } from '../sim';
import { getBuilding } from '../state';
import { checkDispatch, hubOpen, price } from '../trade';
import { BUILDING_DEFS } from '../data/buildings';
import { EDICT_DEFS, FOCUS_DEFS, SETTING_DEFS, SWITCH_DEFS } from '../data/decisions';
import { HUB_DEFS } from '../data/hubs';
import { aName, bestHub, days, int, rankWord, resName } from './util';

const OK: ActionResult = { ok: true };
const fail = (code: FailCode, reason: string): ActionResult => ({ ok: false, code, reason });

/** "Food first" labels and "on food" phrases per labour category. */
const CAT_FIRST: Record<LaborCat, string> = { water: 'Wells', food: 'Food', materials: 'Materials', industry: 'Workshops', services: 'Services', builders: 'Builders' };
const CAT_ON: Record<LaborCat, string> = { water: 'the wells', food: 'the food', materials: 'the materials', industry: 'the workshops', services: 'the services', builders: 'the works' };
const AREA_WORD: Record<OrdoArea, string> = { labour: 'labour', build: 'construction', trade: 'trade' };
const TAB_WORD: Record<TabId, string> = { council: 'Edicta', advisors: 'Consiliarii', build: 'Aedificia', people: 'Populus', trade: 'Commercium', annals: 'Annales' };
const ANCHOR_WORD: Record<string, string> = { petition: 'petition', watch: 'Watch', merchant: 'merchant', labour: 'labour', road: 'roads' };
const OVERLAY_WORD: Record<OverlayId, string> = { none: 'plain', aqua: 'Aqua', domus: 'Domus', officia: 'Officia', desir: 'Dignitas loci', terra: 'Terra' };

/** UI-executed remedies: place, open, overlay, contract, building:center. */
export function isUiRemedy(r: Remedy): boolean {
  return r.kind === 'place' || r.kind === 'open' || r.kind === 'overlay' || r.kind === 'contract' || (r.kind === 'building' && r.op === 'center');
}

/** Whether a remedy can be applied now; never throws (a failure carries its reason for the disabled button). */
export function checkRemedy(s: GameState, r: Remedy): ActionResult {
  try {
    return check(s, r);
  } catch {
    return fail('invalid', 'The council cannot weigh that now.');
  }
}

function check(s: GameState, r: Remedy): ActionResult {
  switch (r.kind) {
    case 'ask': return checkAsk(s, r.building);
    case 'place': return checkPlace(s, r.building, r.tile);
    case 'priority': return checkPriority(s, r.cat, r.days);
    case 'assign': return checkAssign(s, r.cat, r.n);
    case 'edict': return checkEdict(s, r.edict, r.option);
    case 'setting': {
      const def = SETTING_DEFS[r.setting];
      if (!def || !Number.isFinite(r.value) || r.value < def.min || r.value > def.max) return fail('invalid', 'Beyond what the council may set.');
      if (!isUnlocked(s, { kind: 'setting', id: r.setting })) return fail('locked', unlockReason(def.unlock));
      if (Math.abs(settingValue(s, r.setting) - r.value) < 1e-9) return fail('chosen', `${def.name} already stands at ${settingWord(r.setting, r.value)}.`);
      return OK;
    }
    case 'switch':
      if (!SWITCH_DEFS[r.sw]) return fail('invalid', 'No such switch.');
      return switchOn(s, r.sw) === r.value ? fail('chosen', `${SWITCH_DEFS[r.sw].name} is already ${r.value ? 'on' : 'off'}.`) : OK;
    case 'focus':
      if (!FOCUS_DEFS[r.focus]) return fail('invalid', 'No such focus.');
      return s.decisions.focus === r.focus ? fail('chosen', `The council already turns to ${FOCUS_DEFS[r.focus].name}.`) : OK;
    case 'contract': {
      const sp = r.spec;
      if (!HUB_DEFS[sp.hub]) return fail('invalid', 'No such market.');
      if (!hubOpen(s, sp.hub)) return fail('locked', `${HUB_DEFS[sp.hub].name} does not yet trade with us.`);
      if (price(s, sp.hub, sp.res, sp.mode === 'import' ? 'buy' : 'sell') === null) {
        return fail('refused', `${HUB_DEFS[sp.hub].name} will not ${sp.mode === 'import' ? 'sell us' : 'buy'} ${resName(sp.res)}.`);
      }
      if (!(sp.qty > 0) || sp.qty > B.ordo.CARGO) return fail('invalid', `A caravan carries 1 to ${B.ordo.CARGO}.`);
      return checkDispatch(s, sp, view(s));
    }
    case 'buyNow': {
      if (!(r.qty > 0)) return fail('invalid', 'Nothing to buy.');
      const h = bestHub(s, r.res, 'buy', r.qty);
      if (!h) return fail('locked', `No open market sells ${resName(r.res)} to us.`);
      const cost = h.unit * r.qty;
      return s.res.denarii < cost ? fail('unaffordable', `It costs ${int(cost)} denarii; the aerarium holds ${int(s.res.denarii)}.`) : OK;
    }
    case 'relief': return checkRelief(s);
    case 'toggleOrdo':
      return s.ordo.on[r.area] === r.on ? fail('chosen', `${cap(AREA_WORD[r.area])} is already ${r.on ? "the Ordo's" : 'in your hands'}.`) : OK;
    case 'building': {
      const b = getBuilding(s, r.id);
      if (!b) return fail('notFound', 'That building is gone.');
      const name = BUILDING_DEFS[b.type].name.toLowerCase();
      if (r.op === 'center') return OK;
      if (r.op === 'prioritise') return b.status === 'done' ? fail('invalid', `The ${name} is finished.`) : OK;
      if (b.status !== 'done') return fail('invalid', `The ${name} is not finished.`);
      if (r.op === 'open') return b.open ? fail('chosen', `The ${name} is open.`) : OK;
      return b.open ? OK : fail('chosen', `The ${name} is already closed.`);
    }
    case 'open': return tabRevealed(s, r.tab) ? OK : fail('locked', `${TAB_WORD[r.tab]} is not yet open to us.`);
    case 'overlay': return overlayRevealed(s, r.overlay) ? OK : fail('locked', `The ${OVERLAY_WORD[r.overlay]} overlay is not yet revealed.`);
  }
}

function cap(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function unlockReason(m: string): string {
  const def = MILESTONES.find((x) => x.id === m);
  return def ? `Unlocked by the Res Gestae: ${def.text}` : 'Not yet within the council\'s power.';
}

/** Rank, uniqueness and reserved-site checks shared by `ask` and `place`. */
function buildable(s: GameState, type: BuildingId): ActionResult {
  const def = BUILDING_DEFS[type];
  if (!def) return fail('invalid', 'No such building.');
  if (def.place.includes('fixed')) return fail('reserved', 'Reserved by the groma.');
  if (def.rank > s.rank) return fail('rankLocked', `Rome grants this to ${rankWord(def.rank)}.`);
  if (def.maxCount !== undefined && (derived(s).all[type] ?? 0) >= def.maxCount) return fail('maxCount', `Only ${def.maxCount} may be raised.`);
  return OK;
}

function checkAsk(s: GameState, type: BuildingId): ActionResult {
  const b = buildable(s, type);
  if (!b.ok) return b;
  if (!s.ordo.on.build) return fail('manualOnly', 'Construction is in your hands: place it yourself.');
  if (s.ordo.requests.some((q) => q.type === type)) return fail('chosen', `The Ordo will raise ${aName(type)} within days.`);
  // one at a time: a second ask while the first still rises would only stack up works the advice did not need
  if (type !== 'area' && s.buildings.some((b) => b.type === type && b.status !== 'done')) return fail('chosen', `${aName(type).replace(/^./, (c) => c.toUpperCase())} is already being raised.`);
  if (s.ordo.requests.length >= B.ordo.REQUESTS_MAX) return fail('full', `The Ordo already holds ${B.ordo.REQUESTS_MAX} requests.`);
  return validSlots(s, type, 'ordo').size > 0 ? OK : fail('noSlots', `No site can take ${aName(type)} yet.`);   // a best slot exists iff any does
}

function checkPlace(s: GameState, type: BuildingId, tile?: number): ActionResult {
  const b = buildable(s, type);
  if (!b.ok) return b;
  if (tile !== undefined) {
    const c = canPlace(s, type, tile, { owner: 'player' });
    if (c.ok) return OK;
  }
  return validSlots(s, type, 'player').size > 0 ? OK : fail('noSlots', `No site can take ${aName(type)} yet.`);
}

function checkPriority(s: GameState, cat: LaborCat, n: number): ActionResult {
  if (!(n > 0)) return fail('invalid', 'For how long?');
  if (!s.ordo.on.labour) return fail('manualOnly', 'Labour is in your hands: assign it yourself.');
  if (cat !== 'builders' && census(s).catSlots[cat] <= 0) return fail('noSlots', `No post on ${CAT_ON[cat]} stands open: raise one first.`);
  const p = s.ordo.priorities.find((x) => x.cat === cat && x.until > s.day);
  return p ? fail('chosen', `${CAT_FIRST[cat]} already come first until ${formatRoman(p.until)}.`) : OK;
}

function checkAssign(s: GameState, cat: LaborCat, n: number): ActionResult {
  if (!(n > 0)) return fail('invalid', 'Assign how many?');
  if (s.ordo.on.labour) return fail('ordoOnly', 'The Ordo assigns labour: give it a priority instead.');
  if (cat !== 'builders' && census(s).catSlots[cat] - s.ordo.manual[cat] <= 0) return fail('noSlots', `Every post on ${CAT_ON[cat]} is already filled.`);
  return OK;
}

function checkEdict(s: GameState, id: EdictId, option: string): ActionResult {
  const def = EDICT_DEFS[id];
  const opt = def?.options.find((o) => o.id === option);
  if (!def || !opt) return fail('invalid', 'No such edict.');
  if (!isUnlocked(s, { kind: 'edict', id })) return fail('locked', unlockReason(def.unlock));
  if (edictOption(s, id) === option) return fail('chosen', `${def.latin.split(' ')[0]} ${opt.name} is already in force.`);
  const w = edictWindow(s, id);
  if (!w.open) return fail('window', `Next edict window: ${formatRoman(w.next)} (in ${days(w.next - s.day)}).`);
  return OK;
}

function checkRelief(s: GameState): ActionResult {
  if (s.choice) return fail('notReady', 'Another dispatch awaits your answer.');
  const em = s.ordo.emergency;
  const free = s.decisions.paths.path3 === 'annonaPublica' && em.freeReliefYear !== aucYear(s.day);
  const next = em.lastRelief + B.emergency.RELIEF_COOLDOWN;
  if (!free && em.lastRelief >= 0 && s.day < next) return fail('window', `The Legate helped us lately; he hears us again on ${formatRoman(next)}.`);
  return OK;
}

/** Applies a sim remedy through the actions; UI remedies only pass their check (the UI executes them). */
export function applyRemedy(s: GameState, r: Remedy): ActionResult {
  const c = checkRemedy(s, r);
  if (!c.ok || isUiRemedy(r)) return c;
  try {
    return apply(s, r);
  } catch {
    return fail('invalid', 'The council could not carry that out.');
  }
}

function apply(s: GameState, r: Remedy): ActionResult {
  switch (r.kind) {
    case 'ask': return act.askOrdo(s, r.building);
    case 'priority': return act.setLabourPriority(s, r.cat, r.days);
    case 'assign': return act.setManualTarget(s, r.cat, s.ordo.manual[r.cat] + r.n);
    case 'edict': return act.setEdict(s, r.edict, r.option);
    case 'setting': return act.setSetting(s, r.setting, r.value);
    case 'switch': return act.setSwitch(s, r.sw, r.value);
    case 'focus': return act.setFocus(s, r.focus);
    case 'buyNow': return act.buyNow(s, r.res, r.qty);
    case 'toggleOrdo': return act.setOrdo(s, r.area, r.on);
    case 'building': return r.op === 'prioritise' ? act.prioritise(s, r.id) : act.setOpen(s, r.id, r.op === 'open');
    case 'relief': {
      const ctx = newCtx();
      triggerRelief(s, ctx, view(s));
      for (const e of ctx.fx) pushActionFx(e);
      return s.choice?.event === 'mutuum' ? OK : fail('notReady', 'The Legate has not answered.');
    }
    default: return OK;
  }
}

function settingWord(id: keyof typeof SETTING_DEFS, v: number): string {
  const u = SETTING_DEFS[id].unit;
  if (u === '%') return `${Math.round(v * 100)}%`;
  if (u === 'den') return `${int(v)} denarii`;
  return `${int(v)} ${u}`;
}

/** Button label of a remedy, with live numbers; never throws. */
export function remedyLabel(s: GameState, r: Remedy): string {
  try {
    return label(s, r);
  } catch {
    return 'Show me';
  }
}

function label(s: GameState, r: Remedy): string {
  switch (r.kind) {
    case 'ask': return `Ask the Ordo for ${aName(r.building)}`;
    case 'place': return `Place ${aName(r.building)}`;
    case 'priority': return `${CAT_FIRST[r.cat]} first for ${days(r.days)}`;
    case 'assign': return `Put ${r.n} more ${r.n === 1 ? 'hand' : 'hands'} on ${CAT_ON[r.cat]}`;
    case 'edict': {
      const d = EDICT_DEFS[r.edict];
      return `Edict: ${d.latin.split(' ')[0]} ${d.options.find((o) => o.id === r.option)?.name ?? r.option}`;
    }
    case 'setting': return `${SETTING_DEFS[r.setting].name} → ${settingWord(r.setting, r.value)}`;
    case 'switch': return `${SWITCH_DEFS[r.sw].name}: ${r.value ? 'on' : 'off'}`;
    case 'focus': return `Focus: ${FOCUS_DEFS[r.focus].name}`;
    case 'contract': {
      const sp = r.spec;
      const imp = sp.mode === 'import';
      return `${imp ? 'Import' : 'Export'} ${int(sp.qty)} ${resName(sp.res)} ${imp ? 'from' : 'to'} ${HUB_DEFS[sp.hub].name}`;
    }
    case 'buyNow': {
      const h = bestHub(s, r.res, 'buy', r.qty);
      return `Buy ${int(r.qty)} ${resName(r.res)} now${h ? ` (≈ ${int(h.unit * r.qty)} den)` : ''}`;
    }
    case 'relief': return "Ask the Legate's relief";
    case 'toggleOrdo': return r.on ? `Give ${AREA_WORD[r.area]} to the Ordo` : `Take ${AREA_WORD[r.area]} into my hands`;
    case 'building': {
      const b = getBuilding(s, r.id);
      const n = b ? BUILDING_DEFS[b.type].name.toLowerCase() : 'building';
      return r.op === 'open' ? `Reopen the ${n}` : r.op === 'close' ? `Close the ${n}` : r.op === 'prioritise' ? `Raise the ${n} first` : `Show the ${n}`;
    }
    case 'open':
      if (r.anchor === 'choice') return 'Read the dispatch';
      if (r.anchor?.startsWith('contract-')) return 'Open the contract';
      return `Open ${TAB_WORD[r.tab]}${r.anchor ? `: ${ANCHOR_WORD[r.anchor] ?? r.anchor}` : ''}`;
    case 'overlay': return `Show the ${OVERLAY_WORD[r.overlay]} overlay`;
  }
}

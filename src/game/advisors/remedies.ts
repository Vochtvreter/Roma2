// src/game/advisors/remedies.ts — typed, pre-checked remedies (ARCHITECTURE §8.6, §13.6, DESIGN §11.5). Owner: WP-E.
// checkRemedy says whether a remedy can run now and, if not, why (the button stays visible, disabled with that reason);
// applyRemedy runs sim remedies through the frozen action API; UI remedies (place, open, overlay, contract, tool,
// building:center) are executed by App.applyRemedy and only checked here. A block to clear (`clear`) is both: the sim
// part pulls down what stands there (the demolish action), and App, once the player confirms, then places the work on
// the cleared block. Nothing here throws.
import { B as B$ } from '../balance';
import type { ActionResult, BuildingId, EdictId, FailCode, GameState, LaborCat, OrdoArea, OverlayId, Owner, Remedy, TabId, ToolId } from '../types';
import * as act from '../actions';
import { formatRoman as formatRoman$ } from '../calendar';
import { census, peopleIndex } from '../census';
import { derived as derived$ } from '../derived';
import { edictOption, edictWindow, isUnlocked, settingValue, switchOn } from '../decisions';
import { triggerRelief } from '../events';
import { pushActionFx as pushActionFx$ } from '../memo';
import { MILESTONES, milestoneUnlocking } from '../objectives';
import { canPlace, validSlots } from '../place';
import { getMap } from '../map';
import { halfOrigin, isActiveBlock, isRazed, plotOrigin } from '../survey';
import { RULE_REASON, ruleFail } from '../world/siterules';
import { RANK_DEFS } from '../data/ranks';
import { overlayRevealed, tabRevealed, toolRevealed } from '../reveal';
import { newCtx, view } from '../sim';
import { getBuilding as getBuilding$ } from '../lookup';
import { checkDispatch, hubOpen, price } from '../trade';
import { BUILDING_DEFS as BUILDING_DEFS$ } from '../data/buildings';
import { EDICT_DEFS as EDICT_DEFS$, FOCUS_DEFS as FOCUS_DEFS$, SETTING_DEFS as SETTING_DEFS$, SWITCH_DEFS as SWITCH_DEFS$ } from '../data/decisions';
import { HUB_DEFS as HUB_DEFS$ } from '../data/hubs';
import { aName, bestHub, blockWorks, days, fractionWord, int, placeName, rankWord, resName, worksWord } from './util';
// Leaf-module imports copied into module constants: a hot loop then reads a local, not the module record the test
// runner's transform puts behind every import (these modules import nothing that imports back, so they are loaded).
const B = B$, formatRoman = formatRoman$, derived = derived$, pushActionFx = pushActionFx$,
  BUILDING_DEFS = BUILDING_DEFS$, EDICT_DEFS = EDICT_DEFS$, FOCUS_DEFS = FOCUS_DEFS$, SETTING_DEFS = SETTING_DEFS$,
  SWITCH_DEFS = SWITCH_DEFS$, HUB_DEFS = HUB_DEFS$,
  getBuilding = getBuilding$;

const OK: ActionResult = { ok: true };
const fail = (code: FailCode, reason: string): ActionResult => ({ ok: false, code, reason });

/** "Food first" labels and "on food" phrases per labour category. */
const CAT_FIRST: Record<LaborCat, string> = { water: 'Wells', food: 'Food', materials: 'Materials', industry: 'Workshops', services: 'Services', builders: 'Builders' };
const CAT_ON: Record<LaborCat, string> = { water: 'the wells', food: 'the food', materials: 'the materials', industry: 'the workshops', services: 'the services', builders: 'the works' };
const AREA_WORD: Record<OrdoArea, string> = { labour: 'labour', build: 'construction', trade: 'trade' };
const TAB_WORD: Record<TabId, string> = { council: 'Edicta', advisors: 'Consiliarii', build: 'Aedificia', people: 'Populus', trade: 'Commercium', annals: 'Annales' };
const ANCHOR_WORD: Record<string, string> = { petition: 'petition', watch: 'Watch', merchant: 'merchant', labour: 'labour', road: 'roads' };
const OVERLAY_WORD: Record<OverlayId, string> = { none: 'plain', aqua: 'Aqua', domus: 'Domus', officia: 'Officia', desir: 'Dignitas loci', terra: 'Terra' };
const TOOL_WORD: Record<Exclude<ToolId, 'pin'>, string> = { road: 'Lay a road', pave: 'Pave roads', reserve: 'Keep a block free', demolish: 'Demolish' };

/** UI-executed remedies: place, open, overlay, contract, tool, building:center. */
export function isUiRemedy(r: Remedy): boolean {
  return r.kind === 'place' || r.kind === 'open' || r.kind === 'overlay' || r.kind === 'contract' || r.kind === 'tool' || (r.kind === 'building' && r.op === 'center');
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
    case 'clear': return checkClear(s, r.building, r.tile, r.ids);
    case 'open': return tabRevealed(s, r.tab) ? OK : fail('locked', `${TAB_WORD[r.tab]} is not yet open to us.`);
    case 'overlay': return overlayRevealed(s, r.overlay) ? OK : fail('locked', `The ${OVERLAY_WORD[r.overlay]} overlay is not yet revealed.`);
    case 'tool': return checkTool(s, r.tool);
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
  if (s.ordo.requests.some((q) => q.type === type)) return fail('chosen', `Asked of the Ordo: it raises ${aName(type)} when the stores allow.`);
  // one at a time: a second ask while the first still rises would only stack up works the advice did not need
  if (type !== 'area' && s.buildings.some((b) => b.type === type && b.status !== 'done')) return fail('chosen', `${aName(type).replace(/^./, (c) => c.toUpperCase())} is already being raised.`);
  if (s.ordo.requests.length >= B.ordo.REQUESTS_MAX) return fail('full', `The Ordo already holds ${B.ordo.REQUESTS_MAX} requests.`);
  return validSlots(s, type, 'ordo').size > 0 ? OK : fail('noSlots', noSite(s, type, 'ordo'));   // a best slot exists iff any does
}

function checkPlace(s: GameState, type: BuildingId, tile?: number): ActionResult {
  const b = buildable(s, type);
  if (!b.ok) return b;
  if (tile !== undefined) {
    const c = canPlace(s, type, tile, { owner: 'player' });
    if (c.ok) return OK;
  }
  return validSlots(s, type, 'player').size > 0 ? OK : fail('noSlots', noSite(s, type, 'player'));
}

/** Why no site can take a type now (the disabled button's reason, DESIGN §11.1 rule 7): an urban work names the slots
 *  that are all taken (and how more come: a block is cleared, a rank surveys a ring), the site rule every free one fails,
 *  or, for the Ordo, the blocks the player keeps from it; a work that may stand on rural land names its rule. */
function noSite(s: GameState, type: BuildingId, owner: Owner): string {
  const def = BUILDING_DEFS[type];
  const what = aName(type);
  const rule = type === 'castellum' ? RULE_REASON.noFons : type === 'lacus' ? RULE_REASON.nearAqueduct
    : def.rule !== 'none' && def.rule !== 'fixed' ? RULE_REASON[def.rule] : null;
  const low = (x: string): string => x.charAt(0).toLowerCase() + x.slice(1);
  if (def.place.includes('rural')) return `No free land in our territory can take ${what}${rule ? `: ${low(rule)}` : '.'}`;
  const cls = def.place.includes('block') ? 'block' : def.place.includes('half') ? 'half' : 'plot';
  const word = cls === 'half' ? 'half-block' : cls;
  // the free slots of the class, the rule aside, and whether any of them passes it
  const map = getMap(s.seed), sv = map.survey, d = derived(s), razed = isRazed(s);
  const [w, h] = cls === 'block' ? [B.map.BLOCK, B.map.BLOCK] : cls === 'half' ? [B.map.BLOCK, B.map.PLOT] : [B.map.PLOT, B.map.PLOT];
  let free = 0, fits = 0;
  for (const blk of sv.blocks) {
    if (!isActiveBlock(sv, blk, s.rank, razed)) continue;
    const origins = cls === 'block' ? [{ x: blk.x, y: blk.y }] : cls === 'half' ? [halfOrigin(blk, 0), halfOrigin(blk, 1)] : ([0, 1, 2, 3] as const).map((k) => plotOrigin(blk, k));
    for (const o of origins) {
      let ok = true;
      for (let y = o.y; ok && y < o.y + h; y++) for (let x = o.x; x < o.x + w; x++) { const i = y * map.W + x; if (d.buildingAt[i] !== 0 || d.reservedTile[i]) { ok = false; break; } }
      if (!ok) continue;
      free++;
      if (!ruleFail(s, type, o.x, o.y, w, h)) fits++;
    }
  }
  if (free > 0 && (fits === 0 || type === 'castellum') && rule) return `No free ${word} can take ${what}: ${low(rule)}`;
  if (free > 0 && owner === 'ordo') {
    return `${cls === 'block' ? 'Every free block is one' : `Every free ${word} lies in a block`} you keep from the Ordo: place it yourself, or release one.`;
  }
  const next = RANK_DEFS[s.rank + 1];
  const more = next && next.rings.length > RANK_DEFS[s.rank].rings.length ? `, or petition for ${rankWord(s.rank + 1)} to survey more` : '';
  if (cls === 'block') return `Every block of the town is built on: pull down what stands on one to clear it${more}.`;
  return `Every ${word} of the town is taken${more}.`;
}

/** A block to clear for a block service (DESIGN §11.6 row 17): the work may stand there once what is named comes down,
 *  and the block still holds exactly that — anything built on it or pulled down since the advice was given says so.
 *  One at a time, as an ask: while a work of the kind still rises, the homes it will reach wait for it, and a second
 *  block pulled down for the same homes would cost what stands there for nothing. */
function checkClear(s: GameState, type: BuildingId, tile: number, ids: readonly number[]): ActionResult {
  const b = buildable(s, type);
  if (!b.ok) return b;
  if (s.buildings.some((w) => w.type === type && w.status !== 'done')) return fail('chosen', `${aName(type).replace(/^./, (c) => c.toUpperCase())} is already being raised.`);
  const map = getMap(s.seed), sv = map.survey;
  const blk = Number.isInteger(tile) && tile >= 0 && tile < sv.blockAt.length ? sv.blocks[sv.blockAt[tile]] : undefined;
  if (!blk || blk.y * map.W + blk.x !== tile || !BUILDING_DEFS[type].place.includes('block') || !isActiveBlock(sv, blk, s.rank, isRazed(s))) {
    return fail('notOnSlot', `That is no block of the town to take ${aName(type)}.`);
  }
  if (s.ordo.reserved.includes(blk.id)) return fail('reserved', 'You keep this block free.');
  const rf = ruleFail(s, type, blk.x, blk.y, B.map.BLOCK, B.map.BLOCK);
  if (rf) return fail(rf.code, rf.reason);
  const now = blockWorks(s, tile);
  if (!now) return fail('occupied', 'A work too great to pull down stands on the block.');
  const want = [...ids].sort((a, c) => a - c);
  if (now.length === 0 || now.length !== want.length || now.some((id, k) => id !== want[k])) return fail('notReady', 'The block has changed since the Aedilis named it.');
  return OK;
}

/** A map tool, once its milestone reveals it; the Pave brush wants a dirt road and the stone for a pace. */
function checkTool(s: GameState, t: Exclude<ToolId, 'pin'>): ActionResult {
  if (!TOOL_WORD[t]) return fail('invalid', 'No such tool.');
  if (!toolRevealed(s, t)) return fail('locked', unlockReason(milestoneUnlocking({ kind: 'tool', id: t })?.id ?? ''));
  if (t !== 'pave') return OK;
  const road = derived(s).road;
  if (!s.roads.some((i) => road[i] === 1)) return fail('invalid', 'Every road is already paved.');
  const need = B.map.PAVE_STONE;
  return s.res.stone < need ? fail('unaffordable', `Paving takes ${need} stone a pace; the stores hold ${int(s.res.stone)}.`) : OK;
}

function checkPriority(s: GameState, cat: LaborCat, n: number): ActionResult {
  if (!(n > 0)) return fail('invalid', 'For how long?');
  if (!s.ordo.on.labour) return fail('manualOnly', 'Labour is in your hands: assign it yourself.');
  if (cat !== 'builders' && census(s).catSlots[cat] <= 0) return fail('noSlots', `No post on ${CAT_ON[cat]} stands open: raise one first.`);
  const p = s.ordo.priorities.find((x) => x.cat === cat && x.until > s.day);
  return p ? fail('chosen', `${CAT_FIRST[cat]} already ${cat === 'food' ? 'comes' : 'come'} first until ${formatRoman(p.until)}`) : OK;   // the date ends in its point
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

/** As events.triggerRelief judges it: the Legate answers once per RELIEF_COOLDOWN, the Annona publica's free relief
 *  included (it makes the grain free, not the Legate sooner). */
function checkRelief(s: GameState): ActionResult {
  if (s.choice) return fail('notReady', 'Another dispatch awaits your answer.');
  const next = s.ordo.emergency.lastRelief + B.emergency.RELIEF_COOLDOWN;
  if (s.day < next) return fail('window', `The Legate helped us lately; he hears us again on ${formatRoman(next)}`);   // the date ends in its point
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
    case 'clear': {   // what stands on the block comes down (the demolish action: a quarter back, a site cancelled)
      for (const id of r.ids) {
        const d = act.demolish(s, id);
        if (!d.ok) return d;
      }
      return OK;
    }
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

/** The question App asks before a block is cleared (DESIGN §11.5): where, what comes down and who moves, and the work
 *  then placed there. Never throws. */
export function clearPrompt(s: GameState, r: Extract<Remedy, { kind: 'clear' }>): { title: string; text: string; yes: string } {
  try {
    const work = aName(r.building);
    const byHome = peopleIndex(s).byHome;
    let souls = 0, sites = 0;
    for (const id of r.ids) {
      souls += byHome.get(id)?.length ?? 0;
      if (getBuilding(s, id)?.status !== 'done') sites++;
    }
    const what = worksWord(s, r.ids);
    const back = sites === 0 ? `${fractionWord(B.construction.REFUND_DEMOLISH)} of ${r.ids.length === 1 ? 'its' : 'their'} cost is salvaged` : 'what can be is salvaged';
    const who = souls === 0 ? '' : souls === 1 ? ' The one soul who lives there looks for a bed in the town\'s other homes.'
      : ` The ${souls} souls who live there look for beds in the town's other homes.`;
    return {
      title: `Clear the block ${placeName(s, r.tile)}?`,
      text: `${what.charAt(0).toUpperCase()}${what.slice(1)} ${r.ids.length === 1 ? 'comes' : 'come'} down, and ${back}.${who} Then you place ${work} on the cleared block.`,
      yes: `Clear it for ${work}`,
    };
  } catch {
    return { title: 'Clear the block?', text: 'What stands on it comes down.', yes: 'Clear it' };
  }
}

/** What a remedy will set in motion, for its button's tooltip before it is applied (a focus: what the council will
 *  raise under it, so Urbs says it plants gardens on free plots), or null. */
export function remedyTip(r: Remedy): string | null {
  if (r.kind !== 'focus') return null;
  const f = FOCUS_DEFS[r.focus];
  return f ? `${f.latin} · ${f.name}\n${f.desc}` : null;
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
    case 'clear': return `Clear this block for ${aName(r.building)}`;
    case 'open':
      if (r.anchor === 'choice') return 'Read the dispatch';
      if (r.anchor?.startsWith('contract-')) return 'Open the contract';
      return `Open ${TAB_WORD[r.tab]}${r.anchor ? `: ${ANCHOR_WORD[r.anchor] ?? r.anchor}` : ''}`;
    case 'overlay': return `Show the ${OVERLAY_WORD[r.overlay]} overlay`;
    case 'tool': return r.tool === 'pave' ? `${TOOL_WORD.pave} (${B.map.PAVE_STONE} stone a pace)` : TOOL_WORD[r.tool];
  }
}

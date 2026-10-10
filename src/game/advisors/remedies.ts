// src/game/advisors/remedies.ts — typed, pre-checked remedies (ARCHITECTURE §8.6, §13.6, DESIGN §11.5). Owner: WP-E.
// SCAFFOLD: every remedy is { ok: false, code: 'notReady' }; labels and the UI/sim split are real.
import type { ActionResult, GameState, Remedy } from '../types';
import { BUILDING_DEFS } from '../data/buildings';
import { EDICT_DEFS, FOCUS_DEFS, SETTING_DEFS, SWITCH_DEFS } from '../data/decisions';
import { RESOURCE_DEFS } from '../data/resources';
import { HUB_DEFS } from '../data/hubs';

function notReady(): ActionResult {
  return { ok: false, code: 'notReady', reason: 'The advisors are still gathering their counsel.' };
}

/** Whether a remedy can be applied now; never throws (disabled-with-reason). */
export function checkRemedy(s: GameState, r: Remedy): ActionResult {
  // STUB(WP-E): per-kind checks against the action API.
  void s; void r;
  return notReady();
}

/** Applies a sim remedy through the actions; UI remedies return ok (the UI executes them). */
export function applyRemedy(s: GameState, r: Remedy): ActionResult {
  const check = checkRemedy(s, r);
  if (!check.ok) return check;
  if (isUiRemedy(r)) return { ok: true };
  // STUB(WP-E): dispatch to actions (askOrdo, setLabourPriority, setEdict, setSetting, setSwitch, setFocus, buyNow, …).
  return notReady();
}

/** UI-executed remedies: place, open, overlay, contract, building:center. */
export function isUiRemedy(r: Remedy): boolean {
  return r.kind === 'place' || r.kind === 'open' || r.kind === 'overlay' || r.kind === 'contract' || (r.kind === 'building' && r.op === 'center');
}

/** Button label of a remedy. */
export function remedyLabel(s: GameState, r: Remedy): string {
  void s;   // STUB(WP-E): final wording, live numbers
  switch (r.kind) {
    case 'ask': return `Ask the Ordo for a ${BUILDING_DEFS[r.building].name.toLowerCase()}`;
    case 'place': return `Place a ${BUILDING_DEFS[r.building].name.toLowerCase()}`;
    case 'priority': return `${r.cat[0].toUpperCase()}${r.cat.slice(1)} first for ${r.days} days`;
    case 'assign': return `Assign ${r.n} to ${r.cat}`;
    case 'edict': return `${EDICT_DEFS[r.edict].name}: ${EDICT_DEFS[r.edict].options.find((o) => o.id === r.option)?.name ?? r.option}`;
    case 'setting': return `${SETTING_DEFS[r.setting].name}: ${r.value}`;
    case 'switch': return `${SWITCH_DEFS[r.sw].name}: ${r.value ? 'on' : 'off'}`;
    case 'focus': return `Focus: ${FOCUS_DEFS[r.focus].name}`;
    case 'contract': return `${r.spec.mode === 'import' ? 'Import' : 'Export'} ${RESOURCE_DEFS[r.spec.res].name.toLowerCase()} via ${HUB_DEFS[r.spec.hub].name}`;
    case 'buyNow': return `Buy ${r.qty} ${RESOURCE_DEFS[r.res].name.toLowerCase()} now`;
    case 'relief': return 'Ask the legate for relief';
    case 'toggleOrdo': return `${r.on ? 'Let the Ordo run' : 'Take over'} ${r.area}`;
    case 'building': return r.op === 'open' ? 'Reopen it' : r.op === 'close' ? 'Close it' : r.op === 'prioritise' ? 'Build it first' : 'Show me';
    case 'open': return 'Show me';
    case 'overlay': return 'Show on the map';
  }
}

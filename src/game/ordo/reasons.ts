// src/game/ordo/reasons.ts — Reason templates: full sentences and ticker fragments (ARCHITECTURE §8.4, DESIGN §10.6). Owner: WP-C.
// SCAFFOLD: one plain template per code with {param} substitution; WP-C writes the final wording.
import type { Reason, ReasonCode } from '../types';

const TEXT: Record<ReasonCode, string> = {
  request: 'You asked for a {type}.',
  pin: 'Building next, by your order: {type}.',
  survivalFood: 'Food first: grain lasts only {days} days.',
  survivalWater: 'Water first: the amphorae last only {days} days.',
  aestasWater: 'Aestas is coming: more water before the thirsty season.',
  hiemsStore: 'Hiems is coming: a store for the hungry season.',
  storageFull: 'The stores are full: more room.',
  beds: 'Newcomers need beds.',
  waterAccess: 'Houses lack water within reach.',
  evolve: 'Houses wait for {need} to grow.',
  rank: 'Rome expects it of a {rank}.',
  materials: 'Materials for the works ahead.',
  luxury: 'The better houses want {res}.',
  focusPlan: 'The council focus asks for it.',
  beauty: 'To make the town fairer.',
  capitolium: 'For the Capitolium.',
  needWater: 'Wells to meet the water need ({need} a day).',
  needFood: 'Food workers to meet the grain need ({need} a day).',
  reserveTopup: 'Topping up the grain reserve.',
  requiredService: 'Houses depend on this service.',
  builderShare: 'Builders for the works in hand.',
  monument: 'The Capitolium crew.',
  pendingInput: 'Saving {res} for the {type}.',
  winterStock: 'Stockpiling for Hiems.',
  tools: 'Tool kits for the workers.',
  luxuryStaff: 'Olive groves for the oil demand.',
  serviceFull: 'Filling the services to their full radius.',
  focusSplit: 'Spare hands by the council focus.',
  leftover: 'The remaining hands to open posts.',
  priority: 'By your order: {cat} first.',
  deficitImport: 'Importing {res}: we produce too little.',
  luxuryImport: 'Importing {res} for the better houses.',
  wishImport: 'Importing {res} for the next work.',
  surplusExport: 'Selling surplus {res}.',
  merchantDeal: 'A good bargain from the merchant.',
  emergencyRations: 'Rations cut: grain runs low.',
  emergencyWater: 'Works paused: water runs low.',
  emergencyImport: 'Emergency grain from the nearest market.',
  relief: 'Relief from the legate.',
  saving: 'Saving for the {for}.',
};

function fill(t: string, params: Record<string, number | string>): string {
  return t.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = params[k];
    if (v === undefined) return k;
    return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : v;
  });
}

/** Full sentence for tooltips and the Annales. */
export function reasonText(r: Reason): string {
  return fill(TEXT[r.code] ?? r.code, r.params);
}

/** Ticker fragment (no trailing period). */
export function reasonShort(r: Reason): string {
  // STUB(WP-C): dedicated short forms.
  return reasonText(r).replace(/\.$/, '');
}

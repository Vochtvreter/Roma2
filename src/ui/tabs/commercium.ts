// src/ui/tabs/commercium.ts — Commercium / Trade: caravans in flight, contracts (status, pause reason, owner seal,
// edit/resume/cancel), the visiting merchant, the new-contract form with a live preview, and the hub cards (DESIGN §13,
// §15.3). Owner: WP-I.
import { HUBS, TRADE_RES } from '../../game/types';
import type { Caravan, Contract, ContractSpec, GameState, HubId, MerchantOffer, PauseCode, TradeRes } from '../../game/types';
import type { Game, Updater } from '../types';
import { fmt, h, img, realTime, tip } from '../dom';
import * as A from '../../game/actions';
import { caravanSlots, checkDispatch, hubOpen, price, slotsInUse, tripDays } from '../../game/trade';
import { reasonText } from '../../game/ordo/reasons';
import { view } from '../../game/sim';
import { formatRoman } from '../../game/calendar';
import { B } from '../../game/balance';
import { HUB_DEFS, TRADE_BASE } from '../../game/data/hubs';
import { RESOURCE_DEFS } from '../../game/data/resources';
import { RANK_DEFS } from '../../game/data/ranks';
import { resIcon } from '../../render/art/index';
import { confirm2 } from '../modals';
import { bar, btn, section } from './common';
import type { TabPanel } from './common';

const PAUSE: Record<PauseCode, string> = {
  reserve: 'it would dip below our trade reserve', stock: 'not enough in store to load', denarii: 'we cannot pay for it',
  storage: 'no room in our stores for it', refused: 'the market refuses that trade',
};
const QUICK = [20, 40, 80] as const;
const ARROW_EPS = 0.02;

let draft: ContractSpec | null = null;     // the form's fields; they survive rebuilds
let replaceId: number | null = null;       // editing: sending replaces this contract
let formVersion = 0;                       // bumped when the draft is replaced from outside (forces a rebuild)

/** Pre-fills the new-contract form (Game.prefillContract → then openTab('trade', 'new-contract')). */
export function prefill(spec: ContractSpec): void {
  draft = { ...spec, qty: Math.max(1, Math.min(B.ordo.CARGO, Math.round(spec.qty))) };
  replaceId = null;
  formVersion++;
}

/** Why a hub does not trade with us yet, or null when it does. */
function hubLock(s: GameState, hub: HubId): string | null {
  if (hubOpen(s, hub)) return null;
  const r = HUB_DEFS[hub].rank;
  return r > s.rank ? `opens at ${RANK_DEFS[r].name}` : 'trade opens at Vicus, or with the Emporium castrense charter';
}

function resName(r: TradeRes): string {
  return RESOURCE_DEFS[r].name.toLowerCase();
}

function defaultDraft(s: GameState): ContractSpec {
  const hub = HUBS.find((x) => hubOpen(s, x)) ?? 'metellianus';
  return { hub, mode: 'export', res: 'timber', qty: 40, repeat: false };
}

/** '3.1 ▲' with a colour class: for what we pay ▲ is bad; for what we receive ▲ is good. */
function priceEl(p: number | null, res: TradeRes, side: 'buy' | 'sell'): HTMLElement {
  if (p === null) return h('span', { class: 'tr-p none' }, '—');
  const rel = p / TRADE_BASE[res] - 1;
  const arrow = rel > ARROW_EPS ? '▲' : rel < -ARROW_EPS ? '▼' : '';
  const good = side === 'sell' ? rel > ARROW_EPS : rel < -ARROW_EPS;
  const bad = side === 'sell' ? rel < -ARROW_EPS : rel > ARROW_EPS;
  return h('span', { class: `tr-p num${good ? ' good' : bad ? ' bad' : ''}` }, fmt(p), arrow);
}

/** The live preview of a contract: price, value, trip days, profit against the base price, whether it leaves now. */
function preview(g: Game, spec: ContractSpec): { lines: string[]; reason: string | null } {
  const s = g.state;
  const lock = hubLock(s, spec.hub);
  if (lock) return { lines: [], reason: `${HUB_DEFS[spec.hub].name} does not yet trade with us: ${lock}.` };
  const side = spec.mode === 'import' ? 'buy' : 'sell';
  const p = price(s, spec.hub, spec.res, side);
  if (p === null) return { lines: [], reason: `${HUB_DEFS[spec.hub].name} will not ${spec.mode === 'import' ? 'sell us' : 'buy'} ${resName(spec.res)}.` };
  const value = p * spec.qty;
  const base = TRADE_BASE[spec.res] * spec.qty;
  const one = tripDays(s, spec.hub, spec.qty);
  const profit = spec.mode === 'export' ? value - base : base - value;
  const lines = [
    `${fmt(p)} den each (base ${TRADE_BASE[spec.res]}) · ${spec.mode === 'export' ? `+${fmt(value)} den on return` : `−${fmt(value)} den at dispatch`}`,
    `${one} days each way, back in ${2 * one} days (${realTime(2 * one, g.speed)})`,
    `${profit >= 0 ? 'Gain' : 'Loss'} against the base price: ${profit >= 0 ? '+' : '−'}${fmt(Math.abs(profit))} den · ${fmt(value / (2 * one))} den a day on the road`,
  ];
  const free = caravanSlots(s) - slotsInUse(s);
  const check = checkDispatch(s, spec, view(s));
  lines.push(!check.ok ? `It would wait: ${check.reason}` : free > 0 ? 'A mule team is free: it leaves on the next day.' : 'Every mule team is on the road: it waits for one.');
  return { lines, reason: null };
}

/** The new-contract form: hub → mode → good → quantity → repeat, with the live preview; a self-contained re-render. */
function form(g: Game, up: Updater[]): HTMLElement {
  const box = h('div', { class: 'card tr-form', 'data-anchor': 'new-contract' });
  const out = h('div', { class: 'tr-preview' });
  let paintNow = (): void => undefined;
  up.push(() => paintNow());
  const render = (): void => {
    const s = g.state;
    const d = (draft ??= defaultDraft(s));
    const set = (patch: Partial<ContractSpec>): void => { draft = { ...(draft ?? d), ...patch }; g.sfx('click'); render(); };
    const hubSel = h('select', { class: 'tr-select', 'aria-label': 'Market', onchange: (e: Event) => set({ hub: (e.target as HTMLSelectElement).value as HubId }) },
      HUBS.map((x) => h('option', { value: x, selected: x === d.hub, disabled: !hubOpen(s, x) },
        `${HUB_DEFS[x].name} · ${HUB_DEFS[x].days} d${HUB_DEFS[x].rank > s.rank ? ` · opens at ${RANK_DEFS[HUB_DEFS[x].rank].name}` : ''}`)));
    const mode = h('div', { class: 'tab-seg' }, (['export', 'import'] as const).map((m) =>
      h('button', { class: `btn small tab-seg-btn${d.mode === m ? ' sel' : ''}`, type: 'button', onclick: () => set({ mode: m }) }, m === 'export' ? 'Sell (export)' : 'Buy (import)')));
    const goods = h('div', { class: 'tr-goods' }, TRADE_RES.map((r) => {
      const p = price(s, d.hub, r, d.mode === 'import' ? 'buy' : 'sell');
      const b = h('button', { class: `chip tr-good${d.res === r ? ' on' : ''}${p === null ? ' off' : ''}`, type: 'button', onclick: () => set({ res: r }) },
        img(resIcon(r), 1, 'chip-ico'), RESOURCE_DEFS[r].name);
      tip(b, p === null ? `${HUB_DEFS[d.hub].name} will not ${d.mode === 'import' ? 'sell' : 'buy'} it.` : `${fmt(p)} den each · we hold ${fmt(s.res[r])}`);
      return b;
    }));
    const qty = h('input', { type: 'range', class: 'ed-slider', min: 1, max: B.ordo.CARGO, step: 1, value: String(d.qty), 'aria-label': 'Quantity' });
    const qtyVal = h('span', { class: 'ed-val num' }, `${d.qty}`);
    qty.addEventListener('input', () => { draft = { ...(draft ?? d), qty: Number(qty.value) }; qtyVal.textContent = qty.value; paint(); });
    qty.addEventListener('change', () => render());
    const repeat = h('label', { class: 'tr-repeat' }, h('input', { type: 'checkbox', checked: d.repeat, onchange: (e: Event) => set({ repeat: (e.target as HTMLInputElement).checked }) }),
      'Standing contract: repeat whenever a mule team is free');
    let reason: string | null = null;
    const sendBtn = h('button', { class: 'btn primary', type: 'button' }, replaceId !== null ? 'Replace the contract' : 'Send the caravan');
    tip(sendBtn, () => reason ?? 'Draw up the contract: it leaves when a mule team is free.');
    sendBtn.addEventListener('click', () => {
      const st = g.state;
      if (reason) { g.act({ ok: false, code: 'invalid', reason }); return; }
      if (replaceId !== null) { if (!g.act(A.cancelContract(st, replaceId)).ok) return; replaceId = null; }
      g.act(A.createContract(st, { ...(draft ?? d) }), { okSfx: 'coin' });
    });
    const send = h('div', { class: 'tab-row-end' }, sendBtn);
    box.replaceChildren(
      h('div', { class: 'tr-form-head' }, h('b', null, replaceId !== null ? `Edit contract #${replaceId}` : 'New contract'),
        replaceId !== null ? btn(g, 'Stop editing', () => { replaceId = null; render(); }, { cls: 'ghost', sfx: false }) : null),
      h('div', { class: 'tr-field' }, h('span', { class: 'tr-lab' }, 'Market'), hubSel),
      h('div', { class: 'tr-field' }, h('span', { class: 'tr-lab' }, 'We'), mode),
      h('div', { class: 'tr-field' }, h('span', { class: 'tr-lab' }, 'Goods'), goods),
      h('div', { class: 'tr-field' }, h('span', { class: 'tr-lab' }, 'Load'), qty, qtyVal,
        h('span', { class: 'tr-quick' }, QUICK.map((n) => h('button', { class: 'btn small ghost', type: 'button', onclick: () => set({ qty: n }) }, String(n))))),
      repeat, out, send);
    let shown = '';
    const paint = (): void => {
      const pv = preview(g, draft ?? d);
      reason = pv.reason;
      sendBtn.classList.toggle('is-off', !!reason);
      sendBtn.setAttribute('aria-disabled', String(!!reason));
      const key = (reason ? [reason] : pv.lines).join('\n');
      if (key === shown) return;
      shown = key;
      out.classList.toggle('bad', !!reason);
      out.replaceChildren(...(reason ? [reason] : pv.lines).map((l) => h('div', null, l)));
    };
    paintNow = paint;
    paint();
  };
  render();
  return box;
}

function caravanRow(g: Game, c: Caravan, up: Updater[]): HTMLElement {
  const pb = bar('gold');
  const when = h('span', { class: 'tr-when' });
  const refresh = (): void => {
    const s = g.state;
    pb.set((s.day - c.depart) / Math.max(1, c.arrive - c.depart));
    const left = Math.max(0, c.arrive - s.day);
    when.textContent = `back ${formatRoman(c.arrive)} · ${left} d`;
  };
  refresh();
  up.push(refresh);
  const what = `${c.mode === 'export' ? 'Selling' : 'Buying'} ${c.qty} ${resName(c.res)} ${c.mode === 'export' ? 'to' : 'from'} ${HUB_DEFS[c.hub].name}`;
  return h('div', { class: 'tr-row' }, img(resIcon(c.res), 2),
    h('div', { class: 'tr-row-main' }, h('div', null, what, c.kind !== 'contract' ? h('span', { class: 'chip gold' }, c.kind === 'relief' ? 'relief' : 'emergency') : null),
      h('div', { class: 'tr-sub' }, `${c.mode === 'export' ? '+' : '−'}${fmt(c.value)} den · `, when), pb.el));
}

function contractRow(g: Game, c: Contract): HTMLElement {
  const status = c.status === 'paused' ? `paused: ${c.pause ? PAUSE[c.pause] : 'waiting'}` : c.status === 'travelling' ? 'on the road' : 'waiting for a mule team';
  const cancel = h('button', { class: 'btn small ghost', type: 'button' }, 'Cancel');
  confirm2(cancel, 'Cancel?', () => { g.act(A.cancelContract(g.state, c.id), { okSfx: 'click' }); });
  return h('div', { class: `tr-row${c.status === 'paused' ? ' paused' : ''}` }, img(resIcon(c.res), 2),
    h('div', { class: 'tr-row-main' },
      h('div', null, c.owner === 'ordo' ? img('i_seal', 1, 'tr-seal') : null,
        `${c.mode === 'export' ? 'Sell' : 'Buy'} ${c.qty} ${resName(c.res)} · ${HUB_DEFS[c.hub].name}`, c.repeat ? h('span', { class: 'chip' }, '↻ standing') : null),
      h('div', { class: `tr-sub ${c.status === 'paused' ? 'bad' : ''}` }, `${status} · ${c.trips} ${c.trips === 1 ? 'trip' : 'trips'}`),
      c.owner === 'ordo' && c.reason ? h('div', { class: 'tab-why' }, reasonText(c.reason)) : null),
    h('div', { class: 'tr-btns' },
      c.status === 'paused' ? btn(g, 'Resume', () => A.resumeContract(g.state, c.id)) : null,
      btn(g, 'Edit', () => { draft = { hub: c.hub, mode: c.mode, res: c.res, qty: c.qty, repeat: c.repeat }; replaceId = c.id; formVersion++; g.changed(); },
        { cls: 'ghost', sfx: false, tip: 'Load it into the form; sending replaces it.' }),
      cancel));
}

function offerRow(g: Game, o: MerchantOffer): HTMLElement {
  const s = g.state;
  const total = o.price * o.qty;
  const weBuy = o.kind === 'buy';
  const reason = o.taken ? 'Already struck.' : weBuy && s.res.denarii < total ? `We hold only ${fmt(s.res.denarii)} den.` : !weBuy && s.res[o.res] < o.qty ? `We hold only ${fmt(s.res[o.res])} ${resName(o.res)}.` : null;
  return h('div', { class: `tr-row${o.taken ? ' taken' : ''}` }, img(resIcon(o.res), 2),
    h('div', { class: 'tr-row-main' }, `${weBuy ? 'Buy' : 'Sell'} ${o.qty} ${resName(o.res)} at ${fmt(o.price)} each`,
      h('div', { class: 'tr-sub' }, `${weBuy ? '−' : '+'}${fmt(total)} den · base ${TRADE_BASE[o.res]}`)),
    btn(g, o.taken ? 'Struck' : 'Strike the deal', () => A.takeOffer(g.state, o.id), { cls: 'primary', reason, sfx: false }));
}

function hubCard(g: Game, hub: HubId): HTMLElement {
  const s = g.state;
  const d = HUB_DEFS[hub];
  const open = hubOpen(s, hub);
  return h('div', { class: `tr-hub${open ? '' : ' locked'}`, 'data-anchor': `hub-${hub}` },
    h('div', { class: 'tr-hub-head' }, h('b', null, d.name), h('span', { class: 'muted' }, ` · ${d.days} days each way`),
      open ? null : h('span', { class: 'chip' }, hubLock(s, hub) ?? '')),
    h('div', { class: 'tr-sub' }, d.desc),
    !open ? null : h('div', { class: 'tr-prices' }, h('span', { class: 'pop-k' }, ''), h('span', { class: 'pop-k' }, 'WE BUY'), h('span', { class: 'pop-k' }, 'THEY PAY'),
      TRADE_RES.flatMap((r) => [h('span', { class: 'tr-good-n' }, img(resIcon(r), 1, 'chip-ico'), RESOURCE_DEFS[r].name), priceEl(price(s, hub, r, 'buy'), r, 'buy'), priceEl(price(s, hub, r, 'sell'), r, 'sell')])));
}

/** The Trade tab. */
export const panel: TabPanel = {
  id: 'trade', label: 'Commercium', sub: 'Trade', icon: 'i_tab_trade', hotkey: 'T',
  signature(g: Game): string {
    const s = g.state;
    const t = s.trade;
    return [HUBS.map((x) => +hubOpen(s, x)).join(''), t.contracts.map((c) => `${c.id}:${c.status}:${c.pause ?? ''}`).join(','),
      t.caravans.map((c) => c.id).join(','), t.merchant ? `${t.merchant.name}:${t.merchant.offers.map((o) => +o.taken).join('')}` : '',
      formVersion, replaceId ?? '', caravanSlots(s)].join('|');
  },
  build(g: Game, body: HTMLElement, up: Updater[]): void {
    const s = g.state;
    const t = s.trade;
    const anyOpen = HUBS.some((x) => hubOpen(s, x));
    const slots = h('span', { class: 'chip' });
    const refreshSlots = (): void => { slots.textContent = `${slotsInUse(g.state)} of ${caravanSlots(g.state)} mule teams out`; };
    refreshSlots();
    up.push(refreshSlots);
    body.append(h('div', { class: 'tr-top' }, slots, anyOpen ? null : h('span', { class: 'muted' }, 'Trade opens at Vicus, or at once with the Emporium castrense charter.')));
    if (t.merchant) {
      const m = t.merchant;
      const sec = section('Mercator', `${m.name} camp at the forum`, { anchor: 'merchant',
        extra: h('span', { class: 'chip gold' }, `${Math.max(0, m.until - s.day)} d left`) });
      sec.append(...m.offers.map((o) => offerRow(g, o)));
      body.append(sec);
    }
    const car = section('Iter', 'Caravans on the road', { anchor: 'caravans' });
    if (t.caravans.length) car.append(...t.caravans.map((c) => caravanRow(g, c, up)));
    else car.append(h('div', { class: 'tab-quiet' }, 'No caravan is on the road.'));
    body.append(car);
    const con = section('Pacta', 'Contracts', { anchor: 'contracts', note: 'A standing contract repeats on its own and pauses itself rather than hurt us.' });
    if (t.contracts.length) con.append(...t.contracts.map((c) => contractRow(g, c)));
    else con.append(h('div', { class: 'tab-quiet' }, anyOpen ? 'No contracts yet. Draw one up below.' : 'No market trades with us yet.'));
    body.append(con);
    const nf = section('Novum pactum', 'Draw up a contract', { anchor: 'form',
      note: 'Far markets pay more and sell cheaper, but take longer.' });
    nf.append(form(g, up));
    body.append(nf);
    const hubs = section('Fora', 'The markets', { anchor: 'hubs' });
    hubs.append(...HUBS.filter((x) => HUB_DEFS[x].rank <= s.rank + 1 || hubOpen(s, x)).map((x) => hubCard(g, x)));
    body.append(hubs);
  },
  badge(g: Game) {
    const t = g.state.trade;
    const paused = t.contracts.filter((c) => c.status === 'paused').length;
    if (paused) return { text: String(paused), kind: 'warn' };
    return t.merchant ? { text: 'M', kind: 'gold' } : null;
  },
  focus(anchor: string): void {
    if (anchor === 'new-contract') replaceId = null;
  },
};

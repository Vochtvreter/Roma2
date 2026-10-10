// src/ui/audio.ts — the 17 synthesized sound effects, no files (DESIGN §17). Owner: WP-H.
// Master gain B.ui.SFX_GAIN × volume; B.ui.SFX_THROTTLE_MS per-sound throttle. The AudioContext is created on the first
// sound (always after a user gesture) and resumed if the browser suspended it. Math.random here is cosmetic (noise).
import type { SfxName } from './types';
import { B } from '../game/balance';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = true;
let volume = 0.7;
const last: Partial<Record<SfxName, number>> = {};

/** Applies the sound prefs (on/off and volume 0..1). */
export function setAudio(on: boolean, vol: number): void {
  enabled = on;
  volume = Math.max(0, Math.min(1, vol));
  if (master && ctx) master.gain.setTargetAtTime(B.ui.SFX_GAIN * volume, ctx.currentTime, 0.02);
}

function ensure(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    master = ctx.createGain();
    master.gain.value = B.ui.SFX_GAIN * volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One oscillator note: attack, exponential decay, optional pitch slide, optional destination node. */
function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.5,
  opts: { slide?: number; attack?: number; dest?: AudioNode } = {}): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + opts.slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + (opts.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g);
  g.connect(opts.dest ?? master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** A filtered noise burst (shared 1 s white-noise buffer), with an optional filter sweep. */
function noise(start: number, dur: number, vol: number, type: BiquadFilterType, freq: number, sweepTo?: number, q = 1): void {
  if (!ctx || !master) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + start;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0, Math.random() * 0.5, dur + 0.05);
}

/** The recipes (DESIGN §17): Hearthlands' nine plus the eight Roman sounds. */
const RECIPES: Record<SfxName, (c: AudioContext) => void> = {
  click: () => tone(660, 0, 0.05, 'square', 0.18),
  place: () => { tone(330, 0, 0.08, 'square', 0.25); noise(0, 0.12, 0.3, 'lowpass', 900); },
  build: () => { tone(392, 0, 0.09, 'square', 0.22); tone(523, 0.09, 0.09, 'square', 0.22); tone(659, 0.18, 0.18, 'square', 0.22); },
  birth: () => { tone(880, 0, 0.12, 'triangle', 0.25); tone(1175, 0.1, 0.18, 'triangle', 0.22); },
  death: () => tone(220, 0, 0.35, 'triangle', 0.25, { slide: -80 }),
  discover: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.14, 'square', 0.18)),
  event: () => { tone(494, 0, 0.12, 'triangle', 0.3); tone(370, 0.12, 0.22, 'triangle', 0.3); },
  error: () => tone(160, 0, 0.12, 'square', 0.2, { slide: -40 }),
  victory: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.16, i === 6 ? 0.8 : 0.32, 'square', 0.2)),
  coin: () => { tone(1320, 0, 0.06, 'triangle', 0.25); tone(1760, 0.07, 0.12, 'triangle', 0.25); },
  cornu: (c) => {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.connect(master as GainNode);
    [196, 262, 330, 392].forEach((f, i) => tone(f, i * 0.09, 0.9 - i * 0.09, 'sawtooth', 0.14, { attack: 0.06, dest: lp }));
  },
  lyre: () => [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.09, 0.45, 'triangle', 0.22, { attack: 0.003 })),
  tink: () => tone(1046, 0, 0.04, 'square', 0.15),
  crackle: () => { for (let i = 0; i < 6; i++) noise(i * 0.05 + Math.random() * 0.03, 0.04 + Math.random() * 0.04, 0.35, 'bandpass', 1400 + Math.random() * 1600, undefined, 4); },
  splash: () => { noise(0, 0.45, 0.35, 'lowpass', 3000, 300); tone(523, 0.05, 0.12, 'sine', 0.06, { slide: 200 }); },
  tintinnabulum: () => { tone(1568, 0, 0.6, 'triangle', 0.22, { attack: 0.002 }); tone(2093, 0.02, 0.5, 'triangle', 0.16, { attack: 0.002 }); },
  gate: () => {
    tone(95, 0, 0.2, 'triangle', 0.45, { slide: -45, attack: 0.002 });
    noise(0, 0.1, 0.35, 'lowpass', 500);
    tone(1318, 0.16, 0.25, 'triangle', 0.1, { attack: 0.002 });
    tone(1568, 0.26, 0.3, 'triangle', 0.09, { attack: 0.002 });
  },
};

/** Plays one sound (throttled per name; silent when sound is off or WebAudio is missing). */
export function sfx(name: SfxName): void {
  if (!enabled || volume <= 0) return;
  const now = performance.now();
  if (now - (last[name] ?? -Infinity) < B.ui.SFX_THROTTLE_MS) return;
  last[name] = now;
  const c = ensure();
  if (!c || !master) return;
  RECIPES[name](c);
}

// src/ui/audio.ts — synthesized sound effects, no files (DESIGN §17). Owner: WP-H.
// Master gain 0.22 × volume; 70 ms per-sound throttle. Cosmetic: Math.random is fine here (noise buffers).
import type { SfxName } from './types';

const MASTER = 0.22;
const THROTTLE_MS = 70;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let volume = 0.7;
const last: Partial<Record<SfxName, number>> = {};

/** Applies the sound prefs (on/off and volume 0..1). */
export function setAudio(on: boolean, vol: number): void {
  enabled = on;
  volume = Math.max(0, Math.min(1, vol));
  if (master) master.gain.value = MASTER * volume;
}

function ensure(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    master = ctx.createGain();
    master.gain.value = MASTER * volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.5, slide = 0, dest?: AudioNode): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g);
  g.connect(dest ?? master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(start: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, sweepTo?: number): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + start;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
}

/** Plays one sound (throttled per name; silent when sound is off or WebAudio is missing). */
export function sfx(name: SfxName): void {
  if (!enabled || volume <= 0) return;
  const now = performance.now();
  if (now - (last[name] ?? -Infinity) < THROTTLE_MS) return;
  last[name] = now;
  const c = ensure();
  if (!c || !master) return;
  switch (name) {
    case 'click': tone(660, 0, 0.05, 'square', 0.18); break;
    case 'place': tone(330, 0, 0.08, 'square', 0.25); noise(0, 0.12, 0.25, 'lowpass', 900); break;
    case 'build': tone(392, 0, 0.09, 'square', 0.25); tone(523, 0.09, 0.09, 'square', 0.25); tone(659, 0.18, 0.16, 'square', 0.25); break;
    case 'birth': tone(880, 0, 0.12, 'triangle', 0.25); tone(1175, 0.1, 0.18, 'triangle', 0.22); break;
    case 'death': tone(220, 0, 0.35, 'triangle', 0.25, -80); break;
    case 'discover': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.14, 'square', 0.18)); break;
    case 'event': tone(494, 0, 0.12, 'triangle', 0.3); tone(370, 0.12, 0.2, 'triangle', 0.3); break;
    case 'error': tone(160, 0, 0.12, 'square', 0.2, -40); break;
    case 'victory': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.16, 0.32, 'square', 0.2)); break;
    case 'coin': tone(1320, 0, 0.06, 'triangle', 0.25); tone(1760, 0.07, 0.1, 'triangle', 0.25); break;
    case 'cornu': {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      lp.connect(master);
      [196, 262, 330, 392].forEach((f, i) => tone(f, i * 0.12, 0.9 - i * 0.12, 'sawtooth', 0.16, 0, lp));
      break;
    }
    case 'lyre': [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.09, 0.35, 'triangle', 0.22)); break;
    case 'tink': tone(1046, 0, 0.04, 'square', 0.15); break;
    case 'crackle': for (let i = 0; i < 4; i++) noise(i * 0.07, 0.05, 0.3, 'bandpass', 1800); break;
    case 'splash': noise(0, 0.4, 0.3, 'lowpass', 3000, 300); break;
    case 'tintinnabulum': tone(1568, 0, 0.5, 'triangle', 0.22); tone(2093, 0.02, 0.45, 'triangle', 0.16); break;
    case 'gate': tone(110, 0, 0.18, 'triangle', 0.4, -40); noise(0, 0.08, 0.3, 'lowpass', 400); tone(1318, 0.15, 0.2, 'triangle', 0.12); tone(1568, 0.25, 0.2, 'triangle', 0.1); break;
  }
}

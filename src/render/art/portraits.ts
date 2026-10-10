// src/render/art/portraits.ts — 6 advisors × 3 moods, mentor, notes, silhouette (24×24, DESIGN §11.3). Owner: WP-G (G1).
// One bust per person; the three moods (calm / concerned / alarmed) swap the brow, eye and mouth rows and the cheeks.
import { ADVISORS } from '../../game/types';
import type { AdvisorId } from '../../game/types';
import { registerArt } from '../sprites';
import { Pix } from './gridkit';

type Mood = 0 | 1 | 2;
const SIZE = 24;

/** Head rows: [row, first col, last col] of the skin, chin last. */
const HEAD: readonly [number, number, number][] = [
  [4, 9, 14], [5, 8, 15], [6, 7, 16], [7, 7, 16], [8, 7, 16], [9, 7, 16], [10, 7, 16], [11, 7, 16],
  [12, 7, 16], [13, 8, 15], [14, 8, 15], [15, 9, 14], [16, 10, 13],
];
/** Shoulder rows of the garment: [row, first col, last col]. */
const BODY: readonly [number, number, number][] = [
  [17, 6, 17], [18, 4, 19], [19, 3, 20], [20, 2, 21], [21, 2, 21], [22, 2, 21], [23, 2, 21],
];

interface Look {
  cloth: string; clothShade: string; clothLit: string;
  skin?: string; skinShade?: string;
}

/** The common bust: shaded head, ears, neck, a garment over the shoulders. */
function bust(l: Look): Pix {
  const p = new Pix(SIZE, SIZE);
  const sk = l.skin ?? 'h', sh = l.skinShade ?? 'H';
  for (const [y, a, b] of BODY) {
    for (let x = a; x <= b; x++) p.set(x, y, x <= a + 1 ? l.clothLit : x >= b - 2 ? l.clothShade : l.cloth);
  }
  p.rect(10, 15, 4, 3, sk).set(13, 16, sh).set(13, 17, sh);           // neck
  p.set(10, 17, sh).set(11, 18, sk).set(12, 18, sh);                  // neckline
  for (const [y, a, b] of HEAD) for (let x = a; x <= b; x++) p.set(x, y, x >= b - 1 ? sh : sk);
  p.vline(6, 9, 11, sk).set(6, 11, sh).vline(17, 9, 11, sh);           // ears
  p.set(12, 11, sh).set(12, 12, sh).set(11, 12, sh);                   // nose
  return p;
}

/** Hair cap over the top of the head with sideburns; `fringe` lowers the hairline at the front. */
function hair(p: Pix, key: string, shade: string, fringe = 0): void {
  const cap: [number, number, number][] = [[3, 9, 14], [4, 8, 15], [5, 7, 16], [6, 7, 16]];
  for (const [y, a, b] of cap) for (let x = a; x <= b; x++) p.set(x, y, x >= b - 1 ? shade : key);
  for (let f = 0; f < fringe; f++) p.hline(8, 15, 7 + f, f % 2 ? shade : key).set(15, 7 + f, shade);
  p.vline(7, 7, 9, key).vline(16, 7, 9, shade);
}

/** Brows, eyes, mouth and cheeks for a mood; `brow` is the brow key, `mouthY` the mouth row. */
function face(p: Pix, mood: Mood, brow: string, mouthY = 14): void {
  p.set(9, 10, 'w').set(10, 10, 'q').set(13, 10, 'w').set(14, 10, 'q');
  if (mood === 2) p.set(10, 9, 'w').set(14, 9, 'w');                    // wide open
  if (mood === 0) p.hline(9, 10, 8, brow).hline(13, 14, 8, brow);
  else if (mood === 1) p.set(9, 8, brow).set(10, 7, brow).set(13, 7, brow).set(14, 8, brow);
  else p.hline(9, 10, 7, brow).hline(13, 14, 7, brow);
  if (mood === 0) p.hline(11, 12, mouthY, 'R').set(10, mouthY - 1, 'R').set(13, mouthY - 1, 'R');
  else if (mood === 1) p.hline(10, 13, mouthY, 'R').set(10, mouthY + 1, 'H');
  else p.rect(11, mouthY - 1, 2, 2, 'q').set(10, mouthY - 1, 'R').set(13, mouthY - 1, 'R').hline(11, 12, mouthY + 1, 'R');
  if (mood === 2) p.set(8, 12, 'f').set(15, 12, 'f').vline(18, 5, 6, 'c').set(18, 7, 'w');   // flush, sweat drop
}

/** A beard over the jaw, leaving the mouth row open. */
function beard(p: Pix, key: string, shade: string, mouthY = 14): void {
  for (const [y, a, b] of HEAD) {
    if (y < 12) continue;
    for (let x = a; x <= b; x++) p.set(x, y, x >= b - 1 ? shade : key);
  }
  p.vline(7, 9, 11, key).vline(16, 9, 11, shade);
  p.hline(10, 13, mouthY, 'h');
}

/** Each advisor's bust with the DESIGN §11.3 portrait cues. */
const ADVISOR_ART: Record<AdvisorId, (mood: Mood) => Pix> = {
  // grey beard, ochre tunic, wheat-ear brooch
  annonae: (mood) => {
    const p = bust({ cloth: 's', clothShade: 'n', clothLit: 'T' });
    hair(p, 'W', 'g');
    p.hline(9, 14, 4, 'h').hline(10, 13, 3, '.');                         // receding crown
    beard(p, 'W', 'g');
    face(p, mood, 'g');
    p.vline(6, 18, 21, 'N').set(5, 18, 'y').set(7, 19, 'y').set(5, 20, 'y').set(7, 21, 'Y').set(6, 17, 'y');
    return p;
  },
  // blue-grey cloak, water jar on the shoulder
  aquarum: (mood) => {
    const p = bust({ cloth: 'g', clothShade: 'G', clothLit: 'z' });
    hair(p, 'A', 'b', 1);
    face(p, mood, 'b');
    p.hline(6, 17, 17, 'z').set(16, 18, 'N');                              // cloak edge and clasp
    p.rect(18, 15, 4, 5, 'u').vline(21, 15, 19, 'v').hline(19, 20, 14, 'u').set(18, 15, 'o');
    p.set(19, 13, 'c').set(20, 13, 'c').set(19, 12, 'w');
    return p;
  },
  // leather cap, soot smudge, groma pin
  fabrum: (mood) => {
    const p = bust({ cloth: 'U', clothShade: 'b', clothLit: 'B' });
    hair(p, 'A', 'b');
    for (const [y, a, b] of [[2, 9, 14], [3, 8, 15], [4, 7, 16], [5, 7, 16], [6, 6, 17]] as const)
      for (let x = a; x <= b; x++) p.set(x, y, y === 6 ? 'b' : x >= b - 1 ? 'B' : 'n');
    p.set(9, 3, 't').set(10, 3, 't');
    face(p, mood, 'b');
    p.set(8, 12, 'G').set(9, 13, 'G').set(9, 12, 'j');                     // soot
    p.rect(8, 18, 8, 6, 'n').vline(15, 18, 23, 'B');                       // leather apron
    p.hline(17, 21, 19, 'N').vline(19, 18, 22, 'N').set(17, 20, 'X').set(21, 20, 'X');   // groma pin
    return p;
  },
  // bald, toga with a thin stripe, wax tablet
  quaestor: (mood) => {
    const p = bust({ cloth: 'w', clothShade: 'W', clothLit: 'w' });
    p.hline(10, 13, 3, 'h').hline(9, 14, 4, 'h').set(10, 4, 'w');          // bald dome with a shine
    p.vline(7, 7, 10, 'G').vline(16, 7, 10, 'j').set(8, 7, 'G').set(15, 7, 'j');
    face(p, mood, 'G');
    p.vline(9, 18, 23, 'I');                                               // angusticlavus
    p.line(14, 17, 19, 23, 'W');                                           // toga fold
    p.rect(16, 18, 6, 5, 'n').rect(17, 19, 4, 3, 'K').hline(17, 19, 20, 'G');   // wax tablet
    return p;
  },
  // young, toga praetexta, city-plan scroll
  aedilis: (mood) => {
    const p = bust({ cloth: 'w', clothShade: 'W', clothLit: 'w' });
    hair(p, 'A', 'm', 1);
    for (let x = 8; x <= 15; x += 2) p.set(x, 3, 'b');                    // curls
    p.set(8, 8, 'A').set(15, 8, 'm');
    face(p, mood, 'm');
    p.line(4, 18, 9, 23, 'I').line(5, 18, 10, 23, 'I');                    // purple border of the praetexta
    p.rect(14, 19, 8, 3, 'T').hline(14, 21, 21, 'E').vline(13, 18, 22, 'n').vline(22, 18, 22, 'n');
    p.hline(15, 20, 20, 'C');                                              // the plan's lines
    return p;
  },
  // veiled head, curved lituus
  augur: (mood) => {
    const p = bust({ cloth: 'W', clothShade: 'i', clothLit: 'w' });
    const veil: [number, number, number][] = [[2, 9, 14], [3, 7, 16], [4, 6, 17], [5, 6, 17]];
    for (const [y, a, b] of veil) for (let x = a; x <= b; x++) p.set(x, y, x >= b - 1 ? 'i' : 'w');
    for (let y = 6; y <= 17; y++) { p.set(5, y, 'w').set(6, y, 'w').set(17, y, 'i').set(18, y, 'i'); }
    p.hline(7, 16, 6, 'W');
    face(p, mood, 'A');
    p.vline(20, 6, 23, 'N').vline(21, 7, 23, 'Y');                         // lituus
    p.set(20, 5, 'N').set(19, 4, 'N').set(18, 3, 'N').set(18, 2, 'Y').set(19, 1, 'N').set(20, 2, 'N');
    return p;
  },
};

/** The mentor: Decimus Cassius, primus pilus emeritus — cropped grey hair, a scar, red sagum and phalerae. */
function mentor(): Pix {
  const p = bust({ cloth: 'r', clothShade: 'R', clothLit: 'o' });
  hair(p, 'g', 'G');
  p.hline(9, 14, 3, 'W');
  face(p, 0, 'W');
  p.hline(10, 13, 14, 'R').set(10, 13, 'h').set(13, 13, 'h');          // a firm, level mouth
  p.line(15, 8, 14, 12, 'R');                                            // the scar
  p.rect(7, 18, 10, 6, 'X').vline(16, 18, 23, 'j');                      // tunic under the cloak
  for (const [x, y] of [[9, 19], [13, 19], [11, 21]]) p.rect(x, y, 2, 2, 'N').set(x, y, 'y');   // phalerae
  p.set(17, 17, 'N').set(18, 18, 'y');                                   // cloak brooch
  return p;
}

/** Sepia ramp for the "notes" variant (light → dark). */
const SEPIA: Record<string, string> = {
  w: 'e', a: 'e', T: 'e', h: 'T', y: 'T', W: 'E', z: 'E', i: 'E', e: 'T', s: 't', t: 't', o: 't', c: 'T',
  H: 'n', Y: 'n', u: 'n', g: 'n', n: 'n', N: 'n', E: 'n', f: 'n', r: 'B', B: 'B', U: 'B', G: 'B', C: 'B', I: 'B', F: 'B',
  R: 'b', v: 'b', X: 'b', j: 'b', A: 'b', b: 'b', m: 'm', q: 'm', K: 'm', x: 'm',
};

/** A dark bust for advisors not yet appointed. */
function silhouette(): Pix {
  const p = bust({ cloth: 'K', clothShade: 'K', clothLit: 'K', skin: 'K', skinShade: 'K' });
  hair(p, 'K', 'K');
  p.rect(10, 8, 3, 1, 'm').set(13, 9, 'm').set(12, 10, 'm').set(12, 12, 'm');   // a faint question mark
  return p;
}

/** Registers this group's sprites with registerArt()/registerDraw() (no canvas work at registration). */
export function registerPortraits(): void {
  for (const a of ADVISORS) for (const m of [0, 1, 2] as const) registerArt(`pt_${a}_${m}`, ADVISOR_ART[a](m).outline().rows());
  const m = mentor();
  registerArt('pt_mentor', m.clone().outline().rows());
  registerArt('pt_mentor_notes', m.recolor(SEPIA).outline().rows());
  registerArt('pt_silhouette', silhouette().outline().rows());
}

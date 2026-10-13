// tests/css-floor.test.ts — the type floor (DESIGN §16.1, P6 of the Adaptive Sheet): no font size under 12 px in any
// stylesheet of src/styles (literal px under 12 fail; the type tokens of tokens.css and calc() over them are checked by
// what they resolve to, at Normal and at Large, and so is every --fs-* token wherever a stylesheet sets it again), no
// shrinking relative size; the canvas's own type (the map's labels, kept whole on the screen; the chart) at 12 CSS px
// or more; no sheet or pane height in vh, which Safari and Chrome measure against the large
// viewport (the 46vh trap, platform.md §1); no :has() rule styling a part with nothing to match on, nor one on #app
// (the whole-page recalculation trap); and the Text size setting's storage (src/ui/textsize.ts), table by table.
// Headless: node's fs reads the CSS; nothing here touches a DOM.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DPR_MAX, LABEL_MIN_CSS, ZOOM_LEVELS, canvasDpr, labelLines, labelPx, scaleFor } from '../src/render/camera';
import { TEXT_SCALE, TEXT_SIZES, TEXT_SIZE_KEY, chartFontPx, parseTextSize, readTextSize, writeTextSize } from '../src/ui/textsize';
import type { TextSize } from '../src/ui/textsize';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STYLES = join(ROOT, 'src', 'styles');
const FLOOR = 12;
const CSS = readdirSync(STYLES).filter((f) => f.endsWith('.css')).sort().map((f) => ({ f, src: readFileSync(join(STYLES, f), 'utf8') }));

/** The CSS without its comments, line breaks kept (so a line number still points at the rule). */
function uncomment(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

interface Decl { f: string; line: number; sel: string; prop: string; value: string }

/** Every declaration with the selector of the rule it stands in (the innermost; @media and @container blocks pass). */
function declarations(f: string, src: string): Decl[] {
  const s = uncomment(src), out: Decl[] = [], stack: string[] = [];
  let buf = '', start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') { stack.push(buf.trim()); buf = ''; start = i + 1; continue; }
    if (c === '}') {
      const sel = stack.pop() ?? '';
      if (!sel.startsWith('@')) {
        const body = s.slice(start, i);
        let at = 0;
        for (const part of body.split(';')) {
          const m = /^\s*([-\w]+)\s*:\s*([\s\S]+?)\s*$/.exec(part);
          if (m) out.push({ f, line: s.slice(0, start + at).split('\n').length + (part.match(/^\s*/)?.[0].split('\n').length ?? 1) - 1, sel: sel.replace(/\s+/g, ' '), prop: m[1], value: m[2].replace(/\s*!important$/, '') });
          at += part.length + 1;
        }
      }
      buf = ''; start = i + 1;
      continue;
    }
    buf += c;
    if (c === ';') buf = '';   // an @import at the top level
  }
  return out;
}

const DECLS = CSS.flatMap(({ f, src }) => declarations(f, src));
const where = (d: Decl): string => `${d.f}:${d.line} ${d.sel.slice(-70)} { ${d.prop}: ${d.value} }`;

/** The type tokens of tokens.css: name → the px they stand for at a text scale of 1 (calc(Npx * var(--ts)) or Npx). */
function tokens(): Map<string, number> {
  const t = new Map<string, number>();
  for (const d of DECLS.filter((x) => x.f === 'tokens.css' && x.prop.startsWith('--fs-'))) {
    const m = /^calc\(\s*([\d.]+)px\s*\*\s*var\(--ts\)\s*\)$/.exec(d.value) ?? /^([\d.]+)px$/.exec(d.value);
    if (m && !t.has(d.prop)) t.set(d.prop, Number(m[1]));
  }
  t.set('--fs-base', t.get('--fs-body') ?? NaN);
  return t;
}
const TOKENS = tokens();
const TS_LARGE = Number(/#app\[data-text='large'\][^{]*\{[^}]*--ts:\s*([\d.]+)/.exec(uncomment(CSS.find((x) => x.f === 'tokens.css')?.src ?? ''))?.[1]);

/** What a font-size value comes to at text scale `ts`, in px; null for a size this test cannot reckon (a viewport
 *  clamp is reckoned by its lower bound). */
function resolve(value: string, ts: number): number | null {
  const v = value.trim();
  let m = /^var\((--fs-[\w-]+)\)$/.exec(v);
  if (m) return TOKENS.has(m[1]) ? (TOKENS.get(m[1]) ?? NaN) * ts : NaN;
  // a token held to a box's room under Large: min(var(--fs-…), Npx)
  if ((m = /^min\(\s*var\((--fs-[\w-]+)\)\s*,\s*([\d.]+)px\s*\)$/.exec(v))) return Math.min((TOKENS.get(m[1]) ?? NaN) * ts, Number(m[2]));
  if ((m = /^calc\(\s*([\d.]+)px\s*\*\s*var\(--ts\)\s*\)$/.exec(v))) return Number(m[1]) * ts;
  if ((m = /^(?:calc\(\s*)?clamp\(\s*([\d.]+)px\s*,[^)]*\)(?:\s*\*\s*var\(--ts\)\s*\))?$/.exec(v))) return Number(m[1]) * (v.includes('--ts') ? ts : 1);
  if ((m = /^([\d.]+)px$/.exec(v))) return Number(m[1]);
  return null;
}

describe('the type floor in src/styles', () => {
  const sizes = DECLS.filter((d) => d.prop === 'font-size');

  it('reads every stylesheet and finds the declarations', () => {
    expect(CSS.length).toBeGreaterThanOrEqual(15);
    expect(sizes.length).toBeGreaterThan(300);
  });

  it('has no px literal under 12 in any font-size (or font shorthand)', () => {
    const bad: string[] = [];
    for (const d of DECLS.filter((x) => x.prop === 'font-size' || x.prop === 'font')) {
      for (const m of d.value.matchAll(/(?<![\w.-])(\d*\.?\d+)px\b/g)) if (Number(m[1]) < FLOOR) bad.push(where(d));
    }
    expect(bad).toEqual([]);
  });

  it('shrinks nothing by a relative size or a keyword (em, rem, %, smaller, small…)', () => {
    const bad = sizes.filter((d) => /^(smaller|x+-small|small)$/.test(d.value.trim())
      || [...d.value.matchAll(/(?<![\w.-])(\d*\.?\d+)(em|rem|%)/g)].some((m) => Number(m[1]) < (m[2] === '%' ? 100 : 1)));
    expect(bad.map(where)).toEqual([]);
  });

  it('every font-size is a token, calc(Npx * var(--ts)), a token held by min(), or a viewport clamp: Text size Large scales it', () => {
    const bad = sizes.filter((d) => resolve(d.value, 1) === null || /^[\d.]+px$/.test(d.value.trim()));
    expect(bad.map(where)).toEqual([]);
  });

  it('every size resolves to 12 px or more, at Normal and at Large', () => {
    expect(TS_LARGE).toBe(TEXT_SCALE.large);
    const bad: string[] = [];
    for (const d of sizes) {
      for (const ts of [1, TS_LARGE]) {
        const px = resolve(d.value, ts);
        if (px === null || !(px >= FLOOR - 1e-9)) bad.push(`${where(d)} → ${px} at ×${ts}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every --fs-* token, wherever it is set (any file, any @media or @container block), comes to 12 px or more at Normal and at Large', () => {
    // a token lowered later in the cascade (a narrow-screen block, a host's own scale) would bring sub-12 px text back
    // under every font-size that reads it, unseen by the per-declaration checks above
    const sets = DECLS.filter((d) => d.prop.startsWith('--fs-'));
    expect(sets.length).toBeGreaterThanOrEqual(TOKENS.size + 2);   // tokens.css's scale, its 3 dppx caps and Large's
    const bad: string[] = [];
    for (const d of sets) {
      for (const ts of [1, TS_LARGE]) {
        const px = resolve(d.value, ts);
        if (px === null || !(px >= FLOOR - 1e-9)) bad.push(`${where(d)} → ${px} at ×${ts}`);
      }
    }
    expect(bad).toEqual([]);
    // and it would catch one: the reviewer's two traps
    const trap = [...declarations('trap.css', "@media (max-width: 1400px) { #app { --fs-caps: calc(10px * var(--ts)); --fs-xs: 9px; } }"),
      ...declarations('trap2.css', ':root, #app, #app ~ * { --fs-xs: calc(9px * var(--ts)); }')];
    expect(trap.filter((d) => d.prop.startsWith('--fs-') && !((resolve(d.value, 1) ?? 0) >= FLOOR)).length).toBe(3);
  });

  it('the tokens: the four of the design, each at 12 px or more, Silkscreen on whole device pixels at 3× and at Large', () => {
    expect(TOKENS.get('--fs-caps')).toBe(12);
    expect(TOKENS.get('--fs-small')).toBe(13);
    expect(TOKENS.get('--fs-body')).toBe(15);
    expect(TOKENS.get('--fs-num')).toBe(16);
    for (const [name, px] of TOKENS) expect(px, name).toBeGreaterThanOrEqual(FLOOR);
    const css = uncomment(CSS.find((x) => x.f === 'tokens.css')?.src ?? '');
    // 13.333 px: 5 device px a font pixel on a 3× screen (Silkscreen is 8 font pixels to the em)
    const at3x = /@media \(min-resolution: 3dppx\)\s*\{[^}]*--fs-caps:\s*calc\(\s*([\d.]+)px/.exec(css);
    expect(Number(at3x?.[1])).toBeCloseTo(40 / 3, 2);
    const fontPx3x = (Number(at3x?.[1]) * 3) / 8;
    expect(Math.abs(fontPx3x - Math.round(fontPx3x))).toBeLessThan(0.01);
    // Large: 16 px, whole font pixels at 1×, 2× and 3×
    const large = /#app\[data-text='large'\][^{]*\{[^}]*--fs-caps:\s*([\d.]+)px/.exec(css);
    expect(Number(large?.[1])).toBe(16);
    for (const dpr of [1, 2, 3]) expect(((16 * dpr) / 8) % 1).toBe(0);
    // kickers stay under titles: the scale only climbs
    const ramp = ['--fs-caps', '--fs-small', '--fs-line', '--fs-body', '--fs-num', '--fs-lead', '--fs-title', '--fs-hero'].map((n) => TOKENS.get(n) ?? NaN);
    expect(ramp.every((v, i) => i === 0 || v > ramp[i - 1])).toBe(true);
  });

  it('declares the tokens where #app and the layers beside it read their own --ts', () => {
    const css = uncomment(CSS.find((x) => x.f === 'tokens.css')?.src ?? '');
    expect(css).toMatch(/:root, #app, #app ~ \* \{[^}]*--fs-caps/);
    expect(css).toMatch(/#app\[data-text='large'\], #app\[data-text='large'\] ~ \* \{/);
  });
});

describe('no sheet or pane height in vh (the 46vh trap)', () => {
  // vh (and lvh) is the large viewport in Safari and Chrome: the toolbars the player sees cover part of it. A height of
  // the sheet, the drawer, the dock's pane or the panel (#side) is a share of #app (or svh / dvh) instead.
  const VH = /(?<![\w.])(\d*\.?\d+)l?vh\b/;
  const sheetish = (d: Decl): boolean => /^--(sheet|drawer|dock|cols|bar)/.test(d.prop)
    || (/^(height|min-height|max-height|top|bottom|inset)$/.test(d.prop) && /#side\b|sheet|drawer/.test(d.sel));

  it('finds the sheet heights it guards', () => {
    expect(DECLS.filter(sheetish).length).toBeGreaterThan(20);
  });

  it('has none in vh', () => {
    expect(DECLS.filter((d) => sheetish(d) && VH.test(d.value)).map(where)).toEqual([]);
  });

  it('catches the trap it is for', () => {
    const trap = declarations('trap.css', ':root { --sheet-open: min(46vh, calc(100% - 320px)); } #side { height: var(--sheet-open, 46vh); } #side { height: 46dvh; }');
    expect(trap.filter((d) => sheetish(d) && VH.test(d.value)).length).toBe(2);
  });
});

/** The top-level parts of a selector list, or of a complex selector at its combinators: brackets, parentheses and quotes
 *  kept whole. `at` ',' splits a list; ' ' splits a complex selector into its compounds (the combinators dropped). */
function splitTop(sel: string, at: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  const s = at === ' ' ? sel.replace(/\s*([>+~])\s*/g, ' ').trim() : sel;
  for (const c of s) {
    if (quote) { if (c === quote) quote = ''; cur += c; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (depth === 0 && (at === ',' ? c === ',' : /\s/.test(c))) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A compound selector without its :has() and :not() arguments (neither gives Blink a feature to invalidate by). */
function bare(compound: string): string {
  let out = '', depth = 0;
  for (let i = 0; i < compound.length; i++) {
    if (depth === 0 && /^:(has|not)\(/.test(compound.slice(i))) { depth = 1; i = compound.indexOf('(', i); continue; }
    if (depth > 0) { if (compound[i] === '(') depth++; else if (compound[i] === ')') depth--; continue; }
    out += compound[i];
  }
  return out;
}

/** A selector's compounds after one holding a :has() that have nothing to match on: no id, class, attribute or tag
 *  (a bare :last-child, *, ::before). */
function featurelessAfterHas(complex: string): string[] {
  const parts = splitTop(complex, ' ');
  const at = parts.findIndex((p) => p.includes(':has('));
  if (at < 0) return [];
  return parts.slice(at + 1).filter((p) => !/[#.[]|^[a-z]/i.test(bare(p)));
}

/** A selector with a :has() in a compound that names #app or an element above it (:root, html, body): Blink checks it
 *  again on each change under that element, every frame's HUD figures among them. */
function hasOnRoot(complex: string): boolean {
  return splitTop(complex, ' ').some((p) => p.includes(':has(') && /(?<![\w-])(#app|:root|html|body)(?![\w-])/.test(p.slice(0, p.indexOf(':has('))));
}

describe('no :has() rule that styles a part with nothing to match on (the whole-page recalculation trap)', () => {
  // Blink pools what every rule with a :has() in a non-subject compound styles into one invalidation set: one whose part
  // has no id, class, attribute or tag (`.tr-field:has(.ed-slider) > :last-child`) makes it the whole subtree, so each
  // text change under #app (a HUD figure every frame; #app has :has() rules of its own) recalculated the style of the
  // whole page: ~10× origin/main's time on the desktop. Name the part by its class instead.
  const selectors = [...new Set(DECLS.map((d) => d.sel))].flatMap((s) => splitTop(s, ','));

  it('finds the :has() rules it guards', () => {
    expect(selectors.filter((s) => s.includes(':has(')).length).toBeGreaterThan(20);
  });

  it('has none', () => {
    expect(selectors.filter((s) => featurelessAfterHas(s).length > 0)).toEqual([]);
  });

  it('has no :has() on #app or above it (they key on #app[data-panel] and the like: ui/panels.ts panelTokens)', () => {
    expect(selectors.filter(hasOnRoot)).toEqual([]);
  });

  it('catches a :has() on #app or above it, and lets one further down pass', () => {
    for (const s of ["#app[data-host='columns']:has(#side.empty)", '#app:has(#side.collapsed) #choice',
      "#app:where(:not([data-host='dock'])):has(#side.collapsed) #ticker", '#app#app.placing:not(:has(> #tabs:empty))',
      ':root:has(#side.empty) #left', 'body:has(.modal-back) #app']) expect(hasOnRoot(s), s).toBe(true);
    for (const s of ["#app#app[data-host='columns'][data-panel~='empty']", "#app[data-host='dock'] #side:has(> #tray.tray-col) > #tabs",
      "#app:is([data-host='sheet'], [data-host='drawer']) #hud:has(.hud-speed.open)", '#counsel:has(> .counsel-card.offer)',
      '.counsel-body:has(.x)', '#app-shell:has(.x)']) expect(hasOnRoot(s), s).toBe(false);
  });

  it('catches the trap it is for, and lets a named part or the subject itself pass', () => {
    expect(featurelessAfterHas('.tr-field:has(.ed-slider) > :last-child')).toEqual([':last-child']);
    expect(featurelessAfterHas("#app[data-host='x']:has(#side.empty) *")).toEqual(['*']);
    expect(featurelessAfterHas('.a:has(> .b) ::before')).toEqual(['::before']);
    expect(featurelessAfterHas('.tr-field:has(.ed-slider) > .tr-quick')).toEqual([]);
    expect(featurelessAfterHas("#app:has(#side.collapsed) #choice")).toEqual([]);
    expect(featurelessAfterHas('.modal-back:has(~ .modal-back:not(.modal-out)) > .modal')).toEqual([]);
    expect(featurelessAfterHas("#hud > .hud-coin:not(:has(+ .hud-souls[hidden]))")).toEqual([]);
    expect(featurelessAfterHas('#side:has(> #tray.tray-col) > :is(#tabs, #tab-body)')).toEqual([]);
  });
});

describe('canvas type at the floor', () => {
  const SRC = ['render', 'ui'].flatMap((dir) => readdirSync(join(ROOT, 'src', dir)).filter((f) => f.endsWith('.ts')).map((f) => ({ f: `${dir}/${f}`, src: readFileSync(join(ROOT, 'src', dir, f), 'utf8') })));

  // a size literal anywhere in the font string ('7px Silkscreen', 'bold 7px Silkscreen'); a template's ${…} is sized by
  // a helper the cases below pin (labelPx, chartFontPx)
  const FONT_PX = /\.font\s*=\s*['"`][^'"`$]*?(\d+(?:\.\d+)?)px/g;

  it('no canvas font literal under 12 px (the map labels and the chart size theirs: labelPx, chartFontPx)', () => {
    const bad: string[] = [];
    for (const { f, src } of SRC) for (const m of src.matchAll(FONT_PX)) if (Number(m[1]) < FLOOR) bad.push(`${f}: ${m[0]}`);
    expect(bad).toEqual([]);
    const caught = (line: string): number[] => [...line.matchAll(FONT_PX)].map((m) => Number(m[1]));
    expect(caught("g.font = '7px Silkscreen, monospace';")).toEqual([7]);
    expect(caught("g.font = 'bold 7px Silkscreen';")).toEqual([7]);
    expect(caught('g.font = `italic 600 9.5px Pixelify`;')).toEqual([9.5]);
    expect(caught('g.font = `${px}px Silkscreen, monospace`;')).toEqual([]);
  });

  it('the year chart: 12 px at Normal, 16 under Large, and vitals.ts sizes it so', () => {
    expect(chartFontPx('normal')).toBe(12);
    expect(chartFontPx('large')).toBe(16);
    for (const t of TEXT_SIZES) expect(chartFontPx(t)).toBeGreaterThanOrEqual(FLOOR);
    const vitals = SRC.find((x) => x.f === 'ui/vitals.ts')?.src ?? '';
    expect(vitals).toMatch(/=\s*chartFontPx\(textSize\(\)\)/);
    expect(vitals).toMatch(/\.font\s*=\s*`\$\{FS\}px Silkscreen/);
  });

  it('labelPx: on the 8 px grid, 12 CSS px or more at every zoom and device pixel ratio', () => {
    for (const level of ZOOM_LEVELS) {
      for (const raw of [1, 1.5, 2, 2.625, 3, 4, 5]) {
        const dpr = canvasDpr(raw), cssPerWorld = scaleFor(level, dpr) / dpr, px = labelPx(cssPerWorld);
        expect(px % 8, `level ${level} dpr ${raw}`).toBe(0);
        expect(px * cssPerWorld, `level ${level} dpr ${raw}`).toBeGreaterThanOrEqual(LABEL_MIN_CSS - 1e-9);
        // past 3× the canvas draws at 3× (view.ts), so a label is the size it is at 3×, never twice it
        if (raw > DPR_MAX) expect(px).toBe(labelPx(scaleFor(level, DPR_MAX) / DPR_MAX));
      }
    }
    // 16 CSS px from zoom 2 on a 1×, 2× or 3× screen, however far past 3× the browser is zoomed
    for (const raw of [1, 2, 3, 4, 5]) {
      const dpr = canvasDpr(raw), k = scaleFor(2, dpr);
      expect(labelPx(k / dpr) * (k / dpr), `dpr ${raw}`).toBe(16);
    }
  });

  it.each([[undefined, 1], [0, 1], [1, 1], [2, 2], [2.625, 2.625], [3, 3], [4, 3], [5, 3]])('canvasDpr(%s) = %s', (raw, want) => {
    expect(canvasDpr(raw)).toBe(want);
  });

  it('the view, the minimap and the labels read the one capped ratio', () => {
    for (const f of ['render/view.ts', 'render/minimap.ts', 'render/placement.ts']) {
      const src = SRC.find((x) => x.f === f)?.src ?? '';
      expect(src, f).toMatch(/canvasDpr\(/);
      expect(src.replace(/canvasDpr\([^)]*\)/g, ''), f).not.toMatch(/Math\.min\(\s*3\s*,\s*window\.devicePixelRatio/);
    }
    const placement = SRC.find((x) => x.f === 'render/placement.ts')?.src ?? '';
    expect(placement).not.toMatch(/labelPx\([^)]*\/\s*(window\.)?devicePixelRatio/);
  });

  describe('labelLines: a label stays whole on the screen', () => {
    const w = (s: string): number => s.length * 8 + 6;   // Silkscreen at 8 world px, near enough, and the plate's pad
    const VERDICT = 'Inside the castrum only surveyed plots.';

    it('stands where it is meant to when it fits', () => {
      expect(labelLines('Tap again to demolish', 200, 0, 400, w)).toEqual([{ text: 'Tap again to demolish', x: 200 }]);
    });

    it.each([
      ['at the left edge', 10, 0, 400, 0 + w('Tap again to demolish') / 2],
      ['at the right edge', 395, 0, 400, 400 - w('Tap again to demolish') / 2],
      ['off the left of a view that starts at 1000', 900, 1000, 1400, 1000 + w('Tap again to demolish') / 2],
    ])('is slid in %s', (_name, x, lo, hi, want) => {
      expect(labelLines('Tap again to demolish', x, lo, hi, w)).toEqual([{ text: 'Tap again to demolish', x: want }]);
    });

    it('breaks a verdict wider than the view in two balanced lines, each whole on the screen (a 375 px phone at zoom 2)', () => {
      const lo = 0, hi = 187, lines = labelLines(VERDICT, 60, lo, hi, w);
      expect(w(VERDICT)).toBeGreaterThan(hi - lo);
      expect(lines.length).toBe(2);
      expect(lines.map((l) => l.text).join(' ')).toBe(VERDICT);
      expect(lines.map((l) => l.text)).toEqual(['Inside the castrum', 'only surveyed plots.']);
      for (const l of lines) {
        expect(l.x - w(l.text) / 2, l.text).toBeGreaterThanOrEqual(lo);
        expect(l.x + w(l.text) / 2, l.text).toBeLessThanOrEqual(hi);
      }
    });

    it('centres on the view a single word wider than it', () => {
      expect(labelLines('Supercalifragilistic', 20, 100, 200, w)).toEqual([{ text: 'Supercalifragilistic', x: 150 }]);
    });
  });

  it.each([[1, 16], [1.5, 8], [2, 8], [3, 8], [5, 8], [0.75, 16], [0.5, 24]])('labelPx(%s) = %s', (k, px) => {
    expect(labelPx(k)).toBe(px);
  });
});

describe('Text size storage (src/ui/textsize.ts)', () => {
  /** A storage over a plain record, or one that refuses (a private window, blocked site data). */
  const store = (init: Record<string, string> = {}, refuse = false): Storage & { data: Record<string, string> } => {
    const data = { ...init };
    return {
      data, length: 0, clear: () => undefined, key: () => null, removeItem: (k: string) => { delete data[k]; },
      getItem: (k: string) => { if (refuse) throw new Error('SecurityError'); return k in data ? data[k] : null; },
      setItem: (k: string, v: string) => { if (refuse) throw new Error('QuotaExceededError'); data[k] = v; },
    };
  };

  it('a UI-owned key in the keep-placing naming, never a Prefs field', () => {
    expect(TEXT_SIZE_KEY).toBe('castravaleria.ui.textSize.v1');
    expect(TEXT_SIZE_KEY).toMatch(/^castravaleria\.ui\.[a-zA-Z]+\.v\d+$/);
    const types = readFileSync(join(ROOT, 'src', 'game', 'types.ts'), 'utf8');
    expect(types).not.toMatch(/textSize/i);
  });

  it.each<[unknown, TextSize]>([
    ['large', 'large'], ['normal', 'normal'], [null, 'normal'], [undefined, 'normal'], ['', 'normal'], ['LARGE', 'normal'],
    ['Large', 'normal'], [' large', 'normal'], ['huge', 'normal'], ['1', 'normal'], ['{"size":"large"}', 'normal'], [1.25, 'normal'],
  ])('parseTextSize(%j) = %s', (raw, want) => {
    expect(parseTextSize(raw)).toBe(want);
  });

  it.each<[string, Storage | null, TextSize]>([
    ['no storage', null, 'normal'],
    ['nothing stored', store(), 'normal'],
    ['large stored', store({ [TEXT_SIZE_KEY]: 'large' }), 'large'],
    ['normal stored', store({ [TEXT_SIZE_KEY]: 'normal' }), 'normal'],
    ['a foreign value', store({ [TEXT_SIZE_KEY]: 'xl' }), 'normal'],
    ['another key only', store({ 'castravaleria.ui.keepPlacing.v1': '1' }), 'normal'],
    ['storage refuses', store({ [TEXT_SIZE_KEY]: 'large' }, true), 'normal'],
  ])('readTextSize: %s → %s', (_name, s, want) => {
    expect(readTextSize(s)).toBe(want);
  });

  it('writeTextSize stores each size for readTextSize to find again, and says when it could not', () => {
    for (const t of TEXT_SIZES) {
      const s = store();
      expect(writeTextSize(s, t)).toBe(true);
      expect(s.data[TEXT_SIZE_KEY]).toBe(t);
      expect(readTextSize(s)).toBe(t);
    }
    expect(writeTextSize(null, 'large')).toBe(false);
    expect(writeTextSize(store({}, true), 'large')).toBe(false);
  });

  it('Normal and Large, Large × 1.25 on the scale', () => {
    expect(TEXT_SIZES).toEqual(['normal', 'large']);
    expect(TEXT_SCALE).toEqual({ normal: 1, large: 1.25 });
  });
});

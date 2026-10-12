// src/ui/textsize.ts — the Text size setting (DESIGN §15.5, §16.1): Normal, or Large (every type token × 1.25; Silkscreen
// at 16 px: tokens.css). Chosen in the Menu (modals.ts) and kept per browser in a UI-owned key, as ⟳ keep placing is
// (mapbar.ts) — never in Prefs, which the save carries and src/game/types.ts freezes. Applied as data-text='large' on
// #app, whose type scale the layers beside it (the modals, the tooltip, the title, the veil) read too (tokens.css). The
// parse and the guarded read and write are pure over the storage they are handed (tests/css-floor.test.ts); a private
// window or blocked site data may refuse the storage, and the choice then lasts the session. What lays itself out by
// measuring (the HUD rows' priority+, the width ratchets, the layout's geometry) listens (onTextSize) and fits again.
// Owner: WP-H.

export type TextSize = 'normal' | 'large';
/** The sizes in the Menu's order. */
export const TEXT_SIZES: readonly TextSize[] = ['normal', 'large'];
/** The UI-owned localStorage key (the naming of mapbar.ts's keep-placing key). */
export const TEXT_SIZE_KEY = 'castravaleria.ui.textSize.v1';
/** The factor on the type scale (tokens.css --ts). */
export const TEXT_SCALE: Readonly<Record<TextSize, number>> = { normal: 1, large: 1.25 };
/** The Menu's words for each size. */
export const TEXT_SIZE_LABEL: Readonly<Record<TextSize, string>> = { normal: 'Normal', large: 'Large' };

/** The year chart's Silkscreen (vitals.ts chart): the type floor, 12 px, and 16 under Large (tokens.css --fs-caps). */
export function chartFontPx(t: TextSize): number {
  return t === 'large' ? 16 : 12;
}

/** The size a stored value names: 'large' exactly; anything else (missing, empty, an old or foreign value) is Normal. */
export function parseTextSize(raw: unknown): TextSize {
  return raw === 'large' ? 'large' : 'normal';
}

/** The stored size, Normal when the storage is missing or refuses (it throws in a locked-down browser). */
export function readTextSize(store: Pick<Storage, 'getItem'> | null): TextSize {
  if (!store) return 'normal';
  try { return parseTextSize(store.getItem(TEXT_SIZE_KEY)); } catch { return 'normal'; }
}

/** Stores the size; false when there is no storage or it refuses (full, blocked): the choice then lasts the session. */
export function writeTextSize(store: Pick<Storage, 'setItem'> | null, t: TextSize): boolean {
  if (!store) return false;
  try { store.setItem(TEXT_SIZE_KEY, t); return true; } catch { return false; }
}

/** localStorage, or null where reading the property itself throws (a sandboxed frame, blocked cookies). */
function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

let current: TextSize | null = null;
const listeners = new Set<(t: TextSize) => void>();

/** The size in use (read from storage once). */
export function textSize(): TextSize {
  if (current === null) current = readTextSize(storage());
  return current;
}

/** Writes the size on #app (data-text='large'; none for Normal). */
export function applyTextSize(app: HTMLElement | null = typeof document !== 'undefined' ? document.getElementById('app') : null): void {
  if (!app) return;
  if (textSize() === 'large') app.dataset.text = 'large';
  else delete app.dataset.text;
}

/** Chooses a size: remembers it, applies it, and lets every listener fit again. */
export function setTextSize(t: TextSize): void {
  if (t === textSize()) return;
  current = t;
  writeTextSize(storage(), t);
  applyTextSize();
  for (const cb of listeners) cb(t);
}

/** Calls `cb` after the size changes (the new size applied); returns the unsubscribe. */
export function onTextSize(cb: (t: TextSize) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

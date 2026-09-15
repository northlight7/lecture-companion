import { useCallback, useSyncExternalStore } from "react";

import { DEFAULT_LEVEL, clampLevel } from "@/lib/typography";

/**
 * The reader's own preferences: the order they put their courses in, whether
 * the sidebar is collapsed, and the two text sizes they have chosen.
 *
 * These are UI state for a page this app serves itself, so they live in
 * `localStorage` rather than on the server. The server has no route for either
 * and `app/` is frozen, and inventing one to store a drag order would be the
 * wrong shape anyway.
 *
 * ONE store, module level. A `useState` per caller looks equivalent and is not:
 * the shell holds the collapsed flag and the courses screen holds the order,
 * and each would write its own mount-time snapshot of the other back over the
 * newer value. Collapsing the sidebar would then silently undo a drag.
 *
 * One key, one version. A preference written by an older build is dropped
 * rather than migrated: there is nothing in it worth the code.
 */
const KEY = "lecture-companion.prefs.v1";

export interface Prefs {
  /** Course ids, in the reader's order. Ids not listed follow, in server order. */
  order: string[];
  collapsed: boolean;
  /**
   * The app-wide text size, as an index into `FS_LEVELS`.
   *
   * Stored as the level rather than as the multiplier, because the level is
   * what the reader moves between and what the controls are bounded by: the
   * multipliers live in `lib/typography.ts` and in `tokens.css`, and a stored
   * copy of one of them would be a third place for the set to be wrong.
   */
  fsLevel: number;
  /** The explanation pane's own text size, on the same five levels. */
  readLevel: number;
  /**
   * Where the reader stopped in each deck, keyed `"<course>/<deck>"`.
   *
   * The owner asked for this on 2026-09-15: "if I am going through an 80 page
   * lecture and I reach slide 45 and quit ... the next time I open the app and
   * that lecture, it should continue from the last slide I left off on". Sixty
   * entries of one small integer each is nothing, so there is no eviction and
   * no cap, and an entry for a deck the reader has deleted is a key nothing
   * ever reads.
   *
   * It is an index and not a route. Nothing navigates on its own: the deck's
   * links resolve through it, so "open this deck" means "carry on where you
   * were", and every way of moving inside a deck is unchanged.
   */
  lastSlide: Record<string, number>;
}

const EMPTY: Prefs = {
  order: [],
  collapsed: false,
  fsLevel: DEFAULT_LEVEL,
  readLevel: DEFAULT_LEVEL,
  lastSlide: {},
};

/** The key a deck's remembered position lives under. */
export function lastSlideKey(cid: string, did: string): string {
  return `${cid}/${did}`;
}

function read(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const record = parsed as Record<string, unknown>;
    return {
      order: Array.isArray(record.order)
        ? record.order.filter((id): id is string => typeof id === "string")
        : [],
      collapsed: record.collapsed === true,
      // A value that is not one of the five levels, including one an older
      // build never wrote, reads back as the default rather than as a size
      // nothing on screen was built for.
      fsLevel: clampLevel(record.fsLevel),
      readLevel: clampLevel(record.readLevel),
      // Only whole, non-negative numbers. A stored value that is a string, a
      // fraction or a negative is dropped rather than clamped: it did not come
      // from this app, and a slide index of -1 would be a link to nowhere.
      lastSlide: readLastSlide(record.lastSlide),
    };
  } catch {
    // A browser that refuses storage, or a value another build wrote. Either
    // way the defaults are correct and the app is not.
    return EMPTY;
  }
}

let current: Prefs = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): Prefs {
  return current;
}

function write(next: Prefs): void {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or refused. The session still works; the preference just
    // does not survive it, which is not worth interrupting the reader for.
  }
  for (const listener of listeners) listener();
}

/** The stored positions, with every entry that is not a usable index dropped. */
function readLastSlide(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0) {
      out[key] = entry;
    }
  }
  return out;
}

/**
 * Patch one field. Always read against the live store, never against a value
 * captured at render, which is the bug this shape exists to make impossible.
 */
export function updatePrefs(patch: Partial<Prefs>): void {
  write({ ...current, ...patch });
}

/**
 * Where the reader is in a deck, remembered WITHOUT waking the app up.
 *
 * This is written on every slide, so it must not go through `write()`. The
 * shell subscribes to this store for the collapsed flag and the two text sizes,
 * so a notification here would re-render `App` and every screen under it once
 * per arrow key, to tell them a number they do not read changed. The value is
 * still written to storage and it is still the live `current` object, so the
 * next real `updatePrefs` carries it and the next launch finds it.
 */
export function rememberSlide(cid: string, did: string, index: number): void {
  const key = lastSlideKey(cid, did);
  if (current.lastSlide[key] === index) return;
  current = { ...current, lastSlide: { ...current.lastSlide, [key]: index } };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage full or refused, exactly as in `write`. The position is lost and
    // the session continues, which is not worth interrupting the reader for.
  }
}

/**
 * The slide a deck's links should open on: where the reader stopped, or its
 * first slide.
 *
 * Clamped against the deck's own length, because a deck can be re-imported
 * shorter than it was and a remembered index past its end would land on a blank
 * screen. A deck with no slides resolves to 0 rather than to -1, which
 * `parseHash` turns into `NaN` and then into 0 anyway, but a caller should not
 * have to know that.
 */
export function resumeIndex(cid: string, did: string, nSlides: number): number {
  const last = Math.max(nSlides - 1, 0);
  const saved = current.lastSlide[lastSlideKey(cid, did)] ?? 0;
  return Math.min(Math.max(saved, 0), last);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** `usePrefs` plus a stable setter, for callers that only write. */
export function usePrefsUpdater(): (patch: Partial<Prefs>) => void {
  return useCallback((patch: Partial<Prefs>) => updatePrefs(patch), []);
}

/**
 * The saved order applied to a list, with anything the reader has never moved
 * left in the order the server gave it. A course created since the last drag
 * therefore appears at the end rather than disappearing.
 */
export function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const rank = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ra = rank.get(a.item.id);
      const rb = rank.get(b.item.id);
      if (ra === undefined && rb === undefined) return a.index - b.index;
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb;
    })
    .map((entry) => entry.item);
}

/**
 * The id list after moving one entry. Written as ids rather than indices so a
 * course added or deleted between two drags cannot shift what the saved order
 * means.
 */
export function move(order: string[], ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return order;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return order;
  next.splice(to, 0, moved);
  return next;
}

/**
 * The app's text size, as a closed set of five levels.
 *
 * THE LEVELS ARE TOKENS, AND THIS FILE IS THEIR OTHER HALF. `tokens.css`
 * declares `--fs-level-1` to `--fs-level-5` and expresses the six `--fs-*`
 * steps against them. This file holds the same five multipliers so that the
 * code can move between levels, name the default and clamp a value that came
 * back from storage. The two lists have to agree, and `.internal/gate_type.py`
 * reads the tokens and fails if the five there are not a closed, ordered set
 * with the smallest of them keeping the smallest step at 12 pixels or more.
 *
 * Nothing here touches the DOM. `App.tsx` writes the level onto the document
 * element, because that is the one node every screen is below.
 */

/**
 * The five multipliers, in order, low to high.
 *
 * Level 1 is the smallest and takes the 14px step to 12.6px, which is the
 * floor `gate_type.py` enforces. 1 is the level the app starts on and the one
 * `Cmd` and `0` returns to, so the reader's first choice is the size they were
 * already reading, not a resize.
 */
export const FS_LEVELS = [0.9, 1, 1.15, 1.3, 1.5];

/** The index of the default level. `FS_LEVELS[DEFAULT_LEVEL]` is 1. */
export const DEFAULT_LEVEL = 1;

/** The highest index in the set. Past this, the control that steps up is disabled. */
export const MAX_LEVEL = FS_LEVELS.length - 1;

/** Whether `value` is one of the five levels rather than a number near one. */
export function isLevel(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_LEVEL
  );
}

/**
 * The nearest level to `value`, for anything that came from outside this file:
 * a stored preference written by another build, or a step off either end.
 * Anything that is not a level at all is the default rather than an error.
 */
export function clampLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LEVEL;
  return Math.min(Math.max(Math.round(value), 0), MAX_LEVEL);
}

/**
 * What a key asks the app-wide size to do: 1 for one level up, -1 for one level
 * down, 0 for a return to the default, and null for any other key.
 *
 * `=` is what the `+` key reports when Shift is up, so both are accepted. `_`
 * is the same key as `-` with Shift down, and is accepted for the same reason
 * `+` is.
 */
export function levelDelta(key: string): number | null {
  if (key === "+" || key === "=") return 1;
  if (key === "-" || key === "_") return -1;
  if (key === "0") return 0;
  return null;
}

/**
 * Whether Shift is producing the key itself rather than acting as a modifier.
 *
 * On every layout where `+` sits above `=`, `Cmd` and `+` cannot be pressed
 * without Shift: the character needs it. So Shift is allowed exactly where the
 * key it produced is already one of ours, and refused everywhere else. A second
 * modifier, Control or Option, always refuses: `Cmd` is the whole chord.
 */
export function shiftIsTheKey(key: string): boolean {
  return key === "+" || key === "_";
}

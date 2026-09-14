import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge does not know this app's radius scale, so without this a
 * caller passing `rounded-pnl` would not override a component's own
 * `rounded-ctl` and both classes would reach the element. Declaring the class
 * group makes the override behave the way every caller expects.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: [{ rounded: ["ctl", "srf", "pnl"] }],
      // Without this, `text-ui` is classified as a text COLOUR, because
      // tailwind-merge cannot know `ui` is a font size. It then "wins" the
      // conflict against `text-on-accent` and deletes it, so every primary
      // button rendered --ink on --accent: 2.33:1 in light theme, on every
      // screen. Dark theme hid it because --ink and --on-accent are the same
      // cream there. `.internal/gate_merge.mjs` pins this.
      //
      // ALL SIX STEPS, not the three that were listed first. The list used to
      // be `["meta", "ui", "body"]`, and `text-lead`, `text-head` and
      // `text-display` were therefore still classified as colours. The visible
      // cost was the screen title: `Screen`'s `<h1>` merges `text-display` with
      // `text-ink` and a course title's ink class through `cn()`, the merge
      // read `text-display` as a colour that `text-ink` overrode, and the h1
      // rendered at the inherited 16px on every screen in the app. The largest
      // type on a page is not a thing to lose silently to a class merger.
      "font-size": [{ text: ["meta", "ui", "lead", "body", "head", "display"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

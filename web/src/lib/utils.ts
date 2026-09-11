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
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

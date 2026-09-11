import type { ComponentProps } from "react";
import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A busy indicator: the lucide loader arc, rotated. Drawn as an icon so the
 * shape comes from the icon set rather than from a border trick and a radius
 * the scale does not have.
 *
 * 14px or 16px, inside the icon range. Pass a `className` like `size-8` to
 * stand one up on its own for a whole screen.
 */
const spinnerSizes = {
  sm: "size-3.5",
  md: "size-4",
} as const;

type SpinnerProps = Omit<ComponentProps<typeof LoaderCircle>, "children"> & {
  size?: keyof typeof spinnerSizes;
  /** Announced to assistive technology. Pass an empty string when a visible
   *  label already says it, for example inside a button that reads "Saving". */
  label?: string;
};

function Spinner({ className, size = "md", label = "Loading", ...props }: SpinnerProps) {
  return (
    <span role="status" aria-label={label || undefined} className="inline-flex shrink-0 items-center justify-center">
      <LoaderCircle
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn("animate-spin motion-reduce:animate-none", spinnerSizes[size], className)}
        {...props}
      />
    </span>
  );
}

export { Spinner };
export type { SpinnerProps };

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A placeholder block for content that has not arrived.
 *
 * `--surface-well` is the well colour, so a skeleton reads as a hole in the
 * page rather than as content. It pulses on opacity only, which is animation
 * the design allows, and `motion-reduce` turns the pulse off rather than
 * letting the global 1ms collapse strobe it.
 *
 * Give it a height and a width: `h-3` for a line of chrome text.
 */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-ctl bg-well motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Skeleton };

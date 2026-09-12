import type { ComponentProps } from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

/**
 * A progress bar. The track is a well (`--surface-well`), the fill is the
 * one accent, and the fill moves by transform only, never by width, so nothing
 * in the layout animates.
 *
 * Leave `value` off for an indeterminate bar: the fill then holds at full
 * width and pulses on opacity.
 */
function Progress({
  className,
  value,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root>) {
  const indeterminate = value === null || value === undefined;

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn("relative h-2 w-full overflow-hidden rounded-ctl bg-well", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full w-full flex-1 bg-accent",
          indeterminate
            ? "animate-pulse motion-reduce:animate-none"
            : "transition-transform duration-[120ms] ease-[var(--ease)]",
        )}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };

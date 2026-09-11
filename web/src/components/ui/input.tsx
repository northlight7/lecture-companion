import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A single-line text field.
 *
 * Field height, not control height: forms get the taller `--field-h`. The
 * boundary is `--line-control` because the boundary is what identifies the
 * control, and the ground under it is the content ground.
 */
function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[var(--field-h)] w-full min-w-0 rounded-ctl border border-line bg-ground px-3 font-ui text-ui text-ink transition-colors duration-[120ms] ease-[var(--ease)] placeholder:text-ink-faint aria-invalid:border-bad disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };

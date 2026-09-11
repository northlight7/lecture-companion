import type { ComponentProps } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A checkbox. `size-4`, `rounded-ctl`, and a `--line-control` boundary when
 * unchecked, which is the state where the boundary is what identifies it.
 *
 * Checked and indeterminate both fill with the accent and take `--on-accent`
 * for the glyph. The two glyphs swap on the root's `data-state`, so an
 * indeterminate box shows a dash rather than a tick.
 */
function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group size-4 shrink-0 rounded-ctl border border-line bg-ground text-on-accent transition-colors duration-[120ms] ease-[var(--ease)] data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 group-data-[state=indeterminate]:hidden"
        />
        <Minus
          aria-hidden="true"
          strokeWidth={1.75}
          className="hidden size-3.5 group-data-[state=indeterminate]:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };

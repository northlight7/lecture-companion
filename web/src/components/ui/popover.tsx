import type { ComponentProps } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

/**
 * A popover. Level 1: `--radius-panel`, `--surface-raised`, `--shadow-lift`.
 *
 * `bg-raised` is `--surface-raised`, the same surface a card uses, so a
 * floating panel is the same colour family as a grouped surface and only the
 * shadow says it is above the page.
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 8,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-pnl bg-raised p-4 text-ink animate-[lc-enter_var(--dur-enter)_var(--ease)] shadow-float",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };

import type { ComponentProps } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

/**
 * A popover. Level 2 (float): `--radius-panel`, `--surface-float`, `--shadow-lift`.
 *
 * `bg-float` is `--surface-float`: one step above the panel, the surface a card
 * uses. A popover is the only kind of surface that carries `--shadow-lift`, and
 * it is the shadow plus that step that say it is above the page rather than
 * resting on it.
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
          "z-50 w-72 rounded-pnl border border-hair bg-float p-4 text-ink animate-[lc-enter_var(--dur-enter)_var(--ease)] shadow-float",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };

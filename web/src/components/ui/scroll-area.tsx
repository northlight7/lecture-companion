import type { ComponentProps } from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

/**
 * A scroll region with its own bar.
 *
 * `app.css` hides native scrollbars everywhere, so the bar has to be drawn:
 * an 8px gutter with a 1px inset thumb in `--line-control`, which is the one
 * colour in the set that is a boundary and therefore visible on purpose. No
 * radius of its own beyond `rounded-ctl`.
 */
function ScrollArea({
  className,
  children,
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="scroll-viewport size-full"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      {/* Both orientations. Without the horizontal one, anything wider than
          its pane is clipped with no affordance at all: the reader can see
          that content is missing and cannot reach it. */}
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-[2px]",
        orientation === "vertical" && "h-full w-2 flex-col",
        orientation === "horizontal" && "h-2 flex-row",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-ctl bg-line"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };

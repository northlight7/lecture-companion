import type { ComponentProps } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

/**
 * A tab strip. A tab strip is a gated control, so the strip itself carries a
 * `--line-control` boundary and is exactly `--control-h` tall: 4px of padding
 * plus a 24px trigger.
 *
 * The current tab is a `--surface-selected` chip, the same selection surface a
 * selected row uses, so selection reads the same way everywhere in the app and
 * the accent stays almost unused.
 */
const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-[var(--control-h)] items-center justify-center gap-1 rounded-ctl border border-line bg-well p-1",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-full flex-1 items-center justify-center gap-1 rounded-ctl px-3 font-ui text-meta font-medium whitespace-nowrap text-ink-muted transition-colors duration-[120ms] ease-[var(--ease)] hover:bg-hover hover:text-ink data-[state=active]:bg-selected data-[state=active]:text-ink disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };

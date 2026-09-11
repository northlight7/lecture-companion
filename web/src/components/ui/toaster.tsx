import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { ToastItem, useToasts } from "@/components/ui/toast";

/**
 * Renders the live toasts. Mount once, at the bottom of the app shell, outside
 * every scrolling region.
 *
 * The stack sits bottom right, is capped to the window width, and never takes
 * a pointer event outside a toast itself, so it cannot cover a control the
 * user is reaching for.
 */
function Toaster({ className, ...props }: ComponentProps<"div">) {
  const items = useToasts();

  return (
    <div
      data-slot="toaster"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-32px)] flex-col gap-2",
        className,
      )}
      {...props}
    >
      {items.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </div>
  );
}

export { Toaster };

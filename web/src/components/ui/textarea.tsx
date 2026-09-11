import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A multi-line text field. Same boundary and ground as `Input`, taller by
 * default and resizable down the page only.
 */
function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-[96px] w-full resize-y rounded-ctl border border-line bg-ground px-3 py-2 font-ui text-ui text-ink transition-colors duration-[120ms] ease-[var(--ease)] placeholder:text-ink-faint aria-invalid:border-bad disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

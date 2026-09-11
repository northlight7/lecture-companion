import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * A small status chip. `rounded-ctl`, one line of metadata text, no shadow.
 *
 * The meaning variants (`good`, `warn`, `bad`) keep the neutral
 * `--line-control` boundary and carry the meaning in the text colour, so a
 * chip never has to invent a fill that the token set does not define.
 */
const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 select-none items-center justify-center gap-1 whitespace-nowrap rounded-ctl border px-2 font-ui text-meta font-medium [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        neutral: "border-line bg-sunken text-ink-muted",
        accent: "border-accent bg-accent text-on-accent",
        outline: "border-line bg-ground text-ink",
        good: "border-line bg-ground text-good",
        warn: "border-line bg-ground text-warn",
        bad: "border-line bg-ground text-bad",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
export type { BadgeProps };

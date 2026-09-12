import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * A small status chip. Level 0: a well recessed into whatever it sits on,
 * `rounded-ctl`, one line of metadata text, no shadow and no border, because a
 * well is a member of the ground family and the two grounds are separated by a
 * value step and never by a line.
 *
 * Every variant takes the SAME fill so the chips read as one object: `bg-well`,
 * with the meaning carried in the text colour. The accent variant is the one
 * exception, because a filled accent chip is the accent doing its job.
 */
const badgeVariants = cva(
  "inline-flex h-6 w-fit shrink-0 select-none items-center justify-center gap-1 whitespace-nowrap rounded-ctl px-2 font-ui text-meta font-medium [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        neutral: "bg-well text-ink-muted",
        accent: "bg-accent text-on-accent",
        outline: "bg-well text-ink",
        good: "bg-well text-good",
        warn: "bg-well text-warn",
        bad: "bg-well text-bad",
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

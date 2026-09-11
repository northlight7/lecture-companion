import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A grouped surface inside content.
 *
 * Level 0: no shadow, no border, no third ground. The card is separated from
 * the page by `--surface-raised`, which is a mix of the content ground with
 * that theme's ink, plus the whitespace the caller leaves around it.
 * `rounded-srf` because a card is a grouped surface, the same family as a
 * list surface.
 */
function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("flex flex-col gap-4 rounded-srf bg-raised py-4 text-ink", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("grid auto-rows-min items-start gap-1 px-4", className)}
      {...props}
    />
  );
}

/** Sans, chrome-sized, semibold. Never serif: this is not the reading column. */
function CardTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-ui text-ui font-semibold text-ink", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("font-ui text-meta text-ink-muted", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-4", className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center gap-2 px-4", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };

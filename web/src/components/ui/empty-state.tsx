import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * What a region says when it has nothing to show.
 *
 * Left-aligned, flush, no illustration, no shadow. The design bans a centred
 * empty state wider than a short sentence, so the default is a start-aligned
 * block: an icon at 16px, one line of chrome text, and at most one more line
 * of muted explanation. Pass a `className` of `items-center text-center` only
 * when the copy really is one short sentence.
 */
type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & {
  /** A lucide icon at 16px. Hidden from assistive technology. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** At most one control, usually a `Button`. */
  action?: ReactNode;
};

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-start gap-2 p-8 text-left", className)}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-1 text-ink-faint [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          {icon}
        </span>
      ) : null}
      <p className="font-ui text-ui font-medium text-ink">{title}</p>
      {description ? (
        <p className="font-ui text-ui text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };

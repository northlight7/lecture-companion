import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Every screen's page frame. One left edge, one right edge, one vertical
 * rhythm, so no screen reads as if a different person built it.
 *
 * There is no toolbar. The title lives in the content and scrolls with it,
 * which is what both reference apps do.
 */
export function Screen({
  title,
  back,
  lede,
  actions,
  meta,
  children,
  className,
}: {
  title: string;
  back?: { href: string; label: string };
  lede?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("page-column pt-6 pb-16", className)}>
      {back ? (
        <a
          href={back.href}
          className="mb-3 inline-flex items-center gap-1 text-ui text-ink-muted transition-colors duration-[120ms] ease-[var(--ease)] hover:text-ink"
        >
          <ChevronLeft size={14} strokeWidth={2} aria-hidden />
          {back.label}
        </a>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1
            tabIndex={-1}
            className="font-reading text-[30px] leading-[1.15] font-semibold text-ink focus-target"
          >
            {title}
          </h1>
          {meta ? <div className="mt-2 text-ui text-ink-faint">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      {lede ? (
        <p className="mt-3 max-w-[60ch] text-ui text-ink-muted">{lede}</p>
      ) : null}

      <div className="mt-8">{children}</div>
    </div>
  );
}

/** A titled run of content inside a screen. Separated by space, never a card. */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-10 first:mt-0", className)}>
      <div className="mb-1 flex items-center justify-between gap-4">
        <h2 className="font-ui text-ui font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

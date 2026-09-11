import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The sidebar's fixed parts. Everything below the drag strip is a normal
 * scroll region, so a course with forty decks scrolls inside the sidebar and
 * the window still does not move.
 */
export function SidebarFrame({ children }: { children: ReactNode }) {
  return (
    <>
      {/* The traffic lights are drawn here by the window server. Nothing may be
          placed in this strip: it belongs to the window, not to the page. */}
      <div className="titlebar-drag h-[52px] shrink-0" aria-hidden="true" />
      {children}
    </>
  );
}

export function SidebarScroll({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Courses and decks" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {children}
    </nav>
  );
}

export function SidebarFoot({ children }: { children: ReactNode }) {
  return <div className="shrink-0 px-2 pb-2">{children}</div>;
}

/** A muted, all-caps label above a run of rows. Not a link and not a heading. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-5 pb-1 text-[11px] font-medium tracking-[0.06em] text-ink-faint uppercase">
      {children}
    </div>
  );
}

export function NavRow({
  href,
  current,
  children,
  trailing,
  accent,
  className,
}: {
  href: string;
  current?: boolean;
  children: ReactNode;
  trailing?: ReactNode;
  /** A course accent class for the row's mark. The sidebar agrees with the
   *  board: a course is the same colour in both. */
  accent?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "group flex h-[var(--row-h)] items-center gap-2 rounded-srf px-2 text-ui transition-colors duration-[120ms] ease-[var(--ease)]",
        current ? "bg-chrome-selected text-ink" : "text-ink-muted hover:bg-chrome-hover",
        className,
      )}
    >
      {accent ? (
        <span
          aria-hidden
          className={cn("h-3.5 w-[3px] shrink-0 rounded-ctl", accent)}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="shrink-0 text-ink-faint">{trailing}</span> : null}
    </a>
  );
}

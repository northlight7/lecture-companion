import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { SidebarToggle } from "@/shell/SidebarToggle";

/**
 * The frame. Two columns, full height, and the window itself never scrolls:
 * `html`, `body` and `#root` are `overflow: hidden` in app.css, the sidebar has
 * its own scroll region, and so does the content column.
 *
 * There is no toolbar. The sidebar is the chrome, the traffic lights are drawn
 * over it by the window server, and the first strip of it is a drag handle.
 *
 * Collapsed, the sidebar leaves and the content takes the whole window, with
 * the traffic lights over the top-left of the content and the control that
 * brings the sidebar back beside them.
 *
 * THE COLLAPSE IS ANIMATED, and the geometry is what makes that possible. Both
 * strips are `h-[52px]` with `pl-[86px]` and centre their contents, so the
 * toggle sits at the same point on the window whether the sidebar is there or
 * not: it does not travel, and the reader's target never moves under the
 * pointer. The only thing that changes is the width of the first column, so the
 * width is the only thing that animates, and the whole transition is one
 * property on one element.
 *
 * The sidebar's contents keep their own width inside a column that is narrowing.
 * Without that they reflow on every frame: the labels truncate, the rows jump,
 * and it reads as the panel being crushed rather than sliding away. A fixed
 * inner width in an `overflow-hidden` column means the panel keeps its shape
 * and leaves the window edge-first.
 *
 * `inert` WHILE COLLAPSED, so the sidebar is out of the tab order and out of
 * the accessibility tree for the whole 200ms rather than only at the end. The
 * previous version unmounted the contents outright, for the stated reason that
 * squeezing the column to zero leaves the links tabbable off-screen and the
 * collapsed app reporting both "Hide the sidebar" and "Show the sidebar" as
 * controls. `inert` is the same guarantee, held continuously instead of
 * arriving 200ms late.
 */
export function AppShell({
  chrome,
  collapsed,
  onToggleCollapsed,
  children,
}: {
  chrome: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="flex h-full bg-ground text-ink"
    >
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside
        // `|| undefined`, not `collapsed` on its own: `inert={false}` renders
        // `inert="false"`, and inert is a boolean attribute, so the STRING
        // "false" turns it ON. Measured in the bundle before this was fixed:
        // the expanded sidebar was inert and its own "Hide the sidebar" control
        // had left the accessibility tree.
        inert={collapsed || undefined}
        className={cn(
          "flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-chrome",
          // WIDTH, not `grid-template-columns`. The grid version was written
          // first and measured: the sidebar jumped from 280px to 0 in a single
          // frame even with the duration stretched to 2000ms, so this WebKit
          // does not interpolate grid tracks. Width is animatable everywhere.
          "transition-[width] duration-[var(--dur-panel)] ease-[var(--ease)]",
          collapsed ? "w-0" : "w-[var(--chrome-w)]",
        )}
      >
        <div className="flex h-full w-[var(--chrome-w)] shrink-0 flex-col">{chrome}</div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* THE TOP BAR IS DRAGGABLE AT EVERY WIDTH, and it is 52 points tall
            whether the sidebar is out or not.
            
            It used to collapse to nothing while the sidebar was expanded, on
            the reasoning that the sidebar's own strip already covers the top.
            It covers only the sidebar: the other 1000 points of the window's
            top edge belonged to the content column and had no drag region at
            all, so the window could be dragged from the left fifth of its top
            bar and nowhere else. Reported by the owner, and it is the kind of
            thing only using the app finds.
            
            It is a sibling ABOVE `<main>`, not an overlay, so nothing it covers
            is unreachable: the content simply starts below it. */}
        <div
          // Inert while expanded. The toggle it holds is `opacity-0` while the
          // sidebar is out, which hides it from the eye but not from the
          // accessibility tree or the tab order, so without this the expanded
          // app reported a "Show the sidebar" button as well as its real
          // "Hide the sidebar" one.
          inert={collapsed ? undefined : true}
          className={cn(
            "titlebar-drag flex h-[52px] shrink-0 items-center overflow-hidden pl-[86px]",
          )}
        >
          <SidebarToggle
            collapsed
            onToggle={onToggleCollapsed}
            className={cn(
              "transition-opacity duration-[140ms] ease-[var(--ease)]",
              // Held until the sidebar has mostly gone, so the two icons are
              // never both at full strength. They occupy the same point, so an
              // overlap reads as a flicker rather than as two controls.
              collapsed ? "opacity-100 delay-[80ms]" : "opacity-0",
            )}
          />
        </div>
        <main
          id="main"
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none focus-target"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

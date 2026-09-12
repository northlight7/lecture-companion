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
 * brings the sidebar back beside them. That is how the reference app does it,
 * and it is why the strip is a real block rather than an overlay: an overlay
 * would put the page's first line under the window buttons.
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
      className={cn(
        "grid h-full bg-ground text-ink",
        collapsed ? "grid-cols-[0px_1fr]" : "grid-cols-[var(--chrome-w)_1fr]",
      )}
    >
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {/* Collapsed, the contents are not rendered at all. Squeezing the column
          to zero and clipping is not the same thing: the links stay in the tab
          order and in the accessibility tree, so a keyboard reader tabs into a
          side of the window that is not on screen. Measured in the bundle: the
          collapsed app still reported both "Hide the sidebar" and "Show the
          sidebar" as controls. */}
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-chrome">
        {collapsed ? null : chrome}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        {collapsed ? (
          <div className="titlebar-drag flex h-[52px] shrink-0 items-center pl-[86px]">
            <SidebarToggle collapsed onToggle={onToggleCollapsed} />
          </div>
        ) : null}
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

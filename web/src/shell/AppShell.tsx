import type { ReactNode } from "react";

/**
 * The frame. Two columns, full height, and the window itself never scrolls:
 * `html`, `body` and `#root` are `overflow: hidden` in app.css, the sidebar has
 * its own scroll region, and so does the content column.
 *
 * There is no toolbar. The sidebar is the chrome, the traffic lights are drawn
 * over it by the window server, and the first strip of it is a drag handle.
 */
export function AppShell({ chrome, children }: { chrome: ReactNode; children: ReactNode }) {
  return (
    <div className="grid h-full grid-cols-[var(--chrome-w)_1fr] bg-ground text-ink">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="flex h-full min-h-0 flex-col bg-chrome">{chrome}</aside>
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 overflow-y-auto overscroll-none focus-target"
      >
        {children}
      </main>
    </div>
  );
}

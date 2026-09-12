import { PanelLeft, PanelLeftClose } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The control that collapses the sidebar and the one that brings it back.
 *
 * Both sit in the strip the window server draws the traffic lights over, so
 * both carry `.titlebar-control`: inside a drag region an ordinary button never
 * receives the click, because the window server takes it for a window drag.
 */
export function SidebarToggle({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const Icon = collapsed ? PanelLeft : PanelLeftClose;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Show the sidebar" : "Hide the sidebar"}
      title={collapsed ? "Show the sidebar" : "Hide the sidebar"}
      className={cn(
        "titlebar-control grid size-7 place-items-center rounded-ctl text-ink-muted",
        "transition-colors duration-[120ms] ease-[var(--ease)] hover:bg-chrome-hover hover:text-ink",
        className,
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

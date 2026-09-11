import { useEffect, useState, useSyncExternalStore } from "react";
import type { ComponentProps } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Toasts, without a dependency.
 *
 * There is no toast package in `package.json`, and adding one is not allowed,
 * so this is the small version: a module-level store, `toast()` to push,
 * `dismissToast()` to pull, and `<Toaster />` to render. The store is read
 * through `useSyncExternalStore`, so a toast can be raised from anywhere,
 * including outside React.
 *
 *     toast("Deck deleted");
 *     toast({ title: "Deck deleted", description: "3 slides", variant: "good" });
 *
 * A toast is lifted: `--radius-panel`, `--surface-raised`, `--shadow-lift`.
 * The variant is carried by the icon colour, never by a filled panel, so no
 * colour is invented. The timer pauses while the pointer or the keyboard is
 * inside the toast, and `duration: 0` keeps it until it is dismissed.
 */
export type ToastVariant = "info" | "good" | "warn" | "bad";

export type ToastOptions = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds on screen. `0` keeps it until it is dismissed. */
  duration?: number;
};

export type ToastRecord = ToastOptions & { id: string };

const VARIANT_ICON: Record<ToastVariant, LucideIcon> = {
  info: Info,
  good: CircleCheck,
  warn: TriangleAlert,
  bad: CircleX,
};

const VARIANT_TONE: Record<ToastVariant, string> = {
  info: "text-ink-muted",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
};

const DEFAULT_DURATION = 5000;

let toasts: ToastRecord[] = [];
const listeners = new Set<() => void>();
let nextId = 0;

function emit() {
  for (const listener of listeners) listener();
}

/** Raise a toast. Takes a title, or the whole options object.
 *  Returns its id, for `dismissToast`. */
export function toast(input: ToastOptions | string): string {
  const options: ToastOptions = typeof input === "string" ? { title: input } : input;
  nextId += 1;
  const id = `toast-${nextId}`;
  toasts = [...toasts, { ...options, id }];
  emit();
  return id;
}

export function dismissToast(id: string): void {
  const remaining = toasts.filter((item) => item.id !== id);
  if (remaining.length === toasts.length) return;
  toasts = remaining;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return toasts;
}

/** Every live toast, newest last. */
export function useToasts(): ToastRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

type ToastItemProps = Omit<ComponentProps<"li">, "children"> & {
  toast: ToastRecord;
};

function ToastItem({ toast: item, className, ...props }: ToastItemProps) {
  const [paused, setPaused] = useState(false);
  const variant = item.variant ?? "info";
  const duration = item.duration ?? DEFAULT_DURATION;
  const Icon = VARIANT_ICON[variant];

  useEffect(() => {
    if (duration <= 0 || paused) return;
    const timer = window.setTimeout(() => dismissToast(item.id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, item.id, paused]);

  return (
    <li
      data-slot="toast"
      data-variant={variant}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-pnl bg-raised p-4 text-ink shadow-float",
        className,
      )}
      {...props}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn("mt-0.5 size-4 shrink-0", VARIANT_TONE[variant])}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-ui text-ui font-medium text-ink">{item.title}</p>
        {item.description ? (
          <p className="font-ui text-ui text-ink-muted">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(item.id)}
        className="-mt-1 -mr-1 inline-flex size-[28px] shrink-0 items-center justify-center rounded-ctl text-ink-muted transition-colors duration-[120ms] ease-[var(--ease)] hover:bg-hover hover:text-ink"
      >
        <X aria-hidden="true" strokeWidth={1.75} className="size-4" />
      </button>
    </li>
  );
}

export { ToastItem };
export type { ToastItemProps };

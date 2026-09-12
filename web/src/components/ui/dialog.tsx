import type { ComponentProps } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A modal dialog. One of the two things in the app allowed to be lifted.
 *
 * Level 2 (float): `--radius-panel`, `--surface-float` and `--shadow-lift`. The
 * scrim is the content ground at 80 percent, which is a mix of an existing
 * ground rather than a new colour, and nothing is frosted: softening the page
 * behind a panel is banned everywhere in this app.
 *
 * Every dialog needs a `DialogTitle`. Add a `DialogDescription` as well, or the
 * content needs its own `aria-label`.
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 animate-[lc-fade_var(--dur-enter)_var(--ease)] bg-scrim transition-opacity duration-[180ms] ease-[var(--ease)]",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  /** The corner close control. Turn it off when the dialog has its own. */
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-64px)] w-full max-w-[32rem] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-pnl border border-hair bg-float p-6 text-ink animate-[lc-fade_var(--dur-enter)_var(--ease)] shadow-float",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 inline-flex size-[28px] shrink-0 items-center justify-center rounded-ctl text-ink-muted transition-colors duration-[120ms] ease-[var(--ease)] hover:bg-hover hover:text-ink"
          >
            <X aria-hidden="true" strokeWidth={1.75} className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-ui text-body font-semibold text-ink", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("font-ui text-ui text-ink-muted", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};

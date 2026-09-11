import type { ComponentProps } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * A confirmation that requires an explicit answer.
 *
 * `@radix-ui/react-alert-dialog` is not installed, so this is built on the
 * dialog primitive in the same shape as the standard component: same API, the
 * same lifted panel, and the same two behaviours that make it an alert rather
 * than a dialog. A click outside does not dismiss it, so a destructive choice
 * has to be made or cancelled, and pressing Escape still does.
 */
const AlertDialog = DialogPrimitive.Root;
const AlertDialogTrigger = DialogPrimitive.Trigger;
const AlertDialogPortal = DialogPrimitive.Portal;

function AlertDialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 animate-[lc-fade_var(--dur-enter)_var(--ease)] bg-scrim transition-opacity duration-[180ms] ease-[var(--ease)]",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  onPointerDownOutside,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <DialogPrimitive.Content
        role="alertdialog"
        data-slot="alert-dialog-content"
        onPointerDownOutside={(event) => {
          event.preventDefault();
          onPointerDownOutside?.(event);
        }}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-64px)] w-full max-w-[32rem] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-pnl bg-raised p-6 text-ink animate-[lc-fade_var(--dur-enter)_var(--ease)] shadow-float",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-1 text-left", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("font-ui text-body font-semibold text-ink", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("font-ui text-ui text-ink-muted", className)}
      {...props}
    />
  );
}

/** Confirms. Primary fill, because it is the action the dialog exists for. */
function AlertDialogAction({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <DialogPrimitive.Close asChild>
      <Button data-slot="alert-dialog-action" variant={variant} className={className} {...props} />
    </DialogPrimitive.Close>
  );
}

/** Cancels. The bordered secondary look, never the accent. */
function AlertDialogCancel({ className, variant = "secondary", ...props }: ButtonProps) {
  return (
    <DialogPrimitive.Close asChild>
      <Button
        data-slot="alert-dialog-cancel"
        variant={variant}
        className={className}
        {...props}
      />
    </DialogPrimitive.Close>
  );
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};

import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The one button in the app.
 *
 * Five variants, four sizes. Every colour is a token utility, the radius is
 * always `rounded-ctl`, and there is no shadow: a button is flush with the
 * ground it sits on and is identified by its own fill or its `--line-control`
 * boundary. The focus ring is the global `:focus-visible` rule in `app.css`,
 * so nothing here touches focus.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-ctl font-ui font-medium transition-colors duration-[120ms] ease-[var(--ease)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent hover:bg-accent-hover",
        secondary: "border border-line bg-ground text-ink hover:bg-hover",
        ghost: "bg-transparent text-ink hover:bg-hover",
        danger: "border border-line bg-ground text-bad hover:bg-hover",
        link: "bg-transparent text-accent-ink underline-offset-2 hover:underline",
      },
      size: {
        sm: "h-[28px] gap-1 px-2 text-meta",
        md: "h-[var(--control-h)] gap-2 px-3 text-ui",
        lg: "h-[38px] gap-2 px-4 text-ui",
        icon: "size-[var(--control-h)] p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child element instead of a `<button>`. */
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };

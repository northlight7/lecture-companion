import type { ComponentProps } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";

import { cn } from "@/lib/utils";

/**
 * A radio group.
 *
 * The item is a 16px box with the design system's control radius, not a
 * circle: the radius scale has exactly three values and a circle is not one of
 * them. The selected mark is the accent dot inside it.
 */
const RadioGroup = RadioGroupPrimitive.Root;

function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-ctl border border-line bg-ground transition-colors duration-[120ms] ease-[var(--ease)] data-[state=checked]:border-accent disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        {/* 6px box with a 6px radius: clamped to a circle by the browser. */}
        <span aria-hidden="true" className="size-1.5 rounded-ctl bg-accent" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };

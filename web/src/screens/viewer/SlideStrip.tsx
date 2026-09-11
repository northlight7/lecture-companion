import { useCallback, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { SlideSummary } from "@/lib/types";

/**
 * The deck strip: prev, the deck itself, next, the position.
 *
 * The previous strip rendered one numbered chip per slide, so a 110-slide deck
 * printed a 110-wide row of numbers across the page and the current slide was
 * usually off it. This renders the whole deck as ONE control of the same width
 * whatever the deck's length: a proportional rail, one segment per slide, where
 *
 *   - the rail is the deck's extent, drawn in `--line-control`, the one colour
 *     the design allows a control boundary to use,
 *   - an explained slide's segment is lifted to `--ink-faint`, so the deck's
 *     progress is the rail's own shape and no separate meter is needed,
 *   - the current slide's segment is the accent, the single state the accent is
 *     reserved for.
 *
 * Three segments and a hundred and seventy-three segments both fill exactly the
 * row. Clicking or dragging anywhere on the rail maps the pointer to the
 * nearest slide, so a deck too long to give every slide a wide segment is still
 * a precise jump control: the target is the whole rail, not the 5px segment.
 * Arrow keys, Home, End, PageUp and PageDown do the same from the keyboard.
 */
export function SlideStrip({
  slides,
  index,
  onJump,
}: {
  slides: SlideSummary[];
  index: number;
  onJump: (index: number) => void;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  const count = slides.length;
  const last = Math.max(count - 1, 0);
  // While the pointer is down the rail previews the scrub target and the deck
  // is not navigated until release, so a drag across a long deck is one fetch.
  const shown = scrub ?? index;

  const indexAt = useCallback(
    (clientX: number) => {
      const node = track.current;
      if (!node) return 0;
      const box = node.getBoundingClientRect();
      const ratio = box.width > 0 ? (clientX - box.left) / box.width : 0;
      return Math.min(Math.max(Math.round(ratio * last), 0), last);
    },
    [last],
  );

  const step = useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(index + delta, 0), last);
      if (next !== index) onJump(next);
    },
    [index, last, onJump],
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let delta: number;
    if (event.key === "ArrowLeft") delta = -1;
    else if (event.key === "ArrowRight") delta = 1;
    else if (event.key === "PageUp") delta = -10;
    else if (event.key === "PageDown") delta = 10;
    else if (event.key === "Home") delta = -count;
    else if (event.key === "End") delta = count;
    else return;
    // The screen also listens on the document for the arrow keys.
    event.preventDefault();
    event.stopPropagation();
    step(delta);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (count === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrub(indexAt(event.clientX));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrub === null) return;
    setScrub(indexAt(event.clientX));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrub === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const target = indexAt(event.clientX);
    setScrub(null);
    if (target !== index) onJump(target);
  };

  if (count === 0) return null;

  return (
    <div className="flex h-[var(--control-h)] items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Previous slide"
        disabled={index <= 0}
        onClick={() => step(-1)}
      >
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
      </Button>

      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Slides in this deck"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={index + 1}
        aria-valuetext={`Slide ${index + 1} of ${count}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setScrub(null)}
        className="flex h-full min-w-0 flex-1 cursor-pointer touch-none items-center"
      >
        <div className="flex h-1.5 w-full items-stretch gap-px overflow-hidden rounded-ctl bg-line">
          {slides.map((slide) => (
            <span
              key={slide.index}
              className={cn(
                "min-w-0 flex-1",
                slide.index === shown
                  ? "bg-accent"
                  : slide.has_explanation
                    ? "bg-ink-faint"
                    : "bg-transparent",
              )}
            />
          ))}
        </div>
      </div>

      <span className="shrink-0 text-meta tabular-nums text-ink-muted">
        {shown + 1} of {count}
      </span>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Next slide"
        disabled={index >= last}
        onClick={() => step(1)}
      >
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
      </Button>
    </div>
  );
}

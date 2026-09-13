import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { slideImageUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The slide, resting on `--surface-well`, and the speaker notes beneath it.
 *
 * The well is level 0: the ground moved away from the reader, so it carries no
 * border and no shadow. The slide is the object on top of it, and an object has
 * a boundary: one hairline and a radius, which is all that separates it from
 * the well it rests in. It casts nothing.
 *
 * THE NOTES ARE PRESENTER NOTES, after PowerPoint's notes pane rather than
 * after a document. What that means here, in the order the reader meets it:
 *
 *   * They sit BELOW the slide, not beside it and not inside the explanation
 *     column. The well letterboxes a 4:3 or 16:9 slide inside a taller pane, so
 *     the strip under it costs far less than its own height looks like it
 *     should: most of that room was empty well either way.
 *   * They are OPEN by default and small, which is the whole difference from
 *     what this replaced. That was a disclosure that started closed and then
 *     opened into a 32vh block of `--fs-meta` monospace, so the reader either
 *     saw nothing or lost a third of the slide. A notes pane is furniture: it
 *     is there when you look down, and it does not need opening.
 *   * They are capped at a share of the pane and scroll inside that cap, so the
 *     slide keeps its size and the notes can be as long as the extraction was.
 *   * They are labelled and muted, so they read as an aside about the slide
 *     rather than as more of the slide.
 *
 * The fold control stays, because a reader who wants the largest possible slide
 * should be able to have it, and the choice is theirs per slide.
 *
 * The old frontend set the image source and left the element in place, so the
 * previous frame stayed visible until the next one decoded. That is kept: the
 * image is never hidden between slides, and only a slide with no render at all
 * falls back to a line of text.
 */
export function SlideStage({
  cid,
  did,
  index,
  text,
}: {
  cid: string;
  did: string;
  index: number;
  text: string;
}) {
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setMissing(false);
  }, [index]);

  const extracted = text.trim();
  const words = extracted ? extracted.split(/\s+/).length : 0;

  return (
    /* The slide and its notes are one group, centred in the pane. The stage is
     * the image's own box, so it hugs the slide instead of stretching to the
     * pane and leaving the slide adrift in a field of empty well. */
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* The stage. A well takes every pixel the notes are not using, and the
       *  slide sits centred inside it as an object with a boundary. */}
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-pnl bg-well p-6">
        {missing ? (
          <p className="font-ui text-ui text-ink-faint">No rendered image for this slide.</p>
        ) : (
          <img
            src={slideImageUrl(cid, did, index)}
            alt={`Slide ${index + 1}`}
            onError={() => setMissing(true)}
            className="block min-h-0 max-h-full max-w-full rounded-srf border border-hair object-contain"
          />
        )}
      </div>

      {extracted ? (
        <section
          aria-label="Notes for this slide"
          className={cn(
            "flex shrink-0 flex-col overflow-hidden rounded-srf bg-raised",
            "transition-[max-height] duration-[var(--dur-panel)] ease-[var(--ease)]",
            // A quarter of the pane at most, and only while open. The cap is
            // what keeps the slide the subject: without it a long extraction
            // pushes the slide up and the notes become the page.
            open ? "max-h-[26%]" : "max-h-[var(--row-h)]",
          )}
        >
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className={cn(
              "flex h-[var(--row-h)] shrink-0 cursor-pointer items-center gap-2 px-3 text-left",
              "font-ui text-meta font-medium tracking-[0.06em] text-ink-faint uppercase",
              "transition-colors duration-[120ms] ease-[var(--ease)] hover:text-ink-muted",
            )}
          >
            {open ? (
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
            )}
            <span className="flex-1 truncate">Notes for this slide</span>
            <span className="shrink-0 text-meta font-normal tabular-nums tracking-normal normal-case">
              {words} {words === 1 ? "word" : "words"}
            </span>
          </button>

          {open ? (
            /* A well inside a panel, not a well on a well: the panel is the
             *  strip's own level and the reading surface steps back down from
             *  it, so the text is on the quietest surface in the stack. */
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {/* Sans, not the reading face. The reading face is reserved for the reading
                column and the gate refuses it at any size below `--fs-body`, which
                is right: notes are an aside about the slide, drawn in the same voice
                as the labels around them, not a second reading column competing
                with the explanation beside it. */}
            <p className="font-ui text-ui leading-[1.55] whitespace-pre-wrap text-ink-muted">
                {extracted}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

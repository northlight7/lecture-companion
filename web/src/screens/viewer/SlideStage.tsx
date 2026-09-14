import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { slideImageUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The slide, resting on `--surface-well`, and, as its own component below,
 * the deck's own notes for it.
 *
 * The well is level 0: the ground moved away from the reader, so it carries no
 * border and no shadow. The slide is the object on top of it, and an object has
 * a boundary: one hairline and a radius, which is all that separates it from
 * the well it rests in. It casts nothing.
 *
 * THE WELL HAS NO PADDING, on purpose. The slide is the subject of this screen
 * and every point of padding comes straight out of its width, which is what
 * `C7` measures. The well's own fill still earns its place: a 16:9 slide inside
 * a taller pane is letterboxed, and the well is the colour of that letterbox.
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
}: {
  cid: string;
  did: string;
  index: number;
}) {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
  }, [index]);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-pnl bg-well">
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
  );
}

/**
 * The deck's own notes for the slide, under the things the reader owns.
 *
 * THIS IS THE DECK'S PANEL AND NOT THE READER'S, so it is labelled as the
 * deck's and it never uses the second person. What it shows is the text the
 * deck itself carries for this slide, extracted by the pipeline (the shapes'
 * text, with the deck's speaker notes appended when it has any), which is why
 * the label names the deck rather than the reader. The reader's own surface is
 * the scratchpad directly above it.
 *
 * It is OPEN by default and small, which is the whole difference from what the
 * version before this replaced: a disclosure that started closed and then
 * opened into a 32vh block of monospace, so the reader either saw nothing or
 * lost a third of the slide to it. A notes pane is furniture: it is there when
 * you look down, and it does not need opening.
 *
 * The cap is in `vh` and NOT in per cent, on purpose. A percentage
 * `max-height` here has to resolve against a height this panel does not
 * declare: it comes from three levels of flex stretch above it, and whether
 * that counts as definite is exactly the case browsers disagree about. This
 * cap is not decoration, it is the floor under the slide's width (see C7 in
 * `.internal/bar.md`): unbounded, a long extraction takes the column and the
 * slide is left 463 points wide, which is the defect this round exists to fix.
 * A viewport unit always resolves, so the cap holds whatever the flex
 * resolution does, and it holds the same share of the window at every size.
 * The fold control stays, because a reader who wants the largest possible
 * slide should be able to have it, and the choice is theirs per slide.
 */
export function SpeakerNotes({ text }: { text: string }) {
  const [open, setOpen] = useState(true);

  const extracted = text.trim();
  if (!extracted) return null;
  const words = extracted.split(/\s+/).length;

  return (
    <section
      aria-label="Speaker notes from the deck"
      className={cn(
        "flex shrink-0 flex-col overflow-hidden rounded-srf bg-raised",
        "transition-[max-height] duration-[var(--dur-panel)] ease-[var(--ease)]",
        // A share of the window at most, and only while open. The cap is what
        // keeps the slide the subject: without it a long extraction pushes the
        // slide up and the notes become the page.
        open ? "max-h-[14vh]" : "max-h-[var(--row-h)]",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Speaker notes from the deck"
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
        <span className="flex-1 truncate">Speaker notes from the deck</span>
        <span className="shrink-0 text-meta font-normal tracking-normal tabular-nums normal-case">
          {words} {words === 1 ? "word" : "words"}
        </span>
      </button>

      {open ? (
        /* A well inside a panel, not a well on a well: the panel is the
         *  strip's own level and the reading surface steps back down from
         *  it, so the text is on the quietest surface in the stack. */
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {/* Sans, not the reading face. The reading face is reserved for the
            reading column and the gate refuses it at any size below
            `--fs-body`, which is right: these are the deck's words about the
            slide, drawn in the voice of the labels around them, not a second
            reading column competing with the explanation beside it. */}
          <p className="font-ui text-ui leading-[1.55] whitespace-pre-wrap text-ink-muted">
            {extracted}
          </p>
        </div>
      ) : null}
    </section>
  );
}

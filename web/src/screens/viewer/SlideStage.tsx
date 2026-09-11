import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { slideImageUrl } from "@/lib/api";

/**
 * The slide itself, on `--surface-sunken`, the well the design reserves for the
 * slide stage. Not a card: a well, with no border and no shadow.
 *
 * The well is the whole of the left pane above the extracted text, and the
 * image is fitted inside it, so the slide is as large as the window allows and
 * grows when the window does. The extracted text stays a disclosure below it
 * and is capped, so opening it takes room from the stage rather than from the
 * explanation beside it.
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
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setMissing(false);
  }, [index]);

  const extracted = text.trim();

  return (
    /* The slide and its extracted text are one group, centred in the pane. The
     * stage is the image's own box, so it hugs the slide instead of stretching
     * to the pane and leaving the slide adrift in a field of empty well. */
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
      {missing ? (
        <div className="flex min-h-0 items-center justify-center rounded-pnl bg-sunken p-8">
          <p className="font-ui text-ui text-ink-faint">No rendered image for this slide.</p>
        </div>
      ) : (
        <img
          src={slideImageUrl(cid, did, index)}
          alt={`Slide ${index + 1}`}
          onError={() => setMissing(true)}
          className="block min-h-0 max-h-full max-w-full rounded-pnl bg-sunken object-contain p-3"
        />
      )}

      {extracted ? (
        <details
          onToggle={(event) => setOpen(event.currentTarget.open)}
          className="max-h-full w-full shrink-0 [&::-webkit-details-marker]:hidden"
        >
          <summary className="flex h-[var(--row-h)] cursor-pointer list-none items-center gap-2 font-ui text-ui text-ink-muted transition-colors duration-[120ms] ease-[var(--ease)] hover:text-ink">
            {open ? (
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
            )}
            Text extracted from this slide
          </summary>
          <pre className="mt-2 max-h-[32vh] overflow-y-auto rounded-srf bg-sunken p-3 font-code text-meta whitespace-pre-wrap text-ink-muted">
            {extracted}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

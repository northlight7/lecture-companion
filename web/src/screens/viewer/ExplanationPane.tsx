import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Diagram } from "@/components/reading/Diagram";
import { Prose } from "@/components/reading/Prose";
import { explanationProse } from "@/lib/overview";
import type { Explanation, Term } from "@/lib/types";

/** Must match MAX_TERM_CHARS in app/terms.py. */
const MAX_TERM_CHARS = 200;

/** Must match MAX_NOTE_CHARS in app/notes.py. */
const MAX_NOTE_CHARS = 4000;

/** The measure's own small block for a state that replaces the explanation. */
export function PaneNotice({
  icon,
  title,
  children,
  action,
  footer,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      {icon ? (
        <span aria-hidden className="text-ink-faint">
          {icon}
        </span>
      ) : null}
      <h2 className="font-reading text-head leading-[1.25] font-semibold text-ink">{title}</h2>
      {children ? (
        <div className="flex flex-col gap-3 font-reading text-body leading-[1.62] text-ink-muted [&_p]:m-0">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-1 flex flex-wrap items-center gap-2">{action}</div> : null}
      {footer}
    </div>
  );
}

/** The small sans label that opens each block of the footer. */
function FooterLabel({ children }: { children: string }) {
  return (
    <p className="mb-2 font-ui text-meta font-medium tracking-[0.06em] text-ink-muted uppercase">
      {children}
    </p>
  );
}

/**
 * The reader's own apparatus on a slide, at the bottom of the explanation pane
 * and below the explanation it belongs to: the terms they asked to have
 * glossed, their note on the slide, what the explanation drew on, and where the
 * slide sits in the deck.
 *
 * This was the rail beside the reading column. The reading column is now the
 * pane itself and the pane is the full height of the window, so there is no
 * rail left to sit in: everything it carried reads here instead, in this order.
 * Terms and notes are stored per slide, so re-explaining a slide replaces the
 * explanation and leaves both alone.
 */
export function SlideFooter({
  index,
  count,
  explained,
  terms,
  pendingTerm,
  note,
  noteDirty,
  saving,
  sources,
  onNoteChange,
  onSaveNote,
  onRemoveTerm,
}: {
  index: number;
  count: number;
  explained: number;
  terms: Term[];
  pendingTerm: string;
  note: string;
  noteDirty: boolean;
  saving: boolean;
  sources: { key: string; href?: string; label: string }[];
  onNoteChange: (text: string) => void;
  onSaveNote: () => void;
  onRemoveTerm: (term: string) => void;
}) {
  return (
    <div className="mt-12 flex flex-col gap-8">
      <section>
        <FooterLabel>Terms you asked about</FooterLabel>
        {terms.length === 0 && !pendingTerm ? (
          <p className="font-ui text-meta text-ink-faint">
            Select a word or phrase in the explanation to keep a gloss of it here.
          </p>
        ) : null}

        <ul className="flex flex-col gap-5">
          {terms.map((term) => (
            <li key={term.term} className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 font-reading text-body leading-[1.3] text-ink">
                  {term.term}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove the explanation of ${term.term}`}
                  onClick={() => onRemoveTerm(term.term)}
                >
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                </Button>
              </div>
              <Prose>{explanationProse(term.note)}</Prose>
            </li>
          ))}
        </ul>

        <p
          aria-live="polite"
          className="mt-3 font-ui text-meta text-ink-faint empty:mt-0 empty:hidden"
        >
          {pendingTerm ? `Explaining ${pendingTerm}…` : ""}
        </p>
      </section>

      <section>
        <FooterLabel>Your note</FooterLabel>
        <div className="[&_textarea]:font-reading [&_textarea]:text-body [&_textarea]:leading-[1.62]">
          <Textarea
            aria-label="Your note on this slide"
            rows={6}
            maxLength={MAX_NOTE_CHARS}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Anything worth keeping about this slide, in your own words."
          />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Button type="button" variant="secondary" size="md" onClick={onSaveNote} disabled={saving}>
            Save note
          </Button>
          <span aria-live="polite" className="font-ui text-meta text-ink-faint">
            {saving ? "Saving" : noteDirty ? "Unsaved changes" : note ? "Saved" : ""}
          </span>
        </div>
      </section>

      <section>
        <FooterLabel>What this explanation drew on</FooterLabel>
        {sources.length === 0 ? (
          <p className="font-ui text-meta text-ink-faint">
            This explanation was written from the slide and its image alone.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sources.map((source) => (
              <li key={source.key} className="font-ui text-ui">
                {source.href ? (
                  <a
                    href={source.href}
                    className="text-accent-ink transition-colors duration-[120ms] ease-[var(--ease)] hover:underline"
                  >
                    {source.label}
                  </a>
                ) : (
                  <span className="text-ink-muted">{source.label}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <FooterLabel>On this slide</FooterLabel>
        <p className="font-ui text-ui text-ink">
          Slide {index + 1} of {count}
        </p>
        <p className="mt-1 font-ui text-meta text-ink-faint">
          {explained} of {count} explained
        </p>
      </section>
    </div>
  );
}

/**
 * The explanation pane: the right half of the viewer, `clamp(340px, 42%, 640px)`
 * wide and the full height under the header and the strip. It is its own scroll
 * region, which is why it is the `<aside>` and the pane at once, and the only
 * hairline in the screen runs down its leading edge.
 *
 * It holds the explanation, in the serif: the slide's own heading, the body,
 * the worked example, and a mermaid source drawn by `<Diagram>`. A slide with
 * no explanation is a real state, not a hole. It says what will happen, whether
 * the course is already working through the deck, why it stopped if it did, and
 * the control that makes an explanation appear. The dashed empty box the
 * previous build drew here is gone.
 *
 * `footer` is rendered below the explanation, inside the same scroll region:
 * the terms, the reader's note, the sources and the slide's position all belong
 * to the explanation above them, so they travel with it.
 *
 * Selecting a word or phrase in the explanation raises one small lifted control
 * over the selection: a gloss kept on this slide, or a grounded question about
 * the passage. Its position is measured against the node it is drawn in, which
 * is inside the scroll region, so it stays on the text as the pane scrolls.
 */
export function ExplanationPane({
  loading,
  error,
  explanation,
  slideNumber,
  running,
  pausedReason,
  busy,
  disconnected,
  footer,
  onRetry,
  onExplainSlide,
  onExplainDeck,
  onConnect,
  onExplainTerm,
  onAsk,
}: {
  loading: boolean;
  error: string | null;
  explanation: Explanation | null;
  slideNumber: number;
  running: boolean;
  pausedReason: string;
  busy: boolean;
  disconnected: boolean;
  footer?: ReactNode;
  onRetry: () => void;
  onExplainSlide: () => void;
  onExplainDeck: () => void;
  onConnect: () => void;
  onExplainTerm: (text: string) => void;
  onAsk: (text: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const prose = useRef<HTMLDivElement | null>(null);
  const [pick, setPick] = useState<{ text: string; top: number; left: number } | null>(null);

  // A selection belongs to the explanation it was made in.
  useEffect(() => {
    setPick(null);
  }, [explanation]);

  /** The selection, measured in the coordinates of the node the control is
   *  drawn in, so the control travels with the text when the pane scrolls
   *  under it. */
  const read = useCallback(() => {
    const node = prose.current;
    const anchor = host.current;
    const selection = window.getSelection();
    if (!node || !anchor || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setPick(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text || text.length > MAX_TERM_CHARS) {
      setPick(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!node.contains(range.commonAncestorContainer)) {
      setPick(null);
      return;
    }
    const box = range.getBoundingClientRect();
    const frame = anchor.getBoundingClientRect();
    // Half the width of the two-button control, so it never leaves the column.
    const half = 132;
    setPick({
      text,
      top: Math.max(box.top - frame.top - 46, 0),
      left: Math.min(
        Math.max(box.left - frame.left + box.width / 2, half),
        Math.max(frame.width - half, half),
      ),
    });
  }, []);

  const release = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setPick(null);
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") setPick(null);
  };

  // The body, the heading, the worked example and a term gloss are all the
  // model's prose, and all of them can carry the course-overview meta-text the
  // pipeline hands the prompt (`app/pipeline.py:301`). `explanationProse`
  // removes those phrases and leaves the teaching around them alone. The
  // mermaid source is code and is not touched.
  const heading = explanationProse(explanation?.heading.trim() ?? "");
  const body = explanationProse(explanation?.body ?? "");
  const example = explanationProse(explanation?.example.trim() ?? "");
  const mermaid = explanation?.mermaid.trim() ?? "";

  const notConnected = (
    <div className="mt-1 flex flex-wrap items-center gap-3">
      <p className="font-ui text-meta text-ink-muted">
        Not connected, so nothing can be written right now.
      </p>
      <Button type="button" variant="secondary" size="md" onClick={onConnect}>
        Connect
      </Button>
    </div>
  );

  return (
    <aside
      aria-label="Explanation of this slide"
      className="min-h-0 min-w-0 overflow-y-auto rounded-srf border-l border-hair bg-raised"
    >
      <div className="flex flex-col pt-[var(--space-6)] pb-12 pl-[var(--space-6)] pr-[var(--space-6)]">
        {/* The selection control is positioned against this node and not
         *  against the pane, so it stays on the text it was raised over while
         *  the pane scrolls. */}
        <div ref={host} className="relative flex flex-col">
          {error ? (
            <PaneNotice
              title="This slide could not be loaded"
              action={
                <Button type="button" variant="secondary" size="md" onClick={onRetry}>
                  Try again
                </Button>
              }
            >
              <p>{error}</p>
            </PaneNotice>
          ) : loading ? (
            <p className="flex items-center gap-3 font-ui text-ui text-ink-muted">
              <Spinner size="sm" label="" />
              Loading slide {slideNumber}
            </p>
          ) : !explanation ? (
            <PaneNotice
              icon={<Sparkles size={16} strokeWidth={1.75} aria-hidden />}
              title="Not explained yet"
              action={
                <>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    disabled={busy || running}
                    onClick={onExplainSlide}
                  >
                    {busy ? <Spinner size="sm" label="" /> : null}
                    Explain this slide
                  </Button>
                  {running ? null : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      disabled={busy}
                      onClick={onExplainDeck}
                    >
                      Explain this deck
                    </Button>
                  )}
                </>
              }
              footer={disconnected ? notConnected : null}
            >
              {running ? (
                <p>
                  This course is being explained right now. The pipeline works through the deck in
                  order and this slide fills in when it reaches it.
                </p>
              ) : pausedReason ? (
                <>
                  <p>Nothing is being written, so this slide will not fill in on its own.</p>
                  <p>{pausedReason}</p>
                  <p>
                    A slide is written from the slide, its image and the course context that came
                    before it.
                  </p>
                </>
              ) : (
                <p>
                  Nothing has been written for this slide. A slide is written from the slide, its
                  image and the course context that came before it.
                </p>
              )}
            </PaneNotice>
          ) : (
            <article className="flex flex-col">
              <h2 className="font-reading text-head leading-[1.25] font-semibold text-ink">
                {heading || `Slide ${slideNumber}`}
              </h2>

              <div
                ref={prose}
                onMouseUp={read}
                onKeyUp={read}
                onKeyDown={onKeyDown}
                onMouseDown={() => setPick(null)}
                className="mt-3"
              >
                <Prose>{body}</Prose>

                {example ? (
                  <aside className="mt-6">
                    <p className="mb-2 font-ui text-meta font-medium tracking-[0.06em] text-ink-faint uppercase">
                      Worked example
                    </p>
                    <Prose>{example}</Prose>
                  </aside>
                ) : null}

                {mermaid ? <Diagram source={mermaid} /> : null}
              </div>
            </article>
          )}

          {pick ? (
            <div
              className="absolute z-20 flex -translate-x-1/2 animate-[lc-enter_var(--dur-enter)_var(--ease)] items-center gap-1 rounded-pnl bg-float p-1 shadow-float"
              style={{ top: pick.top, left: pick.left }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={() => {
                  const text = pick.text;
                  release();
                  onExplainTerm(text);
                }}
              >
                Explain this term
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={() => {
                  const text = pick.text;
                  release();
                  onAsk(text);
                }}
              >
                Ask a question
              </Button>
            </div>
          ) : null}
        </div>

        {footer}
      </div>
    </aside>
  );
}

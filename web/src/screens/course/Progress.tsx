/**
 * How far this course has been explained, in two small pieces.
 *
 * The count is a ring in the sidebar, beside the decks it counts, because it is
 * about the course rather than about anything in the reading column. The run
 * itself, its state word, its pause reason and the one control that starts and
 * stops it are a single line under the lecture list, where the reader is
 * already looking when they press it.
 *
 * Ported from `runbarHtml` and `paintRunbarLost` in the previous frontend
 * (`web/app.js`): the same states, the same counts, the same pause reason, the
 * same tolerance for a poll that gives up. Two things changed since, and both
 * are removals. The progress bar is gone from the content column, so the reader
 * is not told the same number twice in a screen's height. The running summary
 * lost its fold: a fold control is banned on this screen, and a status message
 * is not worth a control of its own.
 */

import { useState, type JSX } from "react";
import { ACCENT_INK, type CourseAccent } from "@/lib/accents";
import { explanationProse } from "@/lib/overview";
import type { PipelineState, ProgressRow } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The state word, toned by meaning. Never a filled panel: the word is the
 *  signal, and the surface table has nothing to say about a run. */
const STATE_TONE: Record<PipelineState, string> = {
  idle: "text-ink-muted",
  running: "text-accent-ink",
  paused: "text-warn",
  done: "text-good",
  error: "text-bad",
};

function stateWord(state: PipelineState, done: number, total: number): string {
  if (state === "running") return "Explaining";
  if (state === "paused") return "Paused";
  if (state === "error") return "Stopped";
  if (total > 0 && done >= total) return "Every slide is explained";
  return done ? "Partly explained" : "Not explained yet";
}

/** The ring's box, in points. Well inside the 96x96 ceiling the chrome allows,
 *  so it sits in the sidebar without competing with the rows above it. */
const RING_BOX = 64;
/** Radius and stroke of the arc, in the ring's own 64-unit viewBox. */
const RING_RADIUS = 26;
const RING_STROKE = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The course's progress as a percentage inside a ring.
 *
 * Drawn with SVG and `stroke-dasharray` rather than a `conic-gradient`, which is
 * banned outright: a gradient of any kind is a defect in this app, and an arc
 * laid out as a dash on a circle is one element rather than one per theme.
 *
 * The colours are the two the direction allows here and no others. The track is
 * `--line-hair`, because a well on this ground is the ground again (they measure
 * 0.3 dL* apart in the dark theme, so the ring would have no visible circle
 * outside its arc) and a hairline is exactly what a track is. The arc takes the
 * course's own accent ink, which is the same hue the course wears in the
 * sidebar rows above it and is gated at 4.5:1 as text on this ground.
 *
 * Everything a screen reader needs is on the container, including both bounds,
 * so the count is announced as "58 of 112" rather than as a bare number.
 */
export function ProgressRing({
  done,
  total,
  accent,
}: {
  done: number;
  total: number;
  /** The course's accent, from its id: the same value the shell and the course
   *  list give this course, so the ring cannot disagree with the sidebar. */
  accent: CourseAccent;
}): JSX.Element {
  // A percentage of nothing is nothing: a course with no slides yet reads 0%,
  // which is true, and is still a percentage rather than a blank.
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const percent = Math.round(ratio * 100);

  return (
    <div
      role="progressbar"
      aria-label="Slides explained"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      // The percentage, reachable. A `role="progressbar"` is a LEAF in the
      // accessibility tree: its children are replaced by its value, so the
      // `52%` span below is on screen and invisible to a screen reader, and to
      // anything reading the tree. `aria-valuetext` is where that number is
      // supposed to live.
      aria-valuetext={
        total > 0
          ? `${Math.round(ratio * 100)}% explained, ${done} of ${total}`
          : "No slides to explain yet"
      }
      className="relative grid shrink-0 place-items-center"
      style={{ width: RING_BOX, height: RING_BOX }}
    >
      <svg viewBox="0 0 64 64" aria-hidden className="absolute inset-0 size-full">
        {/* The arc starts at twelve o'clock: an SVG circle starts at three. */}
        <g transform="rotate(-90 32 32)" fill="none" strokeWidth={RING_STROKE}>
          <circle cx="32" cy="32" r={RING_RADIUS} stroke="currentColor" className="text-hair" />
          {/* Nothing is drawn at zero. A zero-length dash with a round cap still
              paints a dot, and a dot at the top of an empty ring reads as a
              little progress rather than none. */}
          {ratio > 0 ? (
            <circle
              cx="32"
              cy="32"
              r={RING_RADIUS}
              stroke="currentColor"
              strokeLinecap="round"
              strokeDasharray={`${ratio * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              className={ACCENT_INK[accent]}
            />
          ) : null}
        </g>
      </svg>
      <span className="text-ui font-medium tabular-nums text-ink">{percent}%</span>
    </div>
  );
}

export interface ProgressPanelProps {
  progress: ProgressRow | null;
  /** Set when the poll gave up. The message the last status check failed with. */
  lost: string | null;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onRetry: () => void;
}

/**
 * The run's state, its reason and its one control, as a single row.
 *
 * This is the whole of what is left of the old banner. The bar it used to carry
 * is a ring in the sidebar and the counts it used to print are on that ring.
 * What stays is what a ring cannot say: whether a run is live, why it stopped
 * when it did, and the control that starts it again.
 */
export function ProgressPanel({
  progress,
  lost,
  busy,
  onStart,
  onPause,
  onRetry,
}: ProgressPanelProps): JSX.Element {
  const total = progress?.n_slides ?? 0;
  const done = progress?.n_explained ?? 0;
  const state: PipelineState = progress?.state ?? "idle";
  const running = Boolean(progress?.running) || state === "running";
  const reason = (progress?.pause_reason ?? "").trim();
  const summary = (progress?.running_summary ?? "").trim();
  const complete = total > 0 && done >= total;

  if (lost) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p role="alert" className="text-ui font-medium text-bad">
          Lost contact with the server
        </p>
        <p className="text-meta text-ink-muted">{lost || "The last status check failed."}</p>
        <Button type="button" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!progress || total === 0) {
    return (
      <p className="text-ui text-ink-muted">
        {progress ? "No slides to explain yet." : "Reading this course."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* No `truncate` here. It was there and it clipped the state word to
            "Not explaine…" on every course with nothing explained yet, at every
            size, in both themes: `flex-1 min-w-0` means shrinking always beats
            wrapping, so the state word was the only thing in the row that could
            lose. A minimum width instead, and the row wraps its control to the
            next line when it has to. */}
        <p className="min-w-[10rem] flex-1 text-ui">
          <span className={cn("font-medium", STATE_TONE[state])}>
            {stateWord(state, done, total)}
          </span>
          {reason && !complete ? (
            <span className="text-ink-muted" title={reason}>
              {" · "}
              {reason}
            </span>
          ) : null}
        </p>

        {/* At most one control, and none at all when the work is done: a course
            with every slide explained has nothing to resume, and a "Resume" on
            it would be a lie about what pressing it does. */}
        {running ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={onPause}>
            Pause
          </Button>
        ) : complete ? null : (
          <Button
            type="button"
            variant={done ? "secondary" : "primary"}
            disabled={busy}
            onClick={onStart}
          >
            {state === "error"
              ? "Try again"
              : done
                ? `Resume from slide ${done + 1}`
                : "Explain this course"}
          </Button>
        )}
      </div>

      {/* The run's own rolling summary. CLOSED BY DEFAULT, and that is the
          change: it was three clamped lines of grey model prose sitting between
          the lecture list and the files, which is the largest thing in the
          island and the least useful on arrival. It is a detail about where the
          run got to, so it opens when the reader asks and shows one line when
          they have not. It grows without bound as a course is explained, so
          even open it is capped and scrolls rather than pushing the island's
          height around. It is model prose built from model-written gists, so it
          goes through the same filter an explanation does. */}
      {summary ? <RunSummary text={explanationProse(summary)} /> : null}
    </div>
  );
}

function RunSummary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="self-start font-ui text-meta text-accent-ink transition-colors duration-[120ms] ease-[var(--ease)] hover:underline"
      >
        {open ? "Hide what the run covered" : "What the run covered"}
      </button>
      <p
        className={cn(
          "text-meta text-ink-muted",
          open ? "max-h-40 overflow-y-auto" : "line-clamp-1",
        )}
      >
        {text}
      </p>
    </div>
  );
}

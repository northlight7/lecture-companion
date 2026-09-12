/**
 * The rail beside the course overview: how far this course has been explained,
 * and what the study folders currently hold.
 *
 * Ported from `runbarHtml` and `paintRunbarLost` in the previous frontend
 * (`web/app.js`): the same states, the same counts, the same pause reason, the
 * same tolerance for a poll that gives up. Two changes, both required by the
 * rebuild: the run state is no longer a full-width banner above the page, and
 * the paused state is one line of state beside its control instead of the
 * largest object on the screen.
 *
 * Nothing here is a card. The two blocks are separated by space, by the ground,
 * and by nothing else.
 */

import { useState, type JSX } from "react";
import type { CourseAccent } from "@/lib/accents";
import type { PipelineState, ProgressRow } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { StudyGroup } from "@/screens/course/Files";

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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The bar's fill in the course's hue, instead of the app's single accent.
 *
 * `Progress` draws its own fill from `bg-accent`, and the fill is the one part
 * of the bar a caller cannot reach through props, so the accent is applied to
 * it as a descendant variant on the bar's className. The `data-slot` is the
 * component's own hook. Six literal class names: a name built at runtime would
 * compile to no CSS at all.
 *
 * The track is untouched. A sunken well reads as a track in both themes, and
 * only the fill is asked to say which course this is.
 */
const PROGRESS_FILL: Record<CourseAccent, string> = {
  blue: "[&_[data-slot=progress-indicator]]:bg-course-blue-fill",
  teal: "[&_[data-slot=progress-indicator]]:bg-course-teal-fill",
  green: "[&_[data-slot=progress-indicator]]:bg-course-green-fill",
  orange: "[&_[data-slot=progress-indicator]]:bg-course-orange-fill",
  olive: "[&_[data-slot=progress-indicator]]:bg-course-olive-fill",
  violet: "[&_[data-slot=progress-indicator]]:bg-course-violet-fill",
};

export interface ProgressPanelProps {
  /** The course's accent, from its id. Colours the bar's fill only: no state
   *  word and no control takes it, because the hue means "this course". */
  accent: CourseAccent;
  progress: ProgressRow | null;
  /** Set when the poll gave up. The message the last status check failed with. */
  lost: string | null;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onRetry: () => void;
}

export function ProgressPanel({
  accent,
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

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-ui font-semibold text-ink">Progress</h2>

      {lost ? (
        <>
          <p className="text-ui font-medium text-bad">
            Lost contact with the server
          </p>
          <p className="text-meta text-ink-muted">{lost || "The last status check failed."}</p>
          <Button type="button" variant="secondary" className="self-start" onClick={onRetry}>
            Try again
          </Button>
        </>
      ) : null}

      {!lost && (!progress || total === 0) ? (
        <p className="text-ui text-ink-muted">
          {progress ? "No slides to explain yet." : "Reading this course."}
        </p>
      ) : null}

      {!lost && progress && total > 0 ? (
        <>
          <Progress
            value={done}
            max={total}
            aria-label="Slides explained"
            className={PROGRESS_FILL[accent]}
          />
          <p className="text-ui tabular-nums text-ink-muted">
            {done} of {total} explained
          </p>
          {summary ? (
            <Summary text={summary} />
          ) : null}

          {/* One line of state, its reason, and at most one control. The old
              banner was a block four times this tall, and it outranked both the
              title and the overview. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* No `truncate` here. It was there and it clipped the state word
                to "Not explaine…" on every course with nothing explained yet,
                at every size, in both themes: `flex-1 min-w-0` means shrinking
                always beats wrapping, so the state word was the only thing in
                the row that could lose. A minimum width instead, and the row
                wraps its control to the next line when it has to. */}
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
        </>
      ) : null}
    </section>
  );
}

/**
 * The run's own rolling summary of what it has covered.
 *
 * It grows without bound as a course is explained, so it is folded to three
 * lines and small type. Rendered whole it became a nine-hundred-pixel wall of
 * text that outranked everything else on the course page, which is exactly the
 * "status message larger than the content it describes" the direction bans.
 */
function Summary({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className={cn("text-meta text-ink-muted", !open && "line-clamp-3")}>{text}</p>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mt-1 text-meta text-accent-ink transition-colors duration-[120ms] ease-[var(--ease)] hover:underline"
      >
        {open ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

/**
 * What the study folders hold, in the rail, so the folder structure is legible
 * without scrolling to the file list. Counts only: the editable control lives
 * with the row it belongs to.
 */
export function StudyFoldersSummary({ groups }: { groups: StudyGroup[] }): JSX.Element {
  const files = groups.reduce((count, group) => count + group.rows.length, 0);
  const named = groups.filter((group) => group.folder !== "Unfiled");
  const unfiled = groups.find((group) => group.folder === "Unfiled")?.rows.length ?? 0;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-ui font-semibold text-ink">Study folders</h2>

      {files === 0 ? (
        <p className="text-ui text-ink-muted">
          No files in this course yet.
        </p>
      ) : (
        <>
          <p className="text-ui tabular-nums text-ink-muted">
            {plural(named.length, "folder", "folders")} · {plural(files, "file", "files")}
          </p>
          {unfiled ? (
            <p className="text-meta tabular-nums text-ink-faint">
              {plural(unfiled, "file", "files")} not filed yet
            </p>
          ) : null}
          {named.length ? (
            <ul className="mt-1 flex flex-col gap-1">
              {named.map((group) => (
                <li key={group.folder} className="flex items-center gap-2 text-meta">
                  <span className="min-w-0 flex-1 truncate text-ink-muted" title={group.folder}>
                    {group.folder}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-faint">
                    {group.rows.length}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

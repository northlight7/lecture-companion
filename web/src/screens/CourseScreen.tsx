/**
 * The course screen: the course's name and counts, every lecture it holds, the
 * way to search it, and every file filed into it. That is the whole screen, in
 * that order.
 *
 * Ported from `renderCourse` in the previous frontend (`web/app.js`), plus its
 * progress polling (`startPolling` / `refreshProgress` / `paintRunbarLost`), the
 * deck list, the upload report and the delete-course confirmation. The polling
 * keeps the old contract exactly: one fetch immediately, then every 1200ms while
 * a run is live, at most three consecutive failures before it gives up and says
 * so, and a reload of the course once the run stops.
 *
 * Three things have left since. The course overview is gone from the screen
 * entirely: it was the largest block of prose on the page and its subject was
 * the model's own method, so the screen renders no overview prose, no fold and
 * no rewrite control, and nothing here says the word. The progress bar is gone
 * from the content column, because the same count is a ring in the sidebar. And
 * the rail those two shared is gone with them, so the column is one reading
 * order rather than two.
 *
 * A 404 no longer redirects to the course list: the store reports a message
 * rather than a status, so the screen says what went wrong and offers the back
 * link and a retry instead of navigating under the reader.
 *
 * The course's accent colour reaches the title, the deck rows' marks and the
 * island's own accent. It comes from `courseAccent(cid)`, never from anything
 * the reader has done, so the course looks the same on every visit. It is
 * deliberately not used on any state or destructive control: a colour that means
 * "this course" must not also mean "careful".
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Trash2 } from "lucide-react";

import * as api from "@/lib/api";
import { ACCENT_FILL, ACCENT_INK, courseAccent, type CourseAccent } from "@/lib/accents";
import { deckLabel } from "@/lib/deckLabel";
import { hash, navigate } from "@/lib/router";
import type { ArtifactRow, DeckRow, ProgressRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useErrorHandler, useStore } from "@/state/store";
import { Screen, Section } from "@/shell/Screen";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { FilesSection, groupArtifacts } from "@/screens/course/Files";
import { ProgressPanel } from "@/screens/course/Progress";
import { SearchSection } from "@/screens/course/Search";
import { UploadSection } from "@/screens/course/Upload";

/** How often a live run is asked for its progress. The old screen's interval. */
const PROGRESS_POLL_MS = 1200;

/** Consecutive failures the poll tolerates before it gives up. The old screen
 *  treated one bad tick as a blip, because a run does not stop for one. */
const PROGRESS_FAILURE_LIMIT = 3;

/**
 * The course's hue on its own title, as `ACCENT_INK` on the `h1`.
 *
 * The rule above the title was the other candidate. The ink was chosen because
 * it is the stronger signal that this is *this* course: the title is the one
 * piece of the screen a reader reads before anything else, and a 30px serif in
 * the course's own hue carries further than a 3px rule does. Every `-ink` value
 * is derived at or above 4.5:1 as text on both grounds, in both themes, so the
 * title stays a title rather than becoming decoration.
 *
 * The `h1` is drawn by `Screen`, whose `title` is a string, so the accent
 * reaches it as a descendant variant on the screen's own className rather than
 * by wrapping it. Six literal class names, because Tailwind only emits a
 * utility it can see written out.
 */
const TITLE_INK: Record<CourseAccent, string> = {
  blue: "text-course-blue-ink",
  teal: "text-course-teal-ink",
  green: "text-course-green-ink",
  orange: "text-course-orange-ink",
  olive: "text-course-olive-ink",
  violet: "text-course-violet-ink",
};

/**
 * A deck row plus the file it was extracted from.
 *
 * `DeckRow` in `lib/types.ts` declares the four fields a caller needed until
 * now. `source_file_id` is on the payload (`_course_row` in `app/main.py`), so
 * it is declared here rather than widening a type another screen shares.
 */
type DeckWithSource = DeckRow & { source_file_id?: string };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One deck, and the lecture it belongs to. `lecture` is `""` when the deck's
 *  own artifact could not be found: see `lectureOf`. */
interface LectureRow {
  deck: DeckRow;
  lecture: string;
}

/**
 * Which lecture a deck belongs to, as the name of a study folder.
 *
 * A deck is extracted from exactly one source file, and that file's artifact is
 * filed into a study folder, which is a lecture here ("Lecture 1"). The artifact
 * is found by content hash rather than by title: a source file's id IS
 * `content_hash[:12]` (`app/importer.py` builds both from the same digest, and
 * `app/course.py` relates the two the same way when it removes the files a
 * deleted artifact leaves behind), so this is the exact link. Matching on the
 * filename or the title would be a guess, and a title is a thing a reader or a
 * model may have rewritten.
 *
 * The folder name comes out of `groupArtifacts`, which is the same function and
 * the same unsaved-edits-win rule the file list uses, so a deck cannot be
 * labelled with a folder the reader has just moved its file out of. An artifact
 * that is filed nowhere returns `""`, and the caller says so plainly rather than
 * inventing a lecture for it.
 */
function lectureOf(
  deck: DeckRow,
  artifacts: ArtifactRow[],
  folderOf: Map<string, string>,
): string {
  const fileId = (deck as DeckWithSource).source_file_id ?? "";
  if (!fileId) return "";

  const matches = artifacts.filter((row) => row.content_hash.startsWith(fileId));
  // A re-import can leave a duplicate behind. The deck came from the original,
  // and the duplicate is preferred last rather than filtered out, so a course
  // whose original artifact was deleted still names its lecture.
  const artifact = matches.find((row) => !row.duplicate_of) ?? matches[0];
  if (!artifact) return "";

  const folder = folderOf.get(artifact.id) ?? "";
  return folder === "Unfiled" ? "" : folder;
}

/**
 * One deck, as a row: the link, and the lecture it belongs to beside it.
 *
 * The link carries the deck's name and the deck's own count, and nothing else,
 * in that order. That is deliberate rather than tidy: the row is how the screen
 * says a deck exists, so the count has to be part of the link's accessible name,
 * and the name has to end with it. The lecture is therefore a sibling of the
 * link rather than a child of it, and it is still visible text in the row, so a
 * row read on its own says where the deck belongs. The file list prints the
 * folder on each of its rows for the same reason.
 *
 * The row's whole width changes surface on hover, the link included, and the
 * link is what a click lands on. Nothing here is a div pretending to be a
 * control.
 */
function DeckRow({
  cid,
  deck,
  label,
  lecture,
  accent,
}: {
  cid: string;
  deck: DeckRow;
  label: string;
  lecture: string;
  accent: CourseAccent;
}): JSX.Element {
  return (
    // The row's surface and its hover, on a plain element: the link inside it is
    // the control, and nothing here is a div standing in for one.
    <div className="flex h-[var(--row-h)] items-center rounded-srf px-2 text-ui text-ink transition-colors duration-[120ms] ease-[var(--ease)] hover:bg-hover">
      <a
        href={hash.deck(cid, deck.id, 0)}
        // THE LECTURE IS IN THE NAME, and the visible text is in the name
        // unchanged so WCAG 2.5.3 holds: the label a reader sees is a prefix of
        // the label a screen reader hears. It was a sibling of this link, which
        // kept it beside the deck's name on screen and left it out of the row
        // for anyone reading the row itself. That is the one thing the bar asks
        // this row to say beyond the deck's own name.
        aria-label={
          `${label} ${deck.n_explained} / ${plural(deck.n_slides, "slide", "slides")}`
          + (lecture ? `, ${lecture}` : "")
        }
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {/* One mark per row, in the course's hue: the deck list belongs to the
            colour without the row becoming a filled block. `rounded-ctl` on a
            6px box clamps to a true circle and keeps the radius scale closed. */}
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-ctl bg-current", ACCENT_INK[accent])}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <span className="shrink-0 text-meta tabular-nums text-ink-muted">
          {deck.n_explained} / {plural(deck.n_slides, "slide", "slides")}
        </span>
      </a>
      <span className="ml-3 shrink-0 text-meta text-ink-muted">
        {lecture || "Not filed yet"}
      </span>
    </div>
  );
}

/**
 * Every deck in the course, in the order the course holds them, each one named
 * by `deckLabel` and labelled with the lecture it belongs to.
 *
 * `detail.decks` arrives sorted by `deck.order` (`_course_row` in
 * `app/main.py`), so the order on screen is the course's own and this list does
 * not rearrange it. Lectures are not drawn as their own blocks with a heading
 * over them: the list may not be reordered into lecture groups, because a deck
 * whose lecture sits out of sequence would move away from its own position in
 * the course, and a heading over the first group would be a titled block
 * between the island's own heading and the list it names, which is precisely
 * what the first-island check reads as something other than the list. So the
 * lecture rides on the row, and a reader still sees one lecture's decks
 * together wherever the course already keeps them together.
 */
function LectureList({
  cid,
  rows,
  accent,
}: {
  cid: string;
  rows: LectureRow[];
  accent: CourseAccent;
}): JSX.Element {
  return (
    <ul className="flex flex-col">
      {rows.map((row, index) => (
        <li key={row.deck.id} className="flex flex-col">
          {index > 0 ? <Separator className="my-1" /> : null}
          <DeckRow
            cid={cid}
            deck={row.deck}
            label={deckLabel(row.deck.title)}
            lecture={row.lecture}
            accent={accent}
          />
        </li>
      ))}
    </ul>
  );
}

export function CourseScreen({ cid }: { cid: string }): JSX.Element {
  const { course, courseError, courseLoading, reloadCourse, progress, setProgress } = useStore();
  const handle = useErrorHandler();

  // The store already sequences course requests, and this is the second guard:
  // a payload for another course must never paint on this screen.
  const detail = course && course.id === cid ? course : null;

  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [lost, setLost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const pollRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const seededFor = useRef<string | null>(null);

  // The server's filing is the starting point and never a reset: an edit made
  // before a reload survives the reload, which is the bug the old screen's
  // `typedFolders` map existed to patch.
  useEffect(() => {
    if (!detail || seededFor.current === cid) return;
    seededFor.current = cid;
    setAssignments(
      Object.fromEntries(
        detail.artifacts.filter((a) => a.folder).map((a) => [a.id, a.folder] as const),
      ),
    );
  }, [cid, detail]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    failuresRef.current = 0;
  }, []);

  const refreshProgress = useCallback(async (): Promise<ProgressRow | null> => {
    try {
      const next = await api.getProgress(cid);
      failuresRef.current = 0;
      setLost(null);
      setProgress(next);
      return next;
    } catch (err) {
      failuresRef.current += 1;
      console.error(err);
      if (failuresRef.current < PROGRESS_FAILURE_LIMIT) return null; // a blip
      stopPolling();
      setLost(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [cid, setProgress, stopPolling]);

  const tick = useCallback(async () => {
    const next = await refreshProgress();
    if (!next) return;
    if (!next.running && next.state !== "running") {
      stopPolling();
      // A finished or paused run changes the counts, the decks and the files.
      await reloadCourse();
    }
  }, [refreshProgress, reloadCourse, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    void tick();
    pollRef.current = window.setInterval(() => void tick(), PROGRESS_POLL_MS);
  }, [stopPolling, tick]);

  // A new course, or leaving this one, ends the poll it started.
  useEffect(() => () => stopPolling(), [cid, stopPolling]);

  useEffect(() => {
    if (!detail) return;
    setProgress(detail.progress);
    setLost(null);
    if (detail.progress.running || detail.progress.state === "running") void startPolling();
  }, [detail, setProgress, startPolling]);

  const start = async () => {
    setBusy(true);
    try {
      await api.startProcess(cid, {});
      startPolling();
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  };

  const pause = async () => {
    setBusy(true);
    try {
      setProgress(await api.pauseProcess(cid));
      stopPolling();
      await reloadCourse();
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  };

  const deleteCourse = async () => {
    try {
      await api.deleteCourse(cid);
      setConfirmingDelete(false);
      // The route refetches the list; it is not fetched twice from here.
      navigate(hash.courses());
    } catch (err) {
      handle(err);
      setConfirmingDelete(false);
    }
  };

  // The study folders, as the file list arranges them, flattened to the one
  // question the lecture list asks of them: which folder is this artifact in.
  const groups = detail ? groupArtifacts(detail.artifacts, assignments) : [];
  const folderOf = new Map<string, string>();
  for (const group of groups) {
    for (const row of group.rows) folderOf.set(row.id, group.folder);
  }
  const lectureRows: LectureRow[] = detail
    ? detail.decks.map((deck) => ({
        deck,
        lecture: lectureOf(deck, detail.artifacts, folderOf),
      }))
    : [];

  const shown: ProgressRow | null = progress ?? detail?.progress ?? null;

  // The course's own hue, from its id: the same value the sidebar and the
  // course list show, so the screen and the navigation agree on what colour
  // this course is.
  const accent = courseAccent(cid);

  return (
    <Screen
      title={detail?.title ?? "Course"}
      titleClassName={TITLE_INK[accent]}
      rule={ACCENT_FILL[accent]}
      back={{ href: hash.courses(), label: "All courses" }}
      meta={
        detail
          ? `${plural(detail.n_decks, "deck", "decks")} · ${plural(detail.n_slides, "slide", "slides")} · ${detail.n_explained} explained`
          : undefined
      }
      actions={
        detail ? (
          <Button type="button" variant="danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={16} strokeWidth={1.75} aria-hidden />
            Delete course
          </Button>
        ) : undefined
      }
    >
      {!detail ? (
        courseError ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-ui text-bad">
              {courseError}
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={courseLoading}
              onClick={() => void reloadCourse()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="py-6">
            <Spinner label="Reading this course" />
          </div>
        )
      ) : (
        <>
          {/* The first island is the course itself: every deck it holds, in the
              course's own order, each labelled with the lecture it belongs to.
              What the course is and how far it has been explained are the two
              things a reader arrives for, and they are the same list.

              Its island accent is blue by assignment, not the course's own hue.
              A section's accent is the section's: search is teal, upload is
              green, the file list is violet, and this one is blue, so the four
              islands are four hues on every course rather than four hues on
              most of them. The course's own colour still says which course this
              is, on the title, on the rule under it and on every deck's mark. */}
          <Section title="Lectures" accent="blue">
            {detail.decks.length ? (
              <LectureList cid={cid} rows={lectureRows} accent={accent} />
            ) : (
              <p className="text-ui text-ink-muted">
                No slide deck in this course yet. Other imported artifacts remain available in the
                file list.
              </p>
            )}

            {/* The run's state and its one control, under the list they act on:
                the ring in the sidebar carries the count, so what is left here
                is whether a run is live and how to start or stop it. */}
            <div className="mt-3 border-t border-hair pt-3">
              <ProgressPanel
                progress={shown}
                lost={lost}
                busy={busy}
                onStart={() => void start()}
                onPause={() => void pause()}
                onRetry={() => startPolling()}
              />
            </div>
          </Section>

          <SearchSection cid={cid} />

          <UploadSection cid={cid} />

          <FilesSection
            cid={cid}
            artifacts={detail.artifacts}
            assignments={assignments}
            onAssignments={setAssignments}
          />
        </>
      )}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this course?</AlertDialogTitle>
            <AlertDialogDescription>
              {detail
                ? `“${detail.title}” and everything filed into it is deleted. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={() => void deleteCourse()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}

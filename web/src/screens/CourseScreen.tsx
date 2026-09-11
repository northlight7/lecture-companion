/**
 * The course screen: what the course is, how far it has been explained, the
 * way to search it, its decks, and every file filed into it.
 *
 * Ported from `renderCourse` in the previous frontend (`web/app.js`), plus its
 * progress polling (`startPolling` / `refreshProgress` / `paintRunbarLost`),
 * the overview fold, the deck list, the upload report and the delete-course
 * confirmation. The polling keeps the old contract exactly: one fetch
 * immediately, then every 1200ms while a run is live, at most three consecutive
 * failures before it gives up and says so, and a reload of the course once the
 * run stops.
 *
 * Two things the old screen did are deliberately not done here. The overview
 * fold is a class on a wrapper rather than a `-webkit-line-clamp`, because a
 * line clamp on this markup would mangle the model's lists and headings. And a
 * 404 no longer redirects to the course list: the store reports a message
 * rather than a status, so the screen says what went wrong and offers the back
 * link and a retry instead of navigating under the reader.
 *
 * The rail beside the overview is the reason the overview uses `prose-rail`:
 * at 1440 the progress state and the study-folder summary sit there, so no part
 * of the column is empty margin.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Trash2 } from "lucide-react";

import * as api from "@/lib/api";
import { hash, navigate } from "@/lib/router";
import type { ProgressRow } from "@/lib/types";
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
import { toast } from "@/components/ui/toast";
import { Prose } from "@/components/reading/Prose";
import { FilesSection, groupArtifacts } from "@/screens/course/Files";
import { ProgressPanel, StudyFoldersSummary } from "@/screens/course/Progress";
import { SearchSection } from "@/screens/course/Search";
import { UploadSection } from "@/screens/course/Upload";

/** How often a live run is asked for its progress. The old screen's interval. */
const PROGRESS_POLL_MS = 1200;

/** Consecutive failures the poll tolerates before it gives up. The old screen
 *  treated one bad tick as a blip, because a run does not stop for one. */
const PROGRESS_FAILURE_LIMIT = 3;

/** Above this many characters the overview is folded. The old screen's number. */
const OVERVIEW_FOLD_AT = 260;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The course overview, in the reading column. A long one is folded until the
 * reader asks for it, and an absent one says so and offers to write it rather
 * than hiding the control that would.
 */
function OverviewBlock({
  cid,
  overview,
  onRewritten,
}: {
  cid: string;
  overview: string;
  onRewritten: () => Promise<void>;
}): JSX.Element {
  const handle = useErrorHandler();
  const [expanded, setExpanded] = useState(false);
  const [writing, setWriting] = useState(false);

  const text = (overview ?? "").trim();
  const foldable = text.length > OVERVIEW_FOLD_AT;

  const rewrite = async () => {
    setWriting(true);
    try {
      await api.regenerateOverview(cid);
      await onRewritten();
      toast("Overview rewritten.");
    } catch (err) {
      handle(err);
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div id="course-overview">
        {text ? (
          <div className={foldable && !expanded ? "max-h-64 overflow-hidden" : undefined}>
            <Prose>{text}</Prose>
          </div>
        ) : (
          <p className="font-reading text-body leading-[1.62] text-ink-muted">
            No overview yet. Add the syllabus or the programme requirements and the app writes one,
            so every explanation knows what the course is for.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {foldable ? (
          <Button
            type="button"
            variant="secondary"
            aria-expanded={expanded}
            aria-controls="course-overview"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" disabled={writing} onClick={() => void rewrite()}>
          {writing ? "Rewriting" : text ? "Rewrite overview" : "Write an overview"}
        </Button>
      </div>
    </div>
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

  const groups = detail ? groupArtifacts(detail.artifacts, assignments) : [];
  const shown: ProgressRow | null = progress ?? detail?.progress ?? null;

  return (
    <Screen
      title={detail?.title ?? "Course"}
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
          <div className="prose-rail">
            <OverviewBlock
              key={cid}
              cid={cid}
              overview={detail.overview}
              onRewritten={reloadCourse}
            />

            <div className="flex flex-col gap-8">
              <ProgressPanel
                progress={shown}
                lost={lost}
                busy={busy}
                onStart={() => void start()}
                onPause={() => void pause()}
                onRetry={() => startPolling()}
              />
              <StudyFoldersSummary groups={groups} />
            </div>
          </div>

          <SearchSection cid={cid} />

          <Section title="Decks">
            {detail.decks.length ? (
              <ul className="flex flex-col">
                {detail.decks.map((deck, index) => (
                  <li key={deck.id} className="-mx-2 flex flex-col">
                    {index > 0 ? <Separator className="my-1" /> : null}
                    <a
                      href={hash.deck(cid, deck.id, 0)}
                      className="flex h-[var(--row-h)] items-center gap-3 rounded-srf px-2 text-ui text-ink transition-colors duration-[120ms] ease-[var(--ease)] hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{deck.title}</span>
                      <span className="shrink-0 text-meta tabular-nums text-ink-muted">
                        {deck.n_explained} / {plural(deck.n_slides, "slide", "slides")}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ui text-ink-muted">
                No slide deck in this course yet. Other imported artifacts remain available in the
                file list.
              </p>
            )}
          </Section>

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

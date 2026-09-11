import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";

import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { hash, navigate } from "@/lib/router";
import type { SlideDetail, SlideRegeneration, SlideSummary, Term } from "@/lib/types";
import { useConnect, useErrorHandler, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ExplanationPane, PaneNotice, SlideFooter } from "@/screens/viewer/ExplanationPane";
import { RegenDialog } from "@/screens/viewer/RegenDialog";
import { AskDialog } from "@/screens/viewer/AskDialog";
import { SlideStage } from "@/screens/viewer/SlideStage";
import { SlideStrip } from "@/screens/viewer/SlideStrip";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The deck viewer. A student opens a deck and reads a considered explanation of
 * the slide in front of them.
 *
 * The frame is a left-right split and it fills the window. The slide pane on
 * the left takes whatever width is left, the explanation pane on the right is
 * `clamp(340px, 42%, 640px)`, and both run the full height under the deck
 * header and the slide strip, each scrolling on its own. The window itself
 * never scrolls.
 *
 * The header is written here rather than with `Screen`, which is a scrolling
 * page frame: a slide beside its explanation is not a reading column, and
 * `page-column`'s `--column-max` would strand half of a 1920px window as empty
 * margin beside it. This screen uses the whole content column, with one
 * `--space-6` gutter at its edges and one between the panes.
 *
 * The deck is fetched when the deck changes and not when the slide does. Only
 * the slide in front of the reader is refetched as the index moves, which is
 * what the previous frontend did and what keeps a 173-slide deck to one request
 * per arrow key.
 */
export function ViewerScreen({ cid, did, index }: { cid: string; did: string; index: number }): JSX.Element {
  const {
    course,
    courseError,
    courseLoading,
    reloadCourse,
    progress,
    setProgress,
    connection,
  } = useStore();
  const handle = useErrorHandler();
  const connect = useConnect();

  const [slides, setSlides] = useState<SlideSummary[] | null>(null);
  const [slidesError, setSlidesError] = useState<string | null>(null);
  const [listReload, setListReload] = useState(0);
  const [detail, setDetail] = useState<SlideDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReload, setDetailReload] = useState(0);
  const [terms, setTerms] = useState<Term[]>([]);
  const [pendingTerm, setPendingTerm] = useState("");
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [busySlide, setBusySlide] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [askFor, setAskFor] = useState<string | null>(null);

  // `useErrorHandler` returns a new function whenever its context value moves,
  // so it is held in a ref and kept out of every effect below.
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  // Unsaved notes are held per slide, so moving away from the slide and back
  // does not throw the reader's typing away.
  const pendingNotes = useRef(new Map<number, string>());
  const noteDirtyRef = useRef(false);

  const count = slides?.length ?? 0;
  const last = Math.max(count - 1, 0);
  // An index past the end of the deck is clamped rather than rendered blank.
  const current = Math.min(Math.max(index, 0), last);
  const currentRef = useRef(current);
  const countRef = useRef(count);
  useEffect(() => {
    currentRef.current = current;
    countRef.current = count;
  }, [current, count]);

  const deck = course?.decks.find((row) => row.id === did) ?? null;
  // The detail for the slide in front of the reader and nothing else: during a
  // move the previous slide's payload is already in state, and it must not be
  // painted under the new slide's image.
  const shown = detail && detail.slide.index === current ? detail : null;
  const progressRow = progress ?? course?.progress ?? null;
  const running = Boolean(progressRow && (progressRow.running || progressRow.state === "running"));
  const stoppedReason =
    progressRow && (progressRow.state === "paused" || progressRow.state === "error")
      ? progressRow.pause_reason || "The run stopped before it reached this slide."
      : "";
  const explainedHere = progressRow?.done[did]?.length ?? deck?.n_explained ?? 0;
  const disconnected = Boolean(connection && !connection.connected && !connection.fake);

  // ---------------------------------------------------------------- loading

  // The course detail carries the deck's title and its explained count. The
  // store owns it, so this only asks for it when it is not there yet.
  useEffect(() => {
    if (!course && !courseLoading && !courseError) void reloadCourse();
  }, [course, courseLoading, courseError, reloadCourse]);

  useEffect(() => {
    let live = true;
    setSlides(null);
    setSlidesError(null);
    api
      .listSlides(cid, did)
      .then((list) => {
        if (live) setSlides(list);
      })
      .catch((err: unknown) => {
        if (!live) return;
        // An empty list would read as "this deck has no slides", which is a
        // different fact from "this deck could not be fetched".
        setSlides([]);
        setSlidesError(messageOf(err));
        handleRef.current(err);
      });
    return () => {
      live = false;
    };
  }, [cid, did, listReload]);

  useEffect(() => {
    if (count === 0) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let live = true;
    setDetail(null);
    setDetailError(null);
    api
      .getSlide(cid, did, current)
      .then((payload) => {
        if (!live) return;
        const pending = pendingNotes.current.get(current);
        setDetail(payload);
        setTerms(payload.terms ?? []);
        setNote(pending ?? payload.note ?? "");
        noteDirtyRef.current = pending !== undefined;
        setNoteDirty(pending !== undefined);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setDetail(null);
        setDetailError(messageOf(err));
        handleRef.current(err);
      });
    return () => {
      live = false;
    };
  }, [cid, did, current, count, detailReload]);

  // While a run is going, the deck's own progress moves. Polling is bounded to
  // the running state and stops with the screen.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      api
        .getProgress(cid)
        .then(setProgress)
        .catch(() => {
          // The sidebar reports a lost connection. A status line is not worth
          // raising an error for on every tick.
        });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [running, cid, setProgress]);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) setDetailReload((value) => value + 1);
    wasRunning.current = running;
  }, [running]);

  // ------------------------------------------------------------- navigation

  useEffect(() => {
    if (count > 0 && current !== index) navigate(hash.deck(cid, did, current));
  }, [cid, did, index, current, count]);

  const goTo = useCallback(
    (next: number) => {
      const total = countRef.current;
      if (total === 0) return;
      navigate(hash.deck(cid, did, Math.min(Math.max(next, 0), total - 1)));
    },
    [cid, did],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase() ?? "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target?.isContentEditable) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(currentRef.current - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(currentRef.current + 1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [goTo]);

  // ------------------------------------------------------- terms, notes, runs

  /** A 428 opens the connect dialog. Every other failure is reported where it
   *  happened, so a dialog keeps its own error rather than losing it to a
   *  toast that scrolls away. */
  const reportIfAuth = useCallback((err: unknown) => {
    if (err instanceof ApiError && (err.status === 428 || err.status === 429)) {
      handleRef.current(err);
    }
  }, []);

  const applyExplanation = useCallback((out: SlideRegeneration) => {
    setDetail((prev) => (prev ? { ...prev, explanation: out.explanation } : prev));
    setTerms(out.terms ?? []);
    // Re-explaining a slide leaves the reader's own note alone.
    if (!noteDirtyRef.current) setNote(out.note ?? "");
  }, []);

  const explainTerm = useCallback(
    async (text: string) => {
      const at = currentRef.current;
      setPendingTerm(text);
      try {
        const out = await api.addTerm(cid, did, at, text);
        if (at !== currentRef.current) return;
        setTerms(out.terms ?? []);
        if (!noteDirtyRef.current) setNote(out.note ?? "");
      } catch (err) {
        handleRef.current(err);
      } finally {
        setPendingTerm("");
      }
    },
    [cid, did],
  );

  const removeTerm = useCallback(
    async (term: string) => {
      const at = currentRef.current;
      try {
        const out = await api.removeTerm(cid, did, at, term);
        if (at !== currentRef.current) return;
        setTerms(out.terms ?? []);
      } catch (err) {
        handleRef.current(err);
      }
    },
    [cid, did],
  );

  const changeNote = useCallback(
    (text: string) => {
      const at = currentRef.current;
      setNote(text);
      setNoteDirty(true);
      noteDirtyRef.current = true;
      pendingNotes.current.set(at, text);
    },
    [],
  );

  const saveNoteNow = useCallback(async () => {
    const at = currentRef.current;
    setSavingNote(true);
    try {
      const out = await api.saveNote(cid, did, at, note);
      if (at !== currentRef.current) return;
      setNote(out.note ?? "");
      setNoteDirty(false);
      noteDirtyRef.current = false;
      pendingNotes.current.delete(at);
    } catch (err) {
      handleRef.current(err);
    } finally {
      setSavingNote(false);
    }
  }, [cid, did, note]);

  const explainSlide = useCallback(async () => {
    const at = currentRef.current;
    setBusySlide(true);
    try {
      const out = await api.regenerateSlide(cid, did, at, "");
      if (at === currentRef.current) applyExplanation(out);
      toast({ title: `Slide ${at + 1} explained.` });
    } catch (err) {
      handleRef.current(err);
    } finally {
      setBusySlide(false);
    }
  }, [cid, did, applyExplanation]);

  const explainDeck = useCallback(async () => {
    try {
      await api.startProcess(cid, { deckId: did });
      toast({
        title: "Explaining this deck",
        description: "Slides fill in as the pipeline reaches them.",
      });
      api
        .getProgress(cid)
        .then(setProgress)
        .catch(() => {});
    } catch (err) {
      handleRef.current(err);
    }
  }, [cid, did, setProgress]);

  const pauseRun = useCallback(async () => {
    try {
      setProgress(await api.pauseProcess(cid));
    } catch (err) {
      handleRef.current(err);
    }
  }, [cid, setProgress]);

  const runRegeneration = useCallback(
    async (wholeDeck: boolean, steer: string) => {
      const at = currentRef.current;
      try {
        if (wholeDeck) {
          await api.startProcess(cid, { deckId: did, force: true, steer });
          toast({
            title: "Explaining this deck again",
            description: "Every slide in it is written again.",
          });
          api
            .getProgress(cid)
            .then(setProgress)
            .catch(() => {});
          return;
        }
        const out = await api.regenerateSlide(cid, did, at, steer);
        if (at === currentRef.current) applyExplanation(out);
        toast({ title: `Slide ${at + 1} explained again.` });
      } catch (err) {
        reportIfAuth(err);
        throw err;
      }
    },
    [cid, did, setProgress, applyExplanation, reportIfAuth],
  );

  // -------------------------------------------------------------- the sources

  const sources = useMemo(
    () =>
      (shown?.explanation?.context_used ?? []).flatMap((chunk) => {
        const value = String(chunk);
        if (value.startsWith("object:")) {
          const parts = value.split(":");
          const artifactId = parts[1] ?? "";
          const objectId = parts.slice(2).join(":");
          if (!artifactId || !objectId) return [];
          const artifact = course?.artifacts.find((row) => row.id === artifactId);
          return [
            {
              key: value,
              href: hash.source(cid, artifactId, objectId),
              label: artifact ? `${artifact.filename} (related file)` : "Related course source",
            },
          ];
        }
        const [deckId = "", rawIndex = ""] = value.split(":");
        const slideIndex = Number(rawIndex);
        if (!deckId || !rawIndex || Number.isNaN(slideIndex)) return [];
        const source = course?.decks.find((row) => row.id === deckId);
        const previous = deckId === did && slideIndex === current - 1;
        return [
          {
            key: value,
            href: hash.deck(cid, deckId, slideIndex),
            label: `${source?.title ?? "Deck"}, slide ${slideIndex + 1}${previous ? " (previous slide)" : ""}`,
          },
        ];
      }),
    [shown, course, cid, did, current],
  );

  // --------------------------------------------------------------- the frame

  const status = running
    ? "Explaining this course now"
    : stoppedReason
      ? `${progressRow?.state === "error" ? "Stopped" : "Paused"}. ${stoppedReason}`
      : "";

  // The header and the strip are the full content width: the panes below them
  // are the split, not the page. `px-[var(--space-6)]` is the viewer's own
  // gutter, in place of the `page-column` this screen must not use.
  const header = (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-3 px-[var(--space-6)]">
      <div className="min-w-0 flex-1">
        <a
          href={hash.course(cid)}
          className="mb-3 inline-flex items-center gap-1 text-ui text-ink-muted transition-colors duration-[120ms] ease-[var(--ease)] hover:text-ink"
        >
          <ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
          {course?.title ?? "Course"}
        </a>
        <h1
          tabIndex={-1}
          className="truncate font-reading text-[30px] leading-[1.15] font-semibold text-ink focus-target"
        >
          {deck?.title ?? "Deck"}
        </h1>
        {status ? <div className="mt-2 text-ui text-ink-faint">{status}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {running ? (
          <Button type="button" variant="secondary" size="md" onClick={() => void pauseRun()}>
            Pause
          </Button>
        ) : stoppedReason ? (
          <Button type="button" variant="secondary" size="md" onClick={() => void explainDeck()}>
            Resume
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={count === 0}
          onClick={() => setRegenOpen(true)}
        >
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden />
          Explain again
        </Button>
      </div>
    </header>
  );

  return (
    <div className="flex h-full min-h-0 flex-col pt-6 pb-4">
      {header}

      {count > 0 ? (
        <div className="mt-4 w-full shrink-0 px-[var(--space-6)]">
          <SlideStrip slides={slides ?? []} index={current} onJump={goTo} />
        </div>
      ) : null}

      {slidesError ? (
        <div className="mt-6 min-h-0 w-full flex-1 overflow-y-auto px-[var(--space-6)]">
          <div className="max-w-[var(--measure)]">
            <PaneNotice
              title="Could not load this deck"
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => setListReload((value) => value + 1)}
                >
                  Try again
                </Button>
              }
            >
              <p>{slidesError}</p>
            </PaneNotice>
          </div>
        </div>
      ) : slides !== null && count === 0 ? (
        <div className="mt-6 min-h-0 w-full flex-1 overflow-y-auto px-[var(--space-6)]">
          <div className="max-w-[var(--measure)]">
            <PaneNotice
              title="Nothing to read yet"
              action={
                <Button type="button" variant="secondary" size="md" asChild>
                  <a href={hash.course(cid)}>Back to the course</a>
                </Button>
              }
            >
              <p>This deck has no rendered slides. Another file in the course may have some.</p>
            </PaneNotice>
          </div>
        </div>
      ) : (
        /* The split. The slide takes what is left, the explanation is the fixed
         * column at `clamp(340px, 42%, 640px)`, and both are as tall as the
         * window: each is its own scroll region and the window never scrolls.
         * The one hairline in the screen sits between them, in the middle of
         * the gutter. */
        <div className="mt-4 grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)_clamp(340px,42%,640px)] grid-rows-[minmax(0,1fr)] gap-x-[var(--space-6)] overflow-hidden px-[var(--space-6)]">
          <section aria-label="Slide" className="flex min-h-0 min-w-0 flex-col">
            {slides === null ? null : (
              <SlideStage cid={cid} did={did} index={current} text={shown?.slide.text ?? ""} />
            )}
          </section>

          <ExplanationPane
            loading={slides === null || !shown}
            error={detailError}
            explanation={shown?.explanation ?? null}
            slideNumber={current + 1}
            running={running}
            pausedReason={stoppedReason}
            busy={busySlide}
            disconnected={disconnected}
            onRetry={() => setDetailReload((value) => value + 1)}
            onExplainSlide={() => void explainSlide()}
            onExplainDeck={() => void explainDeck()}
            onConnect={connect.open}
            onExplainTerm={(text) => void explainTerm(text)}
            onAsk={setAskFor}
            footer={
              <SlideFooter
                index={current}
                count={count}
                explained={explainedHere}
                terms={terms}
                pendingTerm={pendingTerm}
                note={note}
                noteDirty={noteDirty}
                saving={savingNote}
                sources={sources}
                onNoteChange={changeNote}
                onSaveNote={() => void saveNoteNow()}
                onRemoveTerm={(term) => void removeTerm(term)}
              />
            }
          />
        </div>
      )}

      <RegenDialog
        open={regenOpen}
        onOpenChange={setRegenOpen}
        running={running}
        disconnected={disconnected}
        onConnect={connect.open}
        onRun={runRegeneration}
      />

      <AskDialog
        open={askFor !== null}
        onOpenChange={(open) => {
          if (!open) setAskFor(null);
        }}
        cid={cid}
        passage={askFor ?? ""}
        disconnected={disconnected}
        onConnect={connect.open}
        onFailure={reportIfAuth}
      />
    </div>
  );
}

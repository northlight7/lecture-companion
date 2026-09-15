import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";

import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { ACCENT_FILL, courseAccent } from "@/lib/accents";
import { rememberSlide } from "@/lib/prefs";
import { hash, navigate, type Route } from "@/lib/router";
import type { DeckRow, SlideDetail, SlideRegeneration, SlideSummary, Term } from "@/lib/types";
import { useConnect, useErrorHandler, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Sidebar } from "@/shell/Sidebar";
import { SidebarToggle } from "@/shell/SidebarToggle";
import { AskSlide } from "@/screens/viewer/AskSlide";
import { ExplanationPane, PaneNotice, SlideFooter } from "@/screens/viewer/ExplanationPane";
import { RegenDialog } from "@/screens/viewer/RegenDialog";
import { AskDialog } from "@/screens/viewer/AskDialog";
import { Scratchpad, type NoteSaveState } from "@/screens/viewer/Scratchpad";
import { SlideStage, SpeakerNotes } from "@/screens/viewer/SlideStage";
import { SlideStrip } from "@/screens/viewer/SlideStrip";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** How long the guard waits after the last keystroke before it saves. */
const NOTE_SAVE_DELAY = 900;

/**
 * The deck viewer. A student opens a deck and reads a considered explanation of
 * the slide in front of them.
 *
 * THE VIEWER LEAVES THE APP SHELL, and that is a measured decision, not a
 * preference. At 1280 the content column is 1000 points once the 280-point
 * sidebar is out, and this screen has to hold a 640-point slide (C7) beside a
 * reading column worth the name plus two gutters. It does not fit, so the
 * sidebar is what gives: the viewer is a reading mode, its own header carries
 * the way back to the course, and the reader does not navigate while reading a
 * slide. `App.tsx` renders this outside `AppShell` and supplies the `<main>`,
 * so the skip link and the focus-on-navigation behaviour are unchanged.
 *
 * THE CHROME IS AN OVERLAY HERE, NOT A COLUMN. The control named "Show the
 * sidebar" opens the navigation over the lecture instead of leaving for the
 * course screen, which is what it used to do and what the owner rejected: "it
 * backs me out of the lecture and back to the page for that course. It should
 * be able to open and close on any page without breaking or moving me to
 * another page." It floats, so it never takes the slide under C7's 640 points,
 * and it starts closed on every visit rather than reading the shell's saved
 * preference, so the arrangement C7 is measured in cannot depend on a flag a
 * previous session left behind.
 *
 * THE HEADER IS TWO ROWS AND ITS BOTTOM EDGE IS AT y=108 (C8):
 *
 *   * Row 1, 48 points, 16 points below the window's top: the chrome control at
 *     the header's own left edge, then the back link to the course, the deck
 *     title as the `h1`, the run status and the actions. It is a drag strip
 *     (`.titlebar-drag`), so every control in it carries `.titlebar-control`,
 *     or the window server would take the click for a window drag.
 *   * Row 2, 36 points, 8 points below it: the deck strip.
 *
 * 16 + 48 + 8 + 36 is 108 of the 120 points C8 allows. The top margin and the
 * taller first row are the owner's, from 2026-09-15: the title and the actions
 * sat 3 and 4 points off the window's top edge and it "really feels squished
 * and too close to the border".
 *
 * ONE LEFT EDGE, AT 76. The header, the strip and the panes all start there,
 * which clears the traffic lights (measured at x 10 to 67 on this window:
 * `.fullSizeContentView`, so they are drawn over the content). The chrome
 * control is the first thing in that edge rather than an outlier in the gutter
 * below it: it was moved there on the same day, at the owner's request, so the
 * header reads as one column instead of two ragged ones.
 *
 * Under the two rows the two panes fill everything that is left, each scrolling
 * on its own, and the window itself never scrolls. The left column is the slide
 * on its well, then the reader's scratchpad, then the deck's own notes.
 *
 * THE VERTICAL BUDGET AT 1280x800, because four of these numbers are
 * load-bearing for C7's 640-point slide. The window gives the panes 676 points
 * (800 less the 88-point header less the grid's own 12 above and 24 below). The
 * left column spends 12 + 149 + 12 + 112 of that on everything but the slide:
 * the 12s are its gaps, 149 is the scratchpad (a 21-point label row, an
 * 8-point gap, a 120-point pad) and 112 is the deck's notes pane at its
 * 14vh cap. The well is left 391 points tall, so a 16:9 slide is 695 points
 * wide, which clears 640 by 55. Change the pad's height or that cap and this
 * arithmetic moves with it.
 *
 * THE RUN STATUS IS ABOUT THIS DECK (C10). A deck whose slides all have an
 * explanation is finished, whatever the course-wide run is doing: it gets no
 * stopped reason, no "Paused" line, no Resume control and no "stopped before"
 * sentence, because there is no work left in front of the reader. The reason is
 * computed from this deck's own unexplained slides and never from the run's
 * state alone, and the fallback sentence is only used when the slide in front
 * of the reader is itself unexplained.
 *
 * The deck is fetched when the deck changes and not when the slide does. Only
 * the slide in front of the reader is refetched as the index moves, which is
 * what the previous frontend did and what keeps a 173-slide deck to one request
 * per arrow key.
 */
export function ViewerScreen({
  route,
  cid,
  did,
  index,
}: {
  /** The live route, so the overlay's sidebar highlights the deck being read
   *  exactly as the shell's sidebar does. */
  route: Route;
  cid: string;
  did: string;
  index: number;
}): JSX.Element {
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
  const disconnected = Boolean(connection && !connection.connected && !connection.fake);

  // ---------------------------------------------------------- what is left

  /**
   * This deck's own unexplained slides, which is what every run-state claim on
   * this screen is measured against. The slide list is the deck's own truth
   * when it is loaded, and the deck's counters are the fallback while it is
   * not: the course-wide run state is never consulted for this, because a deck
   * the reader has finished is finished whatever the pipeline is doing
   * elsewhere (C10).
   */
  const unexplained = useMemo(() => {
    if (slides) return slides.filter((slide) => !slide.has_explanation).length;
    if (deck) return Math.max(deck.n_slides - deck.n_explained, 0);
    return 0;
  }, [slides, deck]);
  const remaining = unexplained > 0;

  const runStopped = Boolean(
    progressRow && (progressRow.state === "paused" || progressRow.state === "error"),
  );
  const explainedHere = slides ? count - unexplained : progressRow?.done[did]?.length ?? 0;

  /**
   * Why the run is not moving, in this deck's terms.
   *
   * There is no reason at all when there is nothing left to explain. When
   * there is, the run's own pause reason is used if the backend wrote one, and
   * the fallback sentence is only used for a slide that is itself unexplained:
   * a slide that already has an explanation cannot have been stopped before.
   */
  const stoppedReason =
    remaining && runStopped
      ? progressRow?.pause_reason ||
        (shown?.explanation ? "" : "The run stopped before it reached this slide.")
      : "";

  const status = remaining
    ? running
      ? "Explaining this course now"
      : stoppedReason
        ? `${progressRow?.state === "error" ? "Stopped" : "Paused"}. ${stoppedReason}`
        : ""
    : "";

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

  // Where the reader is in this deck, remembered for the next launch. It is
  // written on every slide and deliberately does not notify the store: see
  // `rememberSlide`. Nothing navigates from it here, which is what keeps the
  // arrow keys and the strip exactly as they were.
  useEffect(() => {
    if (count > 0) rememberSlide(cid, did, current);
  }, [cid, did, current, count]);

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
      } else if (event.key === "Escape" && chromeOpenRef.current) {
        // The overlay covers the header's own toggle, and a reader who opened
        // it by accident should not have to find the close control inside it.
        // The arrow keys are not affected: the guard above returns before this
        // branch whenever a dialog is open, and the overlay is not a dialog.
        setChromeOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [goTo]);

  /**
   * The chrome, asked for from inside the viewer.
   *
   * IT OPENS HERE, AND NOTHING IS NAVIGATED. It used to set the collapsed
   * preference to expanded and then navigate to the course screen, on the
   * reasoning that the viewer has no sidebar and can never show one. The
   * owner's report: "when I try to unhide it, it backs me out of the lecture
   * and back to the page for that course. It should be able to open and close
   * on any page without breaking or moving me to another page."
   *
   * THE VIEWER'S SIDEBAR IS AN OVERLAY, NOT A COLUMN, and that is what makes
   * it possible at all. C7 needs a 640-point slide at 1280x800, which the
   * content column cannot hold beside a 280-point column: a sidebar that
   * reflowed this screen would take the slide under its floor. Floating over
   * the content leaves the slide exactly the width it had, and the reader
   * chooses when to cover it.
   *
   * IT IS NOT THE COLLAPSED PREFERENCE. The overlay starts closed every time a
   * deck is opened, whatever the shell's preference says, and toggling it
   * writes nothing. Two reasons, and the first is the load-bearing one: the
   * viewer is a reading mode whose slide is measured against C7, so its
   * arrangement must not depend on a saved flag that a previous session can
   * hand it. The second is that the shell's preference is about a column that
   * is always there, and this is a temporary look at the navigation.
   */
  const [chromeOpen, setChromeOpen] = useState(false);
  const toggleChrome = useCallback(() => setChromeOpen((open) => !open), []);
  // The key handler below is bound once and reads live values through refs, the
  // same way it reads `currentRef`, so it does not have to be rebound on every
  // slide and every toggle.
  const chromeOpenRef = useRef(false);
  useEffect(() => {
    chromeOpenRef.current = chromeOpen;
  }, [chromeOpen]);

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

  const changeNote = useCallback((text: string) => {
    const at = currentRef.current;
    setNote(text);
    setNoteDirty(true);
    noteDirtyRef.current = true;
    pendingNotes.current.set(at, text);
  }, []);

  const saveNoteNow = useCallback(async () => {
    const at = currentRef.current;
    const text = note;
    if (!noteDirtyRef.current) return;
    setSavingNote(true);
    try {
      const out = await api.saveNote(cid, did, at, text);
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

  // The pad saves on blur and on a pause after the last keystroke. The timer is
  // reset by every edit, because `saveNoteNow` is rebuilt whenever the text
  // is, and cleared the moment the note is clean.
  useEffect(() => {
    if (!noteDirty) return;
    const timer = window.setTimeout(() => void saveNoteNow(), NOTE_SAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [noteDirty, note, saveNoteNow]);

  const noteState: NoteSaveState = savingNote
    ? "saving"
    : noteDirty
      ? "dirty"
      : note
        ? "saved"
        : "idle";

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

  /**
   * The deck's own source artifact, which is what the "ask about this slide"
   * box reads the slide's learning object out of.
   *
   * A deck's `source_file_id` is `content_hash[:12]` and an artifact's id is
   * the same digest, so the match is by prefix rather than by filename: a
   * filename is a thing a reader or a model may have rewritten. This is the
   * same link `CourseScreen.lectureOf` walks, for the same reason. `DeckRow`
   * does not declare the field because no other screen needed it, so it is
   * read here rather than widening a shared type.
   */
  const deckArtifactId = useMemo(() => {
    const fileId = (deck as (DeckRow & { source_file_id?: string }) | null)?.source_file_id ?? "";
    if (!fileId) return "";
    return course?.artifacts.find((row) => row.content_hash.startsWith(fileId))?.id ?? "";
  }, [deck, course]);

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

  const header = (
    <header className="shrink-0 pt-4">
      {/* Row 1. The chrome control leads, then the way out, then the title, and
       *  the whole row starts at the same left edge as the panes below it: one
       *  left edge for the screen, 76 points in, which clears the traffic
       *  lights (measured at x 10 to 67). Every named box on this screen starts
       *  there.
       *
       *  THE TOGGLE MOVED HERE from row 2, at the owner's request: it "should be
       *  on the top left", and it was sitting on its own at the window's edge
       *  one row down, which made the header two ragged columns rather than
       *  one. It is placed before the back link rather than after the title,
       *  because a chrome control that moves depending on the length of a deck
       *  title is not in a consistent place.
       *
       *  ROW 1 IS 48 POINTS AND THE HEADER HAS 12 ABOVE IT. It was 44 points
       *  with nothing above it, so a 36-point title filled its row to within a
       *  point and the actions sat 4 points off the window's top edge. The
       *  owner's words were that it "really feels squished and too close to the
       *  border". C8 allows the header 120 points and this leaves it at 104. */}
      <div className="titlebar-drag flex h-12 items-center gap-3 pr-6 pl-[76px]">
        {/* The chrome control is rendered even when the strip is not: a deck
         *  that failed to load still has to leave the reader a way out, and it
         *  is the same control on every state of this screen.
         *
         *  `titlebar-control`, because this row is a drag region: without it
         *  the window's own drag handler takes the press and the control never
         *  sees a click.
         *
         *  IT IS THE ONE CONTROL THE OVERLAY DOES NOT COVER. Everything to its
         *  right and every row below it goes `inert` while the chrome is open,
         *  which takes it out of the accessibility tree and the tab order for
         *  as long as it is behind the panel. This one stays live, at `z-50`
         *  over the `z-40` panel, so the control that opened the panel is still
         *  the control that closes it and it has not moved by a pixel. A
         *  layout gate found the version without `inert`: it reported five
         *  pairs of interactive controls whose boxes overlapped, which is what
         *  a covered control looks like from the accessibility tree. */}
        <SidebarToggle
          collapsed={!chromeOpen}
          onToggle={toggleChrome}
          className="titlebar-control relative z-50"
        />
        <div
          inert={chromeOpen || undefined}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <a
            href={hash.course(cid)}
            className="titlebar-control flex max-w-[260px] min-w-0 items-center gap-1 text-ui text-ink-muted transition-colors duration-[120ms] ease-[var(--ease)] hover:text-ink"
          >
            <ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
            <span className="truncate">{course?.title ?? "Course"}</span>
          </a>
          {/* A hairline between the two, drawn as a border rather than a fill:
              `gate_static.py` allows a boundary from `--line-hair` anywhere and
              allows a *background* only from a ground or the surface table. */}
          <span aria-hidden className="h-5 shrink-0 border-l border-hair" />
          <h1
            tabIndex={-1}
            className="max-w-[520px] min-w-0 shrink truncate font-ui text-display leading-[1.15] font-semibold text-ink focus-target"
          >
            {deck?.title ?? "Deck"}
          </h1>
          {status ? (
            <p className="min-w-0 truncate text-ui text-ink-faint">{status}</p>
          ) : null}
          <div className="min-w-0 flex-1" />
          <div className="flex shrink-0 items-center gap-2">
            {remaining && running ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="titlebar-control"
                onClick={() => void pauseRun()}
              >
                Pause
              </Button>
            ) : remaining && stoppedReason ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="titlebar-control"
                onClick={() => void explainDeck()}
              >
                Resume
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="titlebar-control"
              disabled={count === 0}
              onClick={() => setRegenOpen(true)}
            >
              <RefreshCw size={16} strokeWidth={1.75} aria-hidden />
              Explain again
            </Button>
          </div>
        </div>
      </div>

      {/* Row 2, eight points below row 1 and as wide as the window: the deck
       *  strip, which is what a rail of a hundred and seventy-three segments
       *  needs to stay a usable jump control. The row is not a drag strip: the
       *  rail under it is dragged to scrub, and a drag region would take those
       *  pointer events for the window. */}
      {count > 0 ? (
        <div
          inert={chromeOpen || undefined}
          className="mt-2 flex h-9 items-center pr-6 pl-[76px]"
        >
          <div className="min-w-0 flex-1">
            <SlideStrip
              slides={slides ?? []}
              index={current}
              onJump={goTo}
              markerFill={ACCENT_FILL[courseAccent(cid)]}
            />
          </div>
        </div>
      ) : null}
    </header>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-ground">
      {header}

      {slidesError ? (
        <div
          inert={chromeOpen || undefined}
          className="mt-3 min-h-0 w-full flex-1 overflow-y-auto pr-6 pb-6 pl-[76px]"
        >
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
        <div
          inert={chromeOpen || undefined}
          className="mt-3 min-h-0 w-full flex-1 overflow-y-auto pr-6 pb-6 pl-[76px]"
        >
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
         * column at `clamp(340px, 38%, 620px)`, and both are as tall as the
         * window: each is its own scroll region and the window never scrolls.
         * The one hairline in the screen runs down the explanation pane's
         * leading edge, in the middle of the gutter. */
        <div
          inert={chromeOpen || undefined}
          className="grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)_clamp(340px,38%,620px)] grid-rows-[minmax(0,1fr)] gap-x-6 overflow-hidden pt-3 pr-6 pb-6 pl-[76px]"
        >
          <section aria-label="Slide" className="flex min-h-0 min-w-0 flex-col gap-3">
            {slides === null ? null : (
              <SlideStage cid={cid} did={did} index={current} />
            )}
            {/* KEYED BY THE SLIDE, so the pad is a new pad on a new slide.
                Its undo history is its own, and clearing that history when the
                incoming text changes is not enough: two slides whose notes are
                both empty hand the pad the same value, the reset never fires,
                and undo on slide 2 walks back into slide 1's words. A critic
                reproduced exactly that, and undo must never write one slide's
                text into another. A key is the whole fix, because it makes the
                refs new rather than asking them to notice. */}
            <Scratchpad
              key={current}
              value={note}
              state={noteState}
              onChange={changeNote}
              onSave={() => void saveNoteNow()}
            />
            <SpeakerNotes text={shown?.slide.text ?? ""} />
          </section>

          <ExplanationPane
            loading={slides === null || !shown}
            error={detailError}
            explanation={shown?.explanation ?? null}
            slideNumber={current + 1}
            running={running && remaining}
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
              <>
                <SlideFooter
                  index={current}
                  count={count}
                  explained={explainedHere}
                  terms={terms}
                  pendingTerm={pendingTerm}
                  sources={sources}
                  onRemoveTerm={(term) => void removeTerm(term)}
                />
                {/* Keyed by the slide, so a question and the answer to it
                    belong to the slide they were asked on. Nothing here is
                    saved: it lives in this component and dies with the window. */}
                <AskSlide
                  key={current}
                  cid={cid}
                  index={current}
                  artifactId={deckArtifactId}
                  disconnected={disconnected}
                  onConnect={connect.open}
                  onFailure={reportIfAuth}
                />
              </>
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

      {/* The chrome, over the content rather than beside it. It is the one
        * surface in the app that is neither a ground nor a panel resting on
        * one: it is a panel genuinely above the page, and it takes the float
        * level's shadow for exactly that reason, which is the one place
        * `DESIGN.md` allows a shadow. Its fill stays `--ground-chrome`: a
        * sidebar is the sidebar wherever it is drawn, and a `--surface-float`
        * one would be a second navigation idiom. No border, because the
        * boundary here would be a border between the two grounds. */}
      {chromeOpen ? (
        <div className="chrome-overlay fixed inset-y-0 left-0 z-40 flex w-[var(--chrome-w)] flex-col overflow-hidden bg-chrome shadow-float">
          <Sidebar
            route={route}
            onOpenConnect={connect.open}
            onToggleCollapsed={toggleChrome}
            withToggle={false}
          />
        </div>
      ) : null}
    </div>
  );
}

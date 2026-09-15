/**
 * Ask about this slide.
 *
 * The owner asked for this on 2026-09-15: "I want to add an ask AI section when
 * we are going through the slide deck itself ... it allows me to take the
 * context of the slide or even previous slides included and allow me to ask AI
 * supplementary questions about it if I have. The questions asked do not need
 * to be saved or anything and can disappear after I quit the app."
 *
 * IT SITS AT THE END OF THE EXPLANATION PANE, under the terms, the sources and
 * the slide's position, and it is the last thing in that column. The pane is
 * the reading column, it scrolls on its own, and a reader who has just read the
 * explanation is the one who has a follow-up question. The owner's words for
 * where it should go were "somewhere at the bottom that I need to scroll to
 * reach is fine", and this is that.
 *
 * IT IS GROUNDED, AND IT SAYS SO. `POST /api/courses/{id}/questions` answers
 * from a bounded set of objects that this course already holds, and nothing
 * else. The evidence is chosen here, before the question is sent:
 *
 *   * the slide in front of the reader, and the slides before it, found by
 *     their own locators in the deck's own source artifact (a PDF numbers its
 *     objects by `page`, a PowerPoint deck by `slide`, and both are 1-based);
 *   * anything in the course that the reader's own question matches, from
 *     `app/knowledge.py`'s local index, which is a search and not a model call.
 *
 * The two lists are merged, de-duplicated, and capped at the same twelve the
 * backend caps at. What came back is rendered with its citations, the backend's
 * uncertainty, and the backend's own disclosure of what left the machine, which
 * is never folded away.
 *
 * NOTHING IS STORED, AND NOTHING SURVIVES THE SLIDE. Its state is its own and
 * `ViewerScreen` keys it by the slide, so moving to the next slide starts a new
 * question rather than answering the old one against new evidence.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import * as api from "@/lib/api";
import { hash } from "@/lib/router";
import type { LearningObject, QuestionAnswer, QuestionSelection } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Prose } from "@/components/reading/Prose";
import { PaneLabel } from "@/screens/viewer/Scratchpad";

/** Must match MAX_SELECTIONS in app/questions.py. */
const MAX_SELECTIONS = 12;

/**
 * How many slides of context the reader gets when they ask for the ones before.
 *
 * Three, not ten. The backend caps the total at twelve objects and each slide
 * is a long one, so a wider window would spend the whole budget on slides the
 * question is probably not about, and it would push out everything the search
 * found. Three is the slide being read and the two it follows, which is also
 * the window the pipeline itself treats as context (`DESIGN.md`, "The previous
 * completed slide is mandatory context", extended by one for a question that
 * takes a moment to build up).
 */
const CONTEXT_SLIDES = 3;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * What the scope checkbox just did, in words.
 *
 * It describes the control above it and nothing else. It used to be a sentence
 * beside the Ask button that explained the whole retrieval, which is the shape
 * `DESIGN.md`'s banned list entry 17 refuses: a statement about the model's
 * method, printed to the reader, in a place they cannot act on it.
 */
function scopeNote(slides: number, includePrevious: boolean): string {
  // Only reachable when the deck's own source artifact could not be found or
  // has no objects against it, which is a degraded state and not a scope. The
  // question still goes through, answered from whatever this course matches.
  if (slides === 0) return "The slides of this deck could not be found.";
  // NOT "This slide only" while the box above is ticked. A critic caught that:
  // on the first slide of a deck the ticked box was described by the unticked
  // box's sentence, so the line denied the control it sat under. What it says
  // now is why the tick makes no difference here, which is the true answer.
  if (!includePrevious) return "This slide only.";
  if (slides === 1) return "There are no slides before this one.";
  return `This slide and the ${slides - 1} before it.`;
}

/**
 * A slide's number, from whatever its own format calls it.
 *
 * `page` is a PDF's and `slide` is a PowerPoint's, and both count from one
 * while a deck index counts from zero. An object with neither is not a slide
 * and is skipped rather than guessed at.
 */
function slideNumberOf(object: LearningObject): number | null {
  const value = object.locator.slide ?? object.locator.page;
  return typeof value === "number" && value > 0 ? value : null;
}

export function AskSlide({
  cid,
  index,
  artifactId,
  disconnected,
  onConnect,
  onFailure,
}: {
  cid: string;
  /** The slide in front of the reader, 0-based. */
  index: number;
  /** The deck's own source artifact, or `""` when it could not be found. */
  artifactId: string;
  disconnected: boolean;
  onConnect: () => void;
  onFailure: (err: unknown) => void;
}) {
  const questionId = useId();
  const scopeId = useId();

  const [question, setQuestion] = useState("");
  const [includePrevious, setIncludePrevious] = useState(true);
  const [answer, setAnswer] = useState<QuestionAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The deck's own objects, by slide number, fetched once per deck.
   *
   * One request, and it is the same list the artifact viewer would read. A
   * failure is not an error the reader has to see: without it the question is
   * still answered from the search, so it degrades to "this course" rather than
   * to nothing.
   */
  const [bySlide, setBySlide] = useState<Map<number, string> | null>(null);
  useEffect(() => {
    if (!artifactId) {
      setBySlide(null);
      return;
    }
    let live = true;
    api
      .listArtifactObjects(cid, artifactId, { limit: 1000 })
      .then((rows) => {
        if (!live) return;
        const map = new Map<number, string>();
        for (const row of rows) {
          const number = slideNumberOf(row);
          if (number !== null && !map.has(number)) map.set(number, row.id);
        }
        setBySlide(map);
      })
      .catch(() => {
        if (live) setBySlide(new Map());
      });
    return () => {
      live = false;
    };
  }, [cid, artifactId]);

  /** The slide and, when asked for, the ones before it, newest first. */
  const slideSelection = useMemo<QuestionSelection[]>(() => {
    if (!artifactId || !bySlide) return [];
    const first = includePrevious ? Math.max(index - (CONTEXT_SLIDES - 1), 0) : index;
    const out: QuestionSelection[] = [];
    for (let at = index; at >= first; at -= 1) {
      const objectId = bySlide.get(at + 1);
      if (objectId) out.push({ artifact_id: artifactId, object_id: objectId });
    }
    return out;
  }, [artifactId, bySlide, index, includePrevious]);

  const ask = useCallback(async () => {
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      // The search is local and free, and a course whose index is not built
      // yet simply contributes nothing rather than failing the question.
      const found = await api.searchCourse(cid, text, MAX_SELECTIONS).catch(() => null);

      const selections = [...slideSelection];
      const seen = new Set(selections.map((s) => `${s.artifact_id}:${s.object_id}`));
      for (const row of found?.results ?? []) {
        if (selections.length >= MAX_SELECTIONS) break;
        const key = `${row.artifact_id}:${row.object_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        selections.push({ artifact_id: row.artifact_id, object_id: row.object_id });
      }

      if (selections.length === 0) {
        setError(
          "Nothing in this course is close enough to that question to answer from. A question needs at least one source.",
        );
        return;
      }
      setAnswer(await api.askQuestion(cid, text, selections));
    } catch (err) {
      setError(describe(err));
      onFailure(err);
    } finally {
      setAsking(false);
    }
  }, [asking, cid, onFailure, question, slideSelection]);

  const slides = slideSelection.length;

  return (
    // `mt-8`, which is what `SlideFooter` puts between its own sections. It was
    // `mt-12` and a critic measured the extra step: the ink gap above this
    // label was 55 points where every sibling block's was 39.
    <section aria-labelledby={`${questionId}-label`} className="mt-8">
      <div className="mb-2">
        <PaneLabel>Ask about this slide</PaneLabel>
      </div>
      <p id={`${questionId}-label`} className="font-ui text-meta text-ink-faint">
        Answered from this course only. Evidence is chosen on this machine and nothing outside the
        course is read.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <Label htmlFor={questionId}>Your question</Label>
        <Textarea
          id={questionId}
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What is this slide assuming, and why does it matter?"
        />
      </div>

      {/* The scope line sits UNDER THE CONTROL IT DESCRIBES, not beside the
        *  submit button. It was hung off the right of the Ask button, where a
        *  critic found it doing three wrong things at once: repeating the
        *  paragraph above it, wrapping to two ragged lines in the faintest ink
        *  on the screen, and stating a retrieval count the reader cannot act
        *  on from there. What it is for is telling the reader what the
        *  checkbox just changed, so it is the checkbox's own feedback. */}
      <div className="mt-3 flex items-start gap-2">
        <Checkbox
          id={scopeId}
          checked={includePrevious}
          onCheckedChange={(value) => setIncludePrevious(value === true)}
          className="mt-0.5"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={scopeId} className="font-normal text-ink-muted">
            Include the slides before this one
          </Label>
          <p className="font-ui text-meta text-ink-faint">{scopeNote(slides, includePrevious)}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={asking || question.trim().length === 0}
          onClick={() => void ask()}
        >
          {asking ? <Spinner size="sm" label="" /> : <Sparkles size={16} strokeWidth={1.75} aria-hidden />}
          Ask
        </Button>
        {disconnected ? (
          <>
            <p className="font-ui text-meta text-ink-muted">
              Not connected, so this stays an offline answer.
            </p>
            <Button type="button" variant="secondary" size="md" onClick={onConnect}>
              Connect
            </Button>
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-4 font-ui text-meta text-bad">
          {error}
        </p>
      ) : null}

      <section aria-live="polite" className="flex flex-col gap-3">
        {answer ? (
          <>
            {/* THE ANSWER IS LABELLED, because without one it was the
              *  explanation continued. A critic measured them: same serif, same
              *  22-point step, same `--ink`, same 35-point leading, same left
              *  edge, and 11 points of clearance above it. A reader scrolling
              *  into it saw more of the reading column rather than the answer
              *  to their own question, and every other block in this pane
              *  announces itself with an uppercase label. */}
            <div className="mt-8 mb-1">
              <PaneLabel>Answer</PaneLabel>
            </div>
            <Prose>{answer.answer}</Prose>
            {answer.uncertainty ? (
              <p className="font-ui text-meta text-ink-muted">{answer.uncertainty}</p>
            ) : null}
            {answer.citations.length > 0 ? (
              <ol className="flex flex-col gap-2">
                {answer.citations.map((citation) => (
                  <li
                    key={`${citation.number}:${citation.object_id}`}
                    className="flex gap-2 font-ui text-meta text-ink-muted"
                  >
                    <span className="tabular-nums text-ink-faint">{citation.number}.</span>
                    <span className="min-w-0">
                      <a
                        href={hash.source(cid, citation.artifact_id, citation.object_id)}
                        className="text-accent-ink transition-colors duration-[120ms] ease-[var(--ease)] hover:underline"
                      >
                        {citation.label}
                      </a>
                      {citation.quote ? <span>: {citation.quote}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            <p className="font-ui text-meta text-ink-faint">
              {answer.remote_disclosure.sent_remote
                ? `Sent to DeepSeek: ${answer.remote_disclosure.sent.join(", ")}. Not sent: ${answer.remote_disclosure.not_sent.join(", ")}.`
                : "This answer was produced on this machine. Nothing was sent to DeepSeek."}
            </p>
          </>
        ) : null}
      </section>
    </section>
  );
}

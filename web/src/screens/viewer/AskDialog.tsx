import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import * as api from "@/lib/api";
import { hash } from "@/lib/router";
import type { CourseSearchResult, QuestionAnswer, QuestionSelection } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Prose } from "@/components/reading/Prose";

/** Must match MAX_SELECTIONS in app/questions.py. */
const MAX_SELECTIONS = 12;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A grounded question about a passage the reader selected.
 *
 * The evidence is found by this course's own local index first, with no model
 * call, and exactly what was found is shown before the question is asked. Those
 * objects are the selections the question is answered from, so the reader can
 * see the bounds of the answer before spending anything.
 *
 * The answer is rendered with its citations, the uncertainty the backend
 * reports, and the backend's disclosure of what left the machine. The
 * disclosure is never folded away and never summarised: it is the response's
 * own words about what was sent and what was not.
 */
export function AskDialog({
  open,
  onOpenChange,
  cid,
  passage,
  disconnected,
  onConnect,
  onFailure,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cid: string;
  passage: string;
  disconnected: boolean;
  onConnect: () => void;
  onFailure: (err: unknown) => void;
}) {
  const [question, setQuestion] = useState("");
  const [evidence, setEvidence] = useState<CourseSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<QuestionAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !passage) return;
    setQuestion(`What does “${passage}” mean here?`);
    setAnswer(null);
    setAskError(null);
    setEvidence(null);
    setSearchError(null);
    let live = true;
    setSearching(true);
    api
      .searchCourse(cid, passage, MAX_SELECTIONS)
      .then((result) => {
        if (live) setEvidence(result);
      })
      .catch((err: unknown) => {
        if (live) setSearchError(describe(err));
      })
      .finally(() => {
        if (live) setSearching(false);
      });
    return () => {
      live = false;
    };
  }, [open, passage, cid]);

  const results = evidence?.results ?? [];

  const selections = useMemo(() => {
    const seen = new Set<string>();
    const out: QuestionSelection[] = [];
    for (const row of results) {
      const key = `${row.artifact_id}:${row.object_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ artifact_id: row.artifact_id, object_id: row.object_id });
      if (out.length >= MAX_SELECTIONS) break;
    }
    return out;
  }, [results]);

  const indexNote = evidence
    ? evidence.index.ready
      ? evidence.index.stale
        ? `This course's local index is stale, so the evidence below may be out of date. ${evidence.index.reasons.join(" ")}`.trim()
        : null
      : "This course's local index is not built yet, so no evidence can be found."
    : null;

  const ask = async () => {
    const text = question.trim();
    if (!text || selections.length === 0) return;
    setAsking(true);
    setAskError(null);
    try {
      setAnswer(await api.askQuestion(cid, text, selections));
    } catch (err) {
      setAskError(describe(err));
      onFailure(err);
    } finally {
      setAsking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask about this slide</DialogTitle>
          <DialogDescription>
            The question is answered from this course only. Evidence is found locally, and nothing
            outside this course is read.
          </DialogDescription>
        </DialogHeader>

        <p className="font-reading text-body leading-[1.5] text-ink-muted">“{passage}”</p>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ask-question">Question</Label>
          <Textarea
            id="ask-question"
            rows={3}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What does this passage mean?"
          />
        </div>

        <section aria-live="polite" className="flex flex-col gap-2">
          <p className="font-ui text-meta font-medium tracking-[0.06em] text-ink-muted uppercase">
            Evidence this will use
          </p>
          {searching ? (
            <p className="flex items-center gap-2 font-ui text-ui text-ink-muted">
              <Spinner size="sm" label="" />
              Searching this course
            </p>
          ) : null}
          {searchError ? <p className="font-ui text-meta text-bad">{searchError}</p> : null}
          {evidence && selections.length === 0 ? (
            <p className="font-ui text-ui text-ink-muted">
              Nothing in this course is close enough to that passage to answer from. A question
              needs at least one source.
            </p>
          ) : null}
          {selections.length > 0 ? (
            <ul className="flex max-h-[28vh] flex-col gap-2 overflow-y-auto">
              {results.slice(0, MAX_SELECTIONS).map((row) => (
                <li key={`${row.artifact_id}:${row.object_id}`} className="font-ui text-meta">
                  <span className="text-ink">{row.artifact_filename}</span>
                  <span className="text-ink-faint"> · {row.location}</span>
                  <span className="text-ink-muted"> {row.snippet.slice(0, 160)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {indexNote ? <p className="font-ui text-meta text-ink-faint">{indexNote}</p> : null}
        </section>

        <p className="font-ui text-meta text-ink-muted">
          When connected, the question and the excerpts above go to DeepSeek. Original files,
          unselected material and other courses are not sent.
        </p>

        {disconnected ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-ui text-meta text-ink-muted">
              Not connected, so this stays an offline answer.
            </p>
            <Button type="button" variant="secondary" size="md" onClick={onConnect}>
              Connect
            </Button>
          </div>
        ) : null}

        {askError ? (
          <p role="alert" className="font-ui text-meta text-bad">
            {askError}
          </p>
        ) : null}

        {answer ? (
          <section className="flex flex-col gap-3">
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
          </section>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={asking || !question.trim() || selections.length === 0}
            onClick={() => void ask()}
          >
            {asking ? <Spinner size="sm" label="" /> : <Sparkles size={16} strokeWidth={1.75} aria-hidden />}
            Ask
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

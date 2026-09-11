/**
 * The grounded question.
 *
 * A question is asked on the objects the reader selected, and the answer is
 * shown with the citations the backend returned, the uncertainty it reported,
 * and whether anything left this machine. When the question did go to a remote
 * model, the notice names what was sent and what was not, so the disclosure is
 * a fact about this answer rather than a general promise.
 */

import { useState } from "react";
import { Send } from "lucide-react";

import { Prose } from "@/components/reading/Prose";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { hash } from "@/lib/router";
import type { LearningObject, QuestionAnswer } from "@/lib/types";
import { useErrorHandler } from "@/state/store";

import { Note, plural, locatorText } from "./parts";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AskPanel({ cid, selection }: { cid: string; selection: LearningObject[] }) {
  const handle = useErrorHandler();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<QuestionAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  async function ask() {
    setError("");
    const text = question.trim();
    if (!text) {
      setError("Write a question first.");
      return;
    }
    if (!selection.length) {
      setError("Select at least one source in the viewer first.");
      return;
    }
    setAsking(true);
    try {
      const result = await api.askQuestion(
        cid,
        text,
        selection.map((object) => ({ artifact_id: object.artifact_id, object_id: object.id })),
      );
      setAnswer(result);
    } catch (err) {
      setAnswer(null);
      setError(message(err));
      if (err instanceof ApiError && err.status === 428) handle(err);
      else console.error(err);
    } finally {
      setAsking(false);
    }
  }

  const SHOWN = 6;
  const summary = selection.length
    ? `${plural(selection.length, "source", "sources")} selected: ${selection
        .slice(0, SHOWN)
        .map(locatorText)
        .join("; ")}${selection.length > SHOWN ? `, and ${selection.length - SHOWN} more` : ""}`
    : "Nothing selected.";

  return (
    <div className="min-w-0">
      <h2 className="font-ui text-ui font-semibold text-ink">Ask about selected context</h2>
      <p className="mt-2 text-meta text-ink-muted">
        Select source blocks, cells, fields or notebook cells. When connected, only your question
        and those bounded excerpts are sent to DeepSeek. Original files, unselected material and
        other courses are not sent. Offline answers stay on this machine.
      </p>

      <p aria-live="polite" className="mt-3 text-ui text-ink-muted">
        {summary}
      </p>

      <div className="mt-3 min-w-0">
        <Label htmlFor="context-question">Question</Label>
        <Textarea
          id="context-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={4}
          placeholder="What does this selected evidence mean?"
          className="mt-1"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void ask()} disabled={asking}>
          <Send size={14} strokeWidth={1.75} aria-hidden />
          Ask selected context
        </Button>
        {asking ? <Spinner size="sm" /> : null}
      </div>

      {error ? (
        <Note tone="bad" className="mt-2">
          {error}
        </Note>
      ) : null}

      {answer ? (
        <div className="mt-4 min-w-0" aria-live="polite">
          <Prose className="max-w-[var(--measure)]">{answer.answer}</Prose>

          {answer.uncertainty ? (
            <Note className="mt-3">Uncertainty: {answer.uncertainty}</Note>
          ) : null}

          {answer.remote_disclosure.sent_remote ? (
            <Note tone="warn" className="mt-2">
              This question left this machine. Sent:{" "}
              {answer.remote_disclosure.sent.join("; ") || "nothing listed"}. Not sent:{" "}
              {answer.remote_disclosure.not_sent.join("; ") || "nothing listed"}.
            </Note>
          ) : (
            <Note className="mt-2">
              Answered locally. Nothing from this question was sent to a remote model.
            </Note>
          )}

          {answer.citations.length ? (
            <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
              {answer.citations.map((citation) => (
                <li key={`${citation.number}-${citation.object_id}`} className="text-ui">
                  <a
                    href={hash.source(cid, citation.artifact_id, citation.object_id)}
                    className="text-accent-ink underline-offset-2 transition-colors duration-[120ms] ease-[var(--ease)] hover:underline"
                  >
                    {citation.label}
                  </a>
                  <span className="text-ink">: {citation.quote}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Note className="mt-3">The answer cited no source.</Note>
          )}
        </div>
      ) : null}
    </div>
  );
}

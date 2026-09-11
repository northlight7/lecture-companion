/**
 * Notebook execution: the disclosure, the run, and the computed results.
 *
 * Three things this panel is careful about.
 *
 * The disclosure comes first. The real runtime, the exact package set and the
 * limits are on screen before the confirmation control, and the confirmation
 * restates them rather than asking a bare yes/no. Running notebook code on the
 * reader's machine is the largest consequence in this app.
 *
 * Computed results are never mixed with the notebook's saved output. They are
 * labelled "Computed", they carry the source-cell link and the provenance the
 * runner recorded, and they stay in this panel.
 *
 * A run whose source changed is stale. It says so, and it cannot be resumed:
 * its results no longer describe the file on disk.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Square } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { hash } from "@/lib/router";
import type {
  ExecutionCellResult,
  ExecutionEnvironment,
  ExecutionEnvironmentPayload,
  ExecutionRun,
  LearningObject,
} from "@/lib/types";
import { useErrorHandler } from "@/state/store";

import { CodeWell, DataTable, DefList, Fold, Note, StateLine, num, plural, str } from "./parts";

const ACTIVE_STATES: ExecutionRun["state"][] = ["queued", "running"];

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isActive(run: ExecutionRun | null): boolean {
  return run !== null && ACTIVE_STATES.includes(run.state);
}

function stateTone(state: string): "good" | "warn" | "bad" | undefined {
  if (state === "done") return "good";
  if (state === "error") return "bad";
  if (state === "paused" || state === "stale") return "warn";
  return undefined;
}

/** The disclosed limits, as one line. Mirrors the numbers the runner reports. */
export function limitLine(env: ExecutionEnvironment): string {
  const gigabyte = 1024 ** 3;
  return [
    `${env.cell_timeout_seconds}s per cell, ${env.maximum_cell_timeout_seconds}s maximum`,
    `${env.output_char_limit_per_stream.toLocaleString()} characters per stream`,
    `${Math.round(env.memory_limit_bytes / gigabyte)} GiB data segment`,
    `${Math.round(env.file_limit_bytes / (1024 * 1024))} MiB per file`,
  ].join(", ");
}

function packageLine(env: ExecutionEnvironment): string {
  const entries = Object.entries(env.packages ?? {});
  return entries.map(([name, version]) => `${name} ${version}`).join(", ");
}

/** The disclosure, inline and again inside the confirmation. */
export function EnvironmentFacts({ env }: { env: ExecutionEnvironment }) {
  return (
    <DefList
      items={[
        ["Runtime", `${env.implementation} ${env.python}`],
        ["Platform", env.platform],
        ["Packages", packageLine(env) || "none reported"],
        ["Network", env.network],
        ["Files", env.filesystem],
        ["Limits", limitLine(env)],
        ["Processes", env.process_limit],
        ["Sandbox", env.sandbox_backend],
        [
          "Model",
          env.remote_model_used
            ? "a remote model is used by this run"
            : "no remote model is called by this run",
        ],
      ]}
    />
  );
}

function ExecutionValueView({ result }: { result: ExecutionCellResult }) {
  const value = result.value;
  if (!value) return null;
  if (value.kind === "table") {
    const rows: string[][] = [value.columns, ...value.rows.map((row) => row.map(str))];
    return (
      <div className="mt-2 min-w-0">
        <div className="text-meta text-ink-faint">
          Computed value, {value.shape.join(" x ")}
          {value.truncated ? ", truncated" : ""}
        </div>
        <DataTable rows={rows} header className="mt-1" />
      </div>
    );
  }
  return (
    <div className="mt-2 min-w-0">
      <div className="text-meta text-ink-faint">
        Computed value{value.truncated ? ", truncated" : ""}
      </div>
      <CodeWell className="mt-1">{value.text}</CodeWell>
    </div>
  );
}

function ComputedCell({
  cid,
  aid,
  run,
  result,
}: {
  cid: string;
  aid: string;
  run: ExecutionRun;
  result: ExecutionCellResult;
}) {
  const failed = result.state === "error";
  return (
    <article className="min-w-0 border-t border-hair pt-3" data-computed-cell={result.cell_index}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <StateLine tone={failed ? "bad" : "good"}>Computed</StateLine>
        <a
          href={hash.source(cid, aid, result.object_id)}
          className="text-ui text-accent-ink underline-offset-2 transition-colors duration-[120ms] ease-[var(--ease)] hover:underline"
        >
          Notebook cell {result.cell_index + 1}
        </a>
        <span className="text-meta text-ink-faint">{str(result.state)}</span>
        <span className="text-meta text-ink-faint">
          {result.duration_seconds} seconds, source version {run.artifact_version}
        </span>
      </div>
      <Note className="mt-1">{result.provenance}</Note>

      {result.warnings.map((warning, index) => (
        <div key={index} className="mt-2 min-w-0 text-meta">
          <span className="font-medium text-warn">{warning.category}</span>
          <span className="text-ink">: {warning.message}</span>
          <div className="text-ink-faint">
            {warning.diagnostic || "This warning came from the disclosed local runtime."}
          </div>
        </div>
      ))}

      {result.stdout ? (
        <div className="mt-2 min-w-0">
          <div className="text-meta text-ink-faint">Standard output</div>
          <CodeWell className="mt-1">{result.stdout}</CodeWell>
        </div>
      ) : null}
      {result.stderr ? (
        <div className="mt-2 min-w-0">
          <div className="text-meta text-ink-faint">Standard error</div>
          <CodeWell className="mt-1">{result.stderr}</CodeWell>
        </div>
      ) : null}

      <ExecutionValueView result={result} />

      {result.plots.length ? (
        <div className="mt-2 min-w-0">
          <div className="text-meta text-ink-faint">
            {plural(result.plots.length, "computed plot", "computed plots")}
          </div>
          <div className="mt-1 rounded-srf bg-sunken p-3">
            {result.plots.map((name) => (
              <img
                key={name}
                src={api.executionOutputUrl(cid, aid, run.run_id, name)}
                alt={`Computed plot from notebook cell ${result.cell_index + 1}`}
                loading="lazy"
                className="mx-auto block max-h-[30rem] max-w-full"
              />
            ))}
          </div>
        </div>
      ) : null}

      {result.error ? (
        <div className="mt-2 min-w-0">
          <Note tone="bad">
            {str(result.error_type)}: {result.error}
          </Note>
          <Note className="mt-1">
            {result.diagnostic || "Inspect the captured local trace before changing the cell."}
          </Note>
          {result.traceback ? (
            <Fold summary="Local traceback" className="mt-1">
              <CodeWell tone="bad">{result.traceback}</CodeWell>
            </Fold>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ExecutionPanel({
  cid,
  aid,
  selection,
}: {
  cid: string;
  aid: string;
  selection: LearningObject[];
}) {
  const handle = useErrorHandler();
  const [env, setEnv] = useState<ExecutionEnvironmentPayload | null>(null);
  const [run, setRun] = useState<ExecutionRun | null>(null);
  const [error, setError] = useState("");
  const [envError, setEnvError] = useState("");
  const [lost, setLost] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<"all" | "selected" | "resume" | null>(null);

  const timer = useRef<number | null>(null);
  const failures = useRef(0);
  const runRef = useRef<ExecutionRun | null>(null);
  const live = useRef(true);

  const apply = useCallback((next: ExecutionRun | null) => {
    runRef.current = next;
    setRun(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    clearTimer();
    failures.current = 0;
  }, [clearTimer]);

  const poll = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    try {
      const fresh = await api.getExecution(cid, aid, current.run_id);
      if (!live.current) return;
      failures.current = 0;
      setLost("");
      apply(fresh);
      if (isActive(fresh)) timer.current = window.setTimeout(() => void poll(), 250);
    } catch (err) {
      if (!live.current) return;
      failures.current += 1;
      console.error(err);
      if (failures.current < 3) {
        timer.current = window.setTimeout(() => void poll(), 400 * failures.current);
        return;
      }
      // Out of attempts. The run may well still be going on the server, so leave
      // the run itself alone and only say that we stopped hearing about it.
      stopPolling();
      setLost(`Lost contact with the server: ${message(err)}`);
    }
  }, [cid, aid, apply, stopPolling]);

  const schedule = useCallback(
    (delay: number) => {
      clearTimer();
      timer.current = window.setTimeout(() => void poll(), delay);
    },
    [clearTimer, poll],
  );

  useEffect(() => {
    live.current = true;
    stopPolling();
    apply(null);
    setEnv(null);
    setError("");
    setEnvError("");
    setLost("");
    setConfirmed(false);
    setBusy(false);
    setPending(null);
    let cancelled = false;
    void (async () => {
      try {
        const payload = await api.getExecutionEnvironment(cid, aid);
        if (cancelled || !live.current) return;
        setEnv(payload);
        const latest = payload.executions[0] ?? null;
        apply(latest);
        if (isActive(latest)) schedule(100);
      } catch (err) {
        if (cancelled || !live.current) return;
        setEnvError(message(err));
        if (err instanceof ApiError && err.status === 428) handle(err);
        else console.error(err);
      }
    })();
    return () => {
      cancelled = true;
      live.current = false;
      stopPolling();
    };
  }, [cid, aid, apply, stopPolling, schedule, handle]);

  const selectedCells = selection.filter(
    (object) =>
      object.object_type === "notebook_cell" && str(object.data.cell_type) === "code",
  );
  const indices = selectedCells
    .map((object) => num(object.locator.notebook_cell))
    .filter((index): index is number => index !== null);

  const begin = useCallback(
    async (kind: "all" | "selected") => {
      setError("");
      if (kind === "selected" && !indices.length) {
        setError("Select at least one code cell in the source pane.");
        return;
      }
      setBusy(true);
      try {
        const next = await api.startExecution(cid, aid, {
          confirmed: true,
          ...(kind === "selected" ? { cellIndices: indices } : {}),
        });
        stopPolling();
        apply(next);
        schedule(100);
      } catch (err) {
        setError(message(err));
        if (err instanceof ApiError && err.status === 428) handle(err);
      } finally {
        setBusy(false);
      }
    },
    [aid, apply, cid, handle, indices, schedule, stopPolling],
  );

  const resume = useCallback(async () => {
    const current = runRef.current;
    if (!current || current.stale) return;
    setError("");
    setBusy(true);
    try {
      const next = await api.resumeExecution(cid, aid, current.run_id, true);
      stopPolling();
      apply(next);
      schedule(100);
    } catch (err) {
      setError(message(err));
      if (err instanceof ApiError && err.status === 428) handle(err);
    } finally {
      setBusy(false);
    }
  }, [aid, apply, cid, handle, schedule, stopPolling]);

  const stop = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    setError("");
    setBusy(true);
    try {
      const next = await api.stopExecution(cid, aid, current.run_id);
      stopPolling();
      apply(next);
    } catch (err) {
      setError(message(err));
      if (err instanceof ApiError && err.status === 428) handle(err);
    } finally {
      setBusy(false);
    }
  }, [aid, apply, cid, handle, stopPolling]);

  /** Every run button passes through here: an unconfirmed run discloses first. */
  function request(kind: "all" | "selected" | "resume") {
    setError("");
    if (kind === "selected" && !indices.length) {
      setError("Select at least one code cell in the source pane.");
      return;
    }
    if (!confirmed) {
      setPending(kind);
      return;
    }
    if (kind === "resume") void resume();
    else void begin(kind);
  }

  function confirmPending() {
    setConfirmed(true);
    const kind = pending;
    setPending(null);
    if (kind === "resume") void resume();
    else if (kind) void begin(kind);
  }

  const stale = run?.stale === true;
  const active = isActive(run);
  const canStop = run?.state === "running";
  const canResume = !stale && (run?.state === "paused" || run?.state === "error");
  const stateLabel = lost
    ? "Lost contact"
    : run
      ? stale
        ? "Stale"
        : str(run.state)
      : envError
        ? "Unavailable"
        : "Not run";
  const tone = lost
    ? "warn"
    : run
      ? stale
        ? "warn"
        : stateTone(str(run.state))
      : envError
        ? "bad"
        : undefined;

  const disclosure =
    run?.disclosure ||
    "Runs locally without DeepSeek. Network is denied. Code reads copies of current-course files and writes only its execution workspace.";

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h2 className="font-ui text-ui font-semibold text-ink">Run notebook code</h2>
        <StateLine tone={busy ? "warn" : tone}>{stateLabel}</StateLine>
      </div>
      <p className="text-meta text-ink-muted">Computed locally</p>

      <p className="mt-2 text-ui text-ink-muted">{disclosure}</p>

      {env ? (
        <div className="mt-3">
          <EnvironmentFacts env={env.environment} />
        </div>
      ) : envError ? (
        <Note tone="bad" className="mt-2">
          The execution environment could not be read: {envError}
        </Note>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Spinner size="sm" label="" />
          <Note>Reading the local runtime, packages and limits.</Note>
        </div>
      )}

      <div className="mt-3 flex items-start gap-2">
        <Checkbox
          id="execution-confirm"
          checked={confirmed}
          onCheckedChange={(value) => setConfirmed(value === true)}
          className="mt-0.5"
        />
        <label
          htmlFor="execution-confirm"
          className="text-ui text-ink-muted"
          onClick={(event) => {
            // The box is the control, so clicking it is never forwarded here.
            // The text toggles it directly: a label click is not reliably
            // forwarded to a button control in the WKWebView.
            event.preventDefault();
            setConfirmed((current) => !current);
          }}
        >
          I understand this notebook code will run locally with the limits shown above.
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => request("all")}
          disabled={!env || busy || active}
        >
          <Play size={14} strokeWidth={1.75} aria-hidden />
          Run all code cells
        </Button>
        <Button
          variant="secondary"
          onClick={() => request("selected")}
          disabled={!env || busy || active}
        >
          <Play size={14} strokeWidth={1.75} aria-hidden />
          Run selected code cells
        </Button>
        {canStop ? (
          <Button variant="secondary" onClick={() => void stop()} disabled={busy}>
            <Square size={14} strokeWidth={1.75} aria-hidden />
            Stop
          </Button>
        ) : null}
        {canResume ? (
          <Button variant="secondary" onClick={() => request("resume")} disabled={busy}>
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
            Resume
          </Button>
        ) : null}
      </div>

      <Note className="mt-2">
        {plural(selectedCells.length, "selected code cell", "selected code cells")} in the source
        pane. Run selected code cells runs exactly those, in notebook order.
      </Note>

      {error ? (
        <Note tone="bad" className="mt-2">
          {error}
        </Note>
      ) : null}
      {lost ? (
        <Note tone="warn" className="mt-2">
          {lost} The run itself was left alone and may still be going.
        </Note>
      ) : null}

      {stale ? (
        <Note tone="warn" className="mt-3">
          The notebook source changed since this run. These results are not current and the run
          cannot be resumed. Start a new run to check the current source.
        </Note>
      ) : null}

      <div className="mt-3 min-w-0">
        {run ? (
          <>
            <Note>
              {plural(run.completed_cells.length, "code cell", "code cells")} of{" "}
              {plural(run.selected_cells.length, "selected code cell", "selected code cells")}{" "}
              completed. Source version {run.artifact_version}.
              {run.linked_files.length
                ? ` ${plural(run.linked_files.length, "linked course file", "linked course files")} copied into the run workspace.`
                : ""}
            </Note>
            {run.pause_reason ? (
              <Note tone={run.state === "error" ? "bad" : undefined} className="mt-1">
                {run.pause_reason}
              </Note>
            ) : null}
            <div className="mt-3 flex flex-col gap-3">
              {run.results.map((result) => (
                <ComputedCell key={result.cell_index} cid={cid} aid={aid} run={run} result={result} />
              ))}
            </div>
            {!run.results.length ? (
              <Note className="mt-2">
                No cell has completed yet. Computed results appear here and stay separate from the
                notebook's saved output.
              </Note>
            ) : null}
          </>
        ) : (
          <Note>
            Nothing has been run for this notebook. Computed results appear here and stay separate
            from the notebook's saved output.
          </Note>
        )}
      </div>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "resume" ? "Resume this run?" : "Run this notebook's code?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "selected"
                ? `Runs the ${plural(indices.length, "code cell", "code cells")} you selected in the source pane, in notebook order, on this machine.`
                : pending === "resume"
                  ? "Continues the paused run from its checkpoint, on this machine."
                  : "Runs every code cell in this notebook, in order, on this machine."}{" "}
              Nothing is sent to a remote model.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {env ? (
            <div className="min-w-0">
              <DefList
                items={[
                  ["Runtime", `${env.environment.implementation} ${env.environment.python}`],
                  ["Packages", packageLine(env.environment) || "none reported"],
                  ["Limits", limitLine(env.environment)],
                  ["Network", env.environment.network],
                  ["Writes", env.environment.filesystem],
                ]}
              />
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>
              {pending === "resume" ? "Resume on this machine" : "Run on this machine"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Workbook inspection: what the local evaluator checked, and what it could not.
 *
 * The one rule this panel exists to keep is the difference between the value
 * the source file cached and the value computed here from the source ranges.
 * They are always two labelled numbers, never merged, and a check that had to
 * read precedent formulas out of the cache is labelled "partial: cached
 * precedent" rather than "verified", because it is only as current as the file.
 *
 * A stale audit is never shown as current. If the workbook source changed, the
 * prior checks are withheld and the panel says so.
 */

import { useEffect, useRef, useState } from "react";
import { ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { hash } from "@/lib/router";
import type {
  CellValue,
  FormulaExperiment,
  LearningObject,
  WorkbookAudit,
  WorkbookEvidence,
  WorkbookFormattingFinding,
  WorkbookFormulaFinding,
  WorkbookVerificationState,
} from "@/lib/types";
import { useErrorHandler } from "@/state/store";

import { CodeWell, DefList, Fold, Note, StateLine, plural, str, unitText } from "./parts";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function valueText(value: CellValue | null): string {
  if (value === null) return "no value";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function sampleText(sample: CellValue[]): string {
  return sample.length ? sample.map(valueText).join(", ") : "no non-blank values";
}

/**
 * The verification state, told truthfully. "verified" is reserved for a check
 * this evaluator performed itself; a check that read cached precedent formulas
 * says so, in the label and in the reason.
 */
export function verification(state: WorkbookVerificationState): {
  text: string;
  tone: "good" | "warn" | "bad";
  reason: string;
} {
  if (state === "verified") {
    return { text: "verified", tone: "good", reason: "" };
  }
  if (state === "verified_using_cached_precedents") {
    return {
      text: "partial: cached precedent",
      tone: "warn",
      reason:
        "The ranges this formula reads include cells whose values are themselves cached formula results, so this check is only as current as the stored cache. It is not counted as independently verified.",
    };
  }
  if (state === "unsupported") {
    return {
      text: "unsupported",
      tone: "warn",
      reason: "This formula uses a function or a shape the local evaluator does not implement.",
    };
  }
  return { text: "error", tone: "bad", reason: "The local evaluator raised an error." };
}

function EvidenceItem({
  cid,
  aid,
  evidence,
}: {
  cid: string;
  aid: string;
  evidence: WorkbookEvidence;
}) {
  if ("matching_rows" in evidence) {
    return (
      <li className="text-ui text-ink-muted">
        {plural(evidence.matching_rows, "matching row", "matching rows")} for criteria{" "}
        {evidence.criteria.map(valueText).join(", ") || "none"}
      </li>
    );
  }
  if ("error" in evidence) {
    return (
      <li className="text-ui text-warn">
        <span className="font-code">{evidence.reference}</span>: {evidence.error}
      </li>
    );
  }
  const label = `${evidence.locator.sheet || "sheet"}${
    evidence.locator.cell_range ? `!${evidence.locator.cell_range}` : ""
  }${evidence.locator.chart ? `, chart ${evidence.locator.chart}` : ""}`;
  return (
    <li className="text-ui text-ink-muted">
      {evidence.object_id ? (
        <a
          href={hash.source(cid, aid, evidence.object_id)}
          className="font-code text-accent-ink underline-offset-2 hover:underline"
        >
          {label}
        </a>
      ) : (
        <span className="font-code">{label}</span>
      )}
      : {plural(evidence.nonblank_count, "non-blank cell", "non-blank cells")} of{" "}
      {plural(evidence.cell_count, "cell", "cells")}. Sample {sampleText(evidence.sample)}.
    </li>
  );
}

function FormulaFinding({
  cid,
  aid,
  finding,
}: {
  cid: string;
  aid: string;
  finding: WorkbookFormulaFinding;
}) {
  const state = verification(finding.verification_state);
  const mismatch = finding.verification_state === "verified" && finding.matches_cached === false;
  const where = `${finding.locator.sheet || "sheet"}!${finding.locator.cell_range || "cell"}`;
  const unit = unitText(finding.unit);
  const items: Array<[string, string]> = [
    ["Cached source value", valueText(finding.cached_value)],
    ["Local check value", valueText(finding.calculated_value)],
    [
      "Calculation basis",
      `${finding.calculation_basis}${
        finding.difference !== null ? `. Difference ${finding.difference}.` : ""
      }`,
    ],
    ["Unit", unit ? `${unit}. ${finding.unit_basis}` : "not identified"],
  ];
  return (
    <article className="min-w-0 border-t border-hair py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {finding.object_id ? (
          <a
            href={hash.source(cid, aid, finding.object_id)}
            className="font-code text-meta text-accent-ink underline-offset-2 hover:underline"
          >
            {where}
          </a>
        ) : (
          <span className="font-code text-meta text-ink-muted">{where}</span>
        )}
        <StateLine tone={mismatch ? "bad" : state.tone}>
          {mismatch ? "mismatch" : state.text}
        </StateLine>
      </div>

      <CodeWell className="mt-2">{finding.formula || "no formula text"}</CodeWell>

      <DefList items={items} className="mt-2" />

      {state.reason ? (
        <Note tone="warn" className="mt-2">
          {state.reason}
        </Note>
      ) : null}
      {finding.error ? (
        <Note tone="bad" className="mt-2">
          {finding.error}
        </Note>
      ) : null}
      <Note className="mt-1">{finding.provenance}</Note>

      {finding.intermediate.length ? (
        <Fold summary="Exact precedents read" className="mt-1">
          <ul className="flex flex-col gap-1 pl-4">
            {finding.intermediate.map((evidence, index) => (
              <EvidenceItem key={index} cid={cid} aid={aid} evidence={evidence} />
            ))}
          </ul>
        </Fold>
      ) : null}
    </article>
  );
}

function FormattingFinding({ finding }: { finding: WorkbookFormattingFinding }) {
  const where = `${finding.locator.sheet || "sheet"}${
    finding.locator.cell_range ? `!${finding.locator.cell_range}` : ""
  }${finding.locator.chart ? `, chart ${finding.locator.chart}` : ""}`;
  const lead = <span className="font-code">{where}</span>;

  if (finding.kind === "conditional_formatting") {
    return (
      <li className="text-ui text-ink-muted">
        {lead}: priority {finding.priority}, {finding.rule_type}
        {finding.stop_if_true ? ", stop if true" : ""}
        {finding.formula.length ? `, formula ${finding.formula.map(valueText).join(", ")}` : ""}.{" "}
        {finding.provenance}.
      </li>
    );
  }
  if (finding.kind === "auto_filter") {
    return (
      <li className="text-ui text-ink-muted">
        {lead}: {plural(finding.columns.length, "filter column", "filter columns")},{" "}
        {plural(finding.sort.length, "sort condition", "sort conditions")}
        {finding.sort.length
          ? ` (${finding.sort
              .map((item) => `${item.range} ${item.descending ? "descending" : "ascending"}`)
              .join(", ")})`
          : ""}
        .
      </li>
    );
  }
  return (
    <li className="text-ui text-ink-muted">
      {lead}: sheet state {finding.sheet_state}, hidden rows{" "}
      {finding.hidden_rows.join(", ") || "none"}, hidden columns{" "}
      {finding.hidden_columns.join(", ") || "none"}.
    </li>
  );
}

export function WorkbookPanel({
  cid,
  aid,
  sheet,
  sheets,
  selection,
}: {
  cid: string;
  aid: string;
  sheet: string;
  sheets: string[];
  selection: LearningObject[];
}) {
  const handle = useErrorHandler();
  const [audit, setAudit] = useState<WorkbookAudit | null>(null);
  const [label, setLabel] = useState("Not inspected");
  const [stale, setStale] = useState(false);
  const [exists, setExists] = useState(false);
  const [previous, setPrevious] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [expSheet, setExpSheet] = useState("");
  const [expCell, setExpCell] = useState("");
  const [expFormula, setExpFormula] = useState("");
  const [experiment, setExperiment] = useState<FormulaExperiment | null>(null);
  const [experimentError, setExperimentError] = useState("");
  const [experimenting, setExperimenting] = useState(false);

  const prefill = useRef("");

  useEffect(() => {
    let cancelled = false;
    setAudit(null);
    setError("");
    setExperiment(null);
    setExperimentError("");
    setStale(false);
    setExists(false);
    setPrevious("");
    setLabel("Not inspected");
    setLoading(true);
    void (async () => {
      try {
        const status = await api.getWorkbookStatus(cid, aid);
        if (cancelled) return;
        setExists(status.exists);
        setStale(status.stale);
        setPrevious(status.previous_artifact_id ?? "");
        if (status.exists && !status.stale) {
          const cached = await api.inspectWorkbook(cid, aid, false);
          if (cancelled) return;
          setAudit(cached);
          setLabel(cached.cache_hit ? "Current" : "Inspected");
        } else {
          setLabel(status.stale ? "Stale" : "Not inspected");
        }
      } catch (err) {
        if (cancelled) return;
        setLabel("Unavailable");
        setError(message(err));
        if (err instanceof ApiError && err.status === 428) handle(err);
        else console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, aid, handle]);

  // Selecting a cell in the grid is the reader saying "check this one".
  useEffect(() => {
    const cell = selection.find((object) => object.object_type === "cell");
    if (!cell || prefill.current === cell.id) return;
    prefill.current = cell.id;
    setExpSheet(str(cell.locator.sheet));
    setExpCell(str(cell.locator.cell_range));
    if (cell.data.formula) setExpFormula(str(cell.data.formula));
  }, [selection]);

  useEffect(() => {
    setExpSheet((current) => current || sheet || sheets[0] || "");
  }, [sheet, sheets]);

  async function inspect() {
    setError("");
    setBusy(true);
    setLabel("Inspecting");
    try {
      const next = await api.inspectWorkbook(cid, aid, false);
      setAudit(next);
      setStale(false);
      setExists(true);
      setLabel(next.cache_hit ? "Current" : "Inspected");
    } catch (err) {
      setLabel("Error");
      setAudit(null);
      setError(message(err));
      if (err instanceof ApiError && err.status === 428) handle(err);
      else console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function runExperiment() {
    setExperiment(null);
    setExperimentError("");
    setExperimenting(true);
    try {
      const next = await api.runFormulaExperiment(cid, aid, {
        sheet: expSheet.trim(),
        cell: expCell.trim(),
        formula: expFormula.trim(),
      });
      setExperiment(next);
    } catch (err) {
      setExperimentError(message(err));
      if (err instanceof ApiError && err.status === 428) handle(err);
      else console.error(err);
    } finally {
      setExperimenting(false);
    }
  }

  const findings = audit
    ? [...audit.formulas].sort(
        (a, b) =>
          Number(a.matches_cached !== false) - Number(b.matches_cached !== false) ||
          Number(a.verification_state === "verified") -
            Number(b.verification_state === "verified"),
      )
    : [];
  const shown = findings.slice(0, 12);
  const experimentState = experiment ? verification(experiment.verification_state) : null;
  const experimentItems: Array<[string, string]> = experiment
    ? [
        [
          "Computed on copy",
          `${valueText(experiment.calculated_value)}${
            unitText(experiment.unit) ? ` ${unitText(experiment.unit)}` : ""
          }`,
        ],
        ["Basis", experiment.calculation_basis],
        [
          "Original bytes",
          experiment.source_bytes_preserved ? "unchanged" : "changed by this experiment",
        ],
      ]
    : [];

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h2 className="font-ui text-ui font-semibold text-ink">Inspect workbook</h2>
        <StateLine
          tone={
            busy || loading
              ? "warn"
              : label === "Current" || label === "Inspected"
                ? "good"
                : label === "Error" || label === "Unavailable"
                  ? "bad"
                  : undefined
          }
        >
          {busy ? "Inspecting" : label}
        </StateLine>
      </div>
      <p className="text-meta text-ink-muted">Measured locally</p>

      <p className="mt-2 text-ui text-ink-muted">
        Checks the formulas the local evaluator supports against the values this file cached,
        resolves the exact source ranges each one reads, diagnoses chart inputs, and preserves
        filters, formatting and hidden state. No model is called and no source file is written.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void inspect()} disabled={busy || loading}>
          <ClipboardCheck size={14} strokeWidth={1.75} aria-hidden />
          Inspect formulas and charts
        </Button>
        {loading ? <Spinner size="sm" /> : null}
      </div>

      {error ? (
        <Note tone="bad" className="mt-2">
          {error}
        </Note>
      ) : null}

      {stale ? (
        <Note tone="warn" className="mt-3">
          The workbook source changed. Prior checks are stale and are not shown. Inspect this
          version before relying on any result here.
        </Note>
      ) : null}

      {!loading && !error && !exists ? (
        <Note className="mt-3">
          No independent formula or chart check has been run for this source version. Nothing
          below is a stored result until you inspect.
        </Note>
      ) : null}

      {audit ? (
        <div className="mt-3 min-w-0">
          <Note>
            <strong className="font-medium text-ink">
              {audit.summary.formulas_independently_verified} of {audit.summary.formula_count}
            </strong>{" "}
            formulas independently verified. {audit.summary.cached_mismatches} cached mismatches.{" "}
            {plural(audit.summary.charts, "chart", "charts")} inspected,{" "}
            {audit.summary.formatting_filter_findings} formatting or filter findings,{" "}
            {audit.summary.formulas_inspected} of {audit.summary.formula_count} formulas inspected
            across {plural(audit.summary.sheets, "sheet", "sheets")}.
          </Note>
          <Note className="mt-1">
            {audit.cache_hit
              ? "Read from the stored audit for this exact source hash."
              : "Computed now from this version of the source."}{" "}
            {audit.source_bytes_preserved
              ? "The original bytes are unchanged before and after inspection."
              : "The original bytes changed during inspection."}
            {audit.remote_model_used ? " A remote model was used." : " No remote model was used."}
          </Note>

          <Fold
            summary={`Formula checks (${shown.length} of ${findings.length})`}
            className="mt-3"
            open
          >
            {shown.length ? (
              <div className="min-w-0">
                {shown.map((finding, index) => (
                  <FormulaFinding
                    key={`${finding.locator.sheet}-${finding.locator.cell_range}-${index}`}
                    cid={cid}
                    aid={aid}
                    finding={finding}
                  />
                ))}
              </div>
            ) : (
              <Note>No formula was found in this workbook.</Note>
            )}
          </Fold>

          <Fold summary={`Chart checks (${audit.charts.length})`} className="mt-3">
            {audit.charts.length ? (
              <div className="min-w-0">
                {audit.charts.map((chart, index) => (
                  <article key={index} className="min-w-0 border-t border-hair py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      {chart.object_id ? (
                        <a
                          href={hash.source(cid, aid, chart.object_id)}
                          className="text-ui text-accent-ink underline-offset-2 hover:underline"
                        >
                          {chart.title}
                        </a>
                      ) : (
                        <span className="text-ui text-ink">{chart.title}</span>
                      )}
                      <span className="text-meta text-ink-faint">{chart.chart_type}</span>
                    </div>
                    {chart.diagnostics.map((diagnostic, position) => (
                      <Note
                        key={position}
                        tone={diagnostic.severity === "info" ? undefined : "warn"}
                        className="mt-1"
                      >
                        {diagnostic.message}
                      </Note>
                    ))}
                    <Fold summary="Exact chart input ranges" className="mt-1">
                      <ul className="flex flex-col gap-1 pl-4">
                        {chart.series.map((series) => (
                          <li key={series.series} className="min-w-0">
                            <span className="text-meta text-ink-faint">
                              Series {series.series}
                              {Object.entries(series.references)
                                .map(([role, reference]) => ` ${role} = ${reference}`)
                                .join(",")}
                            </span>
                            <ul className="flex flex-col gap-1 pl-4">
                              {Object.entries(series.evidence).map(([role, evidence]) => (
                                <EvidenceItem
                                  key={`${series.series}-${role}`}
                                  cid={cid}
                                  aid={aid}
                                  evidence={evidence}
                                />
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </Fold>
                  </article>
                ))}
              </div>
            ) : (
              <Note>No chart was found in this workbook.</Note>
            )}
          </Fold>

          <Fold
            summary={`Filters, formatting and hidden structure (${audit.formatting_and_filters.length})`}
            className="mt-3"
          >
            {audit.formatting_and_filters.length ? (
              <ul className="flex flex-col gap-1 pl-4">
                {audit.formatting_and_filters.map((finding, index) => (
                  <FormattingFinding key={index} finding={finding} />
                ))}
              </ul>
            ) : (
              <Note>No stored filter, formatting or hidden-structure rule was found.</Note>
            )}
          </Fold>

          <Fold summary="Limits and uncertainty" className="mt-3">
            {audit.uncertainty.length ? (
              <ul className="flex flex-col gap-1 pl-4">
                {audit.uncertainty.map((item, index) => (
                  <li key={index} className="text-ui text-ink-muted">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <Note>The audit reported no uncertainty.</Note>
            )}
          </Fold>
        </div>
      ) : null}

      <Fold summary="Try a formula on a copy" className="mt-4">
        <Note>
          The proposed formula is evaluated from current source values in a course-scoped workbook
          copy. The original is never changed, and its bytes are checked before and after.
        </Note>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <Label htmlFor="experiment-sheet">Sheet</Label>
            <Input
              id="experiment-sheet"
              value={expSheet}
              onChange={(event) => setExpSheet(event.target.value)}
              autoComplete="off"
              className="mt-1"
            />
          </div>
          <div className="min-w-0">
            <Label htmlFor="experiment-cell">Cell</Label>
            <Input
              id="experiment-cell"
              value={expCell}
              onChange={(event) => setExpCell(event.target.value)}
              placeholder="C8"
              autoComplete="off"
              className="mt-1"
            />
          </div>
        </div>
        <div className="mt-3 min-w-0">
          <Label htmlFor="experiment-formula">Formula</Label>
          <Input
            id="experiment-formula"
            value={expFormula}
            onChange={(event) => setExpFormula(event.target.value)}
            placeholder="=SUM(A1:A3)"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 font-code"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void runExperiment()}
            disabled={experimenting || !expSheet.trim() || !expCell.trim() || !expFormula.trim()}
          >
            Calculate on copy
          </Button>
          {experimenting ? <Spinner size="sm" /> : null}
        </div>

        {experimentError ? (
          <Note tone="bad" className="mt-2">
            {experimentError}
          </Note>
        ) : null}

        {experiment && experimentState ? (
          <div className="mt-3 min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              {experiment.object_id ? (
                <a
                  href={hash.source(cid, aid, experiment.object_id)}
                  className="font-code text-meta text-accent-ink underline-offset-2 hover:underline"
                >
                  {experiment.sheet}!{experiment.cell}
                </a>
              ) : (
                <span className="font-code text-meta text-ink-muted">
                  {experiment.sheet}!{experiment.cell}
                </span>
              )}
              <StateLine tone={experimentState.tone}>{experimentState.text}</StateLine>
              <span className="text-meta text-ink-faint">
                {experiment.cache_hit ? "read from the audit cache" : "evaluated now"}
              </span>
            </div>
            <DefList items={experimentItems} className="mt-2" />
            {experimentState.reason ? (
              <Note tone="warn" className="mt-2">
                {experimentState.reason}
              </Note>
            ) : null}
            <Note className="mt-1">{experiment.provenance}</Note>
            {experiment.intermediate.length ? (
              <ul className="mt-2 flex flex-col gap-1 pl-4">
                {experiment.intermediate.map((evidence, index) => (
                  <EvidenceItem key={index} cid={cid} aid={aid} evidence={evidence} />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Fold>

      {previous ? (
        <Note className="mt-3">
          A previous version of this workbook was inspected separately, as {previous}. Those
          checks do not apply to this version.
        </Note>
      ) : null}
    </div>
  );
}

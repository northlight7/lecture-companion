/**
 * The pieces the six artifact viewers share.
 *
 * Two jobs live here. First, coercion: a `LearningObject.data` payload is an
 * untyped record, and every viewer needs the same defensive readers for it, so
 * they exist once. Second, the atoms the viewers are assembled from: the object
 * row, the locator link, the data table, the code well.
 *
 * The locator vocabulary is byte-compatible with the previous frontend's
 * `locatorText`, because those strings are how a reader cites a source and they
 * are already stored inside saved explanations.
 */

import { Fragment, type ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { hash } from "@/lib/router";
import type { LearningObject } from "@/lib/types";
import { cn } from "@/lib/utils";

// --------------------------------------------------------------------------
// untyped payload readers
// --------------------------------------------------------------------------

/** Matches the previous frontend's `esc`: null and undefined render as "". */
export function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function strings(value: unknown): string[] {
  return list(value).map((item) => str(item));
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Rows of text, for the table payloads. */
export function textRows(value: unknown): string[][] {
  return list(value).map((row) => strings(row));
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "not identified" is the workbook unit sentinel; it is not a unit. */
export function unitText(unit: unknown): string {
  const text = str(unit);
  return text === "not identified" ? "" : text;
}

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function isImageMime(type: string): boolean {
  return IMAGE_MIMES.includes(type);
}

export function hasImageMime(value: unknown): boolean {
  return strings(value).some(isImageMime);
}

export function objectLabel(objectType: string): string {
  return objectType ? objectType.replaceAll("_", " ") : "";
}

/**
 * The exact locator, in the previous frontend's order and vocabulary:
 * "slide 4, note 1", "sheet Budget, C8", "notebook cell 3, output 2".
 */
export function locatorText(obj: LearningObject | null | undefined): string {
  const loc = obj?.locator;
  const parts: string[] = [];
  if (loc?.page != null) parts.push(`page ${loc.page}`);
  if (loc?.slide != null) parts.push(`slide ${loc.slide}`);
  if (loc?.note != null) parts.push(`note ${loc.note}`);
  if (loc?.block != null) parts.push(`block ${Number(loc.block) + 1}`);
  if (loc?.sheet) parts.push(`sheet ${loc.sheet}`);
  if (loc?.cell_range) parts.push(loc.cell_range);
  if (loc?.chart) parts.push(`chart ${loc.chart}`);
  if (loc?.notebook_cell != null) parts.push(`notebook cell ${Number(loc.notebook_cell) + 1}`);
  if (loc?.output != null) parts.push(`output ${Number(loc.output) + 1}`);
  if (loc?.dataset_field) parts.push(`field ${loc.dataset_field}`);
  return parts.join(", ") || (obj ? objectLabel(obj.object_type) : "") || "source";
}

/** The locator of a source range the workbook or chart audit resolved. */
export function rangeText(sheet: unknown, cellRange: unknown, chart?: unknown): string {
  const parts = [str(sheet) || "sheet"];
  if (str(cellRange)) parts.push(str(cellRange));
  if (chart && str(chart)) parts.push(`chart ${str(chart)}`);
  return parts.join("!");
}

// --------------------------------------------------------------------------
// links
// --------------------------------------------------------------------------

/** Every locator is a deep link: it sets the hash to this exact object. */
export function LocatorLink({
  cid,
  aid,
  object,
  className,
  suffix,
}: {
  cid: string;
  aid: string;
  object: LearningObject;
  className?: string;
  suffix?: string;
}) {
  return (
    <a
      href={hash.source(cid, aid, object.id)}
      className={cn(
        "min-w-0 truncate text-accent-ink underline-offset-2 transition-colors duration-[120ms] ease-[var(--ease)] hover:underline",
        className,
      )}
    >
      {locatorText(object)}
      {suffix ? `, ${suffix}` : ""}
    </a>
  );
}

/** A source object referenced by another panel, without its LearningObject. */
export function SourceLink({
  cid,
  aid,
  objectId,
  children,
  className,
}: {
  cid: string;
  aid: string;
  objectId: string;
  children: ReactNode;
  className?: string;
}) {
  if (!objectId) return <span className={className}>{children}</span>;
  return (
    <a
      href={hash.source(cid, aid, objectId)}
      className={cn(
        "text-accent-ink underline-offset-2 transition-colors duration-[120ms] ease-[var(--ease)] hover:underline",
        className,
      )}
    >
      {children}
    </a>
  );
}

// --------------------------------------------------------------------------
// atoms
// --------------------------------------------------------------------------

/** The type label on an object row. Value, not outline: a chip per row would be noise. */
export function TypeLabel({ children }: { children: string }) {
  return (
    <span className="shrink-0 text-meta font-medium text-ink-faint uppercase">
      {objectLabel(children)}
    </span>
  );
}

/** One source object's row: the selection box, its type, and its locator link. */
export function ObjectHead({
  cid,
  aid,
  object,
  selected,
  onToggle,
  meta,
}: {
  cid: string;
  aid: string;
  object: LearningObject;
  selected: boolean;
  onToggle: (object: LearningObject, next: boolean) => void;
  meta?: ReactNode;
}) {
  return (
    <div className="flex h-[var(--row-h)] min-w-0 items-center gap-3">
      <Checkbox
        checked={selected}
        onCheckedChange={(value) => onToggle(object, value === true)}
        aria-label={`Select ${locatorText(object)}`}
      />
      <TypeLabel>{object.object_type}</TypeLabel>
      <LocatorLink cid={cid} aid={aid} object={object} className="text-meta" />
      {meta ? <span className="min-w-0 shrink-0 text-meta text-ink-faint">{meta}</span> : null}
    </div>
  );
}

/**
 * The wrapped shell of one source object. Flush: a separator line and space,
 * never a card, and the focused object takes the selection surface.
 */
export function ObjectBlock({
  object,
  focused,
  className,
  children,
}: {
  object: LearningObject;
  focused: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      id={`source-${object.id}`}
      data-oid={object.id}
      className={cn(
        "min-w-0 border-t border-hair py-4 first:border-t-0",
        focused && "rounded-srf bg-selected px-3",
        className,
      )}
    >
      {children}
    </article>
  );
}

/** A code or preformatted well. `--surface-sunken` is the well colour. */
export function CodeWell({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: "bad";
}) {
  return (
    <pre
      className={cn(
        "min-w-0 overflow-hidden rounded-srf bg-sunken p-3 font-code text-ui whitespace-pre-wrap break-words",
        tone === "bad" ? "text-bad" : "text-ink",
        className,
      )}
    >
      {children}
    </pre>
  );
}

/** Prose the reader sits with: serif, reading measure, never chrome. */
export function ReadingText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "max-w-[var(--measure)] font-reading text-body leading-[1.62] whitespace-pre-wrap break-words text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A table of extracted data. Full width: the measure is for prose only. */
export function DataTable({
  rows,
  header = false,
  className,
}: {
  rows: string[][];
  header?: boolean;
  className?: string;
}) {
  if (!rows.length) return null;
  return (
    <table className={cn("w-full border-collapse font-ui text-ui", className)}>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) =>
              header && rowIndex === 0 ? (
                <th
                  key={cellIndex}
                  scope="col"
                  className="border-b border-hair px-3 py-2 text-left font-semibold text-ink-muted"
                >
                  {cell}
                </th>
              ) : (
                <td
                  key={cellIndex}
                  className="border-b border-hair px-3 py-2 align-top break-words whitespace-pre-wrap text-ink"
                >
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DefList({
  items,
  className,
}: {
  items: Array<[string, string]>;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-ui",
        className,
      )}
    >
      {items.map(([term, value]) => (
        <Fragment key={term}>
          <dt className="text-ink-muted">{term}</dt>
          <dd className="min-w-0 break-words whitespace-pre-wrap text-ink">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** A disclosure. Native `<details>`, so the keyboard and the ring come free. */
export function Fold({
  summary,
  children,
  open = false,
  className,
}: {
  summary: string;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details open={open} className={cn("min-w-0", className)}>
      <summary className="inline-flex min-h-[var(--control-h)] cursor-default items-center text-meta font-medium text-ink-muted transition-colors duration-[120ms] ease-[var(--ease)] hover:text-ink">
        {summary}
      </summary>
      <div className="mt-2 min-w-0">{children}</div>
    </details>
  );
}

/** Metadata, never a headline: 12px on the muted ink. */
export function Note({
  children,
  tone,
  className,
}: {
  children: ReactNode;
  tone?: "good" | "warn" | "bad";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-meta",
        tone === "good"
          ? "text-good"
          : tone === "warn"
            ? "text-warn"
            : tone === "bad"
              ? "text-bad"
              : "text-ink-muted",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** The state of an execution or a workbook audit, as a chip-sized line. */
export function StateLine({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <span
      className={cn(
        "text-meta font-medium",
        tone === "good"
          ? "text-good"
          : tone === "warn"
            ? "text-warn"
            : tone === "bad"
              ? "text-bad"
              : "text-ink-muted",
      )}
    >
      {children}
    </span>
  );
}

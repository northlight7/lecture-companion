/**
 * The six artifact viewers.
 *
 * One route, six shapes: rendered pages and slides, document blocks, a
 * spreadsheet grid, a dataset, notebook cells. Everything specific to a format
 * lives here and nothing else does, so `ArtifactScreen` stays the frame and the
 * tools.
 *
 * The rules these viewers obey: no card around any of it, the reading measure
 * for prose and never for a table or a cell grid, `font-code` for formulas and
 * notebook source, and every object the same 34px row: a selection box, its
 * type, and a locator link that sets the hash to that exact object.
 */

import type { ReactNode } from "react";
import { FileWarning } from "lucide-react";

import { Prose } from "@/components/reading/Prose";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import * as api from "@/lib/api";
import type { Artifact, LearningObject } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  CodeWell,
  DataTable,
  DefList,
  Fold,
  LocatorLink,
  Note,
  ObjectBlock,
  ObjectHead,
  ReadingText,
  hasImageMime,
  list,
  locatorText,
  num,
  plural,
  record,
  str,
  strings,
  textRows,
} from "./parts";

export interface ViewerProps {
  cid: string;
  aid: string;
  artifact: Artifact;
  objects: LearningObject[];
  /** The object the route names, if any. It takes the selection surface. */
  focusOid: string;
  selectedIds: Set<string>;
  onToggle: (object: LearningObject, next: boolean) => void;
}

interface ObjectProps {
  cid: string;
  aid: string;
  object: LearningObject;
  focusOid: string;
  selectedIds: Set<string>;
  onToggle: (object: LearningObject, next: boolean) => void;
}

function Shell({
  cid,
  aid,
  object,
  focusOid,
  selectedIds,
  onToggle,
  meta,
  className,
  children,
}: ObjectProps & { meta?: string; className?: string; children?: ReactNode }) {
  return (
    <ObjectBlock object={object} focused={object.id === focusOid} className={className}>
      <ObjectHead
        cid={cid}
        aid={aid}
        object={object}
        selected={selectedIds.has(object.id)}
        onToggle={onToggle}
        meta={meta || undefined}
      />
      {children ? <div className="mt-2 min-w-0">{children}</div> : null}
    </ObjectBlock>
  );
}

function ObjectWarning({ object }: { object: LearningObject }) {
  const warnings = object.warnings ?? [];
  if (!warnings.length) return null;
  return <Note className="mt-2">{warnings.join(" ")}</Note>;
}

// --------------------------------------------------------------------------
// PDF and PPTX: a rendered page, and a slide with its speaker notes
// --------------------------------------------------------------------------

function RenderedObject(props: ObjectProps) {
  const { cid, aid, object } = props;
  const page = num(object.locator.page) ?? num(object.locator.slide);
  const label = object.object_type === "slide" ? "Rendered slide" : "Rendered page";
  return (
    <Shell {...props}>
      {page && page > 0 ? (
        <div className="rounded-srf bg-sunken p-3">
          <img
            src={api.artifactRenderUrl(cid, aid, page)}
            alt={`${label} ${locatorText(object)}`}
            loading="lazy"
            className="mx-auto block max-h-[calc(100dvh-26rem)] max-w-full"
          />
        </div>
      ) : (
        <Note>A rendered image is not available for this source.</Note>
      )}
      {object.text ? (
        <Fold summary="Extracted text" className="mt-2">
          <CodeWell>{object.text}</CodeWell>
        </Fold>
      ) : null}
      <ObjectWarning object={object} />
    </Shell>
  );
}

function SpeakerNote(props: ObjectProps) {
  const slide = num(props.object.locator.slide);
  return (
    <Shell {...props} meta={slide ? `speaker notes for slide ${slide}` : undefined}>
      <div className="border-l border-hair pl-4">
        <ReadingText>{props.object.text}</ReadingText>
      </div>
    </Shell>
  );
}

// --------------------------------------------------------------------------
// DOCX
// --------------------------------------------------------------------------

function DocumentBlock(props: ObjectProps) {
  const style = str(props.object.data.style);
  return (
    <Shell {...props} meta={style || undefined}>
      <ReadingText>{props.object.text}</ReadingText>
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

function DocumentTable(props: ObjectProps) {
  const rows = textRows(props.object.data.rows);
  const name = str(props.object.locator.fragment);
  return (
    <Shell
      {...props}
      meta={name ? `${name}, ${plural(rows.length, "row", "rows")}` : undefined}
    >
      {rows.length ? <DataTable rows={rows} /> : <ReadingText>{props.object.text}</ReadingText>}
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

function EmbeddedImage(props: ObjectProps) {
  const { cid, aid, object } = props;
  const bytes = num(object.data.byte_length);
  const part = str(object.data.part_name);
  return (
    <Shell {...props} meta={part || undefined}>
      <div className="rounded-srf bg-sunken p-3">
        <img
          src={api.artifactObjectMediaUrl(cid, aid, object.id)}
          alt={`Embedded image at ${locatorText(object)}`}
          loading="lazy"
          className="mx-auto block max-h-[34rem] max-w-full"
        />
      </div>
      <Note className="mt-2">
        {part || "Embedded document image"}
        {bytes !== null ? `. ${plural(bytes, "byte", "bytes")} preserved in the original.` : "."}
      </Note>
      <ObjectWarning object={object} />
    </Shell>
  );
}

// --------------------------------------------------------------------------
// XLSX
// --------------------------------------------------------------------------

function SheetObject(props: ObjectProps) {
  const data = props.object.data;
  const items: Array<[string, string]> = [
    ["Dimensions", str(data.dimensions) || str(props.object.locator.cell_range) || "unknown"],
    ["State", str(data.state) || "visible"],
    ["Freeze panes", str(data.freeze_panes) || "none"],
    ["Filter", str(data.auto_filter) || "none"],
    ["Tables", strings(data.tables).join(", ") || "none"],
    ["Merged ranges", strings(data.merged_ranges).join(", ") || "none"],
    ["Hidden rows", strings(data.hidden_rows).join(", ") || "none"],
    ["Hidden columns", strings(data.hidden_columns).join(", ") || "none"],
    ["Conditional formatting rules", str(data.conditional_formatting_rules ?? 0)],
    ["Validation ranges", strings(data.data_validations).join(", ") || "none"],
  ];
  return (
    <Shell
      {...props}
      meta={str(data.state) && str(data.state) !== "visible" ? `state ${str(data.state)}` : undefined}
    >
      <DefList items={items} />
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

/** "AA" -> 27, so cells sort by their real column and not by their spelling. */
function columnIndex(letters: string): number {
  let total = 0;
  for (const character of letters) total = total * 26 + (character.charCodeAt(0) - 64);
  return total;
}

function parseCell(reference: string): { row: number; column: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(reference.toUpperCase());
  if (!match) return null;
  const row = Number(match[2] ?? "");
  if (!Number.isFinite(row)) return null;
  return { row, column: columnIndex(match[1] ?? "") };
}

/**
 * The cell grid. Rows are spreadsheet rows in order, and each cell keeps its
 * own 34px row: selection box, exact locator, value, then the formula the file
 * stores and the value it cached for it.
 */
function CellGrid({
  cid,
  aid,
  cells,
  focusOid,
  selectedIds,
  onToggle,
}: {
  cid: string;
  aid: string;
  cells: LearningObject[];
  focusOid: string;
  selectedIds: Set<string>;
  onToggle: (object: LearningObject, next: boolean) => void;
}) {
  const rows = new Map<number, Array<{ object: LearningObject; column: number }>>();
  const unplaced: LearningObject[] = [];
  for (const object of cells) {
    const parsed = parseCell(str(object.locator.cell_range));
    if (!parsed) {
      unplaced.push(object);
      continue;
    }
    const bucket = rows.get(parsed.row);
    if (bucket) bucket.push({ object, column: parsed.column });
    else rows.set(parsed.row, [{ object, column: parsed.column }]);
  }
  const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="min-w-0">
      <table className="w-full border-collapse">
        <tbody>
          {ordered.map(([rowNumber, items]) => (
            <tr key={rowNumber}>
              <th
                scope="row"
                className="w-10 border-b border-hair px-2 py-2 text-right align-top font-ui text-meta font-normal text-ink-faint tabular-nums"
              >
                {rowNumber}
              </th>
              {[...items]
                .sort((a, b) => a.column - b.column)
                .map(({ object: cell }) => (
                  <td
                    key={cell.id}
                    data-oid={cell.id}
                    className={cn(
                      "min-w-0 border-b border-hair px-3 py-2 align-top",
                      cell.id === focusOid && "bg-selected",
                    )}
                  >
                    <div className="flex h-[var(--row-h)] min-w-0 items-center gap-3">
                      <Checkbox
                        checked={selectedIds.has(cell.id)}
                        onCheckedChange={(value) => onToggle(cell, value === true)}
                        aria-label={`Select ${locatorText(cell)}`}
                      />
                      <LocatorLink
                        cid={cid}
                        aid={aid}
                        object={cell}
                        className="font-code text-meta"
                      />
                    </div>
                    <div className="mt-1 break-words whitespace-pre-wrap text-ui text-ink tabular-nums">
                      {str(cell.text)}
                    </div>
                    {cell.data.formula ? (
                      <div className="mt-1 break-words font-code text-meta text-ink-muted">
                        Formula {str(cell.data.formula)} · Cached{" "}
                        {str(cell.data.cached_value) || "none"}
                      </div>
                    ) : null}
                  </td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>
      {unplaced.length ? (
        <div className="mt-3">
          {unplaced.map((object) => (
            <Shell
              key={object.id}
              cid={cid}
              aid={aid}
              object={object}
              focusOid={focusOid}
              selectedIds={selectedIds}
              onToggle={onToggle}
            >
              <CodeWell>{str(object.text)}</CodeWell>
            </Shell>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RangeObject(props: ObjectProps) {
  const names = list(props.object.data.defined_names).map((item) => record(item));
  const items: Array<[string, string]> = names.length
    ? names.map((item, index) => [str(item.name) || `Name ${index + 1}`, str(item.attr_text)])
    : [
        ["Table", str(props.object.data.name) || str(props.object.text)],
        ["Reference", str(props.object.data.ref) || str(props.object.locator.cell_range)],
        ["Style", str(props.object.data.style) || "none"],
      ];
  return (
    <Shell {...props}>
      <DefList items={items} />
      <Note className="mt-2">
        The cells inside this range appear in the grid above, each with its own locator.
      </Note>
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

function ChartObject(props: ObjectProps) {
  const series = list(props.object.data.series).map((item) => record(item));
  const anchor = str(props.object.data.anchor);
  return (
    <Shell
      {...props}
      meta={[str(props.object.data.type), anchor && `anchor ${anchor}`]
        .filter(Boolean)
        .join(", ")}
    >
      {series.length ? (
        <DefList
          items={series.map((item, index) => [
            `Series ${index + 1}`,
            Object.entries(item)
              .map(([role, reference]) => `${role} = ${str(reference)}`)
              .join(", ") || "no stored reference",
          ])}
        />
      ) : (
        <Note>No series references are stored for this chart.</Note>
      )}
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

function FormattingRuleObject(props: ObjectProps) {
  const data = props.object.data;
  const formula = strings(data.formula);
  const items: Array<[string, string]> = [
    ["Rule type", str(data.rule_type) || "unknown"],
    ["Operator", str(data.operator) || "none"],
    ["Formula", formula.join(", ") || "none"],
    ["Priority", str(data.priority ?? 0)],
    ["Stop if true", data.stop_if_true ? "yes" : "no"],
  ];
  return (
    <Shell {...props}>
      <DefList items={items} />
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

function FilterObject(props: ObjectProps) {
  const columns = list(props.object.data.columns).map((item) => record(item));
  const sort = list(props.object.data.sort).map((item) => record(item));
  const items: Array<[string, string]> = columns.map((column, index) => {
    const parts: string[] = [];
    if (Array.isArray(column.values)) parts.push(`values ${strings(column.values).join(", ")}`);
    if (Array.isArray(column.custom)) {
      parts.push(
        list(column.custom)
          .map((rule) => {
            const item = record(rule);
            return `${str(item.operator)} ${str(item.value)}`;
          })
          .join(" and "),
      );
    }
    const top10 = record(column.top10);
    if (Object.keys(top10).length) {
      parts.push(`${top10.top ? "top" : "bottom"} ${str(top10.value)}`);
    }
    return [
      `Column ${str(column.column_id) || index + 1}`,
      parts.join(", ") || "no stored rule",
    ];
  });
  for (const condition of sort) {
    items.push([
      "Sort",
      `${str(condition.range)} ${condition.descending ? "descending" : "ascending"}`,
    ]);
  }
  return (
    <Shell {...props} meta={plural(columns.length, "filter column", "filter columns")}>
      {items.length ? <DefList items={items} /> : <Note>No stored filter rule.</Note>}
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

function PackagePartObject(props: ObjectProps) {
  const bytes = num(props.object.data.byte_length);
  return (
    <Shell {...props}>
      <DefList
        items={[
          ["Part", str(props.object.data.path) || props.object.text],
          ["Bytes", bytes !== null ? String(bytes) : "unknown"],
          ["SHA-256", str(props.object.data.sha256) || "unknown"],
        ]}
      />
      <Note className="mt-2">
        Preserved inside the original package and byte-identical to it. Nothing in this viewer
        rewrites it.
      </Note>
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

// --------------------------------------------------------------------------
// CSV
// --------------------------------------------------------------------------

function DatasetObject(props: ObjectProps) {
  const fields = strings(props.object.data.fields);
  const sample = list(props.object.data.sample_rows).map((item) => record(item));
  const rows: string[][] = [
    fields,
    ...sample.map((row) => fields.map((field) => str(row[field]))),
  ];
  const rowCount = num(props.object.data.row_count) ?? 0;
  const columnCount = num(props.object.data.column_count) ?? fields.length;
  return (
    <Shell
      {...props}
      meta={`${plural(rowCount, "row", "rows")}, ${plural(columnCount, "column", "columns")}`}
    >
      <Note className="mb-2">
        Bounded local preview: the first {plural(sample.length, "row", "rows")} of {rowCount}.
        Encoding {str(props.object.data.encoding) || "unknown"}, delimiter{" "}
        {str(props.object.data.delimiter) || "unknown"}.
      </Note>
      {rows.length > 1 ? (
        <DataTable rows={rows} header />
      ) : (
        <Note>No sample rows were stored for this dataset.</Note>
      )}
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

function DatasetFieldObject(props: ObjectProps) {
  const samples = strings(props.object.data.samples);
  const rowCount = num(props.object.data.row_count);
  return (
    <Shell {...props} meta={str(props.object.data.inferred_type) || "unknown"}>
      <DefList
        items={[
          ["Inferred type", str(props.object.data.inferred_type) || "unknown"],
          [
            "Missing",
            `${str(props.object.data.missing_count ?? 0)} of ${
              rowCount !== null ? String(rowCount) : "unknown"
            }`,
          ],
          ["Unique values", str(props.object.data.unique_count ?? "unknown")],
          ["Samples", samples.join(", ") || "none"],
        ]}
      />
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

// --------------------------------------------------------------------------
// IPYNB
// --------------------------------------------------------------------------

function NotebookSource(props: ObjectProps) {
  const { object } = props;
  const cellType = str(object.data.cell_type) || "unknown";
  const executionCount = num(object.data.execution_count);
  const meta = [cellType, executionCount !== null && `execution count ${executionCount}`]
    .filter(Boolean)
    .join(", ");
  return (
    <Shell {...props} meta={meta}>
      {cellType === "markdown" ? (
        <Prose className="max-w-[var(--measure)]">{object.text}</Prose>
      ) : (
        <CodeWell>{object.text}</CodeWell>
      )}
    </Shell>
  );
}

function NotebookOutput(props: ObjectProps & { className?: string }) {
  const { cid, aid, object, className } = props;
  const image = hasImageMime(object.data.mime_types);
  const outputType = str(object.data.output_type);
  const evalue = str(object.data.evalue);
  const text = object.text || evalue || (!image ? JSON.stringify(record(object.data.data)) : "");
  return (
    <Shell {...props} meta={outputType || undefined} className={cn("py-3 pl-3", className)}>
      <div className="border-l border-hair pl-4">
        <div className="text-meta text-ink-faint">Saved output</div>
        {image ? (
          <div className="mt-2 rounded-srf bg-sunken p-3">
            <img
              src={api.artifactObjectMediaUrl(cid, aid, object.id)}
              alt={`Saved output from ${locatorText(object)}`}
              loading="lazy"
              className="mx-auto block max-h-[34rem] max-w-full"
            />
          </div>
        ) : null}
        {text ? <CodeWell className="mt-2">{text}</CodeWell> : null}
        {str(object.data.ename) ? (
          <Note tone="bad" className="mt-2">
            {str(object.data.ename)}: {evalue}
          </Note>
        ) : null}
        <ObjectWarning object={object} />
      </div>
    </Shell>
  );
}

interface CellGroup {
  index: number | null;
  cell: LearningObject | null;
  outputs: LearningObject[];
}

function groupNotebook(objects: LearningObject[]): { groups: CellGroup[]; rest: LearningObject[] } {
  const groups: CellGroup[] = [];
  const byIndex = new Map<number, CellGroup>();
  const rest: LearningObject[] = [];
  for (const object of objects) {
    if (object.object_type !== "notebook_cell" && object.object_type !== "notebook_output") {
      rest.push(object);
      continue;
    }
    const index = num(object.locator.notebook_cell);
    let group = index === null ? undefined : byIndex.get(index);
    if (!group) {
      group = { index, cell: null, outputs: [] };
      if (index !== null) byIndex.set(index, group);
      groups.push(group);
    }
    if (object.object_type === "notebook_cell") group.cell = object;
    else group.outputs.push(object);
  }
  return { groups, rest };
}

function NotebookMetadata(props: ObjectProps) {
  const metadata = record(props.object.data.metadata);
  return (
    <Shell
      {...props}
      meta={str(props.object.data.nbformat) ? `nbformat ${str(props.object.data.nbformat)}` : undefined}
    >
      <Fold summary="Notebook metadata">
        <CodeWell>{JSON.stringify(metadata, null, 2)}</CodeWell>
      </Fold>
    </Shell>
  );
}

function NotebookViewer(props: ViewerProps) {
  const { cid, aid, objects, focusOid, selectedIds, onToggle } = props;
  const { groups, rest } = groupNotebook(objects);
  const cells = objects.filter((object) => object.object_type === "notebook_cell").length;
  const outputs = objects.filter((object) => object.object_type === "notebook_output").length;
  const base = { cid, aid, focusOid, selectedIds, onToggle };

  return (
    <div className="min-w-0">
      <Note className="pb-2">
        {plural(cells, "notebook cell", "notebook cells")},{" "}
        {plural(outputs, "saved output", "saved outputs")}. Source is shown as the notebook file
        stores it. Computed results appear in the run panel and are never mixed into these.
      </Note>
      {groups.map((group, position) => (
        <div
          key={group.index ?? `group-${position}`}
          className="min-w-0 border-t border-hair first:border-t-0"
        >
          {group.cell ? (
            <NotebookSource {...base} object={group.cell} />
          ) : (
            <div className="py-4 text-meta text-ink-muted">
              Notebook cell {group.index !== null ? group.index + 1 : "unknown"}, source not in
              this page
            </div>
          )}
          {group.outputs.map((object) => (
            <NotebookOutput key={object.id} {...base} object={object} />
          ))}
        </div>
      ))}
      {rest.map((object) => (
        <NotebookMetadata key={object.id} {...base} object={object} />
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------
// the dispatcher
// --------------------------------------------------------------------------

function FallbackObject(props: ObjectProps) {
  return (
    <Shell {...props}>
      {props.object.text ? (
        <CodeWell>{props.object.text}</CodeWell>
      ) : (
        <CodeWell>{JSON.stringify(props.object.data, null, 2)}</CodeWell>
      )}
      <ObjectWarning object={props.object} />
    </Shell>
  );
}

export function ArtifactViewer(props: ViewerProps) {
  const { artifact, objects, cid, aid, focusOid, selectedIds, onToggle } = props;
  const base = { cid, aid, focusOid, selectedIds, onToggle };

  if (!objects.length) {
    return (
      <EmptyState
        icon={<FileWarning size={16} strokeWidth={1.75} aria-hidden />}
        title="No extracted source objects"
        description={
          artifact.extraction_status === "failed"
            ? "Extraction failed for this file. The original is byte-preserved and still downloadable."
            : "This file produced no readable objects."
        }
      />
    );
  }

  if (artifact.kind === "xlsx") {
    const cells = objects.filter((object) => object.object_type === "cell");
    return (
      <div className="min-w-0">
        {cells.length ? (
          <CellGrid
            cid={cid}
            aid={aid}
            cells={cells}
            focusOid={focusOid}
            selectedIds={selectedIds}
            onToggle={onToggle}
          />
        ) : null}
        {objects
          .filter((object) => object.object_type !== "cell")
          .map((object) => {
            switch (object.object_type) {
              case "sheet":
                return <SheetObject key={object.id} {...base} object={object} />;
              case "chart":
                return <ChartObject key={object.id} {...base} object={object} />;
              case "range":
                return <RangeObject key={object.id} {...base} object={object} />;
              case "formatting_rule":
                return <FormattingRuleObject key={object.id} {...base} object={object} />;
              case "filter_rule":
                return <FilterObject key={object.id} {...base} object={object} />;
              case "package_part":
                return <PackagePartObject key={object.id} {...base} object={object} />;
              default:
                return <FallbackObject key={object.id} {...base} object={object} />;
            }
          })}
      </div>
    );
  }

  if (artifact.kind === "ipynb") return <NotebookViewer {...props} />;

  return (
    <div className="min-w-0">
      {objects.map((object) => {
        switch (object.object_type) {
          case "page":
          case "slide":
            return <RenderedObject key={object.id} {...base} object={object} />;
          case "speaker_note":
            return <SpeakerNote key={object.id} {...base} object={object} />;
          case "document_block":
          case "prompt":
            return <DocumentBlock key={object.id} {...base} object={object} />;
          case "table":
            return <DocumentTable key={object.id} {...base} object={object} />;
          case "image":
            return <EmbeddedImage key={object.id} {...base} object={object} />;
          case "dataset":
            return <DatasetObject key={object.id} {...base} object={object} />;
          case "dataset_field":
            return <DatasetFieldObject key={object.id} {...base} object={object} />;
          default:
            return <FallbackObject key={object.id} {...base} object={object} />;
        }
      })}
    </div>
  );
}

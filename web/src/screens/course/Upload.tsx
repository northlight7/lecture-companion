/**
 * Adding more files to a course, including whole folders.
 *
 * Ported from `uploadCourseFiles` and `wireDrop("course-drop", ...)` in the
 * previous frontend (`web/app.js`): the same copy, the same filed report, the
 * same file kinds. The drop target is the same shape as the courses screen's
 * pile zone, so the two read as one control used twice.
 *
 * Folders arrive three ways: a dropped directory is walked through
 * `webkitGetAsEntry` and its names keep the folder as a prefix, the folder
 * button uses `webkitdirectory`, and either way the multipart filename is the
 * relative path the importer groups by.
 */

import { useRef, useState, type ChangeEvent, type DragEvent, type InputHTMLAttributes, type JSX } from "react";

import * as api from "@/lib/api";
import type { FiledRow, UploadResult } from "@/lib/types";
import { useStore } from "@/state/store";
import { Section } from "@/shell/Screen";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** The file kinds the importer classifies. The old input's accept list. */
const ACCEPT = ".pdf,.pptx,.docx,.xlsx,.csv,.ipynb";

/** React's input props have no `webkitdirectory` and the DOM does. One cast,
 *  here, rather than at the call site. */
const WEBKIT_DIRECTORY = {
  webkitdirectory: "",
} as unknown as InputHTMLAttributes<HTMLInputElement>;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Expand a drop into files. A dropped folder arrives as a directory entry, and
 *  `dataTransfer.files` alone would hand back the folder and nothing inside it.
 *  Names keep the folder as a prefix, which is what the importer groups by. */
async function filesFromDrop(dataTransfer: DataTransfer | null): Promise<File[]> {
  const items = dataTransfer ? Array.from(dataTransfer.items) : [];
  const entries = items
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (!entries.length) return dataTransfer ? Array.from(dataTransfer.files) : [];

  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      out.push(prefix ? new File([file], `${prefix}/${file.name}`, { type: file.type }) : file);
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    // readEntries returns at most 100 at a time, so keep asking until empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!batch.length) break;
      children.push(...batch);
    }
    const next = prefix ? `${prefix}/${entry.name}` : entry.name;
    for (const child of children) await walk(child, next);
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}

/** What one filed row became, in the words the old report used. */
function filedAs(row: FiledRow): string {
  if (row.role === "slides") return plural(row.n_slides, "slide", "slides");
  return `${String(row.kind || row.role || "course").toUpperCase()} artifact`;
}

export function UploadSection({ cid }: { cid: string }): JSX.Element {
  const { reloadCourse } = useStore();

  const [over, setOver] = useState(false);
  const [filing, setFiling] = useState(0);
  const [report, setReport] = useState<UploadResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const dragDepth = useRef(0);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const send = async (files: File[]) => {
    if (!files.length) return;
    setFiling(files.length);
    setFailure(null);
    setReport(null);
    try {
      const result = await api.uploadCourseFiles(cid, files);
      setReport(result);
      await reloadCourse();
    } catch (err) {
      // The old screen wrote upload failures into the report region rather than
      // toasting them, so the message stays next to the control that caused it.
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setFiling(0);
    }
  };

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared so choosing the same files twice fires a change again.
    event.target.value = "";
    if (files.length) void send(files);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    if (event.dataTransfer.types.includes("Files")) setOver(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files")) setOver(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setOver(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setOver(false);
    void (async () => {
      const dropped = await filesFromDrop(event.dataTransfer);
      if (dropped.length) await send(dropped);
    })();
  };

  return (
    <Section title="Add files to this course">
      <div
        onClick={() => filesInput.current?.click()}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col rounded-pnl border border-dashed",
          "px-6 py-6 transition-colors duration-[120ms] ease-[var(--ease)]",
          // `border-accent-ink`, not `border-accent`. The fill does not become
          // the accent here, so this is an OUTLINED control and its boundary is
          // what identifies it: 3:1 is owed. `--accent` measures 2.77 on a hover
          // surface, 2.58 on a selected one and 2.37 on the float, and this state
          // is reachable only by dragging, so nothing had measured it. The ink
          // variant is the accent family's on-a-surface colour and clears 5.82.
          over ? "border-accent-ink bg-hover" : "border-line hover:bg-hover",
        )}
      >
        <p className="text-ui font-medium text-ink">
          Drop files or folders here
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation();
              filesInput.current?.click();
            }}
          >
            Choose files
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation();
              folderInput.current?.click();
            }}
          >
            Choose a folder
          </Button>
        </div>
      </div>

      <input ref={filesInput} type="file" multiple accept={ACCEPT} hidden onChange={onPicked} />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        onChange={onPicked}
        {...WEBKIT_DIRECTORY}
      />

      <div aria-live="polite" className="flex flex-col">
        {filing ? (
          <p className="mt-4 text-ui text-ink-muted">
            Filing {plural(filing, "file", "files")}.
          </p>
        ) : null}

        {failure ? (
          <p className="mt-4 text-ui font-medium text-bad">{failure}</p>
        ) : null}

        {report ? (
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col">
              <h3 className="text-ui font-medium text-ink">Filed</h3>
              {/* The filed report is a grouped block, so it is level 1. */}
              <ul className="mt-1 flex flex-col rounded-srf border border-hair bg-raised p-2">
                {report.filed.map((row, index) => (
                  <li key={`${row.file_id || row.filename}-${index}`} className="flex flex-col px-2">
                    {index > 0 ? <Separator className="my-2" /> : null}
                    <p className="text-ui text-ink-muted">
                      <span className="font-medium text-ink">{row.filename}</span> as{" "}
                      {filedAs(row)}. {row.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            {report.errors.length ? (
              <div className="flex flex-col">
                <h3 className="text-ui font-medium text-bad">
                  Could not read
                </h3>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-6 text-ui text-ink-muted">
                  {report.errors.map((message) => (
                    <li key={message} className="break-words">
                      {message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

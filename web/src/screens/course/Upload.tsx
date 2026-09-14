/**
 * Adding more files to a course, including whole folders.
 *
 * One control, not three. The island is the only interactive thing in this
 * section and its accessible name is "Add files or folders". Activating it
 * opens a menu carrying the two ways in, rather than a second and third button
 * beside it: a reader adding material has one intention and two routes to it,
 * files they pick and a folder the app walks. `DropdownMenu` is the menu the
 * component library already has, so nothing here invents one.
 *
 * Folders arrive three ways. Inside the app the folder item hands the job to
 * the launcher, because a web view cannot read a directory it has been handed:
 * the launcher puts up its own panel, walks what was chosen and posts the files
 * itself. In a browser there is no launcher, so the item falls back to a
 * `webkitdirectory` input. A dropped directory is walked here through
 * `webkitGetAsEntry`, the way the launcher walks a chosen one. Whichever path
 * runs, the multipart filename is the relative path the importer groups by.
 *
 * Every one of those paths says so from the instant it is chosen
 * (`.internal/bar.md`, C5). The island renders a progressbar and a live status
 * line for the whole of the work: while the menu is open, while a panel is up,
 * while a dropped folder is being walked, and while the bytes are leaving the
 * browser, where the counts are the real ones `xhr.upload.onprogress` reports.
 * There is no state in which the reader is looking at nothing.
 *
 * The menu is explicit about `modal={false}`, and that is load-bearing. Radix's
 * default modal menu calls `hideOthers` on its own content, which sets
 * `aria-hidden="true"` on every other element in the page, so the whole app
 * leaves the accessibility tree for as long as the menu is open. This island
 * has to stay in it while the reader is walking through the two items, because
 * it is where the progress is reported.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type InputHTMLAttributes,
  type JSX,
} from "react";
import { Files, FolderOpen } from "lucide-react";

import * as api from "@/lib/api";
import type { FiledRow, UploadResult } from "@/lib/types";
import { useStore } from "@/state/store";
import { Section } from "@/shell/Screen";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** The file kinds the importer classifies. The old input's accept list. */
const ACCEPT = ".pdf,.pptx,.docx,.xlsx,.csv,.ipynb";

/** The island's accessible name. It is also the visible line inside it, and
 *  the bar's own pattern for this control, so the name a reader hears, the
 *  name a harness clicks and the words on the screen are one string. */
const ADD_LABEL = "Add files or folders";

/** React's input props have no `webkitdirectory` and the DOM does. One cast,
 *  here, rather than at the call site. */
const WEBKIT_DIRECTORY = {
  webkitdirectory: "",
} as unknown as InputHTMLAttributes<HTMLInputElement>;

/**
 * What the island is doing, from the moment it is activated to the moment the
 * course has been read again.
 *
 * `menu`, `choosing` and `waiting` have no count at all: the reader is looking
 * at a panel or a menu and nothing has been chosen yet. `walking` has no count
 * because a dropped directory cannot be sized until every entry has been read.
 * Only `sending` carries numbers, and they are byte counts.
 */
type Phase =
  | { kind: "idle" }
  | { kind: "menu" }
  | { kind: "choosing" }
  | { kind: "waiting" }
  | { kind: "walking" }
  | { kind: "sending"; loaded: number; total: number; count: number }
  | { kind: "filing"; count: number };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Bytes as a reader reads them. Two significant figures is the most a moving
 *  number can carry. */
function bytes(count: number): string {
  if (count < 1024) return `${count} B`;
  const thousands = count / 1024;
  if (thousands < 1024) return `${Math.round(thousands)} KB`;
  return `${(thousands / 1024).toFixed(1)} MB`;
}

/**
 * The live status line. Every phase names the work that is happening, because
 * the criterion this answers is that no sample of the screen is ever empty
 * (`.internal/bar.md`, C5).
 */
function statusOf(phase: Phase): string {
  switch (phase.kind) {
    case "menu":
      return "Waiting for you to choose what to add.";
    case "choosing":
      return "Waiting for the file panel.";
    case "waiting":
      return "The folder panel is open. Waiting for the import to finish.";
    case "walking":
      return "Reading the dropped folder.";
    case "sending":
      return phase.total
        ? `Sending ${plural(phase.count, "file", "files")}. ${bytes(phase.loaded)} of ${bytes(phase.total)}.`
        : `Sending ${plural(phase.count, "file", "files")}. ${bytes(phase.loaded)} written.`;
    case "filing":
      return `Filed ${plural(phase.count, "file", "files")}. Reading the course again.`;
    default:
      return "";
  }
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

/**
 * The launcher's half of the folder import.
 *
 * The launcher registers `folderPicker` as a message handler and expects
 * `{mode, courseId}`; it answers by calling `nativeFolderImportFinished` with
 * `{mode, ok, message}` and never with the filed rows, because it posts the
 * files itself and shows what the server said in one sentence.
 *
 * A browser has no `window.webkit`, so the handler's absence is the whole
 * app-versus-browser test. It is the same test the previous frontend used.
 */
type FolderPickerBridge = {
  postMessage(message: { mode: "course" | "bulk"; courseId: string }): void;
};

type FolderImportResult = { mode: string; ok: boolean; message: string };

function folderPicker(): FolderPickerBridge | undefined {
  const webkit = (
    window as unknown as {
      webkit?: { messageHandlers?: { folderPicker?: FolderPickerBridge } };
    }
  ).webkit;
  return webkit?.messageHandlers?.folderPicker;
}

/** What one filed row became, in the words the old report used. */
function filedAs(row: FiledRow): string {
  if (row.role === "slides") return plural(row.n_slides, "slide", "slides");
  return `${String(row.kind || row.role || "course").toUpperCase()} artifact`;
}

export function UploadSection({ cid }: { cid: string }): JSX.Element {
  const { reloadCourse } = useStore();

  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [report, setReport] = useState<UploadResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const dragDepth = useRef(0);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const hintId = useId();

  useEffect(() => {
    // The launcher answers here when its own panel finishes an import. It is
    // registered while this screen is open, which is the only place a folder
    // can be chosen from, and removed on the way out so a stale closure cannot
    // write into an unmounted screen.
    const host = window as unknown as {
      nativeFolderImportFinished?: (result: FolderImportResult) => void;
    };
    host.nativeFolderImportFinished = (result) => {
      // The panel is finished either way, so the island stops reporting the
      // wait before it reports what the launcher said.
      setPhase({ kind: "idle" });
      if (!result.ok) {
        // The old screen wrote these into the report region rather than
        // toasting them, so a refusal stays next to the control that caused it.
        setReport(null);
        setFailure(result.message);
        return;
      }
      // Success toasts, the way it did before, and the rows the browser path
      // would have listed arrive with the reloaded course.
      setFailure(null);
      setReport(null);
      toast(result.message);
      void reloadCourse();
    };
    return () => {
      delete host.nativeFolderImportFinished;
    };
  }, [reloadCourse]);

  // A cancelled panel reports nothing: the launcher only calls back on a
  // finished import, and a `change` event only fires on a real choice. The two
  // signals that the panel is no longer in front of the reader are the window
  // taking focus back and a click landing in the page, and both are given a
  // grace period so they can never cut a choice short: the state change a real
  // choice produces replaces the phase, and this only clears the phase it was
  // armed against, by identity.
  useEffect(() => {
    if (phase.kind !== "choosing" && phase.kind !== "waiting") return;
    let timer = 0;
    const clear = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setPhase((current) => (current === phase ? { kind: "idle" } : current));
      }, 1500);
    };
    window.addEventListener("focus", clear);
    window.addEventListener("pointerdown", clear);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", clear);
      window.removeEventListener("pointerdown", clear);
    };
  }, [phase]);

  const beginMenu = (open: boolean) => {
    setPhase((current) => {
      if (open) {
        // Opening the menu over work that is already running does not replace
        // the report of it. There is only ever one thing happening.
        return current.kind === "sending" || current.kind === "filing"
          ? current
          : { kind: "menu" };
      }
      // Closing without choosing leaves the island idle again. A choice already
      // moved the phase on by the time this fires, in either order, so this
      // only ever clears the phase that was still waiting for one.
      return current.kind === "menu" ? { kind: "idle" } : current;
    });
  };

  const send = async (files: File[]) => {
    if (!files.length) return;
    setFailure(null);
    setReport(null);
    // The sum of the files is a shade under the multipart body, so it is a
    // real total to start from. The first progress event replaces it with the
    // body's own size, which is what the server is actually reading.
    const total = files.reduce((sum, file) => sum + file.size, 0);
    const count = files.length;
    setPhase({ kind: "sending", loaded: 0, total, count });
    try {
      const result = await api.uploadCourseFiles(cid, files, (loaded, sentTotal) => {
        setPhase({ kind: "sending", loaded, total: sentTotal || total, count });
      });
      setReport(result);
      setPhase({ kind: "filing", count });
      await reloadCourse();
    } catch (err) {
      // The old screen wrote upload failures into the report region rather than
      // toasting them, so the message stays next to the control that caused it.
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase({ kind: "idle" });
    }
  };

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared so choosing the same files twice fires a change again.
    event.target.value = "";
    if (files.length) void send(files);
    // Cancelled, in the browsers that fire a change for it. Nothing was
    // chosen, so the island goes back to rest rather than reporting a wait
    // that is over.
    else setPhase({ kind: "idle" });
  };

  const chooseFiles = () => {
    setPhase({ kind: "choosing" });
    filesInput.current?.click();
  };

  const chooseFolder = () => {
    const bridge = folderPicker();
    if (!bridge) {
      // No launcher: a browser, where the directory input works.
      setPhase({ kind: "choosing" });
      folderInput.current?.click();
      return;
    }
    // The launcher opens its own panel and posts the files itself, so nothing
    // is sent from here. It reports back through the effect.
    setPhase({ kind: "waiting" });
    bridge.postMessage({ mode: "course", courseId: cid });
  };

  const onDragEnter = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    if (event.dataTransfer.types.includes("Files")) setOver(true);
  };

  const onDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files")) setOver(true);
  };

  const onDragLeave = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setOver(false);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setOver(false);
    void (async () => {
      // Reported before the first entry is read, because a dropped directory
      // has no size until every one of its entries has been walked.
      setPhase({ kind: "walking" });
      const dropped = await filesFromDrop(event.dataTransfer);
      if (dropped.length) await send(dropped);
      else setPhase({ kind: "idle" });
    })();
  };

  const sending = phase.kind === "sending" && phase.total > 0 ? phase : null;
  const percent = sending
    ? Math.min(100, Math.max(0, Math.round((sending.loaded / sending.total) * 100)))
    : 0;

  return (
    <Section title="Add material to this course" accent="green">
      <DropdownMenu modal={false} onOpenChange={beginMenu}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            aria-label={ADD_LABEL}
            aria-describedby={hintId}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              // The island is the drop target and the button. The base control's
              // own geometry is overridden for a block that holds two lines:
              // centred, 36px tall and `nowrap` are a button's shape, not a
              // drop zone's.
              "flex h-auto w-full flex-col items-start justify-start gap-1 rounded-pnl",
              "border border-dashed px-6 py-6 text-left whitespace-normal",
              "transition-colors duration-[120ms] ease-[var(--ease)]",
              // `border-accent-ink`, not `border-accent`. The fill does not become
              // the accent here, so this is an OUTLINED control and its boundary is
              // what identifies it: 3:1 is owed. `--accent` measures 2.77 on a hover
              // surface, 2.58 on a selected one and 2.37 on the float, and this state
              // is reachable only by dragging, so nothing had measured it. The ink
              // variant is the accent family's on-a-surface colour and clears 5.82.
              over ? "border-accent-ink bg-hover" : "border-line hover:bg-hover",
            )}
          >
            <span className="text-ui font-medium text-ink">{ADD_LABEL}</span>
            <span id={hintId} className="text-meta text-ink-muted">
              Drop them here, or open the menu to browse.
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[12rem]">
          <DropdownMenuLabel>Add to this course</DropdownMenuLabel>
          <DropdownMenuItem onSelect={chooseFiles}>
            <Files size={16} strokeWidth={1.75} aria-hidden />
            Files
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={chooseFolder}>
            <FolderOpen size={16} strokeWidth={1.75} aria-hidden />
            Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input ref={filesInput} type="file" multiple accept={ACCEPT} hidden onChange={onPicked} />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        onChange={onPicked}
        {...WEBKIT_DIRECTORY}
      />

      {/* The progress region is its own live region, above the report rather
          than inside it, so a reader is not read the filed rows again on every
          progress event. */}
      {phase.kind !== "idle" ? (
        <div className="mt-4 flex flex-col gap-2">
          {/* The status line names the work, and the bar under it is real
              whenever there is a count. A sample of this screen taken at any
              point in the work carries one of them, and usually both. */}
          <p role="status" className="text-ui text-ink-muted">
            {statusOf(phase)}
          </p>
          {sending ? (
            <Progress
              className="max-w-[24rem]"
              value={percent}
              aria-label="Upload progress"
              // The bar's fill is drawn on a 0 to 100 scale because that is the
              // geometry the component owns, and the numbers the platform is
              // told are the byte counts themselves, so what is reported is
              // what `xhr.upload.onprogress` measured and not a rounded
              // percentage of it.
              aria-valuemin={0}
              aria-valuemax={sending.total}
              aria-valuenow={sending.loaded}
            />
          ) : (
            // Nothing to count yet: a menu, a panel, or a folder whose entries
            // are still being read. The progressbar is still rendered,
            // indeterminate, because its absence is the failure this criterion
            // is written against.
            <Progress className="max-w-[24rem]" value={null} aria-label="Upload progress" />
          )}
        </div>
      ) : null}

      <div aria-live="polite" className="flex flex-col">
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

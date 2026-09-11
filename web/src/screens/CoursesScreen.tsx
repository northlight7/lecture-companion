/**
 * The courses screen: every course as a tile on a board, the way to make one,
 * and the pile-of-files import.
 *
 * Ported from `renderCourses` and the bulk drop zone in the previous frontend
 * (`web/app.js`). Same copy, same counts, same empty state, same rule that
 * nothing is written until the reader accepts the proposed grouping.
 *
 * The full-width rows became a board of tiles grouped by state
 * (`.internal/DESIGN.md`, "Course tiles" and "More colour"). The board and the
 * tile are their own files, under `./courses/`; the form and the drop sit
 * below the board.
 *
 * Two deliberate changes, both required:
 *
 *   - deleting a course confirms through `AlertDialog` instead of
 *     `window.confirm`, which never resolved inside the WKWebView;
 *   - the file inputs carry `webkitdirectory`, so a folder can be chosen
 *     without the native `folderPicker` message bridge, which imported the
 *     pile straight away and never showed the reader a preview.
 */

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type JSX,
} from "react";
import { LibraryBig } from "lucide-react";

import * as api from "@/lib/api";
import { hash, navigate } from "@/lib/router";
import type { CourseRow, ImportGroup } from "@/lib/types";
import { useErrorHandler, useStore } from "@/state/store";
import { CourseBoard } from "@/screens/courses/CourseBoard";
import { Screen, Section } from "@/shell/Screen";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";

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

/**
 * Create a course from a title. The old form wrote its own failures into the
 * field's error line instead of toasting them, including the 428 that opens the
 * connect dialog everywhere else, so this keeps that and does not call the
 * shared handler.
 */
function NewCourseForm(): JSX.Element {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Give the course a title.");
      field.current?.focus();
      return;
    }
    setCreating(true);
    try {
      const course = await api.createCourse(trimmed);
      setTitle("");
      navigate(hash.course(course.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      field.current?.focus();
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
      <Label htmlFor="new-course-title">New course</Label>
      <div className="flex max-w-[32rem] items-center gap-2">
        <Input
          id="new-course-title"
          ref={field}
          name="title"
          type="text"
          autoComplete="off"
          placeholder="Statistical Learning"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "new-course-error" : undefined}
        />
        <Button type="submit" variant="primary" disabled={creating}>
          Create
        </Button>
      </div>
      {error ? (
        <p
          id="new-course-error"
          role="alert"
          className="text-ui font-medium text-bad"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The pile of files. Drop or choose files and folders, read back the grouping
 * the importer proposes, then accept or reject it. The preview and the import
 * are two separate requests: nothing is written until `Create` is pressed.
 */
function BulkImportSection(): JSX.Element {
  const { reloadCourses } = useStore();
  const handle = useErrorHandler();

  const [picked, setPicked] = useState<File[]>([]);
  const [groups, setGroups] = useState<ImportGroup[] | null>(null);
  const [reading, setReading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importFailed, setImportFailed] = useState(false);
  const [over, setOver] = useState(false);

  const dragDepth = useRef(0);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const preview = async (files: File[]) => {
    setPicked(files);
    setGroups(null);
    setPreviewError(null);
    setImportFailed(false);
    setReading(true);
    try {
      const result = await api.previewImport(files);
      setGroups(result.groups);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  };

  const reset = () => {
    setPicked([]);
    setGroups(null);
    setPreviewError(null);
    setImportFailed(false);
  };

  const commit = async () => {
    setImporting(true);
    setImportFailed(false);
    try {
      const result = await api.importBulk(picked);
      reset();
      toast(`Imported into ${plural(result.courses.length, "course", "courses")}.`);
      await reloadCourses();
    } catch (err) {
      handle(err);
      setImportFailed(true);
    } finally {
      setImporting(false);
    }
  };

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared so choosing the same files twice fires a change again.
    event.target.value = "";
    if (files.length) void preview(files);
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
      if (dropped.length) await preview(dropped);
    })();
  };

  return (
    <Section title="Have a pile of files and no course yet?">
      <p className="max-w-[60ch] text-ui text-ink-muted">
        Drop everything here. The app proposes a grouping into courses, and nothing is written
        until you accept it.
      </p>

      <div
        onClick={() => filesInput.current?.click()}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          "mt-4 cursor-pointer rounded-pnl border border-dashed px-6 py-6",
          "transition-colors duration-[120ms] ease-[var(--ease)]",
          over ? "border-accent bg-hover" : "border-line hover:bg-hover",
        ].join(" ")}
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

      <input
        ref={filesInput}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={onPicked}
      />
      <input ref={folderInput} type="file" multiple hidden onChange={onPicked} {...WEBKIT_DIRECTORY} />

      {reading ? (
        <p className="mt-4 text-ui text-ink-muted">
          Reading {plural(picked.length, "file", "files")}.
        </p>
      ) : null}

      {previewError ? (
        <p className="mt-4 text-ui font-medium text-bad">
          {previewError}
        </p>
      ) : null}

      {groups ? (
        <div className="mt-4 flex flex-col">
          {groups.map((group, index) => (
            <Fragment key={`${index}-${group.title}`}>
              {index > 0 ? <Separator className="my-3" /> : null}
              <div className="flex flex-col gap-1">
                <p className="text-ui font-medium text-ink">
                  {group.title}
                </p>
                <p className="text-meta text-ink-muted">{group.reason}</p>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-6 text-ui text-ink-muted">
                  {group.filenames.map((filename) => (
                    <li key={filename} className="break-words">
                      {filename}
                    </li>
                  ))}
                </ul>
              </div>
            </Fragment>
          ))}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" disabled={importing} onClick={() => void commit()}>
              {importing
                ? "Importing"
                : importFailed
                  ? "Try again"
                  : `Create ${plural(groups.length, "course", "courses")}`}
            </Button>
            <Button type="button" variant="secondary" disabled={importing} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

export function CoursesScreen(): JSX.Element {
  const { courses, coursesError, reloadCourses } = useStore();
  const handle = useErrorHandler();
  const [pendingDelete, setPendingDelete] = useState<CourseRow | null>(null);

  // The old router refetched the list on every visit to #/. The store loads it
  // once for the whole app, so the screen asks again when it mounts.
  useEffect(() => {
    void reloadCourses();
  }, [reloadCourses]);

  const confirmDelete = async () => {
    const course = pendingDelete;
    if (!course) return;
    try {
      await api.deleteCourse(course.id);
      await reloadCourses();
    } catch (err) {
      handle(err);
    }
  };

  return (
    <Screen
      title="Your courses"
      lede="Each course is a sealed container. Slides, reference documents and everything the model remembers stay inside it."
    >
      {/* The board is what a live region has to announce: it is what changes
          when a course is made, imported or deleted. */}
      <div aria-live="polite">
        {coursesError ? (
          <p className="py-6 text-ui text-bad">{coursesError}</p>
        ) : null}

        {courses === null && !coursesError ? (
          <div className="py-6">
            <Spinner label="Loading courses" />
          </div>
        ) : null}

        {courses !== null && courses.length === 0 ? (
          <EmptyState
            icon={<LibraryBig size={16} strokeWidth={1.75} aria-hidden />}
            title="No courses yet"
            description="Create one below, then drop its course files in. Or drop a whole pile and let the app propose the split."
            className="-mx-2 px-2 py-8"
          />
        ) : null}

        {courses !== null && courses.length > 0 ? (
          <CourseBoard courses={courses} onDelete={setPendingDelete} />
        ) : null}
      </div>

      <div className="mt-10">
        <NewCourseForm />
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete ? `Delete ${pendingDelete.title}?` : "Delete this course?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Everything filed into it is deleted too. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkImportSection />
    </Screen>
  );
}

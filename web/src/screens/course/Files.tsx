/**
 * Files and study folders: every artifact in the course, the folder it was
 * filed into, and the way to change that.
 *
 * Ported from the file-list half of `renderCourse` and the `save-folders` /
 * `organize-files` handlers in the previous frontend (`web/app.js`). The three
 * defects it carried are fixed here, and each is a behaviour the rebuild has to
 * preserve:
 *
 *   - the folder control is a real menu (`DropdownMenu`), not a free-text field
 *     with a `datalist`, which WebKit never showed on click;
 *   - the menu and the Delete control sit in one flex row with a shrink-0
 *     cluster, so a long folder name cannot grow over the button beside it;
 *   - a filing lives in React state rather than in the DOM, so a re-render (a
 *     finished run, a reload, a delete) cannot lose it.
 */

import { useEffect, useState, type JSX } from "react";
import { ChevronDown, FolderPlus, Trash2, X } from "lucide-react";

import * as api from "@/lib/api";
import { hash } from "@/lib/router";
import type {
  ArtifactExtractionStatus,
  ArtifactRow,
  OrganizationMethod,
} from "@/lib/types";
import { useErrorHandler, useStore } from "@/state/store";
import { Section } from "@/shell/Screen";
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
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** The sentinel the folder menu uses for "type a new name". Same value the old
 *  frontend used. */
const NEW_FOLDER = "__new__";

/** Must match MAX_FOLDER_NAME in app/organization.py. */
const MAX_FOLDER_CHARS = 80;

const DISCLOSURE =
  "DeepSeek receives file names, imported paths, purposes, and short extracted samples "
  + "only from this course.";

const EXTRACTION_WORD: Record<ArtifactExtractionStatus, string> = {
  running: "extracting",
  done: "extracted",
  failed: "extraction failed",
};

const EXTRACTION_TONE: Record<ArtifactExtractionStatus, string> = {
  running: "text-accent-ink",
  done: "text-ink-faint",
  failed: "text-bad",
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** An artifact and the study folder it is currently filed into. */
export interface StudyGroup {
  folder: string;
  reason: string;
  rows: ArtifactRow[];
}

/**
 * Group the course's artifacts into their study folders. Unsaved edits win over
 * what the server last said, which is what keeps a filing on screen while a
 * reload is in flight. "Unfiled" sorts last, as it did before.
 */
export function groupArtifacts(
  artifacts: ArtifactRow[],
  assignments: Record<string, string>,
): StudyGroup[] {
  const buckets = new Map<string, ArtifactRow[]>();
  for (const artifact of artifacts) {
    const name = (assignments[artifact.id] ?? artifact.folder ?? "").trim() || "Unfiled";
    const rows = buckets.get(name);
    if (rows) rows.push(artifact);
    else buckets.set(name, [artifact]);
  }
  return [...buckets.entries()]
    .map(([folder, rows]) => ({
      folder,
      reason: rows.find((row) => row.folder_reason)?.folder_reason ?? "",
      rows,
    }))
    .sort((a, b) =>
      a.folder === "Unfiled" ? 1 : b.folder === "Unfiled" ? -1 : a.folder.localeCompare(b.folder),
    );
}

/** Every folder name in use, for the menu. "Unfiled" is the menu's own first
 *  item and never a name you can file into. */
function folderNames(groups: StudyGroup[]): string[] {
  return [...new Set(groups.map((group) => group.folder))]
    .filter((name) => name && name !== "Unfiled")
    .sort((a, b) => a.localeCompare(b));
}

function facts(artifact: ArtifactRow): string {
  const purpose = (artifact.purpose ?? "").replaceAll("_", " ");
  return [
    (artifact.kind || "file").toUpperCase(),
    purpose,
    plural(artifact.object_count ?? 0, "source object", "source objects"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One artifact: its filename on a line of its own, then its facts beside the
 *  two controls that act on it. The filename is never given a narrow column to
 *  break inside. */
function FileRow({
  cid,
  artifact,
  folder,
  folders,
  drafting,
  draftName,
  onPick,
  onDraftName,
  onCommitDraft,
  onCancelDraft,
  onDelete,
}: {
  cid: string;
  artifact: ArtifactRow;
  folder: string;
  folders: string[];
  drafting: boolean;
  draftName: string;
  onPick: (name: string) => void;
  /** Called with an empty name to open the draft, and with the typed name on
   *  every keystroke. One callback, so the row cannot disagree with itself. */
  onDraftName: (name: string) => void;
  onCommitDraft: () => void;
  onCancelDraft: () => void;
  onDelete: () => void;
}): JSX.Element {
  const warnings = artifact.extraction_warnings ?? [];
  const sourcePath = artifact.source_path ?? "";
  const showSource = Boolean(sourcePath) && sourcePath !== artifact.filename;

  return (
    <>
      <a
        href={hash.source(cid, artifact.id)}
        title={artifact.filename}
        className="flex h-[var(--row-h)] w-full min-w-0 items-center rounded-srf text-ui font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease)] hover:text-accent-ink"
      >
        <span className="min-w-0 flex-1 truncate">{artifact.filename}</span>
      </a>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-meta text-ink-muted" title={facts(artifact)}>
            {facts(artifact)}
          </p>
          <span
            className={cn("shrink-0 text-meta", EXTRACTION_TONE[artifact.extraction_status])}
          >
            {EXTRACTION_WORD[artifact.extraction_status]}
          </span>
          {warnings.length ? (
            <Badge variant="warn" className="shrink-0">
              {plural(warnings.length, "extraction warning", "extraction warnings")}
            </Badge>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {drafting ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={`Study folder for ${artifact.filename}`}
                >
                  <span className="max-w-[10rem] truncate">{folder || "Unfiled"}</span>
                  <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuRadioGroup
                  value={folder}
                  onValueChange={(value) =>
                    value === NEW_FOLDER ? onDraftName("") : onPick(value)
                  }
                >
                  <DropdownMenuRadioItem value="">Unfiled</DropdownMenuRadioItem>
                  {folders.map((name) => (
                    <DropdownMenuRadioItem key={name} value={name}>
                      {name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onDraftName("")}>
                  <FolderPlus size={16} strokeWidth={1.75} aria-hidden />
                  New folder...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button type="button" variant="danger" onClick={onDelete}>
            <Trash2 size={16} strokeWidth={1.75} aria-hidden />
            Delete
          </Button>
        </div>
      </div>

      {showSource ? (
        <p className="truncate text-meta text-ink-faint" title={sourcePath}>
          Imported as {sourcePath}
        </p>
      ) : null}

      {drafting ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            type="text"
            value={draftName}
            maxLength={MAX_FOLDER_CHARS}
            placeholder="New folder name"
            aria-label={`New study folder for ${artifact.filename}`}
            className="max-w-[18rem]"
            onChange={(event) => onDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCommitDraft();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelDraft();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={onCommitDraft}>
            File it here
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cancel new folder"
            onClick={onCancelDraft}
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </Button>
        </div>
      ) : null}
    </>
  );
}

export interface FilesSectionProps {
  cid: string;
  artifacts: ArtifactRow[];
  /** The working copy of the filing. Owned by the screen so the rail can read
   *  the same structure the list shows. */
  assignments: Record<string, string>;
  onAssignments: (next: Record<string, string>) => void;
}

export function FilesSection({
  cid,
  artifacts,
  assignments,
  onAssignments,
}: FilesSectionProps): JSX.Element {
  const { reloadCourse } = useStore();
  const handle = useErrorHandler();

  const [pendingDelete, setPendingDelete] = useState<ArtifactRow | null>(null);
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null);
  const [rename, setRename] = useState<{ folder: string; name: string } | null>(null);
  const [method, setMethod] = useState<OrganizationMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const groups = groupArtifacts(artifacts, assignments);
  const folders = folderNames(groups);
  const status = note ?? (artifacts.length ? DISCLOSURE : "Add files before creating study folders.");
  const provenance =
    method === "model"
      ? "These folders were suggested by DeepSeek, then saved with your edits."
      : method === "manual"
        ? "These folders are your own arrangement."
        : "";

  // Who arranged the folders is not in the course payload, and it is worth
  // saying. A failure here costs the line and nothing else.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const organization = await api.getOrganization(cid);
        if (alive) setMethod(organization.method);
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [cid]);

  const file = (artifactId: string, name: string) => {
    onAssignments({ ...assignments, [artifactId]: name.trim() });
  };

  const commitDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (name) file(draft.id, name);
    setDraft(null);
  };

  /** Renaming a folder renames it for every file inside it, which is the one
   *  thing filing file by file cannot do in a single move. */
  const commitRename = () => {
    const pending = rename;
    setRename(null);
    if (!pending) return;
    const name = pending.name.trim();
    if (!name) return;
    const next = { ...assignments };
    for (const group of groups) {
      if (group.folder !== pending.folder) continue;
      for (const row of group.rows) next[row.id] = name;
    }
    onAssignments(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      // The whole filing goes up, every artifact in it. `save_organization`
      // replaces the stored map with what it is given and drops empty names, so
      // one request both files and unfiles, and a name left out of the payload
      // would silently unfile a file nobody touched.
      const payload: Record<string, string> = {};
      for (const artifact of artifacts) {
        payload[artifact.id] = (assignments[artifact.id] ?? artifact.folder ?? "").trim();
      }
      const organization = await api.saveOrganization(cid, payload);
      onAssignments(organization.assignments);
      setMethod(organization.method);
      setNote(null);
      toast("Study folders saved.");
      await reloadCourse();
    } catch (err) {
      handle(err);
    } finally {
      setSaving(false);
    }
  };

  const organize = async () => {
    setOrganizing(true);
    setNote("DeepSeek is matching related course files.");
    try {
      const organization = await api.suggestOrganization(cid);
      onAssignments(organization.assignments);
      setMethod(organization.method);
      setNote(null);
      toast("DeepSeek organized the files. You can edit and save any folder name.");
      await reloadCourse();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
      handle(err);
    } finally {
      setOrganizing(false);
    }
  };

  const remove = async () => {
    const artifact = pendingDelete;
    if (!artifact) return;
    try {
      await api.deleteArtifact(cid, artifact.id);
      toast(`${artifact.filename} deleted.`);
      setPendingDelete(null);
      await reloadCourse();
    } catch (err) {
      handle(err);
      setPendingDelete(null);
    }
  };

  return (
    <Section
      title="Files and study folders"
      action={
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={organizing || artifacts.length === 0}
            onClick={() => void organize()}
          >
            {organizing ? "Organizing" : "Organize with DeepSeek"}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving || artifacts.length === 0}
            onClick={() => void save()}
          >
            {saving ? "Saving" : "Save folders"}
          </Button>
        </div>
      }
    >
      <p className="text-ui text-ink-muted">
        Group a lecture with its tutorial, data, workbook, notebook, and supplements. Change any
        folder name, then save.
      </p>

      <p aria-live="polite" className="mt-2 text-meta text-ink-muted">
        {status}
      </p>
      {provenance ? <p className="text-meta text-ink-faint">{provenance}</p> : null}

      {artifacts.length === 0 ? (
        <p className="mt-4 text-ui text-ink-muted">Nothing uploaded yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-8">
          {groups.map((group) => (
            <div key={group.folder} className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-ui font-medium text-ink">
                  {group.folder}
                </h3>
                {group.folder === "Unfiled" || rename?.folder === group.folder ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRename({ folder: group.folder, name: group.folder })}
                  >
                    Rename
                  </Button>
                )}
                {rename?.folder === group.folder ? (
                  <>
                    <Input
                      autoFocus
                      type="text"
                      value={rename.name}
                      maxLength={MAX_FOLDER_CHARS}
                      aria-label={`New name for the ${group.folder} folder`}
                      className="max-w-[18rem]"
                      onChange={(event) =>
                        setRename({ folder: group.folder, name: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitRename();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setRename(null);
                        }
                      }}
                    />
                    <Button type="button" variant="secondary" onClick={commitRename}>
                      Rename folder
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Cancel rename"
                      onClick={() => setRename(null)}
                    >
                      <X size={16} strokeWidth={1.75} aria-hidden />
                    </Button>
                  </>
                ) : null}
              </div>
              {group.reason ? (
                <p className="mt-1 text-meta text-ink-muted">{group.reason}</p>
              ) : null}

              <ul className="mt-1 flex flex-col">
                {group.rows.map((artifact, index) => (
                  <li key={artifact.id} className="-mx-2 flex flex-col px-2">
                    {index > 0 ? <Separator className="my-2" /> : null}
                    <FileRow
                      cid={cid}
                      artifact={artifact}
                      folder={assignments[artifact.id] ?? artifact.folder ?? ""}
                      folders={folders}
                      drafting={draft?.id === artifact.id}
                      draftName={draft?.id === artifact.id ? draft.name : ""}
                      onPick={(name) => file(artifact.id, name)}
                      onDraftName={(name) => setDraft({ id: artifact.id, name })}
                      onCommitDraft={commitDraft}
                      onCancelDraft={() => setDraft(null)}
                      onDelete={() => setPendingDelete(artifact)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `“${pendingDelete.filename}” and its generated data are deleted from this course. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={() => void remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

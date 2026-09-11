/**
 * One artifact, in its own format, with the two local tools that act on it.
 *
 * The frame is the shared `Screen`: the filename is the title, the course is
 * the way back, and the two things a reader takes away (the exact source link
 * and the byte-preserved original) sit in the header rather than in a toolbar.
 *
 * Everything below is a scroll region of its own. The object list scrolls, the
 * tool rail scrolls, and the page column scrolls only when the two panes stack
 * under 1360. The window itself never scrolls.
 *
 * The route names one object, and that object is focused: it takes the
 * selection surface and is scrolled into view. Every locator in the viewer sets
 * the hash back to its own object, so a source link is exact in both
 * directions.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Download, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import * as api from "@/lib/api";
import { hash } from "@/lib/router";
import type { ArtifactView, LearningObject } from "@/lib/types";
import { useErrorHandler, useStore } from "@/state/store";
import { Screen } from "@/shell/Screen";

import { AskPanel } from "./artifact/AskPanel";
import { ExecutionPanel } from "./artifact/ExecutionPanel";
import { ArtifactViewer } from "./artifact/Viewers";
import { WorkbookPanel } from "./artifact/WorkbookPanel";
import { Note, StateLine, plural } from "./artifact/parts";

/** The view route pages at 300 for structured files and at 20 for pdf and pptx. */
const PAGE = 300;

/**
 * The pane height: the window minus the chrome the Screen puts above it. Both
 * panes are bounded, so the object list scrolls inside its own region, the rail
 * scrolls inside its own, and the page column itself never has to.
 */
const PANE = "h-[calc(100dvh-22rem)]";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ArtifactScreen({
  cid,
  aid,
  oid,
}: {
  cid: string;
  aid: string;
  oid: string;
}): JSX.Element {
  const { course } = useStore();
  const handle = useErrorHandler();

  const [view, setView] = useState<ArtifactView | null>(null);
  const [objects, setObjects] = useState<LearningObject[]>([]);
  const [sheet, setSheet] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<LearningObject[]>([]);

  const objectsRef = useRef<LearningObject[]>([]);
  const sheetRef = useRef("");
  const offsetRef = useRef(0);
  const seqRef = useRef(0);
  const routeRef = useRef({ cid: "", aid: "" });
  const autoSelectRef = useRef({ aid: "", oid: "" });
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const putObjects = useCallback((next: LearningObject[]) => {
    objectsRef.current = next;
    setObjects(next);
  }, []);

  const load = useCallback(
    async (options: { append?: boolean; sheet?: string; focus?: string }) => {
      const seq = ++seqRef.current;
      const append = options.append === true;
      setLoading(true);
      try {
        let exact: LearningObject | null = null;
        if (options.focus) {
          exact = await api.getArtifactObject(cid, aid, options.focus);
          if (seq !== seqRef.current) return;
        }
        // An explicit sheet wins, then the focused object's own sheet, then the
        // sheet the reader is already on. The previous frontend's order.
        const requested = options.sheet || exact?.locator.sheet || sheetRef.current;
        const payload = await api.getArtifactView(cid, aid, {
          sheet: requested || undefined,
          offset: append ? offsetRef.current : 0,
          limit: PAGE,
        });
        if (seq !== seqRef.current) return;

        const merged = append ? [...objectsRef.current, ...payload.objects] : payload.objects;
        // A deep link to an object outside this page still has to be shown.
        const withExact =
          exact && !merged.some((item) => item.id === exact.id) ? [exact, ...merged] : merged;

        setView(payload);
        putObjects(withExact);
        offsetRef.current = payload.offset + payload.objects.length;
        setHasMore(payload.has_more);
        sheetRef.current = payload.selected_sheet || "";
        setSheet(payload.selected_sheet || "");
        // The selection belonged to the sheet we left.
        if (options.sheet) setSelection([]);
        setError("");
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(message(err));
        handle(err);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [aid, cid, handle, putObjects],
  );

  useEffect(() => {
    const fresh = routeRef.current.cid !== cid || routeRef.current.aid !== aid;
    routeRef.current = { cid, aid };
    if (fresh) {
      putObjects([]);
      setSelection([]);
      setView(null);
      setSheet("");
      sheetRef.current = "";
      offsetRef.current = 0;
      setHasMore(false);
      setError("");
      autoSelectRef.current = { aid: "", oid: "" };
    } else if (oid && objectsRef.current.some((item) => item.id === oid)) {
      // Already loaded, so the focus effect below scrolls to it. Nothing to
      // fetch, and the reader keeps the pages they loaded.
      return;
    }
    void load({ append: false, focus: oid, sheet: "" });
  }, [cid, aid, oid, load, putObjects]);

  // The route's object is focused, and scrolled into view inside its own list.
  // Matched by dataset, not by a selector built from the route, so a malformed
  // oid can never break the query.
  useEffect(() => {
    if (!oid || !objects.length) return;
    const nodes = viewerRef.current?.querySelectorAll<HTMLElement>("[data-oid]");
    const node = nodes ? Array.from(nodes).find((item) => item.dataset.oid === oid) : undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [oid, objects]);

  // Arriving on an object selects it, so the question panel starts from the
  // evidence the reader followed the link for.
  useEffect(() => {
    if (!oid) return;
    if (autoSelectRef.current.aid === aid && autoSelectRef.current.oid === oid) return;
    const object = objects.find((item) => item.id === oid);
    if (!object) return;
    autoSelectRef.current = { aid, oid };
    setSelection((current) =>
      current.some((item) => item.id === object.id) ? current : [...current, object],
    );
  }, [aid, oid, objects]);

  const toggle = useCallback((object: LearningObject, next: boolean) => {
    setSelection((current) =>
      next
        ? current.some((item) => item.id === object.id)
          ? current
          : [...current, object]
        : current.filter((item) => item.id !== object.id),
    );
  }, []);

  async function copyLink() {
    const link = new URL(hash.source(cid, aid, oid), location.href).href;
    try {
      await navigator.clipboard.writeText(link);
      toast("Exact source link copied.");
    } catch {
      toast("Copy the current address to share this source location.");
    }
  }

  const artifact = view?.artifact ?? null;
  const sheets = view?.sheets ?? [];
  const selectedIds = new Set(selection.map((object) => object.id));
  const backLabel = course && course.id === cid ? course.title : "Course";

  return (
    <Screen
      title={artifact?.filename ?? "Artifact"}
      back={{ href: hash.course(cid), label: backLabel }}
      meta={
        artifact
          ? `${artifact.kind.toUpperCase()} · version ${artifact.version} · ${plural(
              artifact.object_count,
              "object",
              "objects",
            )} · ${artifact.source_path}`
          : undefined
      }
      actions={
        artifact ? (
          <>
            <Button variant="ghost" onClick={() => void copyLink()}>
              <Link2 size={16} strokeWidth={1.75} aria-hidden />
              Copy source link
            </Button>
            <Button variant="secondary" asChild>
              <a href={api.artifactOriginalUrl(cid, aid)} download={artifact.filename}>
                <Download size={16} strokeWidth={1.75} aria-hidden />
                Download original
              </a>
            </Button>
          </>
        ) : undefined
      }
    >
      {artifact?.extraction_warnings.length ? (
        <p role="status" className="mb-4 text-meta text-warn">
          {artifact.extraction_warnings.join(" ")}
        </p>
      ) : null}

      {error ? (
        <Note tone="bad" className="mb-4">
          {error}
        </Note>
      ) : null}

      <div className="grid min-w-0 gap-6 min-[1360px]:grid-cols-[minmax(0,1fr)_var(--rail-w)]">
        <section ref={viewerRef} className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className="font-ui text-ui font-semibold text-ink">Source</h2>
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
              {sheets.length > 1 ? (
                <div className="flex items-center gap-2">
                  <Label htmlFor="artifact-sheet" className="text-meta text-ink-muted">
                    Sheet
                  </Label>
                  <Select value={sheet} onValueChange={(next) => void load({ sheet: next })}>
                    <SelectTrigger id="artifact-sheet">
                      <SelectValue placeholder="Sheet" />
                    </SelectTrigger>
                    <SelectContent>
                      {sheets.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <StateLine>
                {plural(objects.length, "object", "objects")} of{" "}
                {plural(view?.total_objects ?? objects.length, "object", "objects")} shown
              </StateLine>
            </div>
          </div>

          <ScrollArea className={`mt-2 ${PANE}`}>
            <div className="min-w-0 pb-2">
              {artifact ? (
                <ArtifactViewer
                  cid={cid}
                  aid={aid}
                  artifact={artifact}
                  objects={objects}
                  focusOid={oid}
                  selectedIds={selectedIds}
                  onToggle={toggle}
                />
              ) : loading ? (
                <div className="flex flex-col gap-3 p-3">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : (
                <EmptyState
                  title="Nothing to show"
                  description="This artifact has no readable source objects. The original is still downloadable above."
                />
              )}
              {/* Inside the scroll region, after the last object. Sibling of
                  the ScrollArea it sat below the pane's own height and drew on
                  top of the last object's disclosure — a real overlap, caught
                  by the layout gate. Here it cannot collide with anything, and
                  it appears where the reader has just run out of objects. */}
              {hasMore ? (
                <div className="mt-3 flex items-center gap-3 pb-2">
                  <Button
                    variant="secondary"
                    onClick={() => void load({ append: true, focus: oid })}
                    disabled={loading}
                  >
                    Load more source objects
                  </Button>
                  {loading ? <StateLine>Loading</StateLine> : null}
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </section>

        <aside className="min-w-0">
          <ScrollArea className={PANE}>
            <div className="flex min-w-0 flex-col gap-8 pb-2">
              {artifact?.kind === "xlsx" ? (
                <WorkbookPanel
                  cid={cid}
                  aid={aid}
                  sheet={sheet}
                  sheets={sheets}
                  selection={selection}
                />
              ) : null}
              {artifact?.kind === "ipynb" ? (
                <ExecutionPanel cid={cid} aid={aid} selection={selection} />
              ) : null}
              <AskPanel cid={cid} selection={selection} />
            </div>
          </ScrollArea>
        </aside>
      </div>
    </Screen>
  );
}

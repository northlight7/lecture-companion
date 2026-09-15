/**
 * The courses screen: the shelf of courses, and the way to make one.
 *
 * One plain grid of tiles in the reader's own order, after Canvas
 * (`.internal/DESIGN.md`, "The courses screen: a Canvas tile grid", which
 * replaces the kanban board of the day before). The grid, the tile and the
 * add-course dialog are their own files under `./courses/`.
 *
 * Two things the screen owns rather than the tiles:
 *
 *   - **the order.** `usePrefs` holds the reader's saved list, the grid renders
 *     `applyOrder(courses, prefs.order)`, and every move, dragged or from the
 *     tile's menu, writes back through `move()` and `update()`.
 *   - **the live region.** Making, deleting and reordering all change this
 *     list, so the grid sits inside one `aria-live` region and a move is also
 *     announced in words, which is what makes reordering possible from the
 *     keyboard rather than only with a pointer.
 *
 * The bulk "pile of files and no course yet?" flow is gone, with its drop zone,
 * its file inputs, its preview and both of its imports. Adding files happens
 * inside a course, which is where the human wants it (`.internal/DESIGN.md`,
 * "Removed by the human"). `createCourse` and `deleteCourse` stay.
 *
 * Deleting a course confirms through `AlertDialog` rather than
 * `window.confirm`, which never resolved inside the WKWebView.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import { LibraryBig } from "lucide-react";

import * as api from "@/lib/api";
import { applyOrder, move, updatePrefs, usePrefs } from "@/lib/prefs";
import type { CourseRow } from "@/lib/types";
import { useErrorHandler, useStore } from "@/state/store";
import { AddCourseDialog } from "@/screens/courses/AddCourseDialog";
import { CourseGrid } from "@/screens/courses/CourseGrid";
import { Screen } from "@/shell/Screen";
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
import { Spinner } from "@/components/ui/spinner";

export function CoursesScreen(): JSX.Element {
  const { courses, coursesError, reloadCourses } = useStore();
  const handle = useErrorHandler();
  const prefs = usePrefs();
  const [pendingDelete, setPendingDelete] = useState<CourseRow | null>(null);
  const [adding, setAdding] = useState(false);
  /** The last move, in words. It is the announcement as much as the note. */
  const [status, setStatus] = useState("");

  // The old router refetched the list on every visit to #/. The store loads it
  // once for the whole app, so the screen asks again when it mounts.
  useEffect(() => {
    void reloadCourses();
  }, [reloadCourses]);

  const ordered = useMemo(() => applyOrder(courses ?? [], prefs.order), [courses, prefs.order]);

  /**
   * One path for both ways of moving a tile. `move()` returns the saved order
   * unchanged when the move is a no-op, so that is what is checked rather than
   * the indices, and the position announced is where the tile ends up.
   */
  const reorder = (from: number, to: number) => {
    const ids = ordered.map((course) => course.id);
    const next = move(prefs.order, ids, from, to);
    if (next === prefs.order) return;
    const moved = ordered[from];
    updatePrefs({ order: next });
    if (moved) setStatus(`Moved ${moved.title} to position ${to + 1} of ${ids.length}.`);
  };

  const confirmDelete = async () => {
    const course = pendingDelete;
    if (!course) return;
    try {
      await api.deleteCourse(course.id);
      setStatus("");
      await reloadCourses();
    } catch (err) {
      handle(err);
    }
  };

  return (
    <Screen
      title="Your courses"
      masthead
      actions={
        <Button type="button" variant="primary" onClick={() => setAdding(true)}>
          Add course
        </Button>
      }
    >
      {/* The grid is what a live region has to announce: it is what changes
          when a course is made, deleted or moved. */}
      <div aria-live="polite">
        {status ? <p className="mb-4 text-meta text-ink-faint">{status}</p> : null}

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
            description="Start one with Add course, up in the corner. Its files go in from inside it."
            className="-mx-2 px-2 py-8"
          />
        ) : null}

        {ordered.length > 0 ? (
          <CourseGrid courses={ordered} onReorder={reorder} onDelete={setPendingDelete} />
        ) : null}
      </div>

      <AddCourseDialog open={adding} onOpenChange={setAdding} />

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
    </Screen>
  );
}

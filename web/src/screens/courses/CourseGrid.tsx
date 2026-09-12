/**
 * The courses grid: one plain grid of tiles, in the reader's own order.
 *
 * The three state columns are gone, with the grouping, the counts and the sort
 * that fed them (`.internal/DESIGN.md`, "The courses screen: a Canvas tile
 * grid"). The screen hands the tiles down already ordered, so this file is only
 * the shape of the shelf and the drag that rearranges it.
 *
 * Reordering is HTML5 drag and drop. Crossing another tile moves the tile in
 * flight to that position straight away, so the grid shows the result while the
 * pointer is still down. `lastTarget` is what keeps that stable: dragenter
 * keeps firing as the pointer moves inside one tile, and without the guard the
 * pair just swapped would swap straight back.
 *
 * Drop is handled on the grid rather than on the tile, so the gaps between
 * tiles are part of the target and a drop that lands on one simply ends the
 * drag where the live order already put the tile.
 *
 * The track list is the one the board used, with no column semantics attached:
 * one to three columns by content width, and at three columns across a full
 * content column a tile is still wider than the 260px floor.
 */

import { useRef, useState, type DragEvent, type JSX } from "react";

import type { CourseRow } from "@/lib/types";
import { CourseTile } from "@/screens/courses/CourseTile";

export function CourseGrid({
  courses,
  onReorder,
  onDelete,
}: {
  /** In the reader's saved order: `applyOrder` already ran in the screen. */
  courses: CourseRow[];
  /** The reader moved the tile at `from` to position `to`. */
  onReorder: (from: number, to: number) => void;
  onDelete: (course: CourseRow) => void;
}): JSX.Element {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const lastTarget = useRef<string | null>(null);

  // Derived from the ordered list every render, so a course added or deleted
  // mid-drag cannot leave a stale position behind.
  const ids = courses.map((course) => course.id);

  const endDrag = () => {
    setDraggingId(null);
    setOverId(null);
    lastTarget.current = null;
  };

  const startDrag = (courseId: string) => {
    setDraggingId(courseId);
    setOverId(null);
    lastTarget.current = null;
  };

  const dragEnterTile = (courseId: string) => {
    if (!draggingId || courseId === draggingId || lastTarget.current === courseId) return;
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(courseId);
    if (from === -1 || to === -1) return;
    lastTarget.current = courseId;
    setOverId(courseId);
    onReorder(from, to);
  };

  return (
    <ul
      className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3"
      onDragOver={(event: DragEvent<HTMLUListElement>) => {
        if (!draggingId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event: DragEvent<HTMLUListElement>) => {
        event.preventDefault();
        endDrag();
      }}
      onDragEnd={endDrag}
    >
      {courses.map((course, index) => (
        <CourseTile
          key={course.id}
          course={course}
          index={index}
          total={courses.length}
          dragging={draggingId === course.id}
          dropTarget={overId === course.id}
          onMove={onReorder}
          onDelete={onDelete}
          onDragStart={startDrag}
          onDragEnterTile={dragEnterTile}
        />
      ))}
    </ul>
  );
}

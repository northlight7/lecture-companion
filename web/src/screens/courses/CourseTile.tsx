/**
 * One course, as a tile on the shelf.
 *
 * After Canvas: a coloured cover across the top in the course's own accent,
 * carrying the course's monogram with an overflow menu in its corner, then the
 * title in that accent and the course's two counts on a footer rail. No state
 * word and no progress bar: progress is what the course screen is for, and this
 * grid is a shelf (`.internal/DESIGN.md`, "The courses screen: a Canvas tile
 * grid").
 *
 * WHAT CHANGED, AND WHY IT READ AS CRUDE. The first version was a 192px tile
 * with a single run-on metadata line, and the whole of its lower half was one
 * two-line title with a sentence under it that ran out at the tile's edge. A
 * card whose content stops mid-air has no base, and the eye reads the missing
 * base as an unfinished card rather than as a small one. Three things give it
 * one:
 *
 *   * The counts are a FOOTER RAIL, ruled off from the title by a hairline and
 *     pinned to the bottom edge, instead of a sentence following the title.
 *     Labelled figures with tabular numerals read as a shelf label. The run-on
 *     line did not, and it also repeated the word "slides" on every tile.
 *   * The tile is 224px rather than 192, so the cover keeps its share and the
 *     body stops being a slot the title barely fits into.
 *   * It is a SURFACE that lifts, not a rectangle that changes colour. Hover
 *     and focus move it half a pixel up onto the float level and give it the
 *     float's shadow, which is the one place in the app a shadow is allowed and
 *     the one place a pointer is guaranteed to be. Banned-list entry 18 said
 *     "no shadow outside the float level" and this does not break it: the tile
 *     IS at the float level while it is hovered.
 *
 * The cover is not decoration and it is not a bare colour. The accent palette
 * holds lightness constant by design, which spends the one non-colour channel
 * WCAG 1.4.1 would otherwise accept, so the chip has to carry the course's own
 * text: banned list entry 20, stated at entry 4. See `courseMonogram`.
 *
 * The tile is a link, but not one `<a>` around everything: a menu button cannot
 * live inside a link. The title carries a real anchor and a stretched `::after`
 * pseudo-element covers the tile, so the whole surface opens the course, while
 * the menu is lifted above the overlay (`relative z-10`) so its own clicks and
 * its own focus ring are its own.
 *
 * A tile is draggable, and the menu carries `Move earlier` and `Move later` for
 * the readers who have no pointer. Both go through the same `onMove`, so there
 * is one ordering path and not two.
 */

import type { DragEvent, JSX } from "react";
import { MoreVertical } from "lucide-react";

import { ACCENT_FILL, ACCENT_INK, courseAccent } from "@/lib/accents";
import { hash } from "@/lib/router";
import type { CourseRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Words a monogram is allowed to skip: articles, conjunctions and the short
 * prepositions. A title's shape is carried by its nouns, so `Ethics and
 * Regulations` is `ER` and not `EA`, and `Introduction to Programming` is `IP`.
 * Nothing longer is dropped: `with`, `for` and `into` are here because they
 * carry no meaning on their own, while `data`, `using` and `systems` are the
 * course and stay.
 */
const MONOGRAM_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "in",
  "on",
  "at",
  "by",
  "to",
  "for",
  "from",
  "with",
  "or",
  "as",
  "into",
  "over",
  "under",
  "is",
  "are",
  "&",
  "+",
]);

/**
 * What a course with no usable title wears. Not an emoji, not an image, not an
 * empty box: the course mark, `C`, which is the one thing that is true of a
 * course whose title is blank. `app/main.py` refuses to create a course without
 * a title and `app/course.py` substitutes the id for a blank one, so this is a
 * last line of defence against data written by something other than the API
 * rather than a state the app reaches on its own.
 */
const MONOGRAM_FALLBACK = "C";

/**
 * The course's monogram: the initials it wears on its accent cover.
 *
 * Deterministic, and derived from the title alone, so the same course wears the
 * same mark on every render. At most three characters, because this is a mark
 * and not an abbreviated title, and a title of one significant word gives one
 * character.
 *
 * The split is on anything that is not a letter or a digit, which is what keeps
 * the mark out of the banned list's way: a title that is one emoji yields no
 * words at all and takes the fallback, so no picture can ever reach the cover
 * (entry 4), and punctuation cannot either.
 *
 * Exported because it is a pure function of the title, which is what lets the
 * round's checks assert the mark rather than read it off a screenshot.
 */
export function courseMonogram(title: string): string {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
  const significant = words.filter((word) => !MONOGRAM_STOP_WORDS.has(word.toLowerCase()));
  // `The` is all stop words and no course. It keeps its own initial rather than
  // falling through to the fallback, because it is the title the reader chose.
  const source = significant.length > 0 ? significant : words;
  const initials = source
    .slice(0, 3)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
  // Uppercased before the cap, not after: a lowercase character can grow when it
  // uppercases (`ß` is `SS`), and the cap is on the characters that render.
  const monogram = initials.toUpperCase().slice(0, 3);
  return monogram || MONOGRAM_FALLBACK;
}

/** One labelled figure on the footer rail. */
function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-meta font-medium tracking-[0.06em] text-ink-faint uppercase">
        {label}
      </dt>
      <dd className="text-lead leading-none tabular-nums text-ink">
        {value === 0 ? <span className="text-ink-faint">None</span> : value}
      </dd>
    </div>
  );
}

export function CourseTile({
  course,
  index,
  total,
  dragging,
  dropTarget,
  onMove,
  onDelete,
  onDragStart,
  onDragEnterTile,
}: {
  course: CourseRow;
  /** Where the tile sits now, and how many there are, for the move items. */
  index: number;
  total: number;
  /** This tile is the one in flight. */
  dragging: boolean;
  /** This tile is where the tile in flight will land. */
  dropTarget: boolean;
  /** Move the tile at `from` to position `to`. The screen owns the order. */
  onMove: (from: number, to: number) => void;
  onDelete: (course: CourseRow) => void;
  onDragStart: (courseId: string) => void;
  onDragEnterTile: (courseId: string) => void;
}): JSX.Element {
  const accent = courseAccent(course.id);
  const href = hash.course(course.id);
  const first = index === 0;
  const last = index === total - 1;

  const startDrag = (event: DragEvent<HTMLLIElement>) => {
    // Firefox refuses to start a drag whose transfer carries nothing, and the
    // drag itself never needs the payload: the grid tracks the source by id.
    event.dataTransfer.setData("text/plain", course.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(course.id);
  };

  return (
    <li
      draggable
      onDragStart={startDrag}
      onDragEnter={() => onDragEnterTile(course.id)}
      className={cn(
        "group relative flex h-56 flex-col overflow-hidden rounded-pnl border border-hair bg-raised",
        "transition-[transform,background-color,box-shadow,border-color] duration-[160ms] ease-[var(--ease)]",
        // The lift. `focus-within` as well as `hover`, so a reader on the
        // keyboard gets the same feedback as a reader on the pointer: the tile
        // that is about to open is the one standing off the shelf.
        "hover:translate-y-[var(--lift)] hover:bg-hover hover:shadow-lift",
        "focus-within:translate-y-[var(--lift)] focus-within:bg-hover focus-within:shadow-lift",
        // The tile in flight fades and stays put: a lift on the thing already
        // under the pointer reads as a second drag ghost.
        dragging ? "opacity-50" : null,
        dropTarget ? "outline-2 outline-solid outline-focus" : null,
      )}
    >
      {/* The cover is a real 40 per cent of the tile: the tile's height is
          fixed, so the percentage has a definite box to resolve against, and
          everything on the tile is bounded anyway, a two-line title and the
          footer rail. An absolutely positioned menu button would otherwise
          collapse an unresolved percentage to nothing. */}
      <div
        className={cn(
          "relative flex h-[40%] shrink-0 items-end p-4 pr-14",
          ACCENT_FILL[accent],
        )}
      >
        {/* The monogram. Banned list entry 20: no accent chip without the
            course's monogram or short label in it, because the palette holds
            lightness constant and so spends the one non-colour channel WCAG
            1.4.1 accepts. `--on-accent` is the text every fill is measured
            against at 4.5:1, so this is the second channel that entry asks for.
            `aria-hidden`, because it is the title's own initials and the title
            is the next thing down the tile: a reader on a screen reader should
            not hear `AEB` and then the words it stands for.
            `pr-14` on the cover reserves the menu's column, so the mark is
            clear of the button however long it gets, and `items-end` puts it on
            the cover's bottom edge, as far from that button as the block
            allows. */}
        <span
          aria-hidden
          className="font-ui text-head leading-none font-semibold tracking-[0.02em] text-on-accent"
        >
          {courseMonogram(course.title)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${course.title}`}
              // `relative z-10` is load-bearing, not decoration. The whole
              // tile opens the course through a stretched `::after` on the
              // title, and that overlay is a positioned element with an
              // automatic z-index. The cover block comes before the body in
              // the DOM, so without lifting this button the overlay paints
              // over it and every click on the menu navigates into the course
              // instead of opening the menu. Measured in the bundle: the click
              // landed on the tile's link.
              //
              // On the course's fill, so the icon is `--on-accent`, which every
              // fill is measured against. Hovered, it becomes a row of the
              // raised surface it is drawn on.
              className="absolute right-2 top-2 z-10 text-on-accent hover:bg-hover hover:text-ink"
            >
              <MoreVertical size={16} strokeWidth={1.75} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem]">
            <DropdownMenuItem asChild>
              <a href={href}>Open</a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={first} onSelect={() => onMove(index, index - 1)}>
              Move earlier
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last} onSelect={() => onMove(index, index + 1)}>
              Move later
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-bad" onSelect={() => onDelete(course)}>
              Delete course…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {/* Sans, because the tile is chrome: DESIGN.md reserves serif for the
            reading column and puts "every heading that sits in chrome rather
            than in the reading column" in sans. The title owns the space above
            the rail, so a one-line title leaves the rail where a two-line one
            does and the counts line up across the shelf. */}
        <h3 className="font-ui text-lead leading-snug font-semibold">
          <a
            href={href}
            className={cn(
              "line-clamp-2 after:absolute after:inset-0 after:content-['']",
              ACCENT_INK[accent],
            )}
          >
            {course.title}
          </a>
        </h3>
        <dl className="mt-auto flex items-end gap-6 border-t border-hair pt-3">
          <Stat label="Decks" value={course.n_decks} />
          <Stat label="Slides" value={course.n_slides} />
        </dl>
      </div>
    </li>
  );
}

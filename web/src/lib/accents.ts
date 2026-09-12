/**
 * The course accent palette.
 *
 * Six hues, derived and enforced by `.internal/derive_accents.py` so that every
 * one of them meets the rules in `web/src/tokens.css` in both themes rather
 * than being picked by eye. Each name is the hue it actually is, in OKLCH hue
 * order: 48 orange, 99 olive, 150 green, 200 teal, 251 blue, 302 violet. A
 * course takes one from its id, so its colour is the same on every screen, in
 * every session, and after a reload: a course that changed colour would be
 * worse than a course with no colour at all.
 *
 * Class names are written out in full below. Tailwind only emits a utility it
 * can see in the source, so building one at runtime (`bg-course-${name}-fill`)
 * would silently produce no CSS at all.
 */
export const COURSE_ACCENTS = ["orange", "olive", "green", "teal", "blue", "violet"] as const;

export type CourseAccent = (typeof COURSE_ACCENTS)[number];

/** A hue for a course id on its own. FNV-1a, so the same id always lands the
 *  same. This is the starting point, not the answer: see below. */
function hashAccent(courseId: string): CourseAccent {
  let hash = 0x811c9dc5;
  for (let index = 0; index < courseId.length; index += 1) {
    hash ^= courseId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return COURSE_ACCENTS[hash % COURSE_ACCENTS.length] ?? "blue";
}

/**
 * The hue each course is drawn in, by id, assigned from the whole set.
 *
 * Hashing the id alone cannot satisfy "a different colour for each course".
 * On the real five courses it produced three amber and two rose, so the courses
 * screen showed two colours across five tiles. That is the birthday problem,
 * not bad luck: with six hues and five items a collision is near-certain, and
 * no better hash avoids it. What is missing is knowledge of what else is on
 * screen, so the assignment has to be made from the set.
 *
 * Courses are assigned in sorted-id order, which makes this a pure function of
 * the SET rather than of the order they are displayed in. Three consequences:
 * adding a course gives the new one a free hue and leaves every other course
 * alone, DRAGGING a tile to reorder the grid does not change anybody's colour,
 * and DELETING a course can hand a hue to another course that had probed past
 * it. The last one is the price of a set-dependent assignment, and a colour
 * that moves when some other course is deleted is worth it against two courses
 * wearing the same colour. Persisting the map instead would fix it and costs
 * more than it is worth here.
 *
 * Each course starts at its own hash hue and walks forward to the next free
 * one, so the result stays as close to the old per-id colours as a
 * collision-free assignment allows. Past six courses the hues must repeat, and
 * the seventh onward takes its hash hue.
 */
const assigned = new Map<string, CourseAccent>();

export function assignCourseAccents(courseIds: readonly string[]): void {
  assigned.clear();
  const taken = new Set<CourseAccent>();
  for (const id of [...courseIds].sort()) {
    const start = COURSE_ACCENTS.indexOf(hashAccent(id));
    let pick: CourseAccent | undefined;
    for (let step = 0; step < COURSE_ACCENTS.length; step += 1) {
      const candidate = COURSE_ACCENTS[(start + step) % COURSE_ACCENTS.length];
      if (candidate !== undefined && !taken.has(candidate)) {
        pick = candidate;
        break;
      }
    }
    pick ??= hashAccent(id);
    taken.add(pick);
    assigned.set(id, pick);
  }
}

/**
 * The one way any screen asks for a course's colour, so a course cannot be one
 * hue on the grid and another in the sidebar. Falls back to the id hash for a
 * course the current set does not contain, which happens only before the list
 * has loaded.
 */
export function courseAccent(courseId: string): CourseAccent {
  return assigned.get(courseId) ?? hashAccent(courseId);
}

/** The band and progress fill. Carries `--on-accent` text when it does. */
export const ACCENT_FILL: Record<CourseAccent, string> = {
  orange: "bg-course-orange-fill",
  olive: "bg-course-olive-fill",
  green: "bg-course-green-fill",
  teal: "bg-course-teal-fill",
  blue: "bg-course-blue-fill",
  violet: "bg-course-violet-fill",
};

/** The same hue as text or as a thin graphic on a ground. */
export const ACCENT_INK: Record<CourseAccent, string> = {
  orange: "text-course-orange-ink",
  olive: "text-course-olive-ink",
  green: "text-course-green-ink",
  teal: "text-course-teal-ink",
  blue: "text-course-blue-ink",
  violet: "text-course-violet-ink",
};

export const ACCENT_BORDER: Record<CourseAccent, string> = {
  orange: "border-course-orange-ink",
  olive: "border-course-olive-ink",
  green: "border-course-green-ink",
  teal: "border-course-teal-ink",
  blue: "border-course-blue-ink",
  violet: "border-course-violet-ink",
};

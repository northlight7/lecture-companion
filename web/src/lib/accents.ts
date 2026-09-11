/**
 * The course accent palette.
 *
 * Six hues, derived by `.internal/derive_accents.py` so that every one of them
 * meets the floors in `DESIGN.md` in both themes rather than being picked by
 * eye. A course takes one from its id, so its colour is the same on every
 * screen, in every session, and after a reload: a course that changed colour
 * would be worse than a course with no colour at all.
 *
 * Class names are written out in full below. Tailwind only emits a utility it
 * can see in the source, so building one at runtime (`bg-course-${name}-fill`)
 * would silently produce no CSS at all.
 */
export const COURSE_ACCENTS = ["blue", "teal", "green", "amber", "rose", "violet"] as const;

export type CourseAccent = (typeof COURSE_ACCENTS)[number];

/** A stable hue for a course. FNV-1a, so the same id always lands the same. */
export function courseAccent(courseId: string): CourseAccent {
  let hash = 0x811c9dc5;
  for (let index = 0; index < courseId.length; index += 1) {
    hash ^= courseId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return COURSE_ACCENTS[hash % COURSE_ACCENTS.length] ?? "blue";
}

/** The band and progress fill. Carries `--on-accent` text when it does. */
export const ACCENT_FILL: Record<CourseAccent, string> = {
  blue: "bg-course-blue-fill",
  teal: "bg-course-teal-fill",
  green: "bg-course-green-fill",
  amber: "bg-course-amber-fill",
  rose: "bg-course-rose-fill",
  violet: "bg-course-violet-fill",
};

/** The same hue as text or as a thin graphic on a ground. */
export const ACCENT_INK: Record<CourseAccent, string> = {
  blue: "text-course-blue-ink",
  teal: "text-course-teal-ink",
  green: "text-course-green-ink",
  amber: "text-course-amber-ink",
  rose: "text-course-rose-ink",
  violet: "text-course-violet-ink",
};

export const ACCENT_BORDER: Record<CourseAccent, string> = {
  blue: "border-course-blue-ink",
  teal: "border-course-teal-ink",
  green: "border-course-green-ink",
  amber: "border-course-amber-ink",
  rose: "border-course-rose-ink",
  violet: "border-course-violet-ink",
};

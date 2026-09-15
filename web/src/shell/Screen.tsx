import { ChevronLeft } from "lucide-react";
import { useId, type ReactNode } from "react";

import { SECTION_INK, SECTION_LINE, SECTION_RULE, type SectionAccent } from "@/lib/accents";
import { cn } from "@/lib/utils";

export type { SectionAccent };

/**
 * Every screen's page frame. One left edge, one right edge, one vertical
 * rhythm, so no screen reads as if a different person built it.
 *
 * There is no toolbar. The title lives in the content and scrolls with it,
 * which is what both reference apps do.
 */
export function Screen({
  title,
  back,
  lede,
  actions,
  meta,
  titleClassName,
  rule,
  masthead = false,
  children,
  className,
}: {
  title: string;
  back?: { href: string; label: string };
  lede?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  /** Merged onto the `h1`. A course screen tints its own title with its
   *  course's accent; the heading belongs to this frame, so the class is
   *  passed in rather than reached for from outside. */
  titleClassName?: string;
  /** A course screen passes its own accent fill. A short rule under the title
   *  is the one mark that says which course this page belongs to, without
   *  tinting a surface the reader has to read through. */
  rule?: string;
  /** Draw the title row as an ISLAND rather than as text on the ground.
   *
   *  A screen whose title sits directly on the ground has nothing under it and
   *  reads as bare: it was reported as "just sitting there naked with no island
   *  or border or underline or anything". A screen that passes this gets the
   *  same masthead every `Section` draws, in the first section hue, so the
   *  frame's own heading is a member of the same family as the headings below
   *  it rather than a special case. The screen's `rule` is not used with it:
   *  the island draws its own accent rule under the title, because the island
   *  has an accent and the fill under the rule is the island's, not a ground. */
  masthead?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const heading = (
    <div className="min-w-0 flex-1">
      <h1
        tabIndex={-1}
        className={cn(
          "font-ui text-display leading-[1.15] font-semibold text-ink focus-target",
          titleClassName,
        )}
      >
        {title}
      </h1>
      {meta ? <div className="mt-2 text-meta text-ink-faint">{meta}</div> : null}
      {masthead ? (
        // Concatenated, not merged: tailwind-merge does not know `text-head` is
        // a size, and `Section` learned the same lesson. This is a `bg-*` and a
        // size, so `cn` would be safe here, and it is written the same way as
        // the island below so the two cannot drift.
        <div aria-hidden className={"mt-4 h-[3px] w-14 rounded-ctl " + SECTION_RULE.blue} />
      ) : rule ? (
        <div aria-hidden className={cn("mt-4 h-[3px] w-14 rounded-ctl", rule)} />
      ) : null}
    </div>
  );

  return (
    <div className={cn("page-column pt-6 pb-16", className)}>
      {/* THE WAY BACK IS A CONTROL, NOT A LINE OF TEXT.
        *
        * It was a bare link: a chevron and a label in `--ink-muted`, sitting on
        * the content ground with nothing under them. The owner's words for it
        * were that it "has no tile/island of its own and looks barely
        * noticeable". Nothing about it said it could be pressed.
        *
        * It is now a level-1 panel: `--surface-raised` for the fill, so it is
        * visibly a surface resting on the ground, 1px `--line-control` for the
        * boundary, which is the token this project's control-boundary rule
        * assigns to an outlined control and which `check_contrast.py` measures
        * at or above 3:1 on that fill, and `--radius-control`, because it is a
        * control and not a row. The label is `--ink` rather than
        * `--ink-muted`: it is the control's own name, and the muted step is for
        * metadata beside a thing rather than for the thing itself. Hover moves
        * the fill one step up the surface table, the same step every other
        * control in the app takes. Focus is the global rule and is not
        * overridden here. */}
      {back ? (
        <a
          href={back.href}
          className={cn(
            "mb-4 inline-flex h-[var(--control-h)] items-center gap-1.5 rounded-ctl border border-line bg-raised px-3",
            "font-ui text-ui text-ink transition-colors duration-[120ms] ease-[var(--ease)] hover:bg-hover",
          )}
        >
          {/* The chevron takes the control's own ink rather than the muted
            * step. Every other icon in a button in this app is drawn in its
            * button's label colour (`Delete course`'s bin is the same
            * `--meaning-bad` as its word), and a critic measured this one at
            * `--ink-muted` inside an `--ink` label: it read as dimmed, and it
            * is the control's only directional cue. */}
          <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          {back.label}
        </a>
      ) : null}

      {masthead ? (
        <section
          data-section="blue"
          aria-label={title}
          className={cn(
            "flex flex-wrap items-start justify-between gap-x-6 gap-y-4 rounded-pnl border bg-raised px-6 py-5",
            SECTION_LINE.blue,
          )}
        >
          {heading}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </section>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          {heading}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      )}

      {lede ? (
        <p className="mt-3 max-w-[60ch] text-lead text-ink-muted">{lede}</p>
      ) : null}

      <div className="mt-8">{children}</div>
    </div>
  );
}

/**
 * A titled run of content inside a screen, drawn as its own ISLAND.
 *
 * An island is a level-1 surface: `--surface-raised` with its own 1px boundary
 * and its own radius, resting on the content ground. What separates it from the
 * next island is ground, never a border between the two, and `--space-6` (32px)
 * of it, which is twice the 16px the reader needs to read them as two objects.
 * `DESIGN.md`, "The section island and its accent", states the model value for
 * value, and this is the component that draws it.
 *
 * The boundary and the heading carry the section's own pastel accent, from the
 * `--sect-<hue>-line` / `--sect-<hue>-ink` family. Both are measured against
 * the island's own fill by `check_contrast.py`, in both themes: the line clears
 * 3:1 there as a graphic, the heading ink clears 4.5:1 there as text.
 *
 * `data-section` carries the accent's name, so a section is identifiable from
 * the DOM as well as by its heading, and the heading's `id` names the region
 * for a screen reader. Those two together are what make an island findable
 * rather than merely visible.
 */
export function Section({
  title,
  action,
  accent = "blue",
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  accent?: SectionAccent;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      data-section={accent}
      aria-labelledby={headingId}
      className={cn(
        "mt-8 first:mt-0 rounded-pnl border bg-raised",
        SECTION_LINE[accent],
        className,
      )}
    >
      {/* The heading row is the island's masthead: the title in the section's
        * accent, the section's action on the right, and a hairline ruling it
        * off from the content it introduces. The 3px rule under the title is
        * the same mark the course screen puts under its own title, in the same
        * family, so the two read as one system rather than as two. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-hair px-6 pt-4 pb-3">
        <div className="min-w-0">
          <h2
            id={headingId}
            // Deliberately not `cn()`. tailwind-merge does not know that
            // `text-head` is a font size rather than a colour, so merging it
            // with a colour class drops the size and the heading renders at the
            // inherited one. Concatenation keeps both, and the size stays the
            // scale's.
            className={"font-ui text-head font-semibold " + SECTION_INK[accent]}
          >
            {title}
          </h2>
          <div
            aria-hidden
            className={"mt-2 h-[3px] w-12 rounded-ctl " + SECTION_RULE[accent]}
          />
        </div>
        {action}
      </div>
      <div className="px-6 py-4">{children}</div>
    </section>
  );
}

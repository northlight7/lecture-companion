import { Library } from "lucide-react";

import { cn } from "@/lib/utils";
import { resumeIndex } from "@/lib/prefs";
import { hash, type Route } from "@/lib/router";
import { ACCENT_FILL, courseAccent } from "@/lib/accents";
import { useStore } from "@/state/store";
import { NavRow, SectionLabel, SidebarFoot, SidebarFrame, SidebarScroll } from "@/shell/Chrome";
import { SidebarToggle } from "@/shell/SidebarToggle";
import { ProgressRing } from "@/screens/course/Progress";

/**
 * The chrome. Every course, the decks of the course you are in, and how far
 * that course has been explained.
 *
 * This is the whole of the app's navigation. There is no toolbar and no window
 * title: the traffic lights are drawn over the strip above these rows, so the
 * sidebar is where the window's identity lives.
 *
 * The ring is the count the course screen no longer prints. It belongs on this
 * side of the window because it is about the course rather than about a block
 * of the page, and because it is the only number a reader wants while they are
 * reading a slide in the viewer: the chrome does not scroll away.
 */
export function Sidebar({
  route,
  onOpenConnect,
  onToggleCollapsed,
  withToggle = true,
}: {
  route: Route;
  onOpenConnect: () => void;
  onToggleCollapsed: () => void;
  /** Draw the control that hides this sidebar in its own top strip.
   *
   *  The shell's sidebar always does. The viewer's overlay does not: the
   *  control that opened it is in the header, directly under the reader's
   *  pointer, and a second one inside the panel would sit 10 points right and
   *  14 points above it. `DESIGN.md` records the intent for the shell's
   *  collapse in those words: the toggle "sits at the same point on the window
   *  in both states and does not travel under the pointer". A control that
   *  opens a panel and then moves is the same defect with an extra step.
   *
   *  The strip itself stays, because it is what the window is dragged by and
   *  what the traffic lights are drawn over, and it stays a drag region. */
  withToggle?: boolean;
}) {
  const { courses, course, connection, progress } = useStore();

  const activeDeck = route.name === "viewer" ? route.did : null;
  const inCourse = route.name !== "courses";

  // The course the reader is in, guarded the same way the course screen guards
  // it: a payload for another course must never paint here either, and the ring
  // must not report one course's slides while another is open.
  const current =
    inCourse && "cid" in route && course && course.id === route.cid ? course : null;
  // The live poll wins over the stored count, exactly as it does on the screen.
  const shown = progress ?? current?.progress ?? null;

  return (
    <SidebarFrame
      top={
        withToggle ? (
          // `titlebar-control`, because the strip it sits in is a drag region.
          // Without it the window's own drag handler takes the press.
          <SidebarToggle
            collapsed={false}
            onToggle={onToggleCollapsed}
            className="titlebar-control"
          />
        ) : null
      }
    >
      <SidebarScroll>
        <NavRow href={hash.courses()} current={!inCourse}>
          <span className="flex items-center gap-2">
            <Library size={14} strokeWidth={1.75} aria-hidden />
            Courses
          </span>
        </NavRow>

        {courses && courses.length > 0 ? (
          <div className="mt-1 flex flex-col">
            {courses.map((row) => (
              <NavRow
                key={row.id}
                href={hash.course(row.id)}
                current={route.name !== "courses" && "cid" in route && route.cid === row.id}
                accent={ACCENT_FILL[courseAccent(row.id)]}
                className="pl-7"
              >
                {row.title}
              </NavRow>
            ))}
          </div>
        ) : null}

        {course && course.decks.length > 0 ? (
          <>
            <SectionLabel>Decks</SectionLabel>
            <div className="flex flex-col">
              {course.decks.map((deck) => (
                <NavRow
                  key={deck.id}
                  // NOT slide 0: the deck opens where the reader left it, so a
                  // 173-slide deck does not have to be scrubbed back to by
                  // hand. `resumeIndex` clamps against the deck's own length.
                  href={hash.deck(course.id, deck.id, resumeIndex(course.id, deck.id, deck.n_slides))}
                  current={activeDeck === deck.id}
                  className="pl-7"
                >
                  {deck.title}
                </NavRow>
              ))}
            </div>
          </>
        ) : null}
      </SidebarScroll>

      <SidebarFoot>
        {/* Below the deck rows and above the connection row, and in the foot
            rather than in the scroll region above it: the chrome must not move
            when the reader scrolls a list, and a count is chrome. */}
        {current && shown ? (
          <div className="flex items-center gap-3 px-2 pb-2">
            <ProgressRing
              done={shown.n_explained}
              total={shown.n_slides}
              accent={courseAccent(current.id)}
            />
            <p className="text-meta font-medium tracking-[0.06em] text-ink-faint uppercase">
              Slides explained
            </p>
          </div>
        ) : null}
        <ConnectionRow connection={connection} onClick={onOpenConnect} />
      </SidebarFoot>
    </SidebarFrame>
  );
}

function ConnectionRow({
  connection,
  onClick,
}: {
  connection: ReturnType<typeof useStore>["connection"];
  onClick: () => void;
}) {
  const { label, tone } = describe(connection);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className={cn(
        "flex h-[var(--row-h)] w-full items-center gap-2 rounded-srf px-2 text-left text-ui",
        "transition-colors duration-[120ms] ease-[var(--ease)] hover:bg-chrome-hover",
      )}
    >
      <span
        aria-hidden
        className={cn(
          // rounded-ctl on a 7px box clamps to a true circle, and keeps the
          // radius scale closed: no element picks a radius of its own.
          "size-[7px] shrink-0 rounded-ctl",
          tone === "ok" && "bg-good",
          tone === "demo" && "bg-warn",
          tone === "off" && "bg-ink-faint",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-ink-muted">{label}</span>
    </button>
  );
}

function describe(connection: ReturnType<typeof useStore>["connection"]): {
  label: string;
  tone: "ok" | "demo" | "off";
} {
  if (!connection) return { label: "Server unreachable", tone: "off" };
  if (connection.fake) return { label: "Offline demo mode", tone: "demo" };
  if (connection.connected) return { label: `Connected ${connection.hint}`, tone: "ok" };
  return { label: "Not connected", tone: "off" };
}

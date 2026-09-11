import { Library } from "lucide-react";

import { cn } from "@/lib/utils";
import { hash, type Route } from "@/lib/router";
import { ACCENT_FILL, courseAccent } from "@/lib/accents";
import { useStore } from "@/state/store";
import { NavRow, SectionLabel, SidebarFoot, SidebarFrame, SidebarScroll } from "@/shell/Chrome";

/**
 * The chrome. Every course, and the decks of the course you are in.
 *
 * This is the whole of the app's navigation. There is no toolbar and no window
 * title: the traffic lights are drawn over the strip above these rows, so the
 * sidebar is where the window's identity lives.
 */
export function Sidebar({ route, onOpenConnect }: { route: Route; onOpenConnect: () => void }) {
  const { courses, course, connection } = useStore();

  const activeDeck = route.name === "viewer" ? route.did : null;
  const inCourse = route.name !== "courses";

  return (
    <SidebarFrame>
      <SidebarScroll>
        <NavRow href={hash.courses()} current={!inCourse}>
          <span className="flex items-center gap-2">
            <Library size={14} strokeWidth={1.75} aria-hidden />
            Courses
          </span>
        </NavRow>

        {courses && courses.length > 0 ? (
          <div className="mt-0.5 flex flex-col">
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
                  href={hash.deck(course.id, deck.id, 0)}
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

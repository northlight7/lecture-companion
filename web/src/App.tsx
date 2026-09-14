import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useRoute, type Route } from "@/lib/router";
import { usePrefs, usePrefsUpdater } from "@/lib/prefs";
import {
  DEFAULT_LEVEL,
  FS_LEVELS,
  clampLevel,
  levelDelta,
  shiftIsTheKey,
} from "@/lib/typography";
import { ConnectProvider, StoreProvider } from "@/state/store";
import { AppShell } from "@/shell/AppShell";
import { Sidebar } from "@/shell/Sidebar";
import { Toaster } from "@/components/ui/toaster";
import { ConnectDialog } from "@/screens/ConnectDialog";
import { CoursesScreen } from "@/screens/CoursesScreen";
import { CourseScreen } from "@/screens/CourseScreen";
import { ViewerScreen } from "@/screens/ViewerScreen";
import { ArtifactScreen } from "@/screens/ArtifactScreen";

export function App() {
  const route = useRoute();
  const [connectOpen, setConnectOpen] = useState(false);
  const openConnect = useCallback(() => setConnectOpen(true), []);
  // Collapsing the sidebar is a preference, not a route: it survives a
  // relaunch the same way the course order does.
  const prefs = usePrefs();
  const updatePrefs = usePrefsUpdater();
  const toggleCollapsed = useCallback(
    () => updatePrefs({ collapsed: !prefs.collapsed }),
    [prefs.collapsed, updatePrefs],
  );

  const cid = route.name === "courses" ? null : route.cid;

  const fsLevel = clampLevel(prefs.fsLevel);
  const readLevel = clampLevel(prefs.readLevel);

  /**
   * The two text sizes, written onto the DOCUMENT ELEMENT.
   *
   * `--fs-scale` is the app's, and every one of the six `--fs-*` steps in
   * `tokens.css` is that multiplied by its own base size. `--fs-read-scale` is
   * the explanation pane's, and the pane's six multiply both. Both live on the
   * root rather than on a wrapper, so nothing between the root and the text can
   * shadow them, and the pane cannot be given a scale the rest of the app does
   * not know about.
   *
   * A layout effect, not an effect: the level is already known at the first
   * render, and applying it after paint shows the reader the default size for
   * a frame before their own choice replaces it.
   */
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--fs-scale", String(FS_LEVELS[fsLevel]));
    root.style.setProperty("--fs-read-scale", String(FS_LEVELS[readLevel]));
  }, [fsLevel, readLevel]);

  /**
   * `Cmd` and `+` one level up, `Cmd` and `-` one level down, `Cmd` and `0`
   * back to the default. The keys are bound on the document because the size is
   * the app's and every screen has it, the viewer included, which is not inside
   * the shell.
   *
   * The guard is the same one `ViewerScreen`'s arrow keys use, for the same
   * reason: a reader typing in a field or in the scratchpad is writing, not
   * asking for a bigger font. `Cmd` is the whole chord, so a second modifier
   * refuses, and Shift is tolerated only where it is producing the key itself
   * (`+` and `_` need it on the layouts that put them above `=` and `-`).
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      if (event.ctrlKey || event.altKey) return;
      if (event.shiftKey && !shiftIsTheKey(event.key)) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase() ?? "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target?.isContentEditable) return;
      const delta = levelDelta(event.key);
      if (delta === null) return;
      event.preventDefault();
      const next = delta === 0 ? DEFAULT_LEVEL : clampLevel(fsLevel + delta);
      // At either end the level is already what the key asks for, so nothing is
      // written and nothing re-renders.
      if (next !== fsLevel) updatePrefs({ fsLevel: next });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fsLevel, updatePrefs]);

  useFocusOnScreenChange(route);

  /**
   * The viewer is its own frame, and it is the one screen that is not inside
   * the shell.
   *
   * At 1280 the content column is 1000 points wide once the 280-point sidebar
   * is out, and this screen has to hold a 640-point slide (C7) beside a reading
   * column worth the name plus two gutters. It does not fit, and the sidebar is
   * what gives: the viewer is a reading mode, its own header carries the way
   * back to the course, and nothing is navigated while a slide is being read.
   * The chrome is still reachable by name from the viewer's header, and it
   * opens on the course screen, which is the screen that has a sidebar column.
   *
   * `<main>` is supplied here rather than by `AppShell`, so the skip link, the
   * focus target and the focus-on-navigation rule below are unchanged.
   */
  if (route.name === "viewer") {
    return (
      <ConnectProvider open={openConnect}>
        <StoreProvider cid={route.cid}>
          <div className="h-full bg-ground text-ink">
            <a href="#main" className="skip-link">
              Skip to content
            </a>
            <main
              id="main"
              tabIndex={-1}
              className="h-full min-h-0 overflow-hidden overscroll-none focus-target"
            >
              <ViewerScreen
                key={route.did}
                cid={route.cid}
                did={route.did}
                index={route.index}
              />
            </main>
          </div>
          <Toaster />
          <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
        </StoreProvider>
      </ConnectProvider>
    );
  }

  return (
    <ConnectProvider open={openConnect}>
      <StoreProvider cid={cid}>
        <AppShell
          collapsed={prefs.collapsed}
          onToggleCollapsed={toggleCollapsed}
          chrome={
            <Sidebar
              route={route}
              onOpenConnect={openConnect}
              onToggleCollapsed={toggleCollapsed}
            />
          }
        >
          <ScreenFor route={route} />
        </AppShell>
        <Toaster />
        <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
      </StoreProvider>
    </ConnectProvider>
  );
}

function ScreenFor({ route }: { route: Route }) {
  switch (route.name) {
    case "courses":
      return <CoursesScreen />;
    case "course":
      return <CourseScreen key={route.cid} cid={route.cid} />;
    case "viewer":
      // Handled above, outside the shell.
      return null;
    case "artifact":
      return (
        <ArtifactScreen
          key={`${route.aid}/${route.oid}`}
          cid={route.cid}
          aid={route.aid}
          oid={route.oid}
        />
      );
  }
}

/**
 * The screen that just appeared has no focus of its own, which leaves a screen
 * reader on `<body>` after every navigation. Move focus to the heading instead.
 *
 * Only when the screen itself changes. Moving focus on a slide change would
 * take the reader off the arrow keys they are using to change slides.
 */
function useFocusOnScreenChange(route: Route) {
  const previous = useRef<Route["name"] | null>(null);
  const name = route.name;
  useEffect(() => {
    const changed = previous.current !== null && previous.current !== name;
    previous.current = name;
    if (!changed) return;
    const heading = document.querySelector<HTMLElement>("main h1");
    heading?.focus();
  }, [name]);
}

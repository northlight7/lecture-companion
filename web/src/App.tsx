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

/**
 * The window is moved by the page, because nothing else can move it.
 *
 * `-webkit-app-region: drag`, which every `.titlebar-drag` in this app carries,
 * is an Electron property. In a WKWebView it does NOTHING, and the launcher
 * sets `isMovableByWindowBackground = false` and lets the web view cover the
 * window's own title bar, so the app had no way to be moved at all: the reader
 * could not drag the window anywhere, by its top edge or by anything else.
 *
 * So the page drives it. A press on a drag region that is not on a control
 * starts a drag, every move is forwarded, and the launcher moves the window by
 * the pointer's own delta. The listener is on the document in the capture
 * phase, so it covers the sidebar's strip, the collapsed strip and the viewer's
 * header without any of them knowing about it.
 */
/** The draggable band at the top of the window, in CSS pixels. The same 52
 *  points as the strip `AppShell` and `Chrome` draw there. */
const TOP_BAND = 52;

function useWindowDrag() {
  useEffect(() => {
    const post = (phase: "start" | "move" | "end") => {
      const host = window as unknown as {
        webkit?: { messageHandlers?: { windowDrag?: { postMessage(body: unknown): void } } };
      };
      host.webkit?.messageHandlers?.windowDrag?.postMessage({ phase });
    };
    let dragging = false;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      // THE TOP BAND OF THE WINDOW, not a named element inside it.
      //
      // The element test alone was not enough and the owner found it: the
      // window could be dragged from the sidebar's fifth of the top bar and
      // from nowhere else, which is not what "drag it from any point on the top
      // bar" means. A band is also the honest description of the thing: every
      // Mac app's top edge drags, whatever happens to be drawn there.
      //
      // TOP_BAND is the strip's own height, so the two cannot drift apart.
      const inBand = event.clientY <= TOP_BAND;
      if (!inBand && !target?.closest(".titlebar-drag")) return;
      // A control inside a drag region keeps its own click. Without this the
      // window would move under the reader every time they pressed a button in
      // the header.
      if (target?.closest(".titlebar-control")) return;
      dragging = true;
      // No text selection, and no drag image, from a drag region.
      event.preventDefault();
      post("start");
    };
    const onMove = () => {
      if (dragging) post("move");
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      post("end");
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
    };
  }, []);
}

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
  useWindowDrag();

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

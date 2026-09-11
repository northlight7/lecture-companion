import { useCallback, useEffect, useRef, useState } from "react";

import { useRoute, type Route } from "@/lib/router";
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

  const cid = route.name === "courses" ? null : route.cid;

  useFocusOnScreenChange(route);

  return (
    <ConnectProvider open={openConnect}>
      <StoreProvider cid={cid}>
        <AppShell
          chrome={<Sidebar route={route} onOpenConnect={openConnect} />}
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
      return <ViewerScreen key={route.did} cid={route.cid} did={route.did} index={route.index} />;
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

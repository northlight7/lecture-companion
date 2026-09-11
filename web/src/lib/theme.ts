import { useEffect, useState } from "react";

/**
 * Which theme is on screen.
 *
 * The app follows the system, exactly as it did before the rebuild: there is no
 * in-app theme control and none is being added. `data-theme` on `<html>` is the
 * override, and nothing in the product sets it. It exists because the window
 * server decides `prefers-color-scheme`, and a verifier needs a way to pin a
 * theme without changing the reader's desktop.
 */
export type Theme = "dark" | "light";

const QUERY = "(prefers-color-scheme: light)";

function resolve(): Theme {
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return window.matchMedia(QUERY).matches ? "light" : "dark";
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(resolve);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setTheme(resolve());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return theme;
}

/**
 * Hash routing, byte-compatible with the routes the previous frontend used, so
 * every source link and deep link already in a course's stored data still
 * resolves:
 *
 *   #/                      courses
 *   #/c/<cid>               one course
 *   #/c/<cid>/<did>/<i>     a deck, at slide i
 *   #/c/<cid>/a/<aid>[/<oid>]  an artifact, optionally focused on one object
 *
 * The hash is the only navigation state. Nothing else is in the URL, and a
 * route is always reconstructible from the hash alone.
 */

import { useEffect, useState } from "react";

export type Route =
  | { name: "courses" }
  | { name: "course"; cid: string }
  | { name: "viewer"; cid: string; did: string; index: number }
  | { name: "artifact"; cid: string; aid: string; oid: string };

export function parseHash(hash: string): Route {
  const raw = (hash || "#/").replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d, e] = parts;
  if (a === "c" && c === "a" && parts.length >= 4 && b && d) {
    return { name: "artifact", cid: b, aid: d, oid: e ?? "" };
  }
  if (a === "c" && parts.length >= 4 && b && c && d) {
    return { name: "viewer", cid: b, did: c, index: Number(d) || 0 };
  }
  if (a === "c" && parts.length >= 2 && b) {
    return { name: "course", cid: b };
  }
  return { name: "courses" };
}

const enc = encodeURIComponent;

export const hash = {
  courses: () => "#/",
  course: (cid: string) => `#/c/${enc(cid)}`,
  deck: (cid: string, did: string, index: number) =>
    `#/c/${enc(cid)}/${enc(did)}/${index}`,
  source: (cid: string, aid: string, oid = "") =>
    oid ? `#/c/${enc(cid)}/a/${enc(aid)}/${enc(oid)}` : `#/c/${enc(cid)}/a/${enc(aid)}`,
};

/** Assign a new hash, or do nothing when it is already current. */
export function navigate(to: string): void {
  if (location.hash === to) return;
  location.hash = to;
}

/** The current route, re-rendering on every hashchange. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** True when the route names the same screen and subject as before. */
export function sameScreen(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === "courses") return true;
  if (a.name === "course") return b.name === "course" && a.cid === b.cid;
  if (a.name === "viewer") return b.name === "viewer" && a.cid === b.cid && a.did === b.did;
  return b.name === "artifact" && a.cid === b.cid && a.aid === b.aid;
}

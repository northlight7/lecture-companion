import type { Theme } from "./theme";

/**
 * mermaid's colour slots, filled from this app's tokens.
 *
 * WHY THIS EXISTS. `Diagram` used to hand mermaid `theme: "neutral"` (light) or
 * `theme: "dark"`, which are mermaid's own palettes. Every fill, stroke and
 * label colour inside a rendered diagram then came from mermaid, so a diagram
 * was the one surface in the app where rule 11 of the banned list ("no ad-hoc
 * hex values, every colour resolves to a token") did not hold, and no gate
 * looked inside an SVG. The `base` theme takes its colours from
 * `themeVariables`, which is what this module builds.
 *
 * THE TABLE. Every key below is a mermaid theme variable on the left and the
 * token it is painted from on the right. Tokens are read from `:root` at
 * render time, never hard-coded.
 *
 *   background           --surface-well      a painted backdrop, if a diagram
 *                                            type asks for one. The figure that
 *                                            holds the SVG is `bg-well`, so this
 *                                            is deliberately the same value and
 *                                            a backdrop is invisible.
 *   primaryColor         --surface-raised    a flowchart node's fill (level 1,
 *   mainBkg                                  one step off the well)
 *   primaryTextColor     --ink               a node's label
 *   nodeTextColor        --ink               the same slot under its v11 name
 *   textColor            --ink               generic diagram text
 *   titleColor           --ink               titles
 *   primaryBorderColor   --line-control      a node's outline. `--line-control`
 *   nodeBorder                               is the token gated at 3:1 against
 *                                            every surface a boundary is drawn
 *                                            on, which is why it and not
 *                                            `--line-hair` (a 1.2:1 separator)
 *   clusterBorder        --line-control      a subgraph's outline
 *   lineColor            --line-control      edges and arrows
 *   secondaryColor       --surface-raised    the base mermaid derives some of
 *                                            its remaining slots from
 *   tertiaryColor        --surface-selected  the other base
 *   clusterBkg           --surface-selected  a subgraph's interior: a real step
 *                                            away from both the well behind it
 *                                            and the node fill inside it, in
 *                                            both themes
 *   edgeLabelBackground  --surface-raised    the box behind an edge label
 *
 * HOW A TOKEN IS READ. A custom property is substituted as a token stream, not
 * evaluated, so `--surface-raised` comes back as
 * `color-mix(in oklab, #1a1816 94%, #f0eee9)`. mermaid runs colour arithmetic
 * (`darken`, `lighten`) over its theme variables, and those parse neither
 * `color-mix()` nor `oklab()`. So every value is resolved to one concrete
 * colour through a 2d canvas, which normalises whatever the browser computed to
 * `#rrggbb`. If the browser cannot parse a value, the slot falls back to the
 * plain token named in FALLBACK, which is a single hex and always parses.
 */

/** mermaid theme variable -> the token that paints it. */
const SLOTS: Record<string, string> = {
  background: "--surface-well",
  primaryColor: "--surface-raised",
  mainBkg: "--surface-raised",
  primaryTextColor: "--ink",
  nodeTextColor: "--ink",
  textColor: "--ink",
  titleColor: "--ink",
  primaryBorderColor: "--line-control",
  nodeBorder: "--line-control",
  clusterBorder: "--line-control",
  lineColor: "--line-control",
  secondaryColor: "--surface-raised",
  tertiaryColor: "--surface-selected",
  clusterBkg: "--surface-selected",
  edgeLabelBackground: "--surface-raised",
};

/**
 * The token each slot drops back to when its own value will not resolve.
 * Only the `--surface-*` family can fail, because they are the tokens written
 * as `color-mix()`. The fallback is a neighbour in the surface table, so the
 * diagram degrades to fewer steps of the same palette rather than to a colour
 * from nowhere.
 */
const FALLBACK: Record<string, string> = {
  "--surface-well": "--ground",
  "--surface-raised": "--ground",
  "--surface-selected": "--ground-chrome",
};

/** Resolve a CSS colour to one concrete `#rrggbb`, or null if it will not. */
function toConcrete(value: string): string | null {
  const probe =
    typeof document === "undefined" ? null : document.createElement("canvas");
  const ctx = probe?.getContext("2d");
  if (!ctx) return null;
  // An invalid assignment to `fillStyle` is ignored, so a sentinel that is
  // never a real token value tells us whether the assignment took.
  const sentinel = "rgb(1, 2, 3)";
  ctx.fillStyle = sentinel;
  ctx.fillStyle = value;
  const out = ctx.fillStyle;
  return out === sentinel ? null : out;
}

function readToken(name: string): string | null {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return null;
  return toConcrete(raw) ?? (FALLBACK[name] ? readToken(FALLBACK[name]) : null);
}

/** The `themeVariables` for `mermaid.initialize`, in the active theme. */
export function diagramThemeVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {
    // mermaid branches on `darkMode` for the values it derives itself, so it is
    // told the truth even though every slot above is set explicitly.
    darkMode: theme === "dark" ? "true" : "false",
    // The same family the reading column's chrome uses. Read from the token,
    // not from `document.body`, so it cannot drift from the app.
    fontFamily: getComputedStyle(document.documentElement)
      .getPropertyValue("--font-sans")
      .trim(),
  };
  for (const [key, token] of Object.entries(SLOTS)) {
    const value = readToken(token);
    if (value) vars[key] = value;
  }
  return vars;
}

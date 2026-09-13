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

/**
 * mermaid's one size-bearing theme variable: `fontSize`.
 *
 * WHY THIS EXISTS. The colour table above pins every fill, stroke and label
 * colour, but the *sizes* were mermaid's own. Whatever the base theme defaults
 * to (16px for a flowchart label, 10-12px in the class, state, usecase, block
 * and journey chunks that ship in the same bundle) reached the screen, because
 * nothing here set it. The project's rule is that nothing renders below 14px,
 * for any reason, and a diagram label is no exception.
 *
 * WHICH STEP, AND WHY `--fs-lead` (18px). A label inside a diagram is figure
 * text in the reading column, not app chrome: it is the thing the reader looks
 * at to read the picture, so it is held to the reading scale, not the control
 * scale. The column's prose is `--fs-body` (21px). One step down is
 * `--fs-lead` (18px), which is the largest step that still reads as a caption
 * to the prose rather than competing with it, and the smallest one that leaves
 * the 14px floor intact once the figure has been through the width scaling the
 * reading column applies to a wide SVG. `--fs-meta` (14px) is the floor itself,
 * so any scaling at all would put a label under it, and `--fs-ui` (16px) is a
 * control label's size, which this is not.
 *
 * WHAT IT DOES NOT REACH. `fontSize` is the generic slot: the base theme
 * derives its label, node, edge-label and title sizes from it. The per-diagram
 * font sizes mermaid also ships (sequence `actorFontSize`, `messageFontSize`,
 * `noteFontSize`; journey and gantt `taskFontSize`, `sectionFontSize`,
 * `titleFontSize`; the c4 `*FontSize` family; the quadrant and xy label sizes)
 * are *not* theme variables. They hang off each diagram's own config object,
 * so `themeVariables` cannot set them at all. See the module's note in the
 * report: they are the sizes still outside this file's reach.
 */
const FONT_SIZE_TOKEN = "--fs-lead";

/** A token written as a length, taken as its computed value. No canvas: a
 * length is already the form a CSS declaration wants, unlike a `color-mix()`. */
function readSize(name: string): string | null {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .replace(/\s+/g, " ")
    .trim();
  return raw || null;
}

/** Resolve a CSS colour to one concrete `rgb(...)`, or null if it will not. */
function toConcrete(value: string): string | null {
  const probe =
    typeof document === "undefined" ? null : document.createElement("canvas");
  const ctx = probe?.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // An invalid assignment to `fillStyle` is ignored, so a sentinel that is
  // never a real token value tells us whether the assignment took.
  const sentinel = "rgb(1, 2, 3)";
  ctx.fillStyle = sentinel;
  ctx.fillStyle = value;
  if (ctx.fillStyle === sentinel) return null;
  // Reading `fillStyle` back is not enough. A resolved `color-mix()` comes back
  // as `color(srgb ...)` or `oklab(...)`, which mermaid's own colour parser does
  // not read, and passing one made `mermaid.render` reject the whole diagram.
  // Rasterising one pixel and reading the sRGB bytes back gives a value in the
  // one form every parser accepts.
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function readToken(name: string): string | null {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return null;
  return toConcrete(raw) ?? (FALLBACK[name] ? readToken(FALLBACK[name]) : null);
}

/**
 * The per-diagram font sizes mermaid keeps outside `themeVariables`.
 *
 * WHY THIS EXISTS. `themeVariables` pins every colour and the one generic
 * `fontSize`, and it cannot reach the sizes each diagram keeps in its **own**
 * config object. Round 20's two critics named the same category independently:
 * the shipped bundle carries vendored declarations at 10, 11 and 12px, and
 * `gate_type.py` stood down on all of them **by name** rather than because
 * anything proved they could not render. The default that decides a gantt's
 * axis labels is `gantt.fontSize: 11`, a usecase actor's is 12, an ER entity's
 * is 12, a quadrant point's is 12. None of those is reachable from
 * `themeVariables` and every one of them is reachable from here.
 *
 * WHY `--fs-lead`. Same reasoning as `fontSize` above: a diagram label is
 * figure text in the reading column, so it is held to the reading scale. 18px
 * is one step below the column's 21px prose and comfortably above the floor.
 * A size is a plain number in these config blocks, not a CSS length, so the
 * token is parsed rather than used as written.
 *
 * WHY THE TABLE IS EXACTLY THIS AND NOT MORE. It lists the keys mermaid
 * defaults **below** the floor and nothing else. Pinning a key that already
 * defaults to 14 or 16 changes no pixel and hides the fact that the below-floor
 * set moved when mermaid was upgraded, so
 * `.internal/gate_diagram_sizes.py` fails on an entry that pins nothing. The
 * table is the below-floor set, and the gate keeps it that way.
 *
 * WHAT IT DOES NOT REACH, so the next reader does not have to rediscover it.
 * Several vendored declarations are hard literals inside a diagram chunk with
 * no config key behind them at all -- `classDiagram-v2` and `stateDiagram-v2`
 * each carry a 10px, `blockDiagram` and `journeyDiagram` a 12px. There is no
 * key to set, so they cannot be pinned from here, and
 * `.internal/gate_diagram_sizes.py` reads the vendored config out of the
 * shipped chunk and separates the two cases by name and count instead of
 * leaving them in one exempted pile.
 */
const SIZE_SLOTS: Record<string, string[]> = {
  gantt: ["fontSize", "sectionFontSize"],
  usecase: ["usecaseFontSize"],
  c4: ["messageFontSize"],
  er: ["fontSize"],
  quadrantChart: ["pointLabelFontSize"],
  treemap: ["valueFontSize"],
};

/** The per-diagram blocks for `mermaid.initialize`, at the reading step. */
export function diagramConfig(): Record<string, Record<string, number>> {
  const px = Number.parseInt(readSize(FONT_SIZE_TOKEN) ?? "", 10);
  const size = Number.isFinite(px) && px > 0 ? px : 18;
  const out: Record<string, Record<string, number>> = {};
  for (const [diagram, keys] of Object.entries(SIZE_SLOTS)) {
    out[diagram] = {};
    for (const key of keys) out[diagram][key] = size;
  }
  return out;
}

/** The `themeVariables` for `mermaid.initialize`, in the active theme. */
export function diagramThemeVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {
    // mermaid branches on `darkMode` for the values it derives itself, so it is
    // told the truth even though every slot above is set explicitly.
    darkMode: theme === "dark" ? "true" : "false",
    // The same family the reading column's chrome uses. Read from the token,
    // not from `document.body`, so it cannot drift from the app. `--font-sans`
    // is written across two lines in `tokens.css`, so its value carries a
    // newline that is collapsed here before it reaches a CSS declaration.
    fontFamily: getComputedStyle(document.documentElement)
      .getPropertyValue("--font-sans")
      .replace(/\s+/g, " ")
      .trim(),
  };
  for (const [key, token] of Object.entries(SLOTS)) {
    const value = readToken(token);
    if (value) vars[key] = value;
  }
  // Every size mermaid derives itself comes off this one slot. If the token is
  // missing the slot is left unset and mermaid's own size stands, which is the
  // state this table was added to end, so the fallback is the token's own
  // literal step rather than nothing.
  vars.fontSize = readSize(FONT_SIZE_TOKEN) ?? "18px";
  return vars;
}

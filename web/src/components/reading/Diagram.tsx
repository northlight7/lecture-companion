import { useEffect, useRef, useState } from "react";

import { diagramConfig, diagramThemeVariables } from "@/lib/diagramTheme";
import { useTheme } from "@/lib/theme";

/**
 * A mermaid diagram from a slide explanation.
 *
 * mermaid is bundled rather than fetched from a CDN. The previous frontend
 * imported it from jsdelivr at runtime, which meant a local, offline study app
 * silently lost its diagrams on a plane. It is a dynamic import here too, so it
 * stays out of the first paint and only loads when a slide actually has one.
 *
 * If mermaid cannot draw the source, the source is shown instead. A diagram is
 * never worth losing the explanation it belongs to.
 *
 * Colour: `theme: "base"` plus `themeVariables` built from this app's tokens by
 * `@/lib/diagramTheme`, so no fill, stroke or label inside the SVG is
 * mermaid's own. The SVG is injected as markup, so the only colours in it are
 * the ones resolved from `:root` when this effect ran, and the effect re-runs
 * when the theme changes.
 */
let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;

function loadMermaid() {
  mermaidPromise ??= import("mermaid").then((mod) => mod.default);
  return mermaidPromise;
}

let seq = 0;

export function Diagram({ source }: { source: string }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    const node = host.current;
    if (!node || !source.trim()) return;
    let cancelled = false;
    setFailed(false);

    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: diagramThemeVariables(theme),
          // The sizes mermaid keeps in each diagram's own config rather than in
          // `themeVariables`. Without these a gantt's axis labels paint at 11px
          // and a quadrant's point labels at 12px, in every theme.
          ...diagramConfig(),
        });
        const { svg } = await mermaid.render(`lc-diagram-${++seq}`, source);
        if (cancelled) return;
        node.innerHTML = svg;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [source, theme]);

  if (failed) {
    return (
      <figure className="my-6 rounded-srf bg-well p-4">
        <pre className="overflow-x-auto font-code text-meta text-ink-muted">
          <code>{source}</code>
        </pre>
      </figure>
    );
  }

  return (
    <figure
      ref={host}
      role="img"
      aria-label="Diagram from this slide's explanation"
      // `[&_svg]:max-w-full` used to shrink a wide diagram to fit, and that is
      // how the type floor was broken: at a 1440 window the SVG scaled to about
      // 0.67 and an 18px label painted at roughly 12px. The floor is a rule
      // about rendered pixels, so the diagram scrolls instead of shrinking.
      //
      // `justify-start` with `mx-auto` on the child, not `justify-center`: a
      // centred flex child that overflows its scroll container gets its leading
      // edge clipped, which would hide the left of every wide diagram. Auto
      // margins still centre a narrow one.
      className="my-6 flex justify-start overflow-x-auto rounded-srf bg-well p-4 [&_svg]:mx-auto [&_svg]:h-auto"
    />
  );
}

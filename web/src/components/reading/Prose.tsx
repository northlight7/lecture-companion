import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The model writes a deliberately small markdown subset. This renders exactly
 * that subset and nothing more: fenced code, ATX headings, bullet lists,
 * ordered lists, blank-line paragraphs, inline code, bold and italic.
 *
 * It builds React nodes rather than an HTML string, so the model cannot inject
 * markup into the reading column even in principle. The previous frontend
 * escaped first and then assembled a string; this removes the step where that
 * could go wrong.
 */

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|(^|[\s(])\*([^*\n]+)\*/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>);
    else {
      out.push(m[3] ?? "");
      out.push(<em key={key}>{m[4] ?? ""}</em>);
    }
    last = INLINE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*+]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;

function blocks(source: string): ReactNode[] {
  const text = String(source ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const out: ReactNode[] = [];
  const chunks = text.split(/\n{2,}/);

  chunks.forEach((raw, i) => {
    const block = raw.trim();
    if (!block) return;
    const key = `b${i}`;

    if (block.startsWith("```")) {
      const body = block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      out.push(
        <pre key={key}>
          <code>{body.replace(/\n$/, "")}</code>
        </pre>,
      );
      return;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(block);
    if (heading && !block.includes("\n")) {
      const depth = Math.min((heading[1] ?? "#").length + 1, 4);
      const Tag = (depth === 2 ? "h2" : depth === 3 ? "h3" : "h4") as "h2" | "h3" | "h4";
      out.push(<Tag key={key}>{inline(heading[2] ?? "", key)}</Tag>);
      return;
    }

    const lines = block.split("\n");

    if (lines.every((l) => BULLET.test(l))) {
      out.push(
        <ul key={key}>
          {lines.map((l, j) => (
            <li key={j}>{inline(l.replace(BULLET, ""), `${key}-${j}`)}</li>
          ))}
        </ul>,
      );
      return;
    }

    if (lines.every((l) => ORDERED.test(l))) {
      out.push(
        <ol key={key}>
          {lines.map((l, j) => (
            <li key={j}>{inline(l.replace(ORDERED, ""), `${key}-${j}`)}</li>
          ))}
        </ol>,
      );
      return;
    }

    const parts: ReactNode[] = [];
    lines.forEach((line, j) => {
      if (j > 0) parts.push(<br key={`${key}-br${j}`} />);
      parts.push(...inline(line, `${key}-${j}`));
    });
    out.push(<p key={key}>{parts}</p>);
  });

  return out;
}

export function Prose({ children, className }: { children: string; className?: string }) {
  return <div className={cn("prose-reading", className)}>{blocks(children)}</div>;
}

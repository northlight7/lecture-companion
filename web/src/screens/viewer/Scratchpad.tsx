import { useCallback, useEffect, useRef } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { cn } from "@/lib/utils";

/**
 * The reader's own writing surface for the slide, and the deck notes it sits
 * above.
 *
 * This is where the notes box that used to live in the right pane went. It is
 * ONE pad, in the left column under the slide, because that is where the reader
 * is already looking when they want to write something down, and because the
 * explanation pane is a reading column: an editor in it competes with the
 * explanation for the same eye.
 *
 * WHY A CONTENTEDITABLE AND NOT A TEXTAREA. Three behaviours are required and
 * a textarea can do none of them: a leading `-` starts a real bullet, Enter
 * continues the list, and Cmd+Z undoes. The list needs blocks, and blocks need
 * an editable document rather than a single text value. The undo is the
 * browser's own stack, which is the only one that gets the three behaviours to
 * agree with each other: a hand-rolled history would have to model every edit
 * this file makes, and it would still disagree with the caret.
 *
 * The cost of that choice, stated because it is real: every DOM change this
 * file makes by hand (the bullet conversion and the exit from a list) is NOT
 * on the browser's undo stack. Undo therefore steps over typed text and over
 * those two structural edits, which is what the bar asks for and all it asks
 * for. Text the reader typed is always undoable, because the browser inserted
 * it.
 *
 * THE STORED FORM IS MARKDOWN, one line per block, `- ` for an item, because
 * the API stores a plain string (`app/notes.py`). The pad parses it on load
 * and serialises on every edit.
 *
 * The status line beside the pad is the save state the screen above owns:
 * "Saving", "Saved", "Unsaved changes". The pad never talks to the API itself.
 */

/** Must match MAX_NOTE_CHARS in app/notes.py. */
export const MAX_NOTE_CHARS = 4000;

/** What the reader's note is doing right now. */
export type NoteSaveState = "idle" | "dirty" | "saving" | "saved";

/** The live status line for a note. Empty when there is nothing to say. */
export function noteStatus(state: NoteSaveState, hasText: boolean): string {
  if (state === "saving") return "Saving";
  if (state === "dirty") return "Unsaved changes";
  if (state === "saved" && hasText) return "Saved";
  return "";
}

/**
 * The small uppercase label that opens a block on this screen.
 *
 * The pad and the explanation pane's footer open their blocks with the same
 * object, so it lives here and the pane imports it: the notes module is the
 * one place both sides of the viewer can see.
 */
export function PaneLabel({ children }: { children: string }) {
  return (
    <p className="font-ui text-meta font-medium tracking-[0.06em] text-ink-muted uppercase">
      {children}
    </p>
  );
}

/**
 * The class lists the list elements carry.
 *
 * Written as literals because these elements are built with `createElement`
 * and no JSX in the app names them: Tailwind emits the utility it can see
 * written out, and a class name assembled from a variable would compile to
 * nothing. Both are on the spacing scale: `--space-5` is the 24 step.
 */
const LIST_CLASS = "list-disc pl-[var(--space-5)]";
const ITEM_CLASS = "pl-[var(--space-1)]";

// --------------------------------------------------------------------------
// the document, as markdown
// --------------------------------------------------------------------------

/** Every character below a node, with a soft break read as a newline. */
function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node instanceof HTMLElement && node.tagName === "BR") return "\n";
  let out = "";
  for (const child of Array.from(node.childNodes)) out += textOf(child);
  return out;
}

/** The block the caret sits in: a paragraph, a list item, or the pad itself. */
function blockOf(root: HTMLElement, node: Node): HTMLElement {
  let el: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (el && el !== root) {
    if (
      el instanceof HTMLElement &&
      (el.tagName === "DIV" || el.tagName === "P" || el.tagName === "LI")
    ) {
      return el;
    }
    el = el.parentNode;
  }
  return root;
}

/** True while nothing follows the caret inside its own block. */
function caretAtEnd(block: HTMLElement, range: Range): boolean {
  const after = document.createRange();
  after.selectNodeContents(block);
  try {
    after.setStart(range.endContainer, range.endOffset);
  } catch {
    return false;
  }
  return after.toString().replace(/\u00a0/g, " ").length === 0;
}

function paragraph(text: string): HTMLDivElement {
  const div = document.createElement("div");
  if (text) div.textContent = text;
  // An empty paragraph needs its own break, or it has no height and the caret
  // has nowhere to land inside it.
  else div.appendChild(document.createElement("br"));
  return div;
}

function itemNode(text: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = ITEM_CLASS;
  if (text) item.textContent = text;
  else item.appendChild(document.createElement("br"));
  return item;
}

/** The stored markdown as editor DOM: one div per line, items in a list. */
function parse(markdown: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let list: HTMLUListElement | null = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!list) {
        list = document.createElement("ul");
        list.className = LIST_CLASS;
        frag.appendChild(list);
      }
      list.appendChild(itemNode(item[1] ?? ""));
      continue;
    }
    list = null;
    frag.appendChild(paragraph(line));
  }
  return frag;
}

/** The editor DOM back as markdown. `- item` per line is the whole format. */
function serialize(root: HTMLElement): string {
  const lines: string[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.nodeValue ?? "").trim();
      if (text) lines.push(text);
      continue;
    }
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === "UL" || child.tagName === "OL") {
      for (const item of Array.from(child.children)) {
        lines.push(`- ${textOf(item).replace(/\s*\n+\s*/g, " ").trim()}`);
      }
      continue;
    }
    lines.push(textOf(child).replace(/\n+$/, ""));
  }
  return lines.join("\n");
}

// --------------------------------------------------------------------------
// text-editor behaviour
// --------------------------------------------------------------------------

function placeCaretAtEnd(node: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * A typed `- ` at the start of a block turns that block into a list item.
 *
 * Only when the caret is at the end of the block, so the trigger is typing
 * forward and a dash the reader is editing in the middle of an old line is
 * left alone.
 */
function bulletise(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;
  const block = blockOf(root, range.startContainer);
  if (block === root || block.tagName === "LI") return false;
  if (!caretAtEnd(block, range)) return false;
  const match = /^-[ ](.*)$/s.exec(textOf(block).replace(/\u00a0/g, " "));
  if (!match) return false;

  const item = itemNode(match[1] ?? "");
  const list = document.createElement("ul");
  list.className = LIST_CLASS;
  list.appendChild(item);
  block.replaceWith(list);
  placeCaretAtEnd(item);
  return true;
}

/**
 * Enter on an empty item ends the list and leaves a paragraph behind. An item
 * with text in it is the browser's job: its own Enter continues the list.
 */
function exitList(item: HTMLLIElement): void {
  const list = item.parentElement;
  if (!list) return;
  const following = Array.from(list.children).slice(Array.from(list.children).indexOf(item) + 1);
  item.remove();
  const div = paragraph("");
  list.insertAdjacentElement("afterend", div);
  if (following.length) {
    const tail = document.createElement("ul");
    tail.className = LIST_CLASS;
    for (const node of following) tail.appendChild(node);
    div.insertAdjacentElement("afterend", tail);
  }
  if (!list.querySelector("li")) list.remove();
  placeCaretAtEnd(div);
}

// --------------------------------------------------------------------------

export function Scratchpad({
  value,
  state,
  onChange,
  onSave,
}: {
  /** The stored markdown for this slide. */
  value: string;
  state: NoteSaveState;
  /** Every edit, as markdown. The screen above owns the pending copy. */
  onChange: (markdown: string) => void;
  /** Losing focus is a save point. */
  onSave: () => void;
}) {
  const pad = useRef<HTMLDivElement | null>(null);
  // What this pad last put in the DOM. An edit it made itself is already there
  // and rebuilding it would throw the caret and the undo stack away, so the
  // DOM is only rebuilt when the incoming text is a different text.
  const written = useRef<string | null>(null);

  useEffect(() => {
    const node = pad.current;
    if (!node) return;
    if (written.current !== null && value.trim() === written.current.trim()) return;
    const frag = parse(value);
    if (!frag.firstChild) frag.appendChild(paragraph(""));
    node.replaceChildren(frag);
    written.current = value;
  }, [value]);

  const commit = useCallback(() => {
    const node = pad.current;
    if (!node) return;
    const text = serialize(node).slice(0, MAX_NOTE_CHARS);
    written.current = text;
    if (text !== value) onChange(text);
  }, [onChange, value]);

  const onInput = useCallback(() => {
    const node = pad.current;
    if (!node) return;
    bulletise(node);
    commit();
  }, [commit]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    const node = pad.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0) return;
    const block = blockOf(node, selection.getRangeAt(0).startContainer);
    if (block.tagName !== "LI") return;
    if (textOf(block).trim() !== "") return;
    event.preventDefault();
    exitList(block as HTMLLIElement);
    commit();
  };

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    // Plain text only. A paste from a browser would otherwise drop markup this
    // pad has no model for into the reader's notes.
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    if (text) document.execCommand("insertText", false, text);
  };

  const status = noteStatus(state, value.trim() !== "");

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <PaneLabel>Your notes</PaneLabel>
        <p aria-live="polite" className="font-ui text-meta text-ink-faint">
          {status}
        </p>
      </div>

      {/* The pad is the reader's own object, so it is a field like any other:
       *  `--line-control` on its boundary, the content ground under it, and
       *  the reading face inside it. The height is fixed rather than flexible
       *  so the slide above it keeps the room it needs at every window size. */}
      <div
        ref={pad}
        role="textbox"
        aria-multiline="true"
        aria-label="Your notes on this deck"
        tabIndex={0}
        // `contentEditable` IS THE CONTROL. Without it this is a focusable div
        // that carries the right role, the right name and every handler below,
        // and refuses every keystroke: measured, the accessibility tree
        // reported `AXTextArea "Your notes on this deck" 708x120`, the pad took
        // focus and drew its focus ring, and typing `hello` left its value at
        // "\n". A role and a handler are not an editor, which is exactly what
        // invariant I1 is about, so the attribute is load-bearing rather than
        // decorative.
        contentEditable
        // React warns when a `contentEditable` has children it did not put
        // there. It has not: the effect above owns this node's children and
        // rebuilds them from the stored markdown, so the warning is about the
        // design and not about a mistake.
        suppressContentEditableWarning
        spellCheck
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={onSave}
        className={cn(
          "h-[120px] overflow-y-auto rounded-ctl border border-line bg-ground px-3 py-2",
          "font-reading text-body leading-[1.62] text-ink",
        )}
      />
    </div>
  );
}

/**
 * What the course screen is allowed to print out of a stored overview.
 *
 * `app/overview.py` is frozen and writes whatever it writes. It is asked to
 * describe the course, and sometimes it describes itself instead, or pastes the
 * text it scraped off the opening slides. This module is the presentation
 * decision that stands between the stored string and the reader: split it into
 * sentences and keep only the ones that are ABOUT THE COURSE. The screen renders
 * a summary, never a transcript (`.internal/DESIGN.md`, "The course overview,
 * and what the UI refuses to print").
 *
 * THE BANNED PHRASES, verbatim from DESIGN.md's named list:
 *
 *   was derived from        no syllabus or programme document
 *   this overview for       no reference documents have been provided
 *   treat it as a rough     drawn from the imported material
 *   rough map of the        the imported material alone
 *   in this order:          drop the syllabus in
 *   the opening slides      deck(s) covering roughly
 *   indicate the following  slide(s) covering roughly
 *   subject matter          will be covered
 *
 * They are phrases, not words, so a course legitimately about provenance or
 * methodology is not caught. `.internal/gate_overview.py` renders the course
 * screen in the bundle and fails if any of them reaches the app, so this list
 * is a floor and not the design: the design is that a sentence about the model
 * never arrives at the reader.
 *
 * Three ways a sentence is dropped, in one pass:
 *
 *   1. It contains one of the banned phrases, case-insensitively.
 *   2. The slide scrape starts here. Everything from that sentence onward goes,
 *      because the reader is about to see the slides themselves, rendered, with
 *      an explanation, further down the same screen. The scrape announces itself
 *      with "the opening slides", but not always, so a sentence longer than
 *      `SLIDE_SENTENCE_CHARS` or carrying `SLIDE_SLASH_RUN` or more separators
 *      is slide text by any other name.
 *   3. It is a trailing fragment: text cut off before it became a sentence.
 */

/** The named list from DESIGN.md, verbatim and exported so a reviewer can read
 *  it without opening the design document. Case-insensitive substring match. */
export const BANNED_PHRASES: readonly string[] = [
  "was derived from",
  "this overview for",
  "treat it as a rough",
  "rough map of the",
  "in this order:",
  "the opening slides",
  "indicate the following",
  "subject matter",
  "no syllabus or programme document",
  "no reference documents have been provided",
  "drawn from the imported material",
  "the imported material alone",
  "drop the syllabus in",
  "deck(s) covering roughly",
  "slide(s) covering roughly",
  "will be covered",
];

/** A sentence past this length is scraped slide text, not prose. */
const SLIDE_SENTENCE_CHARS = 400;

/** Three or more `/` separators in one sentence: it is a deck outline. */
const SLIDE_SLASH_RUN = 3;

/** A trailing fragment is shorter than this and has no terminal punctuation. */
const FRAGMENT_WORDS = 3;

/** Abbreviations whose full stop does not end a sentence. Kept short on
 *  purpose: the material is slides and syllabi, not prose that uses them. */
const ABBREVIATIONS = ["e.g.", "i.e.", "etc.", "vs.", "no.", "fig.", "p.", "pp.", "al."];

/** Terminal punctuation, optionally inside a closing quote or bracket. */
const TERMINAL = /[.!?]["'”’)\]]?$/;

function isAbbreviation(text: string, at: number): boolean {
  const tail = text.slice(0, at + 1).toLowerCase();
  return ABBREVIATIONS.some((abbr) => tail.endsWith(abbr));
}

/** One sentence of the source, trimmed, with where it sits in the source. The
 *  offsets are what lets a caller edit a sentence in place and leave every
 *  other byte of the stored string alone. */
interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

/**
 * Where each sentence is, in the source, on the same rules `splitSentences`
 * uses. One splitter, two views: the offsets have to agree with the strings or
 * an edit lands in the wrong place.
 *
 * Deliberately not a real NLP splitter: it protects decimal points, ellipses
 * and the handful of abbreviations that appear in course documents, and it
 * leaves a paragraph break as its own boundary. Sentences come back trimmed and
 * with empty ones removed, so `""` in gives `[]` out.
 */
function sentenceSpans(text: string): SentenceSpan[] {
  // The offsets index the string that was handed in, so the caller can splice
  // it. `splitSentences` normalises its line endings before it gets here.
  const source = text ?? "";
  if (!source.trim()) return [];

  const cuts: Array<[number, number]> = [];
  let start = 0;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\n") {
      cuts.push([start, i]);
      start = i + 1;
      continue;
    }
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // `...` and a decimal point are not sentence ends. A `.` followed by a
    // digit is a number ("1.5"), and it is never a sentence end either.
    const prev = source[i - 1];
    const next = source[i + 1];
    if (prev === "." || /\d/.test(next ?? "")) continue;
    if (ch === "." && isAbbreviation(source, i)) continue;
    if (next !== undefined && !/\s|["'”’)\]]/.test(next)) continue;

    // The stop may be followed by a closing quote or bracket that belongs to
    // the sentence, and the whitespace after that is where the split goes.
    let end = i + 1;
    while (end < source.length && /["'”’)\]]/.test(source[end] ?? "")) end += 1;
    cuts.push([start, end]);
    start = end;
    i = end - 1;
  }

  cuts.push([start, source.length]);

  const out: SentenceSpan[] = [];
  for (const [from, to] of cuts) {
    let a = from;
    let b = to;
    while (a < b && /\s/.test(source[a] ?? "")) a += 1;
    while (b > a && /\s/.test(source[b - 1] ?? "")) b -= 1;
    if (b > a) out.push({ text: source.slice(a, b), start: a, end: b });
  }
  return out;
}

/**
 * Split prose into sentences on `.`, `!` and `?` followed by whitespace.
 * Trimmed, empty ones removed, as `sentenceSpans` defines them.
 */
export function splitSentences(text: string): string[] {
  return sentenceSpans((text ?? "").replace(/\r\n?/g, "\n")).map((span) => span.text);
}

/** True when a sentence carries one of the named phrases. */
export function isBanned(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return BANNED_PHRASES.some((phrase) => lower.includes(phrase));
}

/** True when a sentence reads as scraped slide text rather than prose about the
 *  course. The first such sentence also ends the overview: see `courseProse`. */
export function isSlideScrape(sentence: string): boolean {
  if (sentence.length > SLIDE_SENTENCE_CHARS) return true;
  const slashes = (sentence.match(/\//g) ?? []).length;
  return slashes >= SLIDE_SLASH_RUN;
}

/** True when a sentence is a cut-off tail rather than a finished sentence. */
export function isFragment(sentence: string): boolean {
  if (TERMINAL.test(sentence)) return false;
  return sentence.split(/\s+/).length < FRAGMENT_WORDS;
}

/**
 * The sentences of a stored overview that are about the course, in order.
 *
 * Everything from the first slide scrape onward is dropped, not just the scrape
 * sentence: the model pastes the scrape last, and the sentences after it are the
 * scrape's continuation rather than new claims about the course.
 */
export function courseSentences(overview: string | null | undefined): string[] {
  const kept: string[] = [];
  for (const sentence of splitSentences(overview ?? "")) {
    if (isSlideScrape(sentence)) break;
    if (isBanned(sentence)) continue;
    if (isFragment(sentence)) continue;
    kept.push(sentence);
  }
  return kept;
}

/**
 * What the screen renders: the surviving sentences joined back into a
 * paragraph, or `""` when nothing in the stored overview was about the course.
 * An empty string is a real answer here, not a failure, and the screen has a
 * structured block for the facts the dropped sentences were carrying.
 */
export function courseProse(overview: string | null | undefined): string {
  return courseSentences(overview).join(" ").trim();
}

/* -------------------------------------------------------------------------
 *  The same phrases, reaching the reader through an explanation
 *
 *  The course screen was fixed by dropping whole sentences. An explanation
 *  cannot be treated that way: it is legitimate teaching prose, and the defect
 *  does not arrive as a sentence of its own. `app/pipeline.py:301` hands every
 *  explanation prompt `course_overview=_truncate_words(overview, 500)`, and
 *  `app/pipeline.py:149` returns `app/overview.py`'s `fallback_overview(...)`
 *  for a course with no syllabus. The model is handed the meta-text and quotes
 *  it back inside its own sentences, as seen on the Fintech course's viewer:
 *
 *    In the context of the course overview ("This overview for “4-Fintech and
 *    AI"), this is where that thread continues.
 *
 *  The banned phrase is inside a parenthetical quotation. The sentence around
 *  it is a real sentence about the slide. So the unit of removal here is the
 *  span, not the sentence:
 *
 *   1. A parenthetical or quoted span carrying a banned phrase goes, with the
 *      whitespace around it, and the sentence stays.
 *   2. A banned phrase anywhere else in a sentence still takes the sentence,
 *      which is the course screen's rule and the floor under this one.
 *   3. Nothing is left broken: no `()`, no dangling `,`, no ` .`, no doubled
 *      space, no doubled stop, and no sentence opening lower-case after one.
 *   4. Nothing without a banned phrase is dropped. Text that carries none comes
 *      back byte for byte, and `explanationProse` returns the input object
 *      itself on that path rather than a rebuilt string.
 * ---------------------------------------------------------------------- */

/** A quoted span. Straight single quotes are left out on purpose: an
 *  apostrophe would start a span that never closes, and a parenthetical is what
 *  carries this defect anyway. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["“", "”"],
  ["‘", "’"],
];

/** Every balanced `(...)` in the text, innermost included, as offsets. */
function parenGroups(text: string): Array<[number, number]> {
  const open: number[] = [];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") {
      open.push(i);
      continue;
    }
    if (text[i] !== ")" || open.length === 0) continue;
    const start = open.pop() as number;
    out.push([start, i + 1]);
  }
  return out;
}

/** Every quoted span in the text, as offsets that include the quotes. */
function quoteSpans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [open, close] of QUOTE_PAIRS) {
    let from = 0;
    for (;;) {
      const a = text.indexOf(open, from);
      if (a < 0) break;
      const b = text.indexOf(close, a + open.length);
      if (b < 0) break;
      out.push([a, b + close.length]);
      from = b + close.length;
    }
  }
  return out;
}

/** Overlapping spans become one, so nothing is removed twice. */
function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span[0] <= last[1]) {
      last[1] = Math.max(last[1], span[1]);
      continue;
    }
    out.push([span[0], span[1]]);
  }
  return out;
}

/**
 * The spans of one sentence that carry a banned phrase and can be removed
 * without touching the sentence around them.
 *
 * A nested parenthetical takes its parents with it: dropping the inner one
 * would leave `(he said )`, which is the broken punctuation rule 3 forbids.
 */
function bannedSpans(sentence: string): Array<[number, number]> {
  const groups = parenGroups(sentence);
  const quoted = quoteSpans(sentence);
  const found: Array<[number, number]> = [];

  for (const [a, b] of [...groups, ...quoted]) {
    if (!isBanned(sentence.slice(a, b))) continue;
    let span: [number, number] = [a, b];
    for (;;) {
      const outer = groups.find((g) => g[0] < span[0] && g[1] >= span[1]);
      if (!outer) break;
      span = [outer[0], outer[1]];
    }
    found.push(span);
  }

  return mergeSpans(found);
}

/** The sentence with those spans gone. The whitespace the span sat in is left
 *  to `tidy`, which closes the seam: taking a side's space here would run the
 *  words on either side together. */
function without(sentence: string, spans: Array<[number, number]>): string {
  let out = "";
  let cursor = 0;
  for (const [a, b] of spans) {
    out += sentence.slice(cursor, a);
    cursor = b;
  }
  return out + sentence.slice(cursor);
}

/** What the removal left behind, with the seams closed. */
function tidy(sentence: string): string {
  let out = sentence.replace(/\s+/g, " ").trim();
  out = out.replace(/\s+([,.;:!?])/g, "$1"); // a space before punctuation
  out = out.replace(/([,;:])(\s*)(?=[.!?]|$)/g, ""); // a comma with nothing after it
  out = out.replace(/([.!?])\s*([.!?])/g, "$1"); // a doubled stop
  out = out.replace(/([,;:])\s*([,;:])/g, "$1"); // a doubled comma
  out = out.replace(/\(\s*\)/g, ""); // brackets left holding nothing
  out = out.replace(/\[\s*\]/g, "");
  return out.trim();
}

/**
 * One sentence, rendered for the reader: the banned spans removed, the sentence
 * dropped only when the phrase is outside them, or `null` when the sentence is
 * gone. Text with no banned phrase comes back identical.
 */
function renderedSentence(sentence: string): string | null {
  if (!isBanned(sentence)) return sentence;

  const spans = bannedSpans(sentence);
  const text = spans.length ? without(sentence, spans) : sentence;
  // A banned phrase that survived the removals was not inside a span.
  if (isBanned(text)) return null;

  const cleaned = tidy(text);
  // Nothing but punctuation left: the span was the sentence.
  return /[0-9A-Za-z]/.test(cleaned) ? cleaned : null;
}

/**
 * What the viewer and the search list render out of stored model prose: the
 * explanation body, its worked example, its heading, a term gloss, a search
 * snippet. Banned meta-phrases are removed in place. This is not `courseProse`:
 * an explanation is teaching and a dropped sentence takes teaching with it, so
 * a phrase inside a parenthetical or a quotation costs the span and nothing
 * else.
 *
 * Text carrying none of the phrases is returned unchanged, byte for byte.
 */
export function explanationProse(text: string | null | undefined): string {
  const source = text ?? "";
  // The common case, and the one that must not be damaged: nothing to do, and
  // nothing rebuilt.
  if (!isBanned(source)) return source;

  const spans = sentenceSpans(source);
  if (spans.length === 0) return source;

  let out = "";
  let cursor = 0;
  let previousKept = true;

  for (const span of spans) {
    const gap = source.slice(cursor, span.start);
    cursor = span.end;

    const piece = renderedSentence(span.text);
    if (piece === null) {
      previousKept = false;
      continue;
    }

    if (previousKept) {
      out += gap;
    } else if (out) {
      // The sentence before this one went, and the whitespace between them
      // went with it. One space, never two.
      if (!/\s$/.test(out)) out += " ";
      // A sentence that opens lower-case right after a full stop reads as the
      // tail of the sentence that was removed.
      if (/[.!?]["'”’)\]]?\s$/.test(out) && /^[a-z]/.test(piece)) {
        out += piece.slice(0, 1).toUpperCase() + piece.slice(1);
        previousKept = true;
        continue;
      }
    }
    out += piece;
    previousKept = true;
  }

  if (previousKept) out += source.slice(cursor);
  return out;
}

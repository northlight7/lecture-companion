/**
 * What the app is allowed to print out of stored model prose.
 *
 * `app/overview.py` writes a course overview, and it is asked to describe the
 * course. Sometimes it describes itself instead, or pastes the text it scraped
 * off the opening slides. That text reaches the reader through a second door as
 * well: every explanation prompt is handed the overview as context
 * (`app/pipeline.py:301`), and the model quotes the meta-text back inside a
 * sentence of its own.
 *
 * The course screen's half of this module went with the overview itself. That
 * screen renders no overview prose at all now, so the filter it used
 * (`courseProse` and `courseSentences`, which also dropped everything after the
 * first slide scrape) has no caller and is deleted rather than left standing.
 * What remains is the half that still has a reader: `explanationProse`, which
 * the explanation pane, the search results, the question dialog and the run's
 * own summary all render through.
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
 * methodology is not caught. `.internal/gate_overview.py` renders the built app
 * and fails if any of them reaches a screen, so this list is a floor and not the
 * design: the design is that a sentence about the model never arrives at the
 * reader.
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

/** Abbreviations whose full stop does not end a sentence. Kept short on
 *  purpose: the material is slides and syllabi, not prose that uses them. */
const ABBREVIATIONS = ["e.g.", "i.e.", "etc.", "vs.", "no.", "fig.", "p.", "pp.", "al."];

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

/* -------------------------------------------------------------------------
 *  The same phrases, reaching the reader through an explanation
 *
 *  An explanation cannot be treated the way the course screen's overview was,
 *  by dropping whole sentences: it is legitimate teaching prose, and the defect
 *  does not arrive as a sentence of its own. `app/pipeline.py:301` hands every
 *  explanation prompt `course_overview=_truncate_words(overview, 500)`, and
 *  `app/pipeline.py:149` returns `app/overview.py`'s `fallback_overview(...)`
 *  for a course with no syllabus. The model is handed that meta-text and quotes
 *  it back inside its own sentences, as seen on the Fintech course's viewer:
 *
 *    In the context of the course overview ("This overview for “4-Fintech and
 *    AI"), this is where that thread continues.
 *
 *  The banned phrase is inside a parenthetical quotation. The sentence around
 *  it is a real sentence about the slide. So the unit of removal here is the
 *  sentence, and only when a banned phrase is in it:
 *
 *   1. A sentence carrying a banned phrase anywhere, parenthetical or not,
 *      goes. There is no partial removal and no seam to tidy.
 *   2. Nothing without a banned phrase is dropped. Text that carries none comes
 *      back byte for byte, and the join of what survives is re-spaced exactly
 *      once.
 * ---------------------------------------------------------------------- */

/**
 * One sentence, rendered for the reader: `null` when it carries a banned
 * meta-phrase and the sentence itself otherwise. Text with no banned phrase
 * comes back identical.
 */
function renderedSentence(sentence: string): string | null {
  if (!isBanned(sentence)) return sentence;

  // A sentence that carries one of these phrases, however it carries it, goes.
  //
  // The first version of this removed only the parenthetical or quoted span and
  // kept the sentence around it. That was wrong, and a critic found it in the
  // running app. The stored text was:
  //
  //   ... In the context of the course overview ("This overview for
  //   \u201c4-Fintech and AI"), this is where that thread continues.
  //
  // and what shipped was:
  //
  //   ... In the context of the course overview, this is where that thread
  //   continues.
  //
  // The span went and the seam was clean, but the surviving sentence's entire
  // subject is still the model's own artifact, and its antecedent \u2014 "that
  // thread" \u2014 was inside the part that got deleted. So the reader was left
  // with a sentence about nothing, which is the defect this file exists to
  // prevent. DESIGN.md rule 17 bans "any sentence about the model, its sources
  // or its method, printed to the reader", and that sentence is one.
  //
  // A phrase inside a span does not make the sentence innocent; it makes the
  // sentence a quotation of the model talking about itself. 425 stored
  // explanations carry exactly this construction.
  return null;
}

/**
 * What the viewer and the search list render out of stored model prose: the
 * explanation body, its worked example, its heading, a term gloss, a search
 * snippet. Sentences carrying a banned meta-phrase are dropped. This is not
 * `courseProse`, which also drops everything after the first slide scrape:
 * an explanation is teaching and only the sentences that are about the model
 * go, so the rest of the paragraph survives.
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

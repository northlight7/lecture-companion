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

/**
 * Split prose into sentences on `.`, `!` and `?` followed by whitespace.
 *
 * Deliberately not a real NLP splitter: it protects decimal points, ellipses
 * and the handful of abbreviations that appear in course documents, and it
 * leaves a paragraph break as its own boundary. Sentences come back trimmed and
 * with empty ones removed, so `""` in gives `[]` out.
 */
export function splitSentences(text: string): string[] {
  const source = (text ?? "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return [];

  const out: string[] = [];
  let start = 0;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\n") {
      out.push(source.slice(start, i));
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
    out.push(source.slice(start, end));
    start = end;
    i = end - 1;
  }

  out.push(source.slice(start));

  return out.map((sentence) => sentence.trim()).filter(Boolean);
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

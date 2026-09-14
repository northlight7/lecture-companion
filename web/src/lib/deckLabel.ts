/**
 * What a deck is called on screen.
 *
 * A deck's stored title is derived from the filename it was imported under
 * (`_display_title` in `app/importer.py`), so it arrives carrying whatever the
 * person who made the slides put into that name: a container extension, a
 * release marker, underscores where spaces belong, and the odd word in capitals
 * or with no capitals at all. A reader should never be shown
 * `Lec01_Data_and_Vibe_Coding_FINAL.pptx`, and a title that arrived as
 * `lecture 3 - regression` should still read as a title.
 *
 * This is a pure, total function: the same string always gives the same string,
 * and nothing it is handed can throw. It runs at render time only. The stored
 * title, and the filename it came from, are never rewritten.
 *
 * The rules, and the reason each one is here:
 *
 *  1. **Strip a file extension.** `.pptx` and `.pdf` say what container the
 *     slides came in. That is provenance, and the file list already carries it,
 *     so repeating it in the deck's name is noise. Only a short tail of letters
 *     and digits after the LAST dot counts, so a deck named "Week 1.2" keeps its
 *     decimal point and "Lecture 3. Intro" keeps its full stop: neither is a file
 *     type, and stripping them would damage a real name to tidy a guess.
 *
 *  2. **Collapse runs of `_`, `-` and whitespace into one space.** A separator is
 *     a separator whatever it happens to be made of, and a run of them is still
 *     one break between two words. This is what turns `lecture 3 - regression`
 *     into `lecture 3 regression` rather than leaving the hyphen standing as if
 *     it carried meaning.
 *
 *  3. **Trim.** Leading and trailing space is not part of a name. The token pass
 *     below trims as a side effect, which is why there is no separate step.
 *
 *  4. **Drop a trailing release marker.** `FINAL`, `final2`, `DRAFT`, `v2`,
 *     `export` and their like describe the file's history, not the deck: they
 *     say "this is the one I sent", which is a fact about a working directory.
 *     Only a trailing marker goes, so a deck honestly named "Final Exam Review"
 *     keeps every word, and a name the rule would empty is left alone, because a
 *     deck called "Final" is still better than a deck with no name at all.
 *
 *  5. **Re-case a word that carries no case of its own.** A word with no
 *     lower-case letter, or with no upper-case one, is either shouting, which
 *     reads as a filename rather than a title, or flattened, which reads as a
 *     filename too. Both become title case. A word that HAS both cases is left
 *     exactly as it was written, and that is the rule that keeps `Lec01`,
 *     `Codex`, `McKinsey` and `iPad` intact: their author already said how they
 *     should read. An acronym is not excepted, deliberately: `AI` becomes `Ai`
 *     under this rule, and the alternative is a list of acronyms that is wrong
 *     for the next one.
 *
 *  6. **Leave a small word alone, and a number-only token exactly as it is.**
 *     `and`, `of` and `the` are not capitalised in the middle of a title in
 *     English, and the importer's stored titles already have them right, so
 *     rule 5 must not "fix" them into `And`. A token with no letters at all
 *     (`3`, `2024`) is a number rather than a word: it is never re-cased, and it
 *     is never treated as a release marker either, which is why rule 4 matches a
 *     stem with digits welded to it (`final2`, `v2`) rather than dropping bare
 *     numbers. The "2" in "Lecture 2" is content and the 2 in "final2" is not.
 */

/** What a file extension can be: a letter, then up to four more alphanumerics. */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,4}$/;

/** The separator class of rule 2, as a run: underscore, hyphen or whitespace. */
const SEPARATORS = /[\s_-]+/;

/**
 * Release markers, by stem. A marker with digits welded to it ("final2", "v2",
 * "rev3") is the same marker, which is the one place digits are read as part of
 * a word rather than as a number. `v` is in the list on its own because `v2` is
 * the commonest version marker there is and it is the one the stem rule cannot
 * reach any other way.
 */
const RELEASE_MARKERS = new Set([
  "v",
  "ver",
  "version",
  "rev",
  "revision",
  "final",
  "draft",
  "copy",
  "edit",
  "updated",
  "latest",
  "new",
  "fixed",
  "done",
  "export",
]);

/**
 * Words that stay lower case inside a title, in the middle. Never the first
 * word: "The Data Science Course" is capitalised where it opens the name.
 */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from",
  "in", "into", "nor", "of", "on", "or", "the", "to", "vs", "with",
]);

/** True when a token is a release marker, with or without a version digit. */
function isReleaseMarker(token: string): boolean {
  const stem = token.toLowerCase().replace(/\d+$/, "");
  return RELEASE_MARKERS.has(stem);
}

/** True when a token has no letters at all, so it is a number and not a word. */
function isNumberOnly(token: string): boolean {
  return !/[A-Za-z]/.test(token);
}

/** True when a token's case is its own: it has both an upper and a lower letter. */
function hasOwnCase(token: string): boolean {
  return /[a-z]/.test(token) && /[A-Z]/.test(token) && !isShouting(token);
}

/** True when a token is shouting: at least one letter, and no lower-case one. */
function isShouting(token: string): boolean {
  return /[A-Za-z]/.test(token) && token === token.toUpperCase();
}

/** Rule 5: the first letter up, the rest down. Only for a word with no case. */
function titleCase(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * The name to show for a deck, given its stored title.
 *
 * Exported as a pure function rather than inlined into the screen so it can be
 * read, reasoned about and tested on its own: it is the one piece of the course
 * screen that is string surgery rather than layout.
 */
export function deckLabel(title: string): string {
  const source = (title ?? "").trim();
  if (!source) return "";

  const tokens = source.replace(EXTENSION, "").split(SEPARATORS).filter(Boolean);

  // Rule 4, from the end, and never past the last token: a name must not become
  // empty, and only a trailing marker goes.
  while (tokens.length > 1 && isReleaseMarker(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }

  return tokens
    .map((token, index) => {
      if (isNumberOnly(token)) return token;
      if (hasOwnCase(token)) return token;
      if (index > 0 && SMALL_WORDS.has(token.toLowerCase())) return token.toLowerCase();
      return titleCase(token);
    })
    .join(" ");
}

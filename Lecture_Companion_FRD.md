# Lecture Companion — Functional Requirements Document

Version 1.0. Written at the end of the MVP build, as the specification to rebuild from.

---

## 1. Purpose

Lecture Companion is a single-user desktop application that turns a university course's own material into a grounded, plain-language reading companion.

A student imports the files a course gives them: lecture slides, datasets, notebooks, workbooks, handouts, and any syllabus. The application works through the slides in order and writes an explanation of each one, pitched at a reader meeting the material for the first time. The explanations form one continuous text rather than a set of disconnected summaries, so reading them in order reads like a textbook written for that specific course.

Everything the application says is traceable to a page, slide, cell, sheet, or range in the student's own files.

### 1.1 The problem it solves

Lecture slides are written for a room, not for a reader. They assume the lecturer's spoken context and prior familiarity. A student who misses a lecture, or who is new to the field, has the slides but not the explanation. Generic study aids cannot help because they do not know what is on the slides.

### 1.2 The goal

For every slide the student can read an explanation that is:

- **Grounded** in what that slide actually shows, not in general knowledge about the topic.
- **Aware of what came before**, so it can build on it without repeating it.
- **Scoped to one course**, never influenced by another.

Length follows the material. A title slide gets one or two sentences. A dense table gets as much as it needs.

---

## 2. Users

**Primary user.** A postgraduate student working through a taught course, meeting the subject for the first time, possibly in a second language. They are intelligent but not yet fluent in the field's terminology.

**Usage pattern.** Import a term's material once, then read the course in order over weeks. Return to particular slides while revising. Occasionally ask a question about a block of material.

**Not designed for.** Multiple simultaneous users, shared or networked access, institutional administration, or grading.

---

## 3. System context

| Component | Role |
|---|---|
| Desktop application bundle | The product. Owns the window, the process lifecycle, and the local server. |
| Local application server | Serves the interface and the API on the loopback interface. Started and stopped by the application. |
| Local storage | One directory per course, inside the user's own filesystem. |
| DeepSeek API | The only remote service. Generates explanations, glosses, overviews, and folder proposals. |
| Operating system keyring | The only place the API key is stored. |

There is no account, no cloud sync, and no telemetry.

---

## 4. Functional requirements

Requirements are numbered `FR-<area>-<n>`. Each is traceable and testable.

### FR-C Course management

- **FR-C-1** The user can create a course by giving it a title.
- **FR-C-2** The user can see all courses, each with its deck count, slide count, number of slides explained, and its current state.
- **FR-C-3** The user can open a course and see its overview, its decks, its files, and its progress.
- **FR-C-4** The user can delete a course. Deletion removes the course directory and everything derived within it.
- **FR-C-5** Course state is one of: idle, running, paused, partial, done, error.
- **FR-C-6** A course is a sealed container. No operation on one course may read or write another course's data.

### FR-I Import and filing

- **FR-I-1** The user can add files to a course by choosing them, or by choosing a whole folder, or by dropping either onto a target.
- **FR-I-2** Supported formats are PDF, PPTX, DOCX, XLSX, CSV, and IPYNB. Unsupported files are ignored, not errored.
- **FR-I-3** A chosen folder is walked recursively. Files keep their path relative to the chosen folder, so the original hierarchy is preserved and visible.
- **FR-I-4** Files are filed automatically by role: slide decks become decks, everything else becomes a reference or supplementary file. No review step.
- **FR-I-5** Each file is classified with a stated reason, which the user can read.
- **FR-I-6** Original bytes are preserved exactly, and verified by content hash.
- **FR-I-7** Identity is content-addressed. The same bytes imported twice are stored and processed once. A second occurrence keeps its own path and shares the canonical original.
- **FR-I-8** Re-importing identical bytes at the same path is a no-op, reported as unchanged.
- **FR-I-9** Importing different bytes at a path that already exists supersedes the earlier version. The earlier version stops being searchable.
- **FR-I-10** The user can import a mixed pile with no course selected. The application proposes a grouping into courses and writes nothing until the user accepts.
- **FR-I-11** The user can choose a whole folder from the native application, which is the supported path. A browser file-picker fallback exists for development.

### FR-S Study folders

- **FR-S-1** Files within a course can be grouped into named study folders, so a lecture's deck, tutorial, dataset, workbook, and notebook read as one set.
- **FR-S-2** The user can change any file's folder from a menu listing the course's existing folders, the unfiled state, and the option to type a new name.
- **FR-S-3** The user can ask the model to propose a grouping from within-course metadata and bounded source samples.
- **FR-S-4** A proposed grouping is validated deterministically. Invented file identifiers are rejected. A file may appear in at most one folder.
- **FR-S-5** A folder may carry a short reason, which the user can read.
- **FR-S-6** Filing changes only metadata. Originals are never moved or rewritten.
- **FR-S-7** Uncommitted edits survive an automatic refresh of the file list.

### FR-E Explanation generation

- **FR-E-1** The application explains slides in reading order, deck by deck, slide by slide.
- **FR-E-2** Each explanation has a heading, a body, an optional example, and an optional diagram.
- **FR-E-3** Length follows substance. A title, agenda, or logistics slide gets one or two sentences. A dense slide may use more. The body never exceeds 240 words.
- **FR-E-4** The heading names the slide's subject, between three and eight words.
- **FR-E-5** The body explains the subject. It does not describe the slide as an object: not its columns, its layout, its position in the deck, or what it omits.
- **FR-E-6** The body never narrates a bridge to a previous slide. Sentences whose only content is that connection are forbidden.
- **FR-E-7** When the material is a list, a table, or parallel items, it is rendered as a list, one item per line.
- **FR-E-8** A technical term is kept in its correct form and defined in plain words the first time it matters.
- **FR-E-9** No em dash and no semicolon appears in learner-facing text. Output is normalised so a model slip cannot leave one.
- **FR-E-10** An example is given only when it clarifies the slide, and stays under 60 words.
- **FR-E-11** A diagram is produced only when the slide describes a structure, flow, sequence, or relationship worth drawing. It uses plain diagram syntax with no styling, because it is rendered in both light and dark themes.
- **FR-E-12** The explanation receives the course overview, the running summary of what came before, relevant earlier slides, and any files grouped with this deck.
- **FR-E-13** The immediately previous completed slide is mandatory context.
- **FR-E-14** Similarity retrieval contributes only strictly earlier material. Future slides are never supplied, including when regenerating a slide in the middle of a course.
- **FR-E-15** Every explanation records the exact source objects it drew on, and those records are presented to the reader as links.

### FR-P Processing and resumability

- **FR-P-1** The user can start explaining a course, or a single deck within it.
- **FR-P-2** Progress is checkpointed after every slide, before the next one starts.
- **FR-P-3** A slide that already has an explanation is never sent to the model again. This is checked before any context assembly or network call.
- **FR-P-4** A completed slide is never lost by an interruption. The application resumes from the first unexplained slide.
- **FR-P-5** A resume produces the same output as an uninterrupted run.
- **FR-P-6** The user can pause a running course. Pause is honoured at the next slide boundary, so no further work is billed and the position is exact.
- **FR-P-7** A rate limit or an unreachable model pauses the course with its position intact, and says so. It is never an error that loses progress.
- **FR-P-8** A model answer that cannot be read is retried once. Three consecutive failures pause the course and name the slides.
- **FR-P-9** An answer cut off by the token ceiling is recognised as truncation, not as unreadable output, and is retried with a larger budget.
- **FR-P-10** Only one run per course may be active at a time. Starting a second is refused.
- **FR-P-11** If the source of a processed file changes, the work that depended on it is marked stale. A rebuild removes superseded evidence.

### FR-R Regeneration

- **FR-R-1** The user can ask for one slide's explanation to be produced again, replacing what is stored.
- **FR-R-2** The user can ask for an entire deck to be produced again, replacing every slide in it.
- **FR-R-3** Regeneration is the only way a stored explanation is replaced. It is never automatic.
- **FR-R-4** Regenerating one slide leaves every other slide untouched.
- **FR-R-5** Regeneration never removes the reader's own notes, terms, or filings for that slide.
- **FR-R-6** Regenerating a deck runs in the background and reports progress like any other run.
- **FR-R-7** Regenerating a course overview re-distils it from the reference documents.

### FR-A Reader annotations

- **FR-A-1** The reader can select a word or phrase in an explanation and ask for it to be explained.
- **FR-A-2** The gloss is short, plain, and specific to how that slide uses the term, not a general dictionary definition.
- **FR-A-3** Glosses are shown in a section beneath the explanation, each labelling its term.
- **FR-A-4** A gloss is stored against the slide it came from, and is present next time that slide is read.
- **FR-A-5** Asking for the same term again on the same slide updates it rather than duplicating it.
- **FR-A-6** The reader can remove a gloss.
- **FR-A-7** The reader can write free-text notes on any slide, for their own future study.
- **FR-A-8** Notes and glosses persist in the course, and survive re-explaining the slide or re-running the course.
- **FR-A-9** Notes and glosses for one course never appear in another.

### FR-V Reading experience

- **FR-V-1** The reader sees the rendered slide and its explanation side by side.
- **FR-V-2** The explanation uses a serif face at a comfortable reading measure, because it is a text to be read.
- **FR-V-3** Slides can be moved through by keyboard, by paging buttons, and by a numbered strip.
- **FR-V-4** The numbered strip scrolls the current slide into view, so a slide late in a long deck is never invisible.
- **FR-V-5** The text extracted from the slide is available on demand, for checking what the explanation was based on.
- **FR-V-6** A slide with no explanation yet says so, and offers the action that produces one.
- **FR-V-7** The course overview is shown at the top of the course page, folded to three lines if long, with the full text available on request.
- **FR-V-8** Related earlier slides and grouped source files are listed with links that open the exact source.
- **FR-V-9** The interface respects the operating system's light and dark appearance.
- **FR-V-10** All interactive states have visible hover, focus, and pressed feedback. Loading, empty, and error states are designed, not default.

### FR-K Search and knowledge

- **FR-K-1** The reader can search across everything in one course: slide text, explanations, documents, formulas, code, outputs, and dataset fields.
- **FR-K-2** Every result opens the exact source object.
- **FR-K-3** The search method is local and lexical, and is described as such. It is never presented as semantic understanding.
- **FR-K-4** An inspectable alias catalogue connects related vocabulary. Aliases used to expand a query are shown to the reader.
- **FR-K-5** The index is course-local. No index spans courses.
- **FR-K-6** Source changes mark the index stale, and the next search rebuilds it atomically.

### FR-G Concept relationships

- **FR-G-1** The reader can see which files a concept appears in, with measured evidence for each.
- **FR-G-2** Evidence is sampled across files, not filled from the first match.
- **FR-G-3** Explicit filename references between files are shown as measured links.
- **FR-G-4** Suggested prerequisite relationships are labelled as candidates, with an uncertainty warning, unless the source states the dependency.

### FR-Q Questions

- **FR-Q-1** The reader can select up to twelve source objects and ask a question about them.
- **FR-Q-2** The answer cites the exact source objects it used, with locators and quotes.
- **FR-Q-3** The answer states its own uncertainty where it has any.
- **FR-Q-4** The interface discloses what is sent to the remote model and what is not.
- **FR-Q-5** Selecting an object from a different course is refused.

### FR-X Artifact viewing

- **FR-X-1** PDF, PPTX, DOCX, XLSX, CSV, and IPYNB files each have a native read-only viewer.
- **FR-X-2** Every viewer shows the exact source location of what is displayed.
- **FR-X-3** Datasets show a bounded preview with column types, and disclose that it is bounded.
- **FR-X-4** Spreadsheet viewers let the reader move between sheets and jump to a specific range.
- **FR-X-5** Images embedded in documents and plots saved in notebooks are rendered from validated, course-local sources.
- **FR-X-6** The original file can always be downloaded or opened, unchanged.

### FR-N Notebook execution

- **FR-N-1** The reader can run a notebook's code cells, all or a selected subset.
- **FR-N-2** The actual runtime, package versions, and enforced limits are disclosed before the reader confirms.
- **FR-N-3** Execution uses copies of the current course's files and writes only inside a course-scoped run directory.
- **FR-N-4** The operating system sandbox denies network access, child processes, foreign-course reads, and writes outside the run workspace.
- **FR-N-5** A run captures standard output, tables, plots, warnings, errors, and diagnostics.
- **FR-N-6** Every computed result links to the exact source cell that produced it.
- **FR-N-7** Computed results are kept distinct from outputs saved in the notebook itself.
- **FR-N-8** A stopped run resumes from its saved state without repeating completed cells.
- **FR-N-9** No model call is made during execution. This is stated to the reader.

### FR-W Workbook inspection

- **FR-W-1** The reader can have a workbook's formulas inspected and verified.
- **FR-W-2** The inspection reports exact precedents, cached values, units, chart inputs, formatting, and filters.
- **FR-W-3** Source cached values are kept separate from locally calculated values.
- **FR-W-4** A formula verified using cached precedents is labelled as such, and that basis is disclosed.
- **FR-W-5** The reader can run a formula experiment on a course-scoped copy without altering the original.
- **FR-W-6** Original workbook hashes are verified before and after inspection.

### FR-D Deletion

- **FR-D-1** The reader can delete a single file from a course.
- **FR-D-2** File deletion removes every version at that source path, plus orphaned derived data.
- **FR-D-3** Canonical bytes still referenced by another occurrence are preserved.
- **FR-D-4** The reader can delete a whole course.
- **FR-D-5** Deletion is refused while the course is processing.

### FR-CON Connection and credentials

- **FR-CON-1** The reader can paste an API key, which is tested before anything is stored.
- **FR-CON-2** The key is stored only in the operating system keyring. It is never written to a file, a log, or a response body.
- **FR-CON-3** The connection status is shown as a badge, with a masked hint and the model name. The key itself is never displayed.
- **FR-CON-4** Explanations cannot be generated until the connection works, and the application says so.
- **FR-CON-5** A stub model can be selected so the whole pipeline and interface run with no key and no spend.
- **FR-CON-6** The key can be removed.

### FR-APP Desktop application

- **FR-APP-1** The product ships as a desktop application that starts its local server, opens its own window, and stops the server when it quits.
- **FR-APP-2** The application appears in the dock and the application switcher with its own icon.
- **FR-APP-3** The window can be resized and can enter full screen.
- **FR-APP-4** Standard editing shortcuts work in every text field: cut, copy, paste, select all, undo.
- **FR-APP-5** Choosing a folder uses the native folder chooser, which can select either files or folders in one panel.
- **FR-APP-6** Confirmations are presented as native dialogs.
- **FR-APP-7** The server's output is written to a local log file, so a failure can be diagnosed.
- **FR-APP-8** Opening a second copy while one is running is refused.

---

## 5. Non-functional requirements

- **NF-1 Isolation.** Serving or processing course A reads nothing outside course A's directory. No exception.
- **NF-2 Grounding.** No statement is made that the slide or the supplied course context does not support. Where the material is ambiguous, the explanation says so.
- **NF-3 Truthfulness.** Documentation describes what the software does, not what it is meant to do.
- **NF-4 Credential secrecy.** No key, token, or credential is ever committed, logged, or returned.
- **NF-5 Idempotence.** Re-running any operation produces the same result and does not spend again for work already done.
- **NF-6 Performance.** Search returns within about two seconds on a five-course corpus once the index is warm.
- **NF-7 Accessibility.** Text and control contrast meet WCAG AA in both themes. Every control is reachable and operable by keyboard. Focus is managed across navigation.
- **NF-8 No horizontal overflow** at the supported window sizes.
- **NF-9 Portability of user data.** A course is a directory of ordinary files. Nothing about it requires the application to read it.
- **NF-10 Failure is visible.** A failure that affects what the reader sees is reported in the interface, not only in a log.

---

## 6. Data model

All state is files inside one course directory.

| Path | Contents |
|---|---|
| `course.json` | Title, creation time, overview, deck list, file list. |
| `artifacts.json` | One row per file occurrence: identity, content hash, path, kind, role, version, supersession. |
| `raw/` | Original bytes, named by content hash. Written once, never modified. |
| `slides/<deck>/` | Rendered page images and extracted text. |
| `objects/` | Typed learning objects with exact source locators. |
| `explanations/<deck>/` | One explanation per slide. |
| `index.jsonl` | The course-local retrieval index. |
| `progress.json` | State, cursor, completed slides, running summary. |
| `organization.json` | Study-folder assignments and reasons. |
| `terms.json` | Glosses the reader asked for, keyed by slide. |
| `notes.json` | Notes the reader wrote, keyed by slide. |
| `refs/` | Extracted text of reference documents. |

**Learning object.** The unit of evidence. Every object carries a type, a locator, text, and quality information. Locator fields differ by type: page, slide, speaker note, document block, sheet, cell, range, chart, notebook cell, output, or dataset field.

**Identity.** Byte content and path occurrence are separate. Two identical files at different paths share one canonical original and appear as two artifacts.

---

## 7. External interfaces

**DeepSeek API.** OpenAI-compatible chat completions at `https://api.deepseek.com`. Vision model `deepseek-v4-flash-vision-exp`. Images are sent as base64 data URLs. Rate limiting surfaces as HTTP 429 and is handled as a pause. This is the only remote call the application makes.

**Operating system keyring.** Service `lecture-companion`, account `deepseek-api-key`.

**Filesystem.** The user's chosen course root, and the operating system sandbox during notebook execution.

---

## 8. Constraints and known limitations

- **Local, single-user, loopback only.** No network exposure, no concurrency across users.
- **The model is remote.** Explanations require a working key and a reachable service.
- **Extraction fidelity varies.** Four parser degradations were measured and are reported explicitly. Workbooks and notebooks degrade most.
- **Search is lexical.** It is not a semantic model, and does not claim to be.
- **Retrieval is a flat index.** A course is hundreds of slides, not millions, so a vector database was judged unjustified. That judgement should be revisited if courses grow far larger.
- **Only slides have explanations.** Non-slide objects, such as an isolated worksheet or a standalone document, do not yet receive their own explanation.
- **Processing is sequential within a course.** This is deliberate: each slide's context includes the running summary of what came before, so parallelising inside a course would break the continuity that is the product's point. Different courses are independent and could run concurrently, which the backend already permits and the interface does not yet expose.
- **Model calls are billed.** A course of `n` slides costs approximately `n` generation calls plus bookkeeping.

---

## 9. Out of scope for the MVP

Recorded so a rebuild does not silently inherit them, and so they can be planned deliberately:

- Multiple users, accounts, or sharing.
- Mobile or web-hosted deployment.
- Editing or re-exporting the original course material.
- Grading, assessment, or progress tracking beyond explained-slide counts.
- Semester-aware scheduling or calendars.
- Languages other than the language of the course material.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Artifact** | One occurrence of a file at a path within a course. |
| **Canonical original** | The single stored copy of a file's bytes, shared by identical artifacts. |
| **Deck** | A file classified as lecture slides, containing ordered slides. |
| **Explanation** | The generated reading for one slide: heading, body, example, diagram. |
| **Gloss** | A short explanation of one term, requested by the reader. |
| **Learning object** | One typed unit of evidence with an exact source locator. |
| **Overview** | The course-level description every explanation receives as context. |
| **Progress** | The stored state of a course's processing: cursor, completed slides, summary. |
| **Running summary** | The accumulated one-line gists of every slide explained so far. |
| **Stale** | Derived work whose source has changed since it was produced. |
| **Study folder** | A named grouping of a course's files, for the reader's organisation. |

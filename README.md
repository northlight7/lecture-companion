# Lecture Companion

Lecture Companion turns your lecture slides into a per-course, plain-language textbook.

You upload the slides for a course, pick that course, and read each slide alongside a short explanation written in ordinary language, with a concrete example where it fits and the occasional small diagram. The explanation is grounded in what the slide actually shows and builds on the material the course covered earlier, so reading slide after slide feels like following one coherent textbook rather than a pile of disconnected screenshots.

## What it does

- **Reads your slides.** Works from PDF exports and .pptx decks. Each slide is extracted as an image (and its text) so the model can actually see it.
- **Explains each slide in plain language.** Rather than restating the slide, it tells you what it means in the context of the course and the lectures before it.
- **Remembers what you covered.** Explanations are stored per course and retrieved when a later slide needs an earlier concept, so the tool recalls the last lecture instead of starting each slide from scratch.
- **Keeps courses separate.** Everything is scoped to the course you selected, so the memory and context for one course never leak into another.
- **Knows the course requirements.** A syllabus or program breakdown you upload becomes the course overview that every explanation is tailored against.

## How it works (high level)

The app is a small local web server (Python FastAPI) with a browser frontend. Your slides, memory store, and retrieval index all stay on your machine; only the explanation generation reaches out to a model API.

1. **Import.** You drop slide files and any reference documents into a course. The app files them by course and by type (slides vs. a syllabus or program overview) and distills a course overview you upload as context.
2. **Extract.** For each slide, the app renders it to an image and pulls out its text.
3. **Assemble context.** To explain a slide, the app builds a short context: the course overview, a running plain-language summary of everything covered so far, and the most relevant earlier explanations pulled by vector search, scoped strictly to this course.
4. **Generate.** That slide image plus the context goes to a vision model, which returns the explanation (plain restatement, example, and a small diagram only where one helps).
5. **Remember.** The explanation is stored, embedded, and indexed, and the running summary is updated, so the next slide reasons from it in turn.

The flow is deliberately sequential. Each slide is processed one at a time, but always in the light of the course so far, which is what makes the result read like a textbook rather than a series of one-off answers.

## Models

- **Explanation generation:** DeepSeek `deepseek-v4-flash-vision-exp` (remote, vision-capable, key required).
- **Search embeddings:** a small local model, so retrieval runs offline and free.

## Status

Early prototype. The core loop is being built out: course import, the two-pane viewer, per-slide explanation, and per-course retrieval memory.

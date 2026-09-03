/* Lecture Companion frontend.
 *
 * No build step and no framework. One module, three screens, hash routing.
 * The only external dependency is mermaid, loaded lazily from a CDN; when that
 * import fails the diagram falls back to its own source in a <pre>, so a
 * blocked CDN costs a picture, never the page.
 *
 * Every fetch below maps to a route that exists in app/main.py. Nothing here
 * invents backend behaviour.
 */

const $ = (id) => document.getElementById(id);

const els = {
  screens: {
    courses: $("screen-courses"),
    course: $("screen-course"),
    viewer: $("screen-viewer"),
  },
  connBadge: $("conn-badge"),
  connLabel: $("conn-label"),
  toast: $("toast"),
};

const state = {
  route: { name: "courses" },
  connection: null,
  course: null,          // the full GET /api/courses/{cid} payload
  deckId: null,
  slides: [],            // [{index, has_explanation, heading}]
  index: 0,
  poll: null,
};

// ---------------------------------------------------------------- utilities

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, options = {}) {
  const resp = await fetch(path, options);
  const isJson = (resp.headers.get("content-type") || "").includes("json");
  const body = isJson ? await resp.json() : null;
  if (!resp.ok) {
    const message = (body && body.error) || `${resp.status} ${resp.statusText}`;
    throw new ApiError(resp.status, message);
  }
  return body;
}

const getJSON = (path) => api(path);

const postJSON = (path, payload) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });

function postFiles(path, fileList) {
  const form = new FormData();
  for (const file of fileList) form.append("files", file, file.name);
  return api(path, { method: "POST", body: form });
}

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4200);
}

function handle(err) {
  if (err instanceof ApiError && err.status === 428) {
    toast(err.message);
    openConnect();
    return;
  }
  if (err instanceof ApiError && err.status === 429) {
    toast(`Rate limited. ${err.message}`);
    return;
  }
  console.error(err);
  toast(err.message || String(err));
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* A deliberately small markdown subset: fenced code, headings, lists, blank-line
 * paragraphs, inline code, bold and italic. Everything is escaped first, so the
 * model can never inject markup into the reading pane. */
function renderMarkdown(src) {
  const text = String(src ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  const out = [];
  const blocks = text.split(/\n{2,}/);

  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    if (block.startsWith("```")) {
      const body = block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      out.push(`<pre><code>${esc(body.replace(/\n$/, ""))}</code></pre>`);
      continue;
    }
    const heading = block.match(/^(#{1,6})\s+(.*)$/);
    if (heading && !block.includes("\n")) {
      out.push(`<h3>${inline(heading[2])}</h3>`);
      continue;
    }
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*+]\s+/.test(l))) {
      out.push(`<ul>${lines.map((l) =>
        `<li>${inline(l.replace(/^\s*[-*+]\s+/, ""))}</li>`).join("")}</ul>`);
      continue;
    }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      out.push(`<ol>${lines.map((l) =>
        `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`);
      continue;
    }
    out.push(`<p>${inline(block).replace(/\n/g, "<br>")}</p>`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- mermaid

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
let mermaidLib = null;
let mermaidBroken = false;
let mermaidTheme = null;
let diagramSeq = 0;

async function loadMermaid() {
  if (mermaidBroken) return null;
  const theme = darkQuery.matches ? "dark" : "neutral";
  if (mermaidLib && mermaidTheme === theme) return mermaidLib;
  try {
    if (!mermaidLib) {
      const mod = await import(
        "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"
      );
      mermaidLib = mod.default;
    }
    // Theme is picked at the API level, never with an %%{init}%% directive in
    // the model's own mermaid source.
    mermaidLib.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme,
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    mermaidTheme = theme;
    return mermaidLib;
  } catch (err) {
    console.warn("mermaid unavailable, showing diagram source instead", err);
    mermaidBroken = true;
    return null;
  }
}

async function drawDiagram(container) {
  const source = container.dataset.mermaid || "";
  if (!source.trim()) return;
  const lib = await loadMermaid();
  if (!lib) {
    container.innerHTML = `<pre>${esc(source)}</pre>`;
    return;
  }
  try {
    const { svg } = await lib.render(`lc-diagram-${++diagramSeq}`, source);
    container.innerHTML = svg;
  } catch (err) {
    console.warn("mermaid could not render this diagram", err);
    container.innerHTML = `<pre>${esc(source)}</pre>`;
  }
}

darkQuery.addEventListener("change", () => {
  mermaidTheme = null;
  document.querySelectorAll("[data-mermaid]").forEach(drawDiagram);
});

// ---------------------------------------------------------------- connection

async function refreshConnection() {
  try {
    state.connection = await getJSON("/api/connection");
  } catch (err) {
    state.connection = null;
    console.error(err);
  }
  const c = state.connection;
  const badge = els.connBadge;
  if (!c) {
    badge.dataset.state = "off";
    els.connLabel.textContent = "Server unreachable";
  } else if (c.fake) {
    badge.dataset.state = "fake";
    els.connLabel.textContent = "Offline demo mode";
  } else if (c.connected) {
    badge.dataset.state = "ok";
    els.connLabel.textContent = `Connected ${c.hint}`;
  } else {
    badge.dataset.state = "off";
    els.connLabel.textContent = "Not connected";
  }
}

function openConnect() {
  const c = state.connection;
  const line = $("connect-state");
  if (c && c.fake) {
    line.textContent =
      "Offline demo mode is on, so no key is needed. Explanations come from " +
      "the stub client. Unset LC_FAKE_MODEL to use the real model.";
  } else if (c && c.connected) {
    line.textContent = `Connected with key ${c.hint}, using ${c.model}. Paste a new key below to replace it.`;
  } else {
    line.textContent =
      "Paste your DeepSeek key. It is tested before anything is stored, and " +
      "explanations cannot be generated until it works.";
  }
  $("connect-error").hidden = true;
  $("api-key").value = "";
  $("connect-forget").hidden = !(c && c.hint);
  $("connect-dialog").showModal();
}

$("conn-badge").addEventListener("click", openConnect);

$("connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("api-key");
  const errorLine = $("connect-error");
  const button = $("connect-submit");
  const key = input.value.trim();
  errorLine.hidden = true;
  if (!key) {
    errorLine.textContent = "Paste a key first.";
    errorLine.hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = "Testing";
  try {
    const result = await postJSON("/api/connection", { api_key: key });
    if (result.connected) {
      input.value = "";
      await refreshConnection();
      $("connect-dialog").close();
      toast(`Connected. Key ${result.hint} is in your keyring.`);
    } else {
      errorLine.textContent = result.detail || "That key was rejected.";
      errorLine.hidden = false;
    }
  } catch (err) {
    errorLine.textContent = err.message;
    errorLine.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Test and save";
  }
});

$("connect-forget").addEventListener("click", async () => {
  try {
    await api("/api/connection", { method: "DELETE" });
    await refreshConnection();
    $("connect-dialog").close();
    toast("Key removed from the keyring.");
  } catch (err) { handle(err); }
});

// ---------------------------------------------------------------- run bar

function runbarHtml(progress, courseId, deckId) {
  const state_ = progress.state;
  const total = progress.n_slides || 0;
  const done = progress.n_explained || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  if (!total) return "";

  const meter =
    `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${total}"
          aria-valuenow="${done}"><span style="width:${pct}%"></span></div>
     <span class="count">${done} of ${total} explained</span>`;

  const resume = `<button class="btn btn-primary" data-act="process"
      data-course="${esc(courseId)}"${deckId ? ` data-deck="${esc(deckId)}"` : ""}>`;

  if (progress.running || state_ === "running") {
    return `<span class="status">Explaining</span>${meter}
      <div class="acts"><button class="btn btn-quiet" data-act="pause"
        data-course="${esc(courseId)}">Pause</button></div>`;
  }
  if (state_ === "paused") {
    return `<span class="status">Paused</span>${meter}
      <p class="why">${esc(progress.pause_reason || "Paused.")}</p>
      <div class="acts">${resume}Resume from slide ${done + 1}</button></div>`;
  }
  if (state_ === "error") {
    return `<span class="status">Stopped</span>${meter}
      <p class="why">${esc(progress.pause_reason || "Something went wrong.")}</p>
      <div class="acts">${resume}Try again</button></div>`;
  }
  if (done >= total && total > 0) {
    return `<span class="status">Every slide is explained</span>${meter}`;
  }
  return `<span class="status">${done ? "Partly explained" : "Not explained yet"}</span>${meter}
    <div class="acts">${resume}${done ? `Resume from slide ${done + 1}` : "Explain this course"}</button></div>`;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const { act, course, deck } = button.dataset;
  button.disabled = true;
  try {
    if (act === "process") {
      await postJSON(`/api/courses/${encodeURIComponent(course)}/process`,
        { deck_id: deck || null });
      startPolling(course);
    } else if (act === "pause") {
      await postJSON(`/api/courses/${encodeURIComponent(course)}/pause`, {});
      await refreshProgress(course);
    } else if (act === "delete-course") {
      if (!confirm("Delete this course and everything filed into it?")) return;
      await api(`/api/courses/${encodeURIComponent(course)}`, { method: "DELETE" });
      location.hash = "#/";
      await renderCourses();
    }
  } catch (err) {
    handle(err);
  } finally {
    button.disabled = false;
  }
});

// ---------------------------------------------------------------- polling

function stopPolling() {
  if (state.poll) { clearInterval(state.poll); state.poll = null; }
}

function startPolling(courseId) {
  stopPolling();
  refreshProgress(courseId);
  state.poll = setInterval(() => refreshProgress(courseId), 1200);
}

async function refreshProgress(courseId) {
  let progress;
  try {
    progress = await getJSON(`/api/courses/${encodeURIComponent(courseId)}/progress`);
  } catch (err) {
    stopPolling();
    return;
  }
  paintRunbars(courseId, progress);
  if (!progress.running && progress.state !== "running") {
    stopPolling();
    // A finished or paused run changes the slide list and the explanations.
    if (state.route.name === "viewer" && state.route.cid === courseId) {
      await loadSlideList();
      await showSlide(state.index);
    } else if (state.route.name === "course" && state.route.cid === courseId) {
      await renderCourse(courseId);
    }
  } else if (state.route.name === "viewer" && state.route.cid === courseId) {
    await loadSlideList();
  }
}

function paintRunbars(courseId, progress) {
  for (const bar of [$("course-runbar"), $("viewer-runbar")]) {
    if (!bar || bar.closest(".screen").hidden) continue;
    bar.dataset.state = progress.state;
    bar.innerHTML = runbarHtml(progress, courseId, null);
  }
}

// ---------------------------------------------------------------- courses screen

async function renderCourses() {
  const list = $("course-list");
  let courses;
  try {
    courses = await getJSON("/api/courses");
  } catch (err) { handle(err); return; }

  if (!courses.length) {
    list.innerHTML =
      `<p class="empty">No courses yet. Create one above, then drop its slides in.
       Or drop a whole pile below and let the app propose the split.</p>`;
    return;
  }

  list.innerHTML = courses.map((c) => {
    const counts = c.n_slides
      ? `${c.n_explained} of ${c.n_slides} slides explained`
      : "no slides yet";
    const tag = c.state === "idle" ? "" :
      `<span class="tag" data-state="${esc(c.state)}">${esc(c.state)}</span>`;
    return `<a class="course-row" href="#/c/${encodeURIComponent(c.id)}">
      <span class="name">${esc(c.title)}</span>
      ${tag}
      <span class="meta">${plural(c.n_decks, "deck", "decks")} &middot; ${counts}</span>
    </a>`;
  }).join("");
}

$("new-course-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("new-course-title");
  const errorLine = $("new-course-error");
  errorLine.hidden = true;
  const title = input.value.trim();
  if (!title) {
    errorLine.textContent = "Give the course a title.";
    errorLine.hidden = false;
    return;
  }
  try {
    const course = await postJSON("/api/courses", { title });
    input.value = "";
    location.hash = `#/c/${encodeURIComponent(course.id)}`;
  } catch (err) {
    errorLine.textContent = err.message;
    errorLine.hidden = false;
  }
});

// ---------------------------------------------------------------- drop zones

function wireDrop(zoneId, inputId, onFiles) {
  const zone = $(zoneId);
  const input = $(inputId);
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => {
    if (input.files.length) onFiles([...input.files]);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("over");
    }));
  ["dragleave", "drop"].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.remove("over");
    }));
  zone.addEventListener("drop", (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) onFiles(files);
  });
}

let bulkFiles = [];

wireDrop("bulk-drop", "bulk-input", async (files) => {
  bulkFiles = files;
  const box = $("bulk-preview");
  box.hidden = false;
  box.innerHTML = `<p class="muted">Reading ${plural(files.length, "file", "files")}.</p>`;
  try {
    const { groups } = await postFiles("/api/import/preview", files);
    box.innerHTML =
      groups.map((g) => `<div class="preview-group">
          <div class="name">${esc(g.title)}</div>
          <div class="why">${esc(g.reason)}</div>
          <ul>${g.filenames.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        </div>`).join("") +
      `<div class="preview-actions">
         <button class="btn btn-primary" id="bulk-commit">Create ${plural(groups.length, "course", "courses")}</button>
         <button class="btn btn-quiet" id="bulk-cancel">Cancel</button>
       </div>`;
    $("bulk-commit").addEventListener("click", commitBulk);
    $("bulk-cancel").addEventListener("click", () => {
      bulkFiles = [];
      box.hidden = true;
      box.innerHTML = "";
    });
  } catch (err) {
    box.innerHTML = `<p class="field-error">${esc(err.message)}</p>`;
  }
});

async function commitBulk() {
  const button = $("bulk-commit");
  button.disabled = true;
  button.textContent = "Importing";
  try {
    const result = await postFiles("/api/import/bulk", bulkFiles);
    bulkFiles = [];
    $("bulk-preview").hidden = true;
    $("bulk-preview").innerHTML = "";
    await renderCourses();
    toast(`Imported into ${plural(result.courses.length, "course", "courses")}.`);
  } catch (err) {
    handle(err);
    button.disabled = false;
    button.textContent = "Try again";
  }
}

wireDrop("course-drop", "course-input", async (files) => {
  const cid = state.route.cid;
  if (!cid) return;
  const report = $("filed-report");
  report.hidden = false;
  report.innerHTML = `<p class="muted">Filing ${plural(files.length, "file", "files")}.</p>`;
  try {
    const result = await postFiles(`/api/courses/${encodeURIComponent(cid)}/files`, files);
    report.innerHTML =
      `<h3>Filed</h3><ul>${result.filed.map((f) => {
        const what = f.role === "slides"
          ? `${plural(f.n_slides, "slide", "slides")}`
          : "reference document";
        return `<li><strong>${esc(f.filename)}</strong> as ${esc(what)}. ${esc(f.reason)}</li>`;
      }).join("")}</ul>` +
      (result.errors.length
        ? `<h3 class="mt">Could not read</h3><ul>${result.errors.map((e) =>
            `<li>${esc(typeof e === "string" ? e : JSON.stringify(e))}</li>`).join("")}</ul>`
        : "");
    await renderCourse(cid);
  } catch (err) {
    report.innerHTML = `<p class="field-error">${esc(err.message)}</p>`;
  }
});

// ---------------------------------------------------------------- course screen

async function renderCourse(cid) {
  let course;
  try {
    course = await getJSON(`/api/courses/${encodeURIComponent(cid)}`);
  } catch (err) {
    if (err.status === 404) { location.hash = "#/"; return; }
    handle(err);
    return;
  }
  state.course = course;

  $("course-title").textContent = course.title;
  $("course-overview").textContent =
    course.overview ||
    "No overview yet. Drop the syllabus or the programme requirements in and " +
    "the app distils one, so every explanation knows what the course is for.";

  const bar = $("course-runbar");
  bar.dataset.state = course.progress.state;
  bar.innerHTML = runbarHtml(course.progress, cid, null);

  $("deck-list").innerHTML = course.decks.length
    ? course.decks.map((d) => `<a class="deck-row"
        href="#/c/${encodeURIComponent(cid)}/${encodeURIComponent(d.id)}/0">
        <span class="name">${esc(d.title)}</span>
        <span class="meta">${d.n_explained} / ${plural(d.n_slides, "slide", "slides")}</span>
      </a>`).join("")
    : `<p class="empty">No slides in this course yet. Drop a PDF or a .pptx on the right.</p>`;

  $("file-list").innerHTML = course.files.length
    ? course.files.map((f) => `<div class="file-row">
        <span class="name">${esc(f.filename)}</span>
        <span class="meta">${esc(f.role)}</span>
        <span class="why">${esc(f.reason)}</span>
      </div>`).join("")
    : `<p class="empty">Nothing uploaded yet.</p>`;

  if (course.progress.running || course.progress.state === "running") startPolling(cid);
}

// ---------------------------------------------------------------- viewer

async function loadSlideList() {
  const { cid, did } = state.route;
  try {
    state.slides = await getJSON(
      `/api/courses/${encodeURIComponent(cid)}/decks/${encodeURIComponent(did)}/slides`);
  } catch (err) {
    state.slides = [];
    handle(err);
    return;
  }
  const strip = $("slide-strip");
  strip.innerHTML = state.slides.map((s) => `<button class="chip" type="button"
      data-index="${s.index}" data-done="${s.has_explanation ? 1 : 0}"
      aria-current="${s.index === state.index}"
      title="${esc(s.heading || `Slide ${s.index + 1}`)}">${s.index + 1}</button>`).join("");
}

$("slide-strip").addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (chip) goToSlide(Number(chip.dataset.index));
});

function goToSlide(index) {
  const { cid, did } = state.route;
  if (index < 0 || index >= state.slides.length) return;
  location.hash = `#/c/${encodeURIComponent(cid)}/${encodeURIComponent(did)}/${index}`;
}

$("prev-slide").addEventListener("click", () => goToSlide(state.index - 1));
$("next-slide").addEventListener("click", () => goToSlide(state.index + 1));

document.addEventListener("keydown", (event) => {
  if (state.route.name !== "viewer") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = (event.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (document.querySelector("dialog[open]")) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); goToSlide(state.index - 1); }
  if (event.key === "ArrowRight") { event.preventDefault(); goToSlide(state.index + 1); }
});

const SKELETON = `<div class="skel" aria-hidden="true">
  <i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>`;

async function showSlide(index) {
  const { cid, did } = state.route;
  state.index = index;

  const counter = $("slide-counter");
  const reading = $("reading");
  const img = $("slide-img");
  const emptyLine = $("slide-empty");

  document.querySelectorAll(".chip").forEach((chip) =>
    chip.setAttribute("aria-current", String(Number(chip.dataset.index) === index)));

  if (!state.slides.length) {
    counter.textContent = "no slides";
    img.hidden = true;
    emptyLine.hidden = false;
    emptyLine.textContent =
      "This deck has no rendered slides. Upload a PDF or a .pptx to the course first.";
    $("slide-text-wrap").hidden = true;
    reading.innerHTML = `<div class="blank">
      <h3>Nothing to read yet</h3>
      <p>A deck needs slides before it can be explained.</p></div>`;
    return;
  }

  counter.textContent = `${index + 1} of ${state.slides.length}`;
  $("prev-slide").disabled = index === 0;
  $("next-slide").disabled = index === state.slides.length - 1;
  reading.innerHTML = SKELETON;

  const base = `/api/courses/${encodeURIComponent(cid)}/decks/${encodeURIComponent(did)}/slides/${index}`;
  emptyLine.hidden = true;
  img.hidden = false;
  img.src = `${base}/image`;
  img.alt = `Slide ${index + 1}`;

  let payload;
  try {
    payload = await getJSON(base);
  } catch (err) {
    reading.innerHTML = `<div class="blank"><h3>Could not load this slide</h3>
      <p>${esc(err.message)}</p></div>`;
    return;
  }
  if (state.index !== index) return;   // the reader moved on while we fetched

  const slideText = (payload.slide.text || "").trim();
  $("slide-text-wrap").hidden = !slideText;
  $("slide-text").textContent = slideText;

  const exp = payload.explanation;
  if (!exp) {
    const progress = state.course?.progress;
    const busy = progress && (progress.running || progress.state === "running");
    reading.innerHTML = `<div class="blank">
      <h3>Not explained yet</h3>
      <p>${busy
        ? "This course is being explained right now. This slide will fill in as the pipeline reaches it."
        : "Nothing has been generated for this slide. Explaining the course works through it in order and skips anything already done."}</p>
      ${busy ? "" : `<button class="btn btn-primary" data-act="process"
          data-course="${esc(cid)}" data-deck="${esc(did)}">Explain this deck</button>`}
    </div>`;
    return;
  }

  const parts = [];
  parts.push(`<p class="kicker">Slide ${index + 1} of ${state.slides.length}</p>`);
  parts.push(`<h2>${esc(exp.heading || `Slide ${index + 1}`)}</h2>`);
  parts.push(renderMarkdown(exp.body));
  if ((exp.example || "").trim()) {
    parts.push(`<aside class="example">
      <p class="kicker">For example</p>${renderMarkdown(exp.example)}</aside>`);
  }
  if ((exp.mermaid || "").trim()) {
    parts.push(`<figure class="diagram" data-mermaid="${esc(exp.mermaid)}">
      <pre>${esc(exp.mermaid)}</pre></figure>`);
  }
  if (exp.context_used && exp.context_used.length) {
    const links = exp.context_used.map((chunk) => {
      const [deck, slideIndex] = String(chunk).split(":");
      const label = `Slide ${Number(slideIndex) + 1}`;
      if (deck && slideIndex !== undefined && !Number.isNaN(Number(slideIndex))) {
        return `<li><a href="#/c/${encodeURIComponent(cid)}/${encodeURIComponent(deck)}/${Number(slideIndex)}">${esc(label)}</a></li>`;
      }
      return `<li>${esc(chunk)}</li>`;
    }).join("");
    parts.push(`<div class="drawn">Written with these earlier slides in view:<ul>${links}</ul></div>`);
  }
  reading.innerHTML = parts.join("\n");
  reading.querySelectorAll("[data-mermaid]").forEach(drawDiagram);
}

async function renderViewer() {
  const { cid, did, index } = state.route;
  if (!state.course || state.course.id !== cid) {
    try {
      state.course = await getJSON(`/api/courses/${encodeURIComponent(cid)}`);
    } catch (err) {
      if (err.status === 404) { location.hash = "#/"; return; }
      handle(err);
      return;
    }
  }
  const deck = state.course.decks.find((d) => d.id === did);
  $("viewer-back").href = `#/c/${encodeURIComponent(cid)}`;
  $("viewer-back").textContent = state.course.title;
  $("viewer-title").textContent = deck ? deck.title : "Deck";

  const bar = $("viewer-runbar");
  bar.dataset.state = state.course.progress.state;
  bar.innerHTML = runbarHtml(state.course.progress, cid, did);

  await loadSlideList();
  await showSlide(Math.min(Math.max(index, 0), Math.max(state.slides.length - 1, 0)));

  if (state.course.progress.running || state.course.progress.state === "running") {
    startPolling(cid);
  }
}

// ---------------------------------------------------------------- routing

function parseHash() {
  const raw = (location.hash || "#/").replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "c" && parts.length >= 4) {
    return { name: "viewer", cid: parts[1], did: parts[2], index: Number(parts[3]) || 0 };
  }
  if (parts[0] === "c" && parts.length >= 2) {
    return { name: "course", cid: parts[1] };
  }
  return { name: "courses" };
}

function showScreen(name) {
  for (const [key, node] of Object.entries(els.screens)) node.hidden = key !== name;
}

async function route() {
  const next = parseHash();
  const sameDeck =
    state.route.name === "viewer" && next.name === "viewer" &&
    state.route.cid === next.cid && state.route.did === next.did;
  state.route = next;
  showScreen(next.name);

  if (next.name === "courses") {
    stopPolling();
    state.course = null;
    await renderCourses();
  } else if (next.name === "course") {
    stopPolling();
    await renderCourse(next.cid);
  } else if (sameDeck) {
    // Only the slide index moved: do not refetch the whole deck.
    await showSlide(next.index);
  } else {
    stopPolling();
    await renderViewer();
  }
}

window.addEventListener("hashchange", route);

refreshConnection().then(route);

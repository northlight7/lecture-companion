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
    artifact: $("screen-artifact"),
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
  artifact: null,
  artifactObjects: [],
  artifactOffset: 0,
  artifactSheet: "",
  selectedObjects: new Map(),
  execution: null,
  workbook: null,
};

let executionTimer = null;

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

const putJSON = (path, payload) =>
  api(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });

function postFiles(path, fileList) {
  const form = new FormData();
  for (const file of fileList) {
    const sourcePath = file.webkitRelativePath || file.name;
    form.append("files", file, sourcePath);
  }
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
  const { act, course, deck, artifact, filename } = button.dataset;
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
    } else if (act === "delete-file") {
      if (!confirm(`Delete ${filename || "this file"} and its generated data?`)) return;
      await api(
        `/api/courses/${encodeURIComponent(course)}/artifacts/${encodeURIComponent(artifact)}`,
        { method: "DELETE" },
      );
      await renderCourse(course);
      toast(`${filename || "File"} deleted.`);
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
      `<p class="empty">No courses yet. Create one above, then drop its course files in.
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

async function previewBulkFiles(files) {
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
}

wireDrop("bulk-drop", "bulk-input", previewBulkFiles);

function wireFolderPicker(buttonId, inputId, mode, onFiles) {
  const button = $(buttonId);
  const input = $(inputId);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const nativePicker = window.webkit?.messageHandlers?.folderPicker;
    if (nativePicker) {
      if (mode === "bulk") {
        $("bulk-preview").hidden = false;
        $("bulk-preview").innerHTML = `<p class="muted">Choose a folder to import.</p>`;
      } else {
        $("filed-report").hidden = false;
        $("filed-report").innerHTML = `<p class="muted">Choose a folder to import into this course.</p>`;
      }
      nativePicker.postMessage({ mode, courseId: mode === "course" ? state.route.cid : "" });
      return;
    }
    input.click();
  });
  input.addEventListener("change", () => {
    if (input.files.length) onFiles([...input.files]);
    input.value = "";
  });
}

wireFolderPicker("bulk-folder-picker", "bulk-folder-input", "bulk", previewBulkFiles);

window.nativeFolderImportFinished = async ({ mode, ok, message }) => {
  if (!ok) {
    if (mode === "bulk") {
      $("bulk-preview").hidden = false;
      $("bulk-preview").innerHTML = `<p class="field-error">${esc(message)}</p>`;
    } else {
      $("filed-report").hidden = false;
      $("filed-report").innerHTML = `<p class="field-error">${esc(message)}</p>`;
    }
    return;
  }
  toast(message);
  if (mode === "bulk") {
    $("bulk-preview").hidden = true;
    await renderCourses();
  } else if (state.route.name === "course") {
    $("filed-report").hidden = true;
    await renderCourse(state.route.cid);
  }
};

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

async function uploadCourseFiles(files) {
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
          : `${String(f.kind || f.role || "course").toUpperCase()} artifact`;
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
}

wireDrop("course-drop", "course-input", uploadCourseFiles);
wireFolderPicker("course-folder-picker", "course-folder-input", "course", uploadCourseFiles);

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
  $("delete-course").dataset.course = cid;
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
    : `<p class="empty">No slide deck in this course yet. Other imported artifacts remain available in the file list.</p>`;

  const artifacts = course.artifacts || [];
  const folderNames = [...new Set(artifacts.map((a) => a.folder).filter(Boolean))].sort();
  $("folder-options").innerHTML = folderNames.map((name) => `<option value="${esc(name)}"></option>`).join("");
  const groups = new Map();
  for (const artifact of artifacts) {
    const folder = artifact.folder || "Unfiled";
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(artifact);
  }
  const groupRows = [...groups.entries()].sort(([a], [b]) =>
    a === "Unfiled" ? 1 : b === "Unfiled" ? -1 : a.localeCompare(b));
  $("file-list").innerHTML = artifacts.length
    ? groupRows.map(([folder, rows]) => {
      const reason = rows.find((item) => item.folder_reason)?.folder_reason || "";
      return `<section class="study-folder">
        <div class="study-folder-head"><h3>${esc(folder)}</h3>${reason ? `<p>${esc(reason)}</p>` : ""}</div>
        ${rows.map((a) => `<div class="file-row-wrap">
          <a class="file-row" href="#/c/${encodeURIComponent(cid)}/a/${encodeURIComponent(a.id)}">
            <span class="name">${esc(a.source_path || a.filename)}</span>
            <span class="meta">${esc(a.kind.toUpperCase())} · ${esc(a.purpose.replaceAll("_", " "))}</span>
            <span class="why">${plural(a.object_count, "source object", "source objects")}${a.extraction_warnings.length ? " · extraction warning" : ""}</span>
          </a>
          <label class="folder-field">Study folder
            <input class="folder-input" data-artifact="${esc(a.id)}" list="folder-options" maxlength="80" value="${esc(a.folder || "")}" placeholder="Unfiled">
          </label>
          <button class="btn btn-danger file-delete" type="button" data-act="delete-file"
            data-course="${esc(cid)}" data-artifact="${esc(a.id)}" data-filename="${esc(a.filename)}">Delete</button>
        </div>`).join("")}
      </section>`;
    }).join("")
    : `<p class="empty">Nothing uploaded yet.</p>`;

  $("organization-status").textContent = artifacts.length
    ? "DeepSeek receives file names, imported paths, purposes, and short extracted samples only from this course."
    : "Add files before creating study folders.";

  $("search-results").innerHTML = "";
  $("concept-graph").hidden = true;
  $("concept-graph").innerHTML = "";
  try {
    const knowledge = await getJSON(`/api/courses/${encodeURIComponent(cid)}/knowledge/status`);
    paintKnowledgeStatus(knowledge, false);
  } catch (err) {
    $("knowledge-status").textContent = "Search status is unavailable.";
  }

  if (course.progress.running || course.progress.state === "running") startPolling(cid);
}

$("save-folders").addEventListener("click", async () => {
  const cid = state.route.cid;
  if (!cid) return;
  const assignments = {};
  document.querySelectorAll(".folder-input").forEach((input) => {
    const name = input.value.trim();
    if (name) assignments[input.dataset.artifact] = name;
  });
  try {
    await putJSON(`/api/courses/${encodeURIComponent(cid)}/organization`, { assignments });
    await renderCourse(cid);
    toast("Study folders saved.");
  } catch (err) {
    handle(err);
  }
});

$("organize-files").addEventListener("click", async () => {
  const cid = state.route.cid;
  if (!cid) return;
  const button = $("organize-files");
  button.disabled = true;
  $("organization-status").textContent = "DeepSeek is matching related course files.";
  try {
    await postJSON(`/api/courses/${encodeURIComponent(cid)}/organization/suggest`, {});
    await renderCourse(cid);
    toast("DeepSeek organized the files. You can edit and save any folder name.");
  } catch (err) {
    handle(err);
    $("organization-status").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

function paintKnowledgeStatus(index, rebuilt) {
  const status = $("knowledge-status");
  if (rebuilt) {
    status.textContent = `Search refreshed from ${index.artifact_count} current source files and ${index.object_count} exact source objects.`;
    status.dataset.state = "ready";
  } else if (index.stale) {
    status.textContent = `Search needs refresh: ${index.reasons.join(", ")}. It will rebuild locally when you search or open relationships.`;
    status.dataset.state = "stale";
  } else {
    status.textContent = `Local search is current for ${index.artifact_count} source files and ${index.object_count} source objects.`;
    status.dataset.state = "ready";
  }
}

function searchResultHtml(row, cid) {
  return `<article class="search-result">
    <div class="search-result-head">
      <span class="native-object-type">${esc(row.artifact_kind)} · ${esc(row.object_type)}</span>
      <span class="match-reason">${esc(row.matched_by)}</span>
    </div>
    <a class="search-result-link" href="${sourceHash(cid, row.artifact_id, row.object_id)}">
      <strong>${esc(row.artifact_filename)}</strong> · ${esc(row.location)}
    </a>
    <p>${esc(row.snippet || "Structured source object")}</p>
    ${row.relationship_reason ? `<p class="relationship-reason">Why related: ${esc(row.relationship_reason)}</p>` : ""}
    <p class="help">Version ${esc(row.artifact_version)} · ${esc(row.artifact_purpose.replaceAll("_", " "))}</p>
  </article>`;
}

$("course-search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const cid = state.route.cid;
  const query = $("course-search-query").value.trim();
  if (!cid || !query) return;
  const results = $("search-results");
  results.innerHTML = SKELETON;
  try {
    const found = await getJSON(`/api/courses/${encodeURIComponent(cid)}/search?q=${encodeURIComponent(query)}&limit=20`);
    paintKnowledgeStatus(found.index, found.rebuilt);
    const expansion = found.expanded_concepts?.length
      ? `<p class="help">Expanded through: ${found.expanded_concepts.map(esc).join(", ")}. ${esc(found.method)}</p>`
      : `<p class="help">${esc(found.method)}</p>`;
    results.innerHTML = expansion + (found.results.length
      ? found.results.map((row) => searchResultHtml(row, cid)).join("")
      : `<p class="empty">No matching source objects in this course.</p>`);
  } catch (err) {
    results.innerHTML = `<p class="field-error">${esc(err.message)}</p>`;
  }
});

function graphHtml(graph, cid) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const concepts = graph.nodes.filter((node) => node.node_type === "concept");
  const evidence = graph.edges.filter((edge) => edge.relation === "appears_in");
  const prerequisites = graph.edges.filter((edge) => edge.relation === "prerequisite_candidate");
  const artifactLinks = graph.edges.filter((edge) => edge.relation === "explicit_reference");
  const conceptCards = concepts.map((concept) => {
    const links = evidence.filter((edge) => edge.from === concept.id).map((edge) => {
      const artifact = nodes.get(edge.to);
      const oid = edge.object_ids[0];
      return `<li><a href="${sourceHash(cid, artifact.artifact_id, oid)}">${esc(artifact.label)}</a>
        <span>${esc(artifact.kind)} · ${esc(edge.reason)}</span></li>`;
    }).join("");
    return `<article class="concept-node">
      <button class="concept-search" type="button" data-concept="${esc(concept.label)}">${esc(concept.label)}</button>
      <p class="help">${concept.artifact_count} files · ${concept.evidence_count} evidence links · ${esc(concept.kind.replaceAll("_", " "))}</p>
      <ul>${links || "<li>No current artifact link.</li>"}</ul>
    </article>`;
  }).join("");
  const prerequisiteRows = prerequisites.map((edge) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    return `<li><strong>${esc(from.label)}</strong> → <strong>${esc(to.label)}</strong><br><span>${esc(edge.reason)}</span></li>`;
  }).join("");
  const artifactRows = artifactLinks.map((edge) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    return `<li><a href="${sourceHash(cid, from.artifact_id, edge.source_object_id)}">${esc(from.label)}</a> →
      <a href="${sourceHash(cid, to.artifact_id, edge.target_object_id)}">${esc(to.label)}</a>
      <span>${esc(edge.reason)} ${esc(edge.certainty)}.</span></li>`;
  }).join("");
  return `<div class="graph-heading"><div><h3>Course concept graph</h3><p class="help">Concept-to-file lines use measured source matches. Arrows below are visibly labeled candidates.</p></div></div>
    <div class="concept-network">${conceptCards || `<p class="empty">No cross-file concepts were found.</p>`}</div>
    ${artifactRows ? `<h3>Explicit file relationships</h3><ul class="prerequisite-list">${artifactRows}</ul>` : ""}
    ${prerequisiteRows ? `<h3>Prerequisite candidates</h3><ul class="prerequisite-list">${prerequisiteRows}</ul>` : ""}
    <p class="quality-warning">${esc(graph.warning)}</p>`;
}

$("show-relationships").addEventListener("click", async () => {
  const cid = state.route.cid;
  if (!cid) return;
  const graph = $("concept-graph");
  graph.hidden = false;
  graph.innerHTML = SKELETON;
  try {
    const payload = await getJSON(`/api/courses/${encodeURIComponent(cid)}/concepts?limit=24`);
    paintKnowledgeStatus(payload.index, payload.rebuilt);
    graph.innerHTML = graphHtml(payload, cid);
  } catch (err) {
    graph.innerHTML = `<p class="field-error">${esc(err.message)}</p>`;
  }
});

$("concept-graph").addEventListener("click", (event) => {
  const button = event.target.closest(".concept-search");
  if (!button) return;
  $("course-search-query").value = button.dataset.concept;
  $("course-search").requestSubmit();
});

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
      "This deck has no rendered slides. Open another artifact from the course file list.";
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
      if (String(chunk).startsWith("object:")) {
        const [, artifactId, ...objectParts] = String(chunk).split(":");
        const objectId = objectParts.join(":");
        const artifact = (state.course?.artifacts || []).find((item) => item.id === artifactId);
        const label = artifact ? `${artifact.filename} (related file)` : "Related course source";
        return `<li><a href="${sourceHash(cid, artifactId, objectId)}">${esc(label)}</a></li>`;
      }
      const [deck, slideIndex] = String(chunk).split(":");
      const sourceDeck = state.course?.decks.find((item) => item.id === deck);
      const isPrevious = deck === did && Number(slideIndex) === index - 1;
      const label = `${sourceDeck?.title || "Deck"}, slide ${Number(slideIndex) + 1}${isPrevious ? " (previous slide)" : ""}`;
      if (deck && slideIndex !== undefined && !Number.isNaN(Number(slideIndex))) {
        return `<li><a href="#/c/${encodeURIComponent(cid)}/${encodeURIComponent(deck)}/${Number(slideIndex)}">${esc(label)}</a></li>`;
      }
      return `<li>${esc(chunk)}</li>`;
    }).join("");
    parts.push(`<div class="drawn">Earlier slides and grouped sources connected to this topic:<ul>${links}</ul></div>`);
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

// ------------------------------------------------------- artifact viewer

function locatorText(obj) {
  const loc = obj?.locator || {};
  const parts = [];
  if (loc.page != null) parts.push(`page ${loc.page}`);
  if (loc.slide != null) parts.push(`slide ${loc.slide}`);
  if (loc.note != null) parts.push(`note ${loc.note}`);
  if (loc.block != null) parts.push(`block ${Number(loc.block) + 1}`);
  if (loc.sheet) parts.push(`sheet ${loc.sheet}`);
  if (loc.cell_range) parts.push(loc.cell_range);
  if (loc.chart) parts.push(`chart ${loc.chart}`);
  if (loc.notebook_cell != null) parts.push(`notebook cell ${Number(loc.notebook_cell) + 1}`);
  if (loc.output != null) parts.push(`output ${Number(loc.output) + 1}`);
  if (loc.dataset_field) parts.push(`field ${loc.dataset_field}`);
  return parts.join(", ") || obj?.object_type?.replaceAll("_", " ") || "source";
}

function sourceHash(cid, aid, oid = "") {
  const base = `#/c/${encodeURIComponent(cid)}/a/${encodeURIComponent(aid)}`;
  return oid ? `${base}/${encodeURIComponent(oid)}` : base;
}

function tableHtml(rows) {
  if (!rows?.length) return "";
  return `<div class="native-table-wrap"><table class="native-table"><tbody>${rows.map((row) =>
    `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function objectCard(obj, artifact, cid, currentOid) {
  const link = sourceHash(cid, artifact.id, obj.id);
  const checked = state.selectedObjects.has(obj.id) ? " checked" : "";
  const current = obj.id === currentOid ? " current" : "";
  let body = "";
  if ((obj.object_type === "page" || obj.object_type === "slide") &&
      (obj.locator.page || obj.locator.slide)) {
    const number = obj.locator.page || obj.locator.slide;
    body = `<img class="native-page" loading="lazy" src="/api/courses/${encodeURIComponent(cid)}/artifacts/${encodeURIComponent(artifact.id)}/render/${number}" alt="${esc(locatorText(obj))}">
      <details><summary>Extracted text</summary><pre>${esc(obj.text)}</pre></details>`;
  } else if (obj.object_type === "table") {
    body = tableHtml(obj.data.rows || []) || `<pre>${esc(obj.text)}</pre>`;
  } else if (obj.object_type === "notebook_cell") {
    const tag = obj.data.cell_type === "code" ? "pre" : "div";
    body = `<${tag}>${esc(obj.text)}</${tag}>`;
  } else if (obj.object_type === "notebook_output") {
    const hasImage = (obj.data.mime_types || []).some((type) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type));
    const visual = hasImage
      ? `<img class="native-embedded" loading="lazy" src="/api/courses/${encodeURIComponent(cid)}/artifacts/${encodeURIComponent(artifact.id)}/objects/${encodeURIComponent(obj.id)}/media" alt="Saved output from ${esc(locatorText(obj))}">`
      : "";
    const outputText = obj.text || obj.data.evalue || (!hasImage ? JSON.stringify(obj.data.data || {}) : "");
    body = visual + (outputText ? `<pre>${esc(outputText)}</pre>` : "");
  } else if (obj.object_type === "image") {
    body = `<img class="native-embedded" loading="lazy" src="/api/courses/${encodeURIComponent(cid)}/artifacts/${encodeURIComponent(artifact.id)}/objects/${encodeURIComponent(obj.id)}/media" alt="Embedded image at ${esc(locatorText(obj))}">
      <p class="muted">${esc(obj.data.part_name || "Embedded document image")}</p>`;
  } else if (obj.object_type === "dataset") {
    const fields = obj.data.fields || [];
    const rows = [fields, ...(obj.data.sample_rows || []).map((row) => fields.map((field) => row[field] ?? ""))];
    body = `<p>${obj.data.row_count} rows, ${obj.data.column_count} columns. Bounded local preview.</p>${tableHtml(rows)}`;
  } else if (obj.object_type === "sheet") {
    body = `<dl class="sheet-metadata">
      <dt>Dimensions</dt><dd>${esc(obj.data.dimensions || obj.locator.cell_range || "unknown")}</dd>
      <dt>State</dt><dd>${esc(obj.data.state || "visible")}</dd>
      <dt>Freeze panes</dt><dd>${esc(obj.data.freeze_panes || "none")}</dd>
      <dt>Filter</dt><dd>${esc(obj.data.auto_filter || "none")}</dd>
      <dt>Merged ranges</dt><dd>${esc((obj.data.merged_ranges || []).join(", ") || "none")}</dd>
      <dt>Hidden rows</dt><dd>${esc((obj.data.hidden_rows || []).join(", ") || "none")}</dd>
      <dt>Hidden columns</dt><dd>${esc((obj.data.hidden_columns || []).join(", ") || "none")}</dd>
      <dt>Conditional formatting rules</dt><dd>${esc(obj.data.conditional_formatting_rules ?? 0)}</dd>
      <dt>Validation ranges</dt><dd>${esc((obj.data.data_validations || []).join(", ") || "none")}</dd>
    </dl>`;
  } else if (obj.object_type === "dataset_field") {
    body = `<p>Type: ${esc(obj.data.inferred_type || "unknown")}. Missing: ${esc(obj.data.missing_count ?? 0)} of ${esc(obj.data.row_count ?? "unknown")}. Unique values: ${esc(obj.data.unique_count ?? "unknown")}.</p>
      <p>Samples: ${esc((obj.data.samples || []).join(", ") || "none")}</p>`;
  } else {
    body = obj.text ? `<pre>${esc(obj.text)}</pre>` : `<pre>${esc(JSON.stringify(obj.data, null, 2))}</pre>`;
  }
  return `<article class="native-object${current}" id="source-${esc(obj.id)}" data-object-id="${esc(obj.id)}">
    <div class="native-object-head">
      <input type="checkbox" class="source-select" data-object-id="${esc(obj.id)}" aria-label="Select ${esc(locatorText(obj))}"${checked}>
      <span class="native-object-type">${esc(obj.object_type.replaceAll("_", " "))}</span>
      <a class="source-location" href="${link}">${esc(locatorText(obj))}</a>
    </div>${body}</article>`;
}

function spreadsheetHtml(objects, artifact, cid, currentOid) {
  const cells = objects.filter((obj) => obj.object_type === "cell");
  const sheets = objects.filter((obj) => obj.object_type === "sheet");
  const others = objects.filter((obj) => obj.object_type !== "cell" && obj.object_type !== "sheet");
  const sheetCards = sheets.map((obj) => objectCard(obj, artifact, cid, currentOid)).join("");
  if (!cells.length) return sheetCards + others.map((obj) => objectCard(obj, artifact, cid, currentOid)).join("");
  const rows = new Map();
  for (const obj of cells) {
    const match = String(obj.locator.cell_range || "").match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const row = Number(match[2]);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(obj);
  }
  const grid = `<div class="native-table-wrap"><table class="native-table"><tbody>${[...rows.entries()].sort((a,b) => a[0]-b[0]).map(([row, items]) =>
    `<tr><th scope="row">${row}</th>${items.map((obj) => `<td data-object-id="${esc(obj.id)}" class="${obj.id === currentOid ? "current" : ""}">
      <label><input type="checkbox" class="source-select" data-object-id="${esc(obj.id)}"${state.selectedObjects.has(obj.id) ? " checked" : ""}>
      <a href="${sourceHash(cid, artifact.id, obj.id)}">${esc(obj.locator.cell_range)}</a></label><br>${esc(obj.text)}
      ${obj.data.formula ? `<small>Formula: ${esc(obj.data.formula)} · Cached: ${esc(obj.data.cached_value)}</small>` : ""}</td>`).join("")}</tr>`
  ).join("")}</tbody></table></div>`;
  return sheetCards + grid + others.map((obj) => objectCard(obj, artifact, cid, currentOid)).join("");
}

function executionBase() {
  const { cid, aid } = state.route;
  return `/api/courses/${encodeURIComponent(cid)}/artifacts/${encodeURIComponent(aid)}/execution`;
}

function workbookBase() {
  const { cid, aid } = state.route;
  return `/api/courses/${encodeURIComponent(cid)}/artifacts/${encodeURIComponent(aid)}/workbook`;
}

function evidenceLink(evidence) {
  const locator = evidence.locator || {};
  const label = `${locator.sheet || "sheet"}!${locator.cell_range || "range"}`;
  return evidence.object_id
    ? `<a href="${sourceHash(state.route.cid, state.route.aid, evidence.object_id)}">${esc(label)}</a>`
    : esc(label);
}

function formulaFindingHtml(row) {
  const status = row.verification_state === "verified_using_cached_precedents"
    ? "partial: cached precedent"
    : row.verification_state === "verified"
    ? (row.matches_cached === false ? "mismatch" : "verified")
    : row.verification_state;
  const cls = status === "verified" ? "finding-pass" : "finding-warning";
  const source = row.object_id
    ? `<a href="${sourceHash(state.route.cid, state.route.aid, row.object_id)}">${esc(row.locator.sheet)}!${esc(row.locator.cell_range)}</a>`
    : `${esc(row.locator.sheet)}!${esc(row.locator.cell_range)}`;
  const intermediate = (row.intermediate || []).map((item) => item.locator
    ? `<li>${evidenceLink(item)}: ${esc(item.nonblank_count)} nonblank cells, sample ${esc((item.sample || []).join(", "))}</li>`
    : `<li>${esc(item.matching_rows)} matching rows for criteria ${esc((item.criteria || []).join(", "))}</li>`).join("");
  return `<article class="workbook-finding" data-formula-cell="${esc(row.locator.cell_range)}">
    <h3>${source} · <span class="${cls}">${esc(status)}</span></h3>
    <code>${esc(row.formula)}</code>
    <p>Cached source value: <strong>${esc(row.cached_value)}</strong>. Local check value: <strong>${esc(row.calculated_value)}</strong>.</p>
    <p>Calculation basis: ${esc(row.calculation_basis)}.</p>
    <p>Unit: ${esc(row.unit)}. ${esc(row.unit_basis)}.</p>
    ${row.error ? `<p class="field-error">${esc(row.error)}</p>` : ""}
    ${intermediate ? `<details><summary>Intermediate source evidence</summary><ul>${intermediate}</ul></details>` : ""}
  </article>`;
}

function chartFindingHtml(chart) {
  const source = chart.object_id
    ? `<a href="${sourceHash(state.route.cid, state.route.aid, chart.object_id)}">${esc(chart.title)}</a>`
    : esc(chart.title);
  const ranges = chart.series.flatMap((series) => Object.values(series.evidence || {})).map((item) => item.error
    ? `<li class="finding-warning">${esc(item.reference)}: ${esc(item.error)}</li>`
    : `<li>${evidenceLink(item)}: ${esc(item.cell_count)} cells</li>`).join("");
  const diagnostics = chart.diagnostics.map((item) =>
    `<p class="${item.severity === "info" ? "finding-pass" : "finding-warning"}">${esc(item.message)}</p>`).join("");
  return `<article class="workbook-finding"><h3>${source} · ${esc(chart.chart_type)}</h3>
    ${diagnostics}<details><summary>Exact chart input ranges</summary><ul>${ranges}</ul></details></article>`;
}

function formattingFindingHtml(row) {
  const where = evidenceLink(row);
  if (row.kind === "conditional_formatting") {
    return `<li>${where}: priority ${esc(row.priority)}, ${esc(row.rule_type)}${row.stop_if_true ? ", Stop If True" : ""}${row.formula?.length ? `, formula ${esc(row.formula.join(", "))}` : ""}</li>`;
  }
  if (row.kind === "auto_filter") {
    return `<li>${where}: ${esc(row.columns.length)} filter columns, ${esc(row.sort.length)} sort conditions</li>`;
  }
  return `<li>${where}: sheet ${esc(row.sheet_state)}, hidden rows ${esc((row.hidden_rows || []).join(", ") || "none")}, hidden columns ${esc((row.hidden_columns || []).join(", ") || "none")}</li>`;
}

function paintWorkbook(audit) {
  state.workbook = audit;
  $("workbook-state").textContent = audit.cache_hit ? "Current" : "Inspected";
  const summary = audit.summary;
  const formulas = [...audit.formulas].sort((a, b) =>
    Number(a.matches_cached !== false) - Number(b.matches_cached !== false) ||
    Number(a.verification_state === "verified") - Number(b.verification_state === "verified"));
  $("workbook-results").innerHTML = `
    <p><strong>${esc(summary.formulas_independently_verified)} of ${esc(summary.formula_count)}</strong> formulas independently verified. ${esc(summary.cached_mismatches)} cached mismatches. ${esc(summary.charts)} charts inspected.</p>
    <details open><summary>Formula checks</summary>${formulas.slice(0, 12).map(formulaFindingHtml).join("") || "<p>No formulas.</p>"}</details>
    <details><summary>Chart checks</summary>${audit.charts.map(chartFindingHtml).join("") || "<p>No charts.</p>"}</details>
    <details><summary>Filters, formatting, and hidden structure</summary><ul>${audit.formatting_and_filters.map(formattingFindingHtml).join("") || "<li>No stored rules found.</li>"}</ul></details>
    <details><summary>Limits and uncertainty</summary><ul>${audit.uncertainty.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></details>`;
}

async function loadWorkbookPanel() {
  const panel = $("workbook-panel");
  if (state.artifact?.kind !== "xlsx") {
    panel.hidden = true;
    state.workbook = null;
    return;
  }
  panel.hidden = false;
  const status = await getJSON(`${workbookBase()}/status`);
  $("workbook-state").textContent = status.exists ? (status.stale ? "Stale" : "Ready") : "Not inspected";
  if (status.exists && !status.stale) {
    paintWorkbook(await postJSON(`${workbookBase()}/inspect`, {}));
  } else {
    $("workbook-results").innerHTML = status.stale
      ? `<p class="finding-warning">The workbook source changed. Prior checks are stale and are not shown. Inspect this version before relying on results.</p>`
      : `<p class="help">No independent formula or chart checks have been run for this source version.</p>`;
  }
}

function executionValueHtml(value) {
  if (!value) return "";
  if (value.kind === "table") {
    return tableHtml([value.columns || [], ...(value.rows || [])]);
  }
  return `<pre class="execution-output">${esc(value.text || "")}</pre>`;
}

function executionResultHtml(result, run) {
  const source = sourceHash(state.route.cid, state.route.aid, result.object_id);
  const warnings = (result.warnings || []).map((warning) =>
    `<div class="execution-warning"><strong>${esc(warning.category)}:</strong> ${esc(warning.message)}
      <p>${esc(warning.diagnostic || "This warning came from the disclosed local runtime.")}</p></div>`).join("");
  const streams = [
    result.stdout ? `<h4>Standard output</h4><pre class="execution-output">${esc(result.stdout)}</pre>` : "",
    result.stderr ? `<h4>Standard error</h4><pre class="execution-output">${esc(result.stderr)}</pre>` : "",
  ].join("");
  const plots = (result.plots || []).map((name) =>
    `<img class="execution-plot" src="${executionBase()}/${encodeURIComponent(run.run_id)}/outputs/${encodeURIComponent(name)}" alt="Computed plot from notebook cell ${Number(result.cell_index) + 1}">`).join("");
  const failure = result.error
    ? `<p class="field-error">${esc(result.error_type)}: ${esc(result.error)}</p>
      <p>${esc(result.diagnostic || "Inspect the captured local trace before changing the cell.")}</p>
      <details><summary>Local traceback</summary><pre>${esc(result.traceback)}</pre></details>`
    : "";
  return `<article class="execution-cell" data-execution-cell="${esc(result.cell_index)}">
    <h3><a href="${source}">Notebook cell ${Number(result.cell_index) + 1}</a> · ${esc(result.state)}</h3>
    <p class="help">${esc(result.provenance)} · ${esc(result.duration_seconds)} seconds</p>
    ${warnings}${streams}${executionValueHtml(result.value)}${plots}${failure}
  </article>`;
}

function paintExecution(run = null) {
  const stateLabel = $("execution-state");
  const results = $("execution-results");
  const stop = $("stop-execution");
  const resume = $("resume-execution");
  if (!run) {
    stateLabel.textContent = "Not run";
    stop.hidden = true;
    resume.hidden = true;
    results.innerHTML = `<p class="help">Computed results appear here and remain separate from saved notebook output.</p>`;
    return;
  }
  state.execution.current = run;
  stateLabel.textContent = run.stale ? "Stale" : run.state;
  stop.hidden = run.state !== "running";
  resume.hidden = run.stale || !["paused", "error"].includes(run.state);
  const progress = `${run.completed_cells.length} of ${run.selected_cells.length} selected code cells completed.`;
  const pause = run.pause_reason ? `<p class="${run.state === "error" ? "field-error" : "help"}">${esc(run.pause_reason)}</p>` : "";
  results.innerHTML = `<p class="help">${esc(progress)} Source version ${esc(run.artifact_version)}.</p>${pause}` +
    (run.results || []).map((result) => executionResultHtml(result, run)).join("");
}

function stopExecutionPolling() {
  clearTimeout(executionTimer);
  executionTimer = null;
}

async function pollExecution() {
  const run = state.execution?.current;
  if (!run || state.route.name !== "artifact") return;
  try {
    const fresh = await getJSON(`${executionBase()}/${encodeURIComponent(run.run_id)}`);
    paintExecution(fresh);
    if (["queued", "running"].includes(fresh.state)) {
      executionTimer = setTimeout(pollExecution, 250);
    }
  } catch (err) {
    $("execution-error").hidden = false;
    $("execution-error").textContent = err.message;
  }
}

async function loadExecutionPanel() {
  stopExecutionPolling();
  const panel = $("execution-panel");
  if (state.artifact?.kind !== "ipynb") {
    panel.hidden = true;
    state.execution = null;
    return;
  }
  panel.hidden = false;
  const payload = await getJSON(`${executionBase()}/environment`);
  state.execution = { info: payload, current: payload.executions[0] || null };
  const env = payload.environment;
  $("execution-disclosure").textContent = "Runs locally without DeepSeek. Network is denied. Code reads copies of current-course files and writes only its execution workspace.";
  $("execution-environment").innerHTML = [
    ["Runtime", `${env.implementation} ${env.python}`],
    ["Packages", Object.entries(env.packages).map(([name, version]) => `${name} ${version}`).join(", ")],
    ["Network", env.network],
    ["Files", env.filesystem],
    ["Limits", `${env.cell_timeout_seconds}s per cell, ${env.output_char_limit_per_stream.toLocaleString()} characters per stream, ${Math.round(env.memory_limit_bytes / 1073741824)} GiB data segment`],
    ["Processes", env.process_limit],
  ].map(([term, value]) => `<dt>${esc(term)}</dt><dd>${esc(value)}</dd>`).join("");
  paintExecution(state.execution.current);
  if (state.execution.current && ["queued", "running"].includes(state.execution.current.state)) {
    executionTimer = setTimeout(pollExecution, 100);
  }
}

async function startNotebookExecution(selectedOnly) {
  const error = $("execution-error");
  error.hidden = true;
  if (!$("execution-confirm").checked) {
    error.textContent = "Confirm the disclosed local runtime before running code.";
    error.hidden = false;
    return;
  }
  const payload = { confirmed: true };
  if (selectedOnly) {
    const indices = [...state.selectedObjects.values()]
      .filter((obj) => obj.object_type === "notebook_cell" && obj.data.cell_type === "code")
      .map((obj) => Number(obj.locator.notebook_cell));
    if (!indices.length) {
      error.textContent = "Select at least one code cell in the source pane.";
      error.hidden = false;
      return;
    }
    payload.cell_indices = indices;
  }
  try {
    const run = await postJSON(executionBase(), payload);
    paintExecution(run);
    stopExecutionPolling();
    executionTimer = setTimeout(pollExecution, 100);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
}

function paintSelected() {
  const values = [...state.selectedObjects.values()];
  $("selected-context").textContent = values.length
    ? `${plural(values.length, "source", "sources")} selected: ${values.map(locatorText).join("; ")}`
    : "Nothing selected.";
}

async function loadArtifactPage({ append = false } = {}) {
  const { cid, aid, oid } = state.route;
  const params = new URLSearchParams({ offset: String(append ? state.artifactOffset : 0), limit: "300" });
  let exact = null;
  if (oid) {
    exact = await getJSON(`/api/courses/${encodeURIComponent(cid)}/artifacts/${encodeURIComponent(aid)}/objects/${encodeURIComponent(oid)}`);
  }
  const requestedSheet = exact?.locator?.sheet || state.artifactSheet;
  if (requestedSheet) params.set("sheet", requestedSheet);
  const payload = await getJSON(`/api/courses/${encodeURIComponent(cid)}/artifacts/${encodeURIComponent(aid)}/view?${params}`);
  state.artifact = payload.artifact;
  state.artifactSheet = payload.selected_sheet || "";
  state.artifactOffset = payload.offset + payload.objects.length;
  state.artifactObjects = append ? [...state.artifactObjects, ...payload.objects] : payload.objects;
  if (exact && !state.artifactObjects.some((obj) => obj.id === oid)) {
    state.artifactObjects.unshift(exact);
  }
  const artifact = payload.artifact;
  $("artifact-title").textContent = artifact.filename;
  $("artifact-original").href = `/api/courses/${encodeURIComponent(cid)}/artifacts/${encodeURIComponent(aid)}/original`;
  $("source-location").textContent = oid
    ? `${artifact.source_path} · ${locatorText(state.artifactObjects.find((obj) => obj.id === oid))}`
    : artifact.source_path;
  const warning = $("artifact-warning");
  warning.hidden = !artifact.extraction_warnings.length;
  warning.textContent = artifact.extraction_warnings.join(" ");
  const sheet = $("artifact-sheet");
  $("sheet-label").hidden = !payload.sheets.length;
  sheet.hidden = !payload.sheets.length;
  sheet.innerHTML = payload.sheets.map((name) => `<option${name === payload.selected_sheet ? " selected" : ""}>${esc(name)}</option>`).join("");
  const content = artifact.kind === "xlsx"
    ? spreadsheetHtml(state.artifactObjects, artifact, cid, oid)
    : state.artifactObjects.map((obj) => objectCard(obj, artifact, cid, oid)).join("");
  $("native-viewer").innerHTML = content || `<p class="empty">No extracted source objects.</p>`;
  $("native-viewer").dataset.artifactId = artifact.id;
  $("artifact-more").hidden = !payload.has_more;
  paintSelected();
  await loadExecutionPanel();
  await loadWorkbookPanel();
  if (artifact.kind === "xlsx") $("experiment-sheet").value = state.artifactSheet || payload.sheets[0] || "";
  if (oid) requestAnimationFrame(() => document.getElementById(`source-${oid}`)?.scrollIntoView({ block: "center" }));
}

async function renderArtifact() {
  const { cid, aid } = state.route;
  if (!state.course || state.course.id !== cid) {
    try { state.course = await getJSON(`/api/courses/${encodeURIComponent(cid)}`); }
    catch (err) { handle(err); location.hash = "#/"; return; }
  }
  if (!state.artifact || state.artifact.id !== aid) {
    state.artifactSheet = "";
    state.artifactOffset = 0;
    state.artifactObjects = [];
    state.selectedObjects.clear();
  }
  $("artifact-back").href = `#/c/${encodeURIComponent(cid)}`;
  $("artifact-back").textContent = state.course.title;
  try { await loadArtifactPage(); }
  catch (err) { handle(err); location.hash = `#/c/${encodeURIComponent(cid)}`; }
}

$("native-viewer").addEventListener("change", (event) => {
  const input = event.target.closest(".source-select");
  if (!input) return;
  const obj = state.artifactObjects.find((item) => item.id === input.dataset.objectId);
  if (!obj) return;
  if (input.checked) state.selectedObjects.set(obj.id, obj);
  else state.selectedObjects.delete(obj.id);
  if (input.checked && state.artifact?.kind === "xlsx" && obj.object_type === "cell") {
    $("experiment-sheet").value = obj.locator.sheet || "";
    $("experiment-cell").value = obj.locator.cell_range || "";
    if (obj.data.formula) $("experiment-formula").value = obj.data.formula;
  }
  paintSelected();
});

$("artifact-sheet").addEventListener("change", async (event) => {
  state.artifactSheet = event.target.value;
  state.artifactOffset = 0;
  state.selectedObjects.clear();
  try { await loadArtifactPage(); } catch (err) { handle(err); }
});

$("load-more-objects").addEventListener("click", async () => {
  try { await loadArtifactPage({ append: true }); } catch (err) { handle(err); }
});

$("copy-source-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Exact source link copied.");
  } catch (_err) { toast("Copy the current address to share this source location."); }
});

$("ask-selected-context").addEventListener("click", async () => {
  const question = $("context-question").value.trim();
  const answer = $("question-answer");
  if (!question || !state.selectedObjects.size) {
    answer.innerHTML = `<p class="field-error">Write a question and select at least one source.</p>`;
    return;
  }
  answer.innerHTML = SKELETON;
  const selections = [...state.selectedObjects.values()].map((obj) => ({ artifact_id: obj.artifact_id, object_id: obj.id }));
  try {
    const result = await postJSON(`/api/courses/${encodeURIComponent(state.route.cid)}/questions`, { question, selections });
    const citations = result.citations.map((citation) => `<li><a href="${sourceHash(state.route.cid, citation.artifact_id, citation.object_id)}">${esc(citation.label)}</a>: ${esc(citation.quote)}</li>`).join("");
    answer.innerHTML = `<div class="answer">${renderMarkdown(result.answer)}</div>
      <p class="help">${esc(result.uncertainty)}</p><ol class="citations">${citations}</ol>`;
  } catch (err) { answer.innerHTML = `<p class="field-error">${esc(err.message)}</p>`; }
});

$("run-all-cells").addEventListener("click", () => startNotebookExecution(false));
$("run-selected-cells").addEventListener("click", () => startNotebookExecution(true));

$("stop-execution").addEventListener("click", async () => {
  const run = state.execution?.current;
  if (!run) return;
  try {
    paintExecution(await postJSON(`${executionBase()}/${encodeURIComponent(run.run_id)}/stop`, {}));
    stopExecutionPolling();
  } catch (err) { handle(err); }
});

$("resume-execution").addEventListener("click", async () => {
  const run = state.execution?.current;
  if (!run) return;
  if (!$("execution-confirm").checked) {
    $("execution-error").textContent = "Confirm the disclosed local runtime before resuming code.";
    $("execution-error").hidden = false;
    return;
  }
  try {
    paintExecution(await postJSON(`${executionBase()}/${encodeURIComponent(run.run_id)}/resume`, { confirmed: true }));
    stopExecutionPolling();
    executionTimer = setTimeout(pollExecution, 100);
  } catch (err) { handle(err); }
});

$("inspect-workbook").addEventListener("click", async () => {
  const error = $("workbook-error");
  error.hidden = true;
  $("workbook-state").textContent = "Inspecting";
  $("workbook-results").innerHTML = SKELETON;
  try {
    paintWorkbook(await postJSON(`${workbookBase()}/inspect`, {}));
  } catch (err) {
    $("workbook-state").textContent = "Error";
    error.textContent = err.message;
    error.hidden = false;
    $("workbook-results").innerHTML = "";
  }
});

$("run-formula-experiment").addEventListener("click", async () => {
  const target = $("experiment-result");
  target.innerHTML = SKELETON;
  try {
    const result = await postJSON(`${workbookBase()}/experiments`, {
      sheet: $("experiment-sheet").value.trim(),
      cell: $("experiment-cell").value.trim(),
      formula: $("experiment-formula").value.trim(),
    });
    const source = result.object_id
      ? `<a href="${sourceHash(state.route.cid, state.route.aid, result.object_id)}">${esc(result.sheet)}!${esc(result.cell)}</a>`
      : `${esc(result.sheet)}!${esc(result.cell)}`;
    const evidence = (result.intermediate || []).map((item) => item.locator
      ? `<li>${evidenceLink(item)}: ${esc((item.sample || []).join(", "))}</li>`
      : `<li>${esc(item.matching_rows)} matching rows</li>`).join("");
    target.innerHTML = `<article class="workbook-finding"><h3>${source} · ${esc(result.verification_state)}</h3>
      <p>Computed on copy: <strong>${esc(result.calculated_value)}</strong> ${esc(result.unit === "not identified" ? "" : result.unit)}.</p>
      <p class="help">${esc(result.provenance)}.</p>${evidence ? `<ul>${evidence}</ul>` : ""}</article>`;
  } catch (err) {
    target.innerHTML = `<p class="field-error">${esc(err.message)}</p>`;
  }
});

// ---------------------------------------------------------------- routing

function parseHash() {
  const raw = (location.hash || "#/").replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "c" && parts[2] === "a" && parts.length >= 4) {
    return { name: "artifact", cid: parts[1], aid: parts[3], oid: parts[4] || "" };
  }
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
  if (next.name !== "artifact") stopExecutionPolling();
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
  } else if (next.name === "viewer") {
    stopPolling();
    await renderViewer();
  } else {
    stopPolling();
    await renderArtifact();
  }
}

window.addEventListener("hashchange", route);

refreshConnection().then(route);

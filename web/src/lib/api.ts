/**
 * Typed client for the Lecture Companion HTTP API.
 *
 * One function per route in `app/main.py`. Nothing here invents backend
 * behaviour, and the request/response shapes live in `./types`.
 */

import type {
  ArtifactObjectOptions,
  ArtifactRow,
  ArtifactView,
  ArtifactViewOptions,
  ConceptGraph,
  ConnectionInfo,
  ConnectionTestResult,
  CourseDetail,
  CourseRow,
  CourseSearchResult,
  DeletedArtifact,
  DeletedCourse,
  ExecutionEnvironmentPayload,
  ExecutionRun,
  FormulaExperiment,
  HealthStatus,
  ImportBulkResult,
  ImportPreview,
  KnowledgeIndexStatus,
  LearningObject,
  NoteUpdate,
  Organization,
  OverviewUpdate,
  ProcessStart,
  ProgressRow,
  QuestionAnswer,
  QuestionSelection,
  SlideDetail,
  SlideRegeneration,
  SlideSummary,
  StartExecutionOptions,
  TermUpdate,
  UploadResult,
  WorkbookAudit,
  WorkbookStatus,
} from "./types";

/**
 * `status` is the HTTP status. The UI branches on 428 (no API key) and 429
 * (rate limited); every other failure is surfaced by message.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type UploadFiles = FileList | readonly File[];

/** Bytes written so far, and the size of the body being written when the
 *  browser can size it. `total` is `0` when it cannot, which is the signal to
 *  render a state that does not claim to know. */
export type UploadProgress = (loaded: number, total: number) => void;

type Segment = string | number;

/** Ids, run ids and filenames arrive from the server and may contain anything
 *  a filename can, so every segment is encoded on its own. */
function path(...segments: Segment[]): string {
  return `/${segments.map((segment) => encodeURIComponent(String(segment))).join("/")}`;
}

function query(params: Record<string, Segment | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();
  return text.trim() ? text : null;
}

/** FastAPI answers errors as `{error: ...}`. Anything else (a proxy's HTML, a
 *  bare status line) is still reported rather than dropped. */
function describe(status: number, statusText: string, body: unknown): string {
  if (body !== null && typeof body === "object" && "error" in body) {
    const message = (body as { error: unknown }).error;
    if (typeof message === "string" && message) return message;
  }
  if (typeof body === "string") return body.slice(0, 500);
  return `${status} ${statusText}`;
}

async function settle<T>(response: Response): Promise<T> {
  const body = await readBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, describe(response.status, response.statusText, body));
  }
  return body as T;
}

async function send<T>(method: string, url: string, payload?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (payload !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(payload);
  }
  return settle<T>(await fetch(url, init));
}

const get = <T>(url: string) => send<T>("GET", url);
const post = <T>(url: string, payload: unknown = {}) => send<T>("POST", url, payload);
const put = <T>(url: string, payload: unknown = {}) => send<T>("PUT", url, payload);
const remove = <T>(url: string, payload?: unknown) => send<T>("DELETE", url, payload);

function fileForm(files: UploadFiles): FormData {
  const form = new FormData();
  for (const file of files) {
    // The relative path keeps a dropped folder's hierarchy in the filename the
    // importer classifies and files.
    form.append("files", file, file.webkitRelativePath || file.name);
  }
  return form;
}

async function postFiles<T>(url: string, files: UploadFiles): Promise<T> {
  return settle<T>(await fetch(url, { method: "POST", body: fileForm(files) }));
}

/** The body of a finished XHR, read the way `readBody` reads a response. */
function readXhrBody(request: XMLHttpRequest): unknown {
  const contentType = request.getResponseHeader("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      return JSON.parse(request.responseText);
    } catch {
      return null;
    }
  }
  const text = request.responseText ?? "";
  return text.trim() ? text : null;
}

/**
 * A multipart POST that reports its own upload progress.
 *
 * `fetch` has no upload progress channel. There is no `upload` on a `fetch`
 * request and no event that counts the bytes as they leave: a `fetch` call
 * with a `FormData` body reports nothing until the response arrives, and a
 * request body built from a stream has no progress callback either.
 * `XMLHttpRequest` is the only API in the platform that counts the bytes it is
 * writing, through `xhr.upload.onprogress`, so that is what an upload uses.
 *
 * Everything else keeps `settle`'s contract exactly, because a failure is
 * rendered from the error's own message: a non-2xx rejects with an `ApiError`
 * carrying the server's own `{error: ...}` text, a 2xx resolves with the parsed
 * body, and a body that is not JSON is passed through as a string.
 */
function postFilesProgress<T>(
  url: string,
  files: UploadFiles,
  onProgress?: UploadProgress,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);

    if (onProgress) {
      // `lengthComputable` is false when the browser cannot size the body. The
      // caller is told `0` rather than a guess, so it can render an
      // indeterminate state instead of a bar that pretends to know.
      request.upload.onprogress = (event) => {
        onProgress(event.loaded, event.lengthComputable ? event.total : 0);
      };
      // AND THE ENDS ARE REPORTED, because `onprogress` alone is not enough to
      // promise an increase. Over loopback the browser can hand the whole body
      // to the kernel in one write and fire a single progress event at zero, so
      // a 67 MB upload was measured showing `aria-valuenow` 0 for its entire
      // duration while the file landed correctly. A bar that never moves is the
      // defect the criterion names.
      //
      // `loadstart` and `loadend` bracket every request and cannot be missed.
      // Together with `onprogress` they guarantee a value at the start, every
      // intermediate value the browser can report, and the total at the end,
      // which is monotonic whatever the transport does.
      const body = request.upload;
      body.onloadstart = (event) => {
        onProgress(0, event.lengthComputable ? event.total : 0);
      };
      body.onloadend = (event) => {
        onProgress(
          event.lengthComputable ? event.total : 0,
          event.lengthComputable ? event.total : 0,
        );
      };
    }

    request.onload = () => {
      const body = readXhrBody(request);
      if (request.status < 200 || request.status >= 300) {
        reject(new ApiError(request.status, describe(request.status, request.statusText, body)));
        return;
      }
      resolve(body as T);
    };
    // `fetch` rejects these as a `TypeError` and has no status to report. The
    // upload reports them as a request that never reached the server, which is
    // the same thing the failure region would have said about it.
    request.onerror = () => {
      reject(new ApiError(0, "The upload could not reach the server."));
    };
    request.onabort = () => {
      reject(new ApiError(0, "The upload was cancelled."));
    };

    request.send(fileForm(files));
  });
}

/** For the routes that answer with bytes rather than JSON. */
export async function fetchBinary(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await readBody(response);
    throw new ApiError(
      response.status,
      describe(response.status, response.statusText, body),
    );
  }
  return response.blob();
}

// --------------------------------------------------------------------------
// health and connection
// --------------------------------------------------------------------------

export function getHealth(): Promise<HealthStatus> {
  return get<HealthStatus>(path("api", "health"));
}

export function getConnection(): Promise<ConnectionInfo> {
  return get<ConnectionInfo>(path("api", "connection"));
}

export function saveConnection(apiKey: string): Promise<ConnectionTestResult> {
  return post<ConnectionTestResult>(path("api", "connection"), { api_key: apiKey });
}

/**
 * Remove the stored key.
 *
 * This is the only call in the client that destroys something the reader cannot
 * get back: the key is deleted from the machine-global OS keyring and a deleted
 * DeepSeek key is not recoverable. It exists because the product has a "Forget
 * key" control and dropping it would be a regression.
 *
 * It must only ever be called from behind an explicit confirmation, and it must
 * never be exercised by a test, a gate or a verification pass. Nothing in this
 * project other than the connect dialog may import it.
 */
export function forgetConnection(): Promise<{ removed: boolean }> {
  return remove<{ removed: boolean }>(path("api", "connection"));
}

// --------------------------------------------------------------------------
// courses
// --------------------------------------------------------------------------

export function listCourses(): Promise<CourseRow[]> {
  return get<CourseRow[]>(path("api", "courses"));
}

export function createCourse(title: string): Promise<CourseRow> {
  return post<CourseRow>(path("api", "courses"), { title });
}

export function getCourse(courseId: string): Promise<CourseDetail> {
  return get<CourseDetail>(path("api", "courses", courseId));
}

export function deleteCourse(courseId: string): Promise<DeletedCourse> {
  return remove<DeletedCourse>(path("api", "courses", courseId));
}

export function getProgress(courseId: string): Promise<ProgressRow> {
  return get<ProgressRow>(path("api", "courses", courseId, "progress"));
}

export function startProcess(
  courseId: string,
  options: { deckId?: string | null; force?: boolean; steer?: string } = {},
): Promise<ProcessStart> {
  return post<ProcessStart>(path("api", "courses", courseId, "process"), {
    deck_id: options.deckId ?? null,
    force: options.force ?? false,
    steer: options.steer ?? "",
  });
}

export function pauseProcess(courseId: string): Promise<ProgressRow> {
  return post<ProgressRow>(path("api", "courses", courseId, "pause"));
}

export function regenerateOverview(courseId: string): Promise<OverviewUpdate> {
  return post<OverviewUpdate>(path("api", "courses", courseId, "overview", "regenerate"));
}

// --------------------------------------------------------------------------
// import and upload
// --------------------------------------------------------------------------

export function previewImport(files: UploadFiles): Promise<ImportPreview> {
  return postFiles<ImportPreview>(path("api", "import", "preview"), files);
}

export function importBulk(files: UploadFiles): Promise<ImportBulkResult> {
  return postFiles<ImportBulkResult>(path("api", "import", "bulk"), files);
}

/**
 * Add files to a course. The multipart filename is the relative path, which is
 * what the importer groups a dropped folder by.
 *
 * `onProgress` is optional and additive: every existing call keeps working
 * unchanged, and a caller that passes it is told how many bytes have left the
 * browser. It is called from `xhr.upload.onprogress` while the body is still
 * being written, which is the whole reason this route is not on `fetch`.
 */
export function uploadCourseFiles(
  courseId: string,
  files: UploadFiles,
  onProgress?: UploadProgress,
): Promise<UploadResult> {
  return postFilesProgress<UploadResult>(
    path("api", "courses", courseId, "files"),
    files,
    onProgress,
  );
}

// --------------------------------------------------------------------------
// artifacts and learning objects
// --------------------------------------------------------------------------

export function listArtifacts(courseId: string): Promise<ArtifactRow[]> {
  return get<ArtifactRow[]>(path("api", "courses", courseId, "artifacts"));
}

export function deleteArtifact(courseId: string, artifactId: string): Promise<DeletedArtifact> {
  return remove<DeletedArtifact>(path("api", "courses", courseId, "artifacts", artifactId));
}

export function listArtifactObjects(
  courseId: string,
  artifactId: string,
  options: ArtifactObjectOptions = {},
): Promise<LearningObject[]> {
  const suffix = query({ offset: options.offset, limit: options.limit });
  return get<LearningObject[]>(
    path("api", "courses", courseId, "artifacts", artifactId, "objects") + suffix,
  );
}

export function getArtifactObject(
  courseId: string,
  artifactId: string,
  objectId: string,
): Promise<LearningObject> {
  return get<LearningObject>(
    path("api", "courses", courseId, "artifacts", artifactId, "objects", objectId),
  );
}

export function getArtifactView(
  courseId: string,
  artifactId: string,
  options: ArtifactViewOptions = {},
): Promise<ArtifactView> {
  const suffix = query({
    sheet: options.sheet || undefined,
    offset: options.offset,
    limit: options.limit,
  });
  return get<ArtifactView>(
    path("api", "courses", courseId, "artifacts", artifactId, "view") + suffix,
  );
}

export function artifactRenderUrl(courseId: string, artifactId: string, page: number): string {
  return path("api", "courses", courseId, "artifacts", artifactId, "render", page);
}

export function artifactObjectMediaUrl(
  courseId: string,
  artifactId: string,
  objectId: string,
): string {
  return path(
    "api", "courses", courseId, "artifacts", artifactId, "objects", objectId, "media",
  );
}

export function artifactOriginalUrl(courseId: string, artifactId: string): string {
  return path("api", "courses", courseId, "artifacts", artifactId, "original");
}

// --------------------------------------------------------------------------
// organization
// --------------------------------------------------------------------------

export function getOrganization(courseId: string): Promise<Organization> {
  return get<Organization>(path("api", "courses", courseId, "organization"));
}

export function saveOrganization(
  courseId: string,
  assignments: Record<string, string>,
): Promise<Organization> {
  return put<Organization>(path("api", "courses", courseId, "organization"), { assignments });
}

export function suggestOrganization(courseId: string): Promise<Organization> {
  return post<Organization>(path("api", "courses", courseId, "organization", "suggest"));
}

// --------------------------------------------------------------------------
// grounded questions
// --------------------------------------------------------------------------

export function askQuestion(
  courseId: string,
  question: string,
  selections: QuestionSelection[],
): Promise<QuestionAnswer> {
  return post<QuestionAnswer>(path("api", "courses", courseId, "questions"), {
    question,
    selections,
  });
}

// --------------------------------------------------------------------------
// knowledge index, search, concepts
// --------------------------------------------------------------------------

export function getKnowledgeStatus(courseId: string): Promise<KnowledgeIndexStatus> {
  return get<KnowledgeIndexStatus>(path("api", "courses", courseId, "knowledge", "status"));
}

export function rebuildKnowledge(courseId: string): Promise<KnowledgeIndexStatus> {
  return post<KnowledgeIndexStatus>(path("api", "courses", courseId, "knowledge", "rebuild"));
}

export function searchCourse(
  courseId: string,
  searchQuery: string,
  limit?: number,
): Promise<CourseSearchResult> {
  const suffix = query({ q: searchQuery, limit });
  return get<CourseSearchResult>(path("api", "courses", courseId, "search") + suffix);
}

export function getCourseConcepts(
  courseId: string,
  options: { q?: string; limit?: number } = {},
): Promise<ConceptGraph> {
  const suffix = query({ q: options.q, limit: options.limit });
  return get<ConceptGraph>(path("api", "courses", courseId, "concepts") + suffix);
}

// --------------------------------------------------------------------------
// notebook execution
// --------------------------------------------------------------------------

export function getExecutionEnvironment(
  courseId: string,
  artifactId: string,
): Promise<ExecutionEnvironmentPayload> {
  return get<ExecutionEnvironmentPayload>(
    path("api", "courses", courseId, "artifacts", artifactId, "execution", "environment"),
  );
}

export function startExecution(
  courseId: string,
  artifactId: string,
  options: StartExecutionOptions,
): Promise<ExecutionRun> {
  const payload: Record<string, unknown> = { confirmed: options.confirmed };
  if (options.cellIndices) payload.cell_indices = options.cellIndices;
  if (options.cellTimeoutSeconds !== undefined) {
    payload.cell_timeout_seconds = options.cellTimeoutSeconds;
  }
  return post<ExecutionRun>(
    path("api", "courses", courseId, "artifacts", artifactId, "execution"),
    payload,
  );
}

export function getExecution(
  courseId: string,
  artifactId: string,
  runId: string,
): Promise<ExecutionRun> {
  return get<ExecutionRun>(
    path("api", "courses", courseId, "artifacts", artifactId, "execution", runId),
  );
}

export function stopExecution(
  courseId: string,
  artifactId: string,
  runId: string,
): Promise<ExecutionRun> {
  return post<ExecutionRun>(
    path("api", "courses", courseId, "artifacts", artifactId, "execution", runId, "stop"),
  );
}

export function resumeExecution(
  courseId: string,
  artifactId: string,
  runId: string,
  confirmed: boolean,
): Promise<ExecutionRun> {
  return post<ExecutionRun>(
    path("api", "courses", courseId, "artifacts", artifactId, "execution", runId, "resume"),
    { confirmed },
  );
}

export function executionOutputUrl(
  courseId: string,
  artifactId: string,
  runId: string,
  filename: string,
): string {
  return path(
    "api", "courses", courseId, "artifacts", artifactId, "execution", runId, "outputs", filename,
  );
}

// --------------------------------------------------------------------------
// workbook inspection
// --------------------------------------------------------------------------

export function getWorkbookStatus(
  courseId: string,
  artifactId: string,
): Promise<WorkbookStatus> {
  return get<WorkbookStatus>(
    path("api", "courses", courseId, "artifacts", artifactId, "workbook", "status"),
  );
}

export function inspectWorkbook(
  courseId: string,
  artifactId: string,
  force = false,
): Promise<WorkbookAudit> {
  return post<WorkbookAudit>(
    path("api", "courses", courseId, "artifacts", artifactId, "workbook", "inspect"),
    { force },
  );
}

export function runFormulaExperiment(
  courseId: string,
  artifactId: string,
  experiment: { sheet: string; cell: string; formula: string },
): Promise<FormulaExperiment> {
  return post<FormulaExperiment>(
    path("api", "courses", courseId, "artifacts", artifactId, "workbook", "experiments"),
    experiment,
  );
}

// --------------------------------------------------------------------------
// slides, explanations, terms, notes
// --------------------------------------------------------------------------

export function listSlides(courseId: string, deckId: string): Promise<SlideSummary[]> {
  return get<SlideSummary[]>(path("api", "courses", courseId, "decks", deckId, "slides"));
}

export function getSlide(
  courseId: string,
  deckId: string,
  index: number,
): Promise<SlideDetail> {
  return get<SlideDetail>(
    path("api", "courses", courseId, "decks", deckId, "slides", index),
  );
}

export function slideImageUrl(courseId: string, deckId: string, index: number): string {
  return path("api", "courses", courseId, "decks", deckId, "slides", index, "image");
}

export function regenerateSlide(
  courseId: string,
  deckId: string,
  index: number,
  steer = "",
): Promise<SlideRegeneration> {
  return post<SlideRegeneration>(
    path("api", "courses", courseId, "decks", deckId, "slides", index, "regenerate"),
    { steer },
  );
}

export function addTerm(
  courseId: string,
  deckId: string,
  slideIndex: number,
  term: string,
): Promise<TermUpdate> {
  return post<TermUpdate>(path("api", "courses", courseId, "terms"), {
    deck_id: deckId,
    slide_index: slideIndex,
    term,
  });
}

export function removeTerm(
  courseId: string,
  deckId: string,
  slideIndex: number,
  term: string,
): Promise<TermUpdate> {
  return remove<TermUpdate>(path("api", "courses", courseId, "terms"), {
    deck_id: deckId,
    slide_index: slideIndex,
    term,
  });
}

export function saveNote(
  courseId: string,
  deckId: string,
  slideIndex: number,
  text: string,
): Promise<NoteUpdate> {
  return put<NoteUpdate>(path("api", "courses", courseId, "notes"), {
    deck_id: deckId,
    slide_index: slideIndex,
    text,
  });
}

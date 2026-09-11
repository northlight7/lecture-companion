/**
 * Response bodies of the Lecture Companion HTTP API.
 *
 * Derived from `app/main.py`'s serialisers (`_course_row`, `_progress_dict`,
 * `_artifact_rows`, `_filed_rows`) and the modules it delegates to. Where a
 * value comes straight out of a dataclass `.to_dict()` in `app/contracts.py`,
 * the field names are the Python field names, snake_case included.
 */

export type FileRole = "slides" | "reference";

export type PipelineState = "idle" | "running" | "paused" | "done" | "error";

/** `_display_state` reports "partial" for a course that has work left. */
export type CourseState = PipelineState | "partial";

export type ArtifactKind = "pdf" | "pptx" | "docx" | "xlsx" | "csv" | "ipynb";

export type ArtifactPurpose =
  | "lecture"
  | "tutorial"
  | "assignment"
  | "dataset"
  | "worked_result"
  | "reference"
  | "unknown";

export type ArtifactExtractionStatus = "running" | "done" | "failed";

export type LearningObjectType =
  | "page"
  | "slide"
  | "speaker_note"
  | "document_block"
  | "table"
  | "image"
  | "equation"
  | "sheet"
  | "cell"
  | "range"
  | "chart"
  | "dataset"
  | "dataset_field"
  | "notebook_cell"
  | "notebook_output"
  | "hyperlink"
  | "prompt"
  | "package_part"
  // `app/contracts.py` declares eighteen kinds. `app/extract/structured.py`
  // also emits these two, which the frozen Literal does not list. They are part
  // of the real payload, so the viewer has to be able to name them; the
  // backend's own inconsistency is recorded here rather than hidden.
  | "formatting_rule"
  | "filter_rule";

/** The scalar shapes `_json_value` in app/workbook.py hands to the UI. */
export type CellValue = string | number | boolean;

// --------------------------------------------------------------------------
// connection
// --------------------------------------------------------------------------

export interface ConnectionInfo {
  connected: boolean;
  hint: string;
  model: string;
  fake: boolean;
}

export interface ConnectionTestResult {
  connected: boolean;
  detail: string;
  hint: string;
}

export interface HealthStatus {
  ok: boolean;
}

// --------------------------------------------------------------------------
// courses
// --------------------------------------------------------------------------

export interface CourseRow {
  id: string;
  title: string;
  n_decks: number;
  n_slides: number;
  n_explained: number;
  state: CourseState;
}

export interface DeckRow {
  id: string;
  title: string;
  n_slides: number;
  n_explained: number;
}

export interface CourseFileRow {
  id: string;
  filename: string;
  role: FileRole;
  reason: string;
}

export interface ProgressRow {
  running_summary: string;
  done: Record<string, number[]>;
  state: PipelineState;
  pause_reason: string;
  cursor_deck_id: string;
  cursor_slide_index: number;
  updated_at: number;
  n_slides: number;
  n_explained: number;
  running: boolean;
}

export interface CourseDetail extends CourseRow {
  overview: string;
  decks: DeckRow[];
  files: CourseFileRow[];
  artifacts: ArtifactRow[];
  progress: ProgressRow;
}

export interface DeletedCourse {
  deleted: string;
}

// --------------------------------------------------------------------------
// artifacts and learning objects
// --------------------------------------------------------------------------

export interface Artifact {
  id: string;
  content_hash: string;
  filename: string;
  source_path: string;
  kind: ArtifactKind;
  purpose: ArtifactPurpose;
  stored_path: string;
  order: number;
  duplicate_of: string;
  supersedes: string;
  version: number;
  extraction_status: ArtifactExtractionStatus;
  extraction_quality: number;
  extraction_warnings: string[];
  object_count: number;
  added_at: number;
}

/** An artifact plus the study folder it was filed into. */
export interface ArtifactRow extends Artifact {
  folder: string;
  folder_reason: string;
}

export interface DeletedArtifact {
  deleted_artifact_ids: string[];
  source_path: string;
  removed_deck_ids: string[];
}

/** `SourceLocator.to_dict()` drops every field that is null or empty. */
export interface SourceLocator {
  artifact_id: string;
  kind: ArtifactKind;
  page?: number;
  slide?: number;
  note?: number;
  block?: number;
  sheet?: string;
  cell_range?: string;
  chart?: string;
  notebook_cell?: number;
  output?: number;
  dataset_field?: string;
  fragment?: string;
}

export interface LearningObject {
  id: string;
  artifact_id: string;
  object_type: LearningObjectType;
  locator: SourceLocator;
  text: string;
  /** Payload varies with `object_type`: cells carry `formula`, sheets carry
   *  `dimensions`, datasets carry `fields` and `sample_rows`, and so on. */
  data: Record<string, unknown>;
  source_version: string;
  quality: number;
  warnings: string[];
}

export interface ArtifactView {
  artifact: Artifact;
  sheets: string[];
  selected_sheet: string;
  objects: LearningObject[];
  total_objects: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface ArtifactObjectOptions {
  offset?: number;
  limit?: number;
}

export interface ArtifactViewOptions {
  sheet?: string;
  offset?: number;
  limit?: number;
}

// --------------------------------------------------------------------------
// import and upload
// --------------------------------------------------------------------------

export type FiledStatus = "done" | "unchanged";

export interface FiledRow {
  filename: string;
  file_id: string;
  role: FileRole;
  reason: string;
  deck_id: string;
  n_slides: number;
  artifact_id: string;
  kind: ArtifactKind;
  source_path: string;
  object_count: number;
  status: FiledStatus;
}

export interface UploadResult {
  filed: FiledRow[];
  errors: string[];
  overview_refreshed: boolean;
  course: CourseRow;
}

export interface ImportGroup {
  title: string;
  filenames: string[];
  reason: string;
}

export interface ImportPreview {
  groups: ImportGroup[];
}

export interface BulkCourseImport {
  course: CourseRow;
  filed: FiledRow[];
  errors: string[];
}

export interface ImportBulkResult {
  courses: BulkCourseImport[];
}

// --------------------------------------------------------------------------
// organization
// --------------------------------------------------------------------------

export type OrganizationMethod = "manual" | "model";

export interface Organization {
  assignments: Record<string, string>;
  reasons: Record<string, string>;
  method: OrganizationMethod;
  updated_at: number;
}

// --------------------------------------------------------------------------
// grounded questions
// --------------------------------------------------------------------------

export interface QuestionSelection {
  artifact_id: string;
  object_id: string;
}

export interface Citation {
  number: number;
  artifact_id: string;
  object_id: string;
  label: string;
  locator: SourceLocator;
  quote: string;
}

export interface RemoteDisclosure {
  sent_remote: boolean;
  sent: string[];
  not_sent: string[];
}

export interface QuestionAnswer {
  answer: string;
  citations: Citation[];
  uncertainty: string;
  remote_disclosure: RemoteDisclosure;
}

// --------------------------------------------------------------------------
// knowledge index, search, concepts
// --------------------------------------------------------------------------

export interface KnowledgeIndexStatus {
  ready: boolean;
  stale: boolean;
  reasons: string[];
  source_fingerprint: string;
  indexed_fingerprint: string;
  artifact_count: number;
  object_count: number;
}

export type SearchMatch = "source terms" | "concept alias" | "artifact relationship";

export interface SearchResult {
  artifact_id: string;
  artifact_filename: string;
  artifact_kind: ArtifactKind;
  artifact_purpose: ArtifactPurpose;
  artifact_version: number;
  object_id: string;
  object_type: LearningObjectType;
  locator: SourceLocator;
  location: string;
  snippet: string;
  score: number;
  matched_by: SearchMatch;
  /** Present only on rows pulled in by an explicit filename reference. */
  relationship_reason?: string;
  related_from_artifact?: string;
  related_from_object?: string;
}

export interface CourseSearchResult {
  query: string;
  /** Absent when the query matched no concept alias. */
  expanded_concepts?: string[];
  results: SearchResult[];
  index: KnowledgeIndexStatus;
  rebuilt: boolean;
  /** Absent when the query reduced to no searchable terms. */
  method?: string;
}

export interface ConceptNode {
  id: string;
  node_type: "concept";
  label: string;
  aliases: string[];
  kind: "curated_alias" | "course_term";
  artifact_count: number;
  evidence_count: number;
}

export interface ConceptArtifactNode {
  id: string;
  node_type: "artifact";
  label: string;
  artifact_id: string;
  kind: ArtifactKind;
  purpose: ArtifactPurpose;
  version: number;
}

export type ConceptGraphNode = ConceptNode | ConceptArtifactNode;

export type ConceptRelation = "appears_in" | "explicit_reference" | "prerequisite_candidate";

export interface ConceptEdge {
  from: string;
  to: string;
  relation: ConceptRelation;
  object_ids: string[];
  reason: string;
  certainty: string;
  /** Present on "explicit_reference" edges only. */
  source_object_id?: string;
  target_object_id?: string;
}

export interface ConceptGraph {
  nodes: ConceptGraphNode[];
  edges: ConceptEdge[];
  index: KnowledgeIndexStatus;
  rebuilt: boolean;
  warning: string;
}

// --------------------------------------------------------------------------
// notebook execution
// --------------------------------------------------------------------------

export interface ExecutionEnvironment {
  python: string;
  implementation: string;
  platform: string;
  packages: Record<string, string>;
  sandbox_backend: string;
  network: string;
  filesystem: string;
  cell_timeout_seconds: number;
  maximum_cell_timeout_seconds: number;
  output_char_limit_per_stream: number;
  memory_limit_bytes: number;
  file_limit_bytes: number;
  process_limit: string;
  remote_model_used: boolean;
}

export interface ExecutionCodeCell {
  index: number | null;
  object_id: string;
  location: string;
}

export type ExecutionState = "queued" | "running" | "paused" | "done" | "error";

export interface ExecutionLinkedFile {
  artifact_id: string;
  source_path: string;
  kind: ArtifactKind;
  content_hash: string;
  workspace_path: string;
}

export interface ExecutionWarning {
  category: string;
  message: string;
  diagnostic: string;
}

export interface ExecutionTableValue {
  kind: "table";
  columns: string[];
  rows: unknown[][];
  shape: number[];
  truncated: boolean;
}

export interface ExecutionTextValue {
  kind: "text";
  text: string;
  truncated: boolean;
}

export type ExecutionValue = ExecutionTableValue | ExecutionTextValue;

export interface ExecutionCellResult {
  cell_index: number;
  object_id: string;
  locator: SourceLocator;
  provenance: string;
  stdout: string;
  stderr: string;
  warnings: ExecutionWarning[];
  value: ExecutionValue | null;
  plots: string[];
  state: "done" | "error";
  duration_seconds: number;
  error?: string;
  error_type?: string;
  diagnostic?: string;
  traceback?: string;
}

export interface ExecutionRun {
  run_id: string;
  course_id: string;
  artifact_id: string;
  source_version: string;
  source_hash: string;
  artifact_version: number;
  state: ExecutionState;
  pause_reason: string;
  selected_cells: number[];
  completed_cells: number[];
  current_cell: number | null;
  results: ExecutionCellResult[];
  worker_pid: number | null;
  confirmed_at: number;
  created_at: number;
  updated_at: number;
  environment: ExecutionEnvironment;
  linked_files: ExecutionLinkedFile[];
  disclosure: string;
  stale: boolean;
}

export interface ExecutionEnvironmentPayload {
  environment: ExecutionEnvironment;
  artifact_id: string;
  source_version: string;
  source_hash: string;
  code_cells: ExecutionCodeCell[];
  executions: ExecutionRun[];
}

export interface StartExecutionOptions {
  confirmed: boolean;
  /** Omitted means every code cell in the notebook. */
  cellIndices?: number[];
  cellTimeoutSeconds?: number;
}

// --------------------------------------------------------------------------
// workbook inspection
// --------------------------------------------------------------------------

export interface WorkbookLocator {
  sheet: string;
  cell_range?: string;
  chart?: string;
}

/** One source range the local evaluator resolved and read. */
export interface WorkbookRangeEvidence {
  reference: string;
  locator: WorkbookLocator;
  cell_count: number;
  nonblank_count: number;
  sample: CellValue[];
  /** "" when the range start matches no stored cell object. */
  object_id: string;
}

/** A range the evaluator refused to resolve. */
export interface WorkbookRangeError {
  reference: string;
  error: string;
}

/** COUNTIF and SUMIFS append a criteria row after their range evidence. */
export interface WorkbookCriteriaEvidence {
  criteria: CellValue[];
  matching_rows: number;
}

export type WorkbookEvidence =
  | WorkbookRangeEvidence
  | WorkbookRangeError
  | WorkbookCriteriaEvidence;

export type WorkbookVerificationState =
  | "verified"
  | "verified_using_cached_precedents"
  | "unsupported"
  | "error";

export interface WorkbookSummary {
  sheets: number;
  formula_count: number;
  formulas_inspected: number;
  formulas_independently_verified: number;
  cached_mismatches: number;
  charts: number;
  formatting_filter_findings: number;
}

export interface WorkbookFormulaFinding {
  object_id: string;
  locator: WorkbookLocator;
  formula: string;
  cached_value: CellValue | null;
  calculated_value: CellValue | null;
  verification_state: WorkbookVerificationState;
  matches_cached: boolean | null;
  difference: number | null;
  error: string;
  unit: string;
  unit_basis: string;
  intermediate: WorkbookEvidence[];
  calculation_basis: string;
  provenance: string;
}

export interface WorkbookDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
}

export type WorkbookChartEvidence = WorkbookRangeEvidence | WorkbookRangeError;

export interface WorkbookChartSeries {
  series: number;
  /** Keys are the openpyxl reference roles: cat/val, or xVal/yVal. */
  references: Record<string, string>;
  evidence: Record<string, WorkbookChartEvidence>;
}

export interface WorkbookChartFinding {
  object_id: string;
  locator: WorkbookLocator;
  title: string;
  chart_type: string;
  series: WorkbookChartSeries[];
  diagnostics: WorkbookDiagnostic[];
  provenance: string;
}

export interface WorkbookDateGroup {
  year?: number;
  month?: number;
  day?: number;
  dateTimeGrouping?: string;
}

export interface WorkbookFilterColumn {
  column_id: number;
  values?: unknown[];
  date_groups?: WorkbookDateGroup[];
  custom?: { operator: string; value: CellValue | null }[];
  and?: boolean;
  top10?: { top: boolean; value: number | null; filter_value: number | null };
}

export interface WorkbookConditionalFormattingFinding {
  kind: "conditional_formatting";
  locator: WorkbookLocator;
  rule_type: string;
  operator: string;
  formula: CellValue[];
  priority: number;
  stop_if_true: boolean;
  provenance: string;
}

export interface WorkbookAutoFilterFinding {
  kind: "auto_filter";
  locator: WorkbookLocator;
  columns: WorkbookFilterColumn[];
  sort: { range: string; descending: boolean }[];
  provenance: string;
}

export interface WorkbookHiddenStructureFinding {
  kind: "hidden_structure";
  locator: WorkbookLocator;
  sheet_state: string;
  hidden_rows: number[];
  hidden_columns: string[];
  provenance: string;
}

export type WorkbookFormattingFinding =
  | WorkbookConditionalFormattingFinding
  | WorkbookAutoFilterFinding
  | WorkbookHiddenStructureFinding;

export interface WorkbookAudit {
  audit_version: number;
  artifact_id: string;
  source_hash: string;
  artifact_version: number;
  source_path: string;
  generated_at: number;
  cache_hit: boolean;
  stale: boolean;
  remote_model_used: boolean;
  source_bytes_preserved: boolean;
  summary: WorkbookSummary;
  formulas: WorkbookFormulaFinding[];
  charts: WorkbookChartFinding[];
  formatting_and_filters: WorkbookFormattingFinding[];
  uncertainty: string[];
}

export interface WorkbookStatus {
  exists: boolean;
  stale: boolean;
  artifact_id: string;
  /** Absent when no audit exists yet. */
  summary?: WorkbookSummary;
  source_hash?: string | null;
  audit_version?: number | null;
  /** Set when `supersedes` points at an audit for an earlier version. */
  previous_artifact_id?: string;
}

export interface FormulaExperiment {
  experiment_id: string;
  artifact_id: string;
  source_hash: string;
  artifact_version: number;
  sheet: string;
  cell: string;
  formula: string;
  verification_state: WorkbookVerificationState;
  calculated_value: CellValue | null;
  intermediate: WorkbookEvidence[];
  unit: string;
  unit_basis: string;
  calculation_basis: string;
  object_id: string;
  cache_hit: boolean;
  source_bytes_preserved: boolean;
  provenance: string;
  remote_model_used: boolean;
}

// --------------------------------------------------------------------------
// slides, explanations, terms, notes
// --------------------------------------------------------------------------

export interface SlideSummary {
  index: number;
  has_explanation: boolean;
  heading: string;
}

export interface Explanation {
  deck_id: string;
  slide_index: number;
  body: string;
  example: string;
  mermaid: string;
  heading: string;
  model: string;
  /** Retrieval chunk ids: "deck:3", or "object:<artifact_id>:<object_id>". */
  context_used: string[];
  created_at: number;
}

export interface Term {
  term: string;
  note: string;
  added_at?: number;
}

export interface SlideDetail {
  slide: { index: number; text: string };
  explanation: Explanation | null;
  terms: Term[];
  note: string;
}

export interface SlideRegeneration {
  explanation: Explanation;
  terms: Term[];
  note: string;
}

export interface TermUpdate {
  terms: Term[];
  note: string;
}

export interface NoteUpdate {
  note: string;
}

export interface OverviewUpdate {
  overview: string;
}

// --------------------------------------------------------------------------
// processing
// --------------------------------------------------------------------------

export interface ProcessStart {
  started: boolean;
  state: PipelineState;
}

/**
 * Search across the course, and the concept graph behind it.
 *
 * Ported from `paintKnowledgeStatus`, `searchResultHtml`, the `course-search`
 * submit handler, `graphHtml` and the `show-relationships` toggle in the
 * previous frontend (`web/app.js`). Same copy, same match types, same exact
 * source links.
 *
 * Two things the port keeps deliberately: the knowledge-index line states what
 * the search method actually is, and a `prerequisite_candidate` edge is never
 * shown as a fact. It is labelled a modelled candidate, it carries the reason
 * and the certainty the backend reported, and the graph's own uncertainty
 * warning is printed with it.
 */

import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";
import { LoaderCircle } from "lucide-react";

import * as api from "@/lib/api";
import { hash } from "@/lib/router";
import type {
  ConceptEdge,
  ConceptGraph,
  ConceptGraphNode,
  ConceptNode,
  CourseSearchResult,
  KnowledgeIndexStatus,
  SearchResult,
} from "@/lib/types";
import { Section } from "@/shell/Screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const SEARCH_LIMIT = 20;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The backend names its types with underscores ("dataset_field"). The chrome
 *  is sans text a reader reads, so they close up. */
function words(value: string): string {
  return (value ?? "").replaceAll("_", " ");
}

/** A busy arc beside a line of text that already says what is happening, so it
 *  is hidden from assistive technology rather than announced twice. */
function BusyArc(): JSX.Element {
  return (
    <LoaderCircle
      aria-hidden
      strokeWidth={1.75}
      className="size-4 shrink-0 animate-spin text-ink-muted motion-reduce:animate-none"
    />
  );
}

/**
 * What the knowledge index currently is, in the old screen's words. `rebuilt`
 * reports that this very search rebuilt it, which is a different fact from
 * "the index is current".
 */
function knowledgeLine(
  index: KnowledgeIndexStatus | null,
  rebuilt: boolean,
): { text: string; tone: string } {
  if (!index) return { text: "", tone: "text-ink-muted" };
  const files = index.artifact_count;
  const objects = index.object_count;
  if (rebuilt) {
    return {
      text: `Search refreshed from ${files} current source files and ${objects} exact source objects.`,
      tone: "text-ink-muted",
    };
  }
  if (index.stale) {
    return {
      text: `Search needs refresh: ${(index.reasons ?? []).join(", ")}. It will rebuild locally when you search or open relationships.`,
      tone: "text-warn",
    };
  }
  return {
    text: `Local search is current for ${files} source files and ${objects} source objects.`,
    tone: "text-ink-muted",
  };
}

function SearchResultRow({ cid, row }: { cid: string; row: SearchResult }): JSX.Element {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta text-ink-faint">
        <span>
          {row.artifact_kind} · {words(row.object_type)}
        </span>
        <span className="text-ink-muted">{row.matched_by}</span>
      </div>

      <a
        href={hash.source(cid, row.artifact_id, row.object_id)}
        className="mt-1 block truncate text-ui text-accent-ink underline-offset-2 hover:underline"
      >
        <span className="font-medium text-ink">{row.artifact_filename}</span> · {row.location}
      </a>

      <p className="mt-1 text-ui text-ink-muted">
        {row.snippet || "Structured source object"}
      </p>

      {row.relationship_reason ? (
        <p className="mt-1 text-meta text-ink-faint">Why related: {row.relationship_reason}</p>
      ) : null}

      <p className="mt-1 text-meta text-ink-faint">
        Version {row.artifact_version} · {words(row.artifact_purpose)}
      </p>
    </>
  );
}

/** One concept: what it is, how much evidence stands behind it, and the exact
 *  source objects that carry it. Selecting the label searches for it. */
function ConceptBlock({
  cid,
  concept,
  byId,
  edges,
  onSearch,
}: {
  cid: string;
  concept: ConceptNode;
  byId: Map<string, ConceptGraphNode>;
  edges: ConceptEdge[];
  onSearch: (label: string) => void;
}): JSX.Element {
  const links: JSX.Element[] = [];
  for (const edge of edges) {
    if (edge.from !== concept.id) continue;
    const target = byId.get(edge.to);
    if (!target || target.node_type !== "artifact") continue;
    const objectId = edge.object_ids[0] ?? "";
    links.push(
      <li key={`${concept.id}-${target.id}`} className="flex flex-wrap items-baseline gap-x-2 text-meta">
        <a
          href={hash.source(cid, target.artifact_id, objectId)}
          className="text-accent-ink underline-offset-2 hover:underline"
        >
          {target.label}
        </a>
        <span className="text-ink-faint">
          {target.kind} · {edge.reason}
        </span>
      </li>,
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => onSearch(concept.label)}
        className="self-start text-left text-ui font-medium text-ink underline-offset-2 transition-colors duration-[120ms] ease-[var(--ease)] hover:text-accent-ink hover:underline"
      >
        {concept.label}
      </button>
      <p className="text-meta text-ink-faint">
        {concept.artifact_count} files · {concept.evidence_count} evidence links ·{" "}
        {words(concept.kind)}
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {links.length ? links : <li className="text-meta text-ink-faint">No current artifact link.</li>}
      </ul>
    </>
  );
}

function ConceptGraphView({
  cid,
  graph,
  onSearch,
}: {
  cid: string;
  graph: ConceptGraph;
  onSearch: (label: string) => void;
}): JSX.Element {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const concepts = graph.nodes.filter((node): node is ConceptNode => node.node_type === "concept");
  const evidence = graph.edges.filter((edge) => edge.relation === "appears_in");
  const references = graph.edges.filter((edge) => edge.relation === "explicit_reference");
  const prerequisites = graph.edges.filter((edge) => edge.relation === "prerequisite_candidate");

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-ui font-semibold text-ink">
          Course concept graph
        </h3>
        <p className="text-meta text-ink-muted">
          Concept-to-file lines use measured source matches. Arrows below are visibly labelled
          candidates. Select a concept to search this course for it.
        </p>
      </div>

      {concepts.length ? (
        <ul className="flex flex-col">
          {concepts.map((concept, index) => (
            <li key={concept.id} className="-mx-2 flex flex-col px-2">
              {index > 0 ? <Separator className="my-3" /> : null}
              <ConceptBlock
                cid={cid}
                concept={concept}
                byId={byId}
                edges={evidence}
                onSearch={onSearch}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ui text-ink-muted">
          No cross-file concepts were found.
        </p>
      )}

      {references.length ? (
        <div className="flex flex-col">
          <h3 className="text-ui font-semibold text-ink">
            Explicit file relationships
          </h3>
          <ul className="mt-1 flex flex-col">
            {references.map((edge, index) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || from.node_type !== "artifact" || !to || to.node_type !== "artifact") {
                return null;
              }
              return (
                <li key={`${edge.from}-${edge.to}-${index}`} className="-mx-2 flex flex-col px-2">
                  {index > 0 ? <Separator className="my-2" /> : null}
                  <p className="flex flex-wrap items-baseline gap-x-2 text-ui">
                    <a
                      href={hash.source(cid, from.artifact_id, edge.source_object_id)}
                      className="text-accent-ink underline-offset-2 hover:underline"
                    >
                      {from.label}
                    </a>
                    <span className="text-ink-faint">→</span>
                    <a
                      href={hash.source(cid, to.artifact_id, edge.target_object_id)}
                      className="text-accent-ink underline-offset-2 hover:underline"
                    >
                      {to.label}
                    </a>
                  </p>
                  <p className="text-meta text-ink-muted">
                    {edge.reason} {edge.certainty}.
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {prerequisites.length ? (
        <div className="flex flex-col">
          <h3 className="text-ui font-semibold text-ink">
            Prerequisite candidates
          </h3>
          <p className="mt-1 text-meta text-ink-muted">
            Modelled candidates, not verified prerequisites. Each line carries the reason it was
            proposed and the certainty it was proposed with.
          </p>
          <ul className="mt-2 flex flex-col">
            {prerequisites.map((edge, index) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || from.node_type !== "concept" || !to || to.node_type !== "concept") {
                return null;
              }
              return (
                <li key={`${edge.from}-${edge.to}-${index}`} className="-mx-2 flex flex-col gap-1 px-2">
                  {index > 0 ? <Separator className="my-2" /> : null}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant="warn">Modelled candidate</Badge>
                    <span className="text-ui text-ink">
                      <span className="font-medium">{from.label}</span>
                      <span className="text-ink-faint"> → </span>
                      <span className="font-medium">{to.label}</span>
                    </span>
                  </div>
                  <p className="text-meta text-ink-muted">{edge.reason}</p>
                  <p className="text-meta text-ink-faint">Certainty: {edge.certainty}.</p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {graph.warning ? <p className="text-meta text-warn">{graph.warning}</p> : null}
    </div>
  );
}

export function SearchSection({ cid }: { cid: string }): JSX.Element {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<CourseSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [index, setIndex] = useState<KnowledgeIndexStatus | null>(null);
  const [indexNote, setIndexNote] = useState<string | null>(null);
  const [rebuilt, setRebuilt] = useState(false);

  const [graphOpen, setGraphOpen] = useState(false);
  const [graph, setGraph] = useState<ConceptGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setIndex(null);
    setIndexNote(null);
    setFound(null);
    setSearchError(null);
    setGraph(null);
    setGraphOpen(false);
    setGraphError(null);
    void (async () => {
      try {
        const status = await api.getKnowledgeStatus(cid);
        if (alive) setIndex(status);
      } catch {
        if (alive) setIndexNote("Search status is unavailable.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [cid]);

  const runSearch = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setSearching(true);
      setSearchError(null);
      try {
        const result = await api.searchCourse(cid, text, SEARCH_LIMIT);
        setFound(result);
        setIndex(result.index);
        setRebuilt(result.rebuilt);
      } catch (err) {
        // The old screen reported a failed search beside the field instead of
        // toasting it, so the message stays where the reader is looking.
        setFound(null);
        setSearchError(message(err));
      } finally {
        setSearching(false);
      }
    },
    [cid],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runSearch(query);
  };

  const searchFor = (label: string) => {
    setQuery(label);
    void runSearch(label);
  };

  const toggleGraph = async () => {
    if (graphOpen) {
      setGraphOpen(false);
      return;
    }
    setGraphOpen(true);
    setGraph(null);
    setGraphError(null);
    setGraphLoading(true);
    try {
      const payload = await api.getCourseConcepts(cid, { limit: 24 });
      setGraph(payload);
      setIndex(payload.index);
      setRebuilt(payload.rebuilt);
    } catch (err) {
      setGraphError(message(err));
    } finally {
      setGraphLoading(false);
    }
  };

  const status = knowledgeLine(index, rebuilt);
  const statusText = indexNote ?? status.text;

  return (
    <Section
      title="Search across this course"
      action={
        <Button
          type="button"
          variant="secondary"
          aria-expanded={graphOpen}
          onClick={() => void toggleGraph()}
        >
          {graphOpen ? "Hide relationships" : "Show relationships"}
        </Button>
      }
    >
      <p className="text-ui text-ink-muted">
        Local-only search across slides, notes, documents, formulas, code, outputs, and dataset
        fields. Every result opens its exact source.
      </p>

      <form role="search" onSubmit={submit} className="mt-4 flex items-center gap-2">
        <Input
          type="search"
          value={query}
          maxLength={500}
          autoComplete="off"
          placeholder="Try regression, ridge, cardinality, or look-ahead bias"
          aria-label="Search this course"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={searching || !query.trim()}>
          {searching ? "Searching" : "Search"}
        </Button>
      </form>

      <p
        aria-live="polite"
        className={cn("mt-2 text-meta", indexNote ? "text-ink-muted" : status.tone)}
      >
        {statusText}
      </p>

      <div aria-live="polite" className="flex flex-col">
        {searching ? (
          <p className="mt-3 flex items-center gap-2 text-ui text-ink-muted">
            <BusyArc />
            Searching this course.
          </p>
        ) : null}

        {searchError ? (
          <p className="mt-3 text-ui font-medium text-bad">
            {searchError}
          </p>
        ) : null}

        {!searching && found ? (
          <div className="mt-3 flex flex-col">
            {found.expanded_concepts?.length || found.method ? (
              <p className="text-meta text-ink-muted">
                {found.expanded_concepts?.length
                  ? `Expanded through: ${found.expanded_concepts.join(", ")}. `
                  : ""}
                {found.method ?? ""}
              </p>
            ) : null}

            {found.results.length ? (
              // The result block is a grouped block, so it is level 1: raised
              // fill, hairline boundary, surface radius. Rows inside keep their
              // own hover step, a state of this same level.
              <ul className="mt-2 flex flex-col rounded-srf border border-hair bg-raised p-2">
                {found.results.map((row, position) => (
                  <li
                    key={`${row.artifact_id}-${row.object_id}-${position}`}
                    className="flex flex-col px-2"
                  >
                    {position > 0 ? <Separator className="my-3" /> : null}
                    <SearchResultRow cid={cid} row={row} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-ui text-ink-muted">
                No matching source objects in this course.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {graphOpen ? (
        <div aria-live="polite" className="flex flex-col">
          {graphLoading ? (
            <p className="mt-6 flex items-center gap-2 text-ui text-ink-muted">
              <BusyArc />
              Reading the concept graph.
            </p>
          ) : null}
          {graphError ? (
            <p className="mt-6 text-ui font-medium text-bad">
              {graphError}
            </p>
          ) : null}
          {graph ? <ConceptGraphView cid={cid} graph={graph} onSearch={searchFor} /> : null}
        </div>
      ) : null}
    </Section>
  );
}

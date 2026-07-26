import type {
  HumanNoteListItem,
  HumanNoteResponse
} from "../contracts/human-note.js";
import type {
  OrganizationModelValue,
  QueryFilter,
  QueryPredicate,
  QuerySpec,
  StructuredNoteItem
} from "../contracts/organization-model.js";
import type { SearchResult } from "../contracts/search.js";
import type { DailyNoteSnapshot } from "./daily-notes.js";

export type ProjectedHumanNote = Omit<HumanNoteResponse, "vault"> & {
  created: string;
};

export class InMemoryProjection {
  readonly #humanNotes = new Map<string, ProjectedHumanNote>();
  readonly #dailyNotes = new Map<string, ProjectedDailyNote>();
  readonly #inboxState: string;
  readonly #archivedState: string;

  constructor(options: {
    inboxState: string;
    archivedState: string;
  }) {
    this.#inboxState = options.inboxState;
    this.#archivedState = options.archivedState;
  }

  publishHumanNote(note: ProjectedHumanNote): void {
    this.#humanNotes.set(note.id, note);
  }

  humanNote(id: string): ProjectedHumanNote | undefined {
    return this.#humanNotes.get(id);
  }

  humanNoteLists(): {
    notes: HumanNoteListItem[];
    inbox: HumanNoteListItem[];
  } {
    const active = [...this.#humanNotes.values()].filter(
      (note) => note.state !== this.#archivedState
    );
    return {
      notes: active.map(toListItem),
      inbox: this.queryHumanNotes({
        filter: {
          all: [
            { field: "kind", operator: "equals", value: "standalone" },
            { field: "state", operator: "equals", value: this.#inboxState }
          ]
        }
      }).map(toListItem)
    };
  }

  queryHumanNotes(query: QuerySpec): StructuredNoteItem[] {
    const matching = [
      ...this.#humanNotes.values(),
      ...this.#dailyNotes.values()
    ].filter(
      (note) => !query.filter || matchesFilter(note, query.filter)
    );
    if (query.order) {
      matching.sort((left, right) => {
        for (const order of query.order ?? []) {
          const comparison = compareValues(
            projectedField(left, order.field),
            projectedField(right, order.field)
          );
          if (comparison !== 0) {
            return order.direction === "ascending" ? comparison : -comparison;
          }
        }
        return 0;
      });
    }
    return matching.map(toStructuredItem);
  }

  publishDailyNote(note: DailyNoteSnapshot): void {
    if (!note.exists || !note.revision || !note.sourceMarkdown) {
      return;
    }
    const id = note.sourceMarkdown.match(/^_id:\s*(.+?)\s*$/m)?.[1];
    if (!id) {
      throw new Error(`Daily Note is missing '_id': ${note.date}`);
    }
    this.#dailyNotes.set(note.date, {
      kind: "daily-note",
      id,
      created:
        note.sourceMarkdown.match(/^_created:\s*(.+?)\s*$/m)?.[1] ?? "",
      title: note.date,
      canonicalPath: `human/daily/${note.date}.md`,
      url: `/daily/${note.date}`,
      revision: note.revision,
      bodyMarkdown: note.bodyMarkdown,
      sourceMarkdown: note.sourceMarkdown,
      type: note.type,
      state: note.state,
      tags: note.tags,
      aliases: note.aliases,
      properties: note.properties
    });
  }

  search(query: string): SearchResult[] {
    const normalizedQuery = query.toLocaleLowerCase();
    const humanDocuments = [...this.#humanNotes.values()].map((note) => ({
      kind: "note" as const,
      ...note,
      url: `/notes/${note.id}`
    }));
    return [...humanDocuments, ...this.#dailyNotes.values()]
      .filter((document) =>
        [
          document.title,
          document.canonicalPath,
          document.sourceMarkdown,
          document.bodyMarkdown
        ].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery)
        )
      )
      .map((document) => ({
        kind: document.kind,
        id: document.id,
        title: document.title,
        canonicalPath: document.canonicalPath,
        url: document.url,
        revision: document.revision,
        snippet: searchSnippet(document, query)
      }));
  }
}

type ProjectedDailyNote = {
  kind: "daily-note";
  id: string;
  created: string;
  title: string;
  canonicalPath: string;
  url: string;
  revision: string;
  bodyMarkdown: string;
  sourceMarkdown: string;
  type: "daily-note";
  state: string;
  tags: string[];
  aliases: string[];
  properties: Record<string, OrganizationModelValue>;
};

function toListItem(
  note: Pick<
    ProjectedHumanNote,
    "id" | "title" | "canonicalPath" | "revision" | "state"
  >
): HumanNoteListItem {
  return {
    id: note.id,
    title: note.title,
    canonicalPath: note.canonicalPath,
    revision: note.revision,
    state: note.state,
    url: `/notes/${note.id}`
  };
}

function toStructuredItem(
  note: ProjectedHumanNote | ProjectedDailyNote
): StructuredNoteItem {
  return {
    kind: structuredKind(note),
    id: note.id,
    title: note.title,
    canonicalPath: note.canonicalPath,
    revision: note.revision,
    type: note.type,
    state: note.state,
    tags: note.tags,
    aliases: note.aliases,
    properties: note.properties,
    url: "kind" in note ? note.url : `/notes/${note.id}`,
    fields: projectedFields(note)
  };
}

function projectedFields(
  note: ProjectedHumanNote | ProjectedDailyNote
): Record<string, OrganizationModelValue | null> {
  return {
    kind: structuredKind(note),
    title: note.title,
    canonical_path: note.canonicalPath,
    created: note.created,
    type: note.type,
    state: note.state,
    tags: note.tags,
    aliases: note.aliases,
    ...note.properties
  };
}

function structuredKind(
  note: ProjectedHumanNote | ProjectedDailyNote
): "standalone" | "daily" {
  return "kind" in note ? "daily" : "standalone";
}

function projectedField(
  note: ProjectedHumanNote | ProjectedDailyNote,
  field: string
): OrganizationModelValue | null | undefined {
  return projectedFields(note)[field];
}

function matchesFilter(
  note: ProjectedHumanNote | ProjectedDailyNote,
  filter: QueryFilter
): boolean {
  if ("all" in filter) {
    return filter.all.every((child) => matchesFilter(note, child));
  }
  if ("any" in filter) {
    return filter.any.some((child) => matchesFilter(note, child));
  }
  if ("not" in filter) {
    return !matchesFilter(note, filter.not);
  }
  return matchesPredicate(projectedField(note, filter.field), filter);
}

function matchesPredicate(
  candidate: OrganizationModelValue | null | undefined,
  predicate: QueryPredicate
): boolean {
  const expected = predicate.value;
  switch (predicate.operator) {
    case "equals":
      return equalValues(candidate, expected);
    case "not_equals":
      return !equalValues(candidate, expected);
    case "in":
      return Array.isArray(expected)
        ? expected.some((value) => equalValues(candidate, value))
        : false;
    case "not_in":
      return Array.isArray(expected)
        ? expected.every((value) => !equalValues(candidate, value))
        : false;
    case "contains":
      return Array.isArray(candidate)
        ? candidate.some((value) => equalValues(value, expected))
        : typeof candidate === "string" && typeof expected === "string"
          ? candidate.includes(expected)
          : false;
    case "exists": {
      const exists = candidate !== undefined && candidate !== null;
      return typeof expected === "boolean" ? exists === expected : exists;
    }
    case "greater_than":
      return (
        candidate !== undefined &&
        candidate !== null &&
        expected !== undefined &&
        compareValues(candidate, expected) > 0
      );
    case "greater_than_or_equal":
      return (
        candidate !== undefined &&
        candidate !== null &&
        expected !== undefined &&
        compareValues(candidate, expected) >= 0
      );
    case "less_than":
      return (
        candidate !== undefined &&
        candidate !== null &&
        expected !== undefined &&
        compareValues(candidate, expected) < 0
      );
    case "less_than_or_equal":
      return (
        candidate !== undefined &&
        candidate !== null &&
        expected !== undefined &&
        compareValues(candidate, expected) <= 0
      );
  }
}

function equalValues(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length &&
        left.every((value, index) => value === right[index])
    : left === right;
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined || left === null) {
    return 1;
  }
  if (right === undefined || right === null) {
    return -1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

function searchSnippet(
  document: {
    title: string;
    canonicalPath: string;
    sourceMarkdown: string;
    bodyMarkdown: string;
  },
  query: string
): string {
  const normalizedQuery = query.toLocaleLowerCase();
  for (const candidate of [
    document.title,
    document.canonicalPath,
    ...document.bodyMarkdown.split("\n"),
    ...document.sourceMarkdown.split("\n")
  ]) {
    const matchStart = candidate.toLocaleLowerCase().indexOf(normalizedQuery);
    if (matchStart < 0) {
      continue;
    }
    const start = Math.max(0, matchStart - 60);
    const end = Math.min(
      candidate.length,
      matchStart + query.length + 100
    );
    return `${start > 0 ? "…" : ""}${candidate.slice(start, end)}${
      end < candidate.length ? "…" : ""
    }`;
  }
  return document.title;
}

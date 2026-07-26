import type {
  HumanNoteListItem,
  HumanNoteResponse
} from "../contracts/human-note.js";
import type {
  NoteConnections,
  ResolvedWikilink
} from "../contracts/connections.js";
import type {
  OrganizationModelValue,
  QueryFilter,
  QueryPredicate,
  QuerySpec,
  RelationshipDefinition,
  StructuredNoteItem
} from "../contracts/organization-model.js";
import type { SearchResult } from "../contracts/search.js";
import type { DailyNoteSnapshot } from "./daily-notes.js";
import { wikilinks } from "./wikilinks.js";

export type ProjectedHumanNote = Omit<HumanNoteResponse, "vault"> & {
  created: string;
};

export type PreparedProjection = {
  humanNotes: Map<string, ProjectedHumanNote>;
  dailyNotes: Map<string, ProjectedDailyNote>;
};

type ProjectedDocument = ProjectedHumanNote | ProjectedDailyNote;

export class InMemoryProjection {
  #humanNotes = new Map<string, ProjectedHumanNote>();
  #dailyNotes = new Map<string, ProjectedDailyNote>();
  #resolutionIndexDirty = true;
  #documentsByExactTarget = new Map<string, Set<ProjectedDocument>>();
  #documentsByLinkKey = new Map<string, Set<ProjectedDocument>>();
  readonly #inboxState: string;
  readonly #archivedState: string;
  readonly #relationships: readonly RelationshipDefinition[];

  constructor(options: {
    inboxState: string;
    archivedState: string;
    relationships: readonly RelationshipDefinition[];
  }) {
    this.#inboxState = options.inboxState;
    this.#archivedState = options.archivedState;
    this.#relationships = options.relationships;
  }

  publishHumanNote(note: ProjectedHumanNote): void {
    this.#humanNotes.set(note.id, note);
    this.#resolutionIndexDirty = true;
  }

  removeHumanNote(id: string): void {
    this.#humanNotes.delete(id);
    this.#resolutionIndexDirty = true;
  }

  replaceHumanNotes(notes: readonly ProjectedHumanNote[]): void {
    const next = new Map<string, ProjectedHumanNote>();
    for (const note of notes) {
      const duplicate = next.get(note.id);
      if (duplicate) {
        throw new Error(
          `Duplicate object ID '${note.id}' in ${duplicate.canonicalPath} and ${note.canonicalPath}`
        );
      }
      next.set(note.id, note);
    }
    this.#humanNotes = next;
    this.#resolutionIndexDirty = true;
  }

  prepareAllNotes(
    humanNotes: readonly ProjectedHumanNote[],
    dailyNotes: readonly DailyNoteSnapshot[]
  ): PreparedProjection {
    const projectedDailyNotes = dailyNotes
      .map(toProjectedDailyNote)
      .filter((note): note is ProjectedDailyNote => note !== undefined);
    const prepared: PreparedProjection = {
      humanNotes: new Map(),
      dailyNotes: new Map()
    };
    for (const note of humanNotes) {
      prepared.humanNotes.set(note.id, note);
    }
    for (const note of projectedDailyNotes) {
      prepared.dailyNotes.set(note.title, note);
    }
    return prepared;
  }

  replaceAllNotes(prepared: PreparedProjection): void {
    this.#humanNotes = prepared.humanNotes;
    this.#dailyNotes = prepared.dailyNotes;
    this.#resolutionIndexDirty = true;
  }

  humanNote(id: string): ProjectedHumanNote | undefined {
    return this.#humanNotes.get(id);
  }

  humanNoteLists(): {
    notes: HumanNoteListItem[];
    inbox: HumanNoteListItem[];
    archive: HumanNoteListItem[];
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
      }).map(toListItem),
      archive: [...this.#humanNotes.values()]
        .filter((note) => note.state === this.#archivedState)
        .map(toListItem)
    };
  }

  incomingLinkCount(id: string): number | undefined {
    if (!this.#humanNotes.has(id)) {
      return undefined;
    }
    let count = 0;
    for (const source of this.#documents()) {
      if (source.id === id) {
        continue;
      }
      count += wikilinks(source.bodyMarkdown).filter(
        (link) => this.#linkResolvesTo(link, id)
      ).length;
      if (!("relationships" in source)) {
        continue;
      }
      for (const value of Object.values(source.relationships)) {
        const entries = Array.isArray(value) ? value : [value];
        count += entries.flatMap(wikilinks).filter(
          (link) => this.#linkResolvesTo(link, id)
        ).length;
      }
    }
    return count;
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
    const projected = toProjectedDailyNote(note);
    if (projected) {
      this.#dailyNotes.set(note.date, projected);
      this.#resolutionIndexDirty = true;
    }
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

  suggestions(query: string): Array<{ target: string; title: string; url: string }> {
    const normalized = query.trim().toLocaleLowerCase();
    return this.#documents()
      .filter(
        (note) =>
          !normalized ||
          [note.title, ...note.aliases].some((value) =>
            value.toLocaleLowerCase().includes(normalized)
          )
      )
      .sort((left, right) => left.title.localeCompare(right.title))
      .map((note) => ({
        target: note.title,
        title: note.title,
        url: noteUrl(note)
      }));
  }

  connections(id: string): NoteConnections | undefined {
    const note = this.#documents().find((candidate) => candidate.id === id);
    if (!note) {
      return undefined;
    }
    const outgoing = wikilinks(note.bodyMarkdown).map((link) =>
      this.#resolve(link)
    );
    const backlinks = this.#documents()
      .filter((source) =>
        wikilinks(source.bodyMarkdown).some(
          (link) =>
            this.#resolve(link).status === "resolved" &&
            this.#resolve(link).matches[0]?.id === id
        )
      )
      .map(linkedNote);
    const relationships = this.#relationships.flatMap((definition) => {
      const value =
        "relationships" in note
          ? note.relationships[definition.key]
          : undefined;
      if (value === undefined) {
        return [];
      }
      const values = Array.isArray(value) ? value : [value];
      return [
        {
          key: definition.key,
          name: definition.name,
          cardinality: definition.cardinality,
          targets: values.flatMap(wikilinks).map((link) => this.#resolve(link))
        }
      ];
    });
    const inverseRelationships = this.#documents().flatMap((source) => {
      if (!("relationships" in source)) {
        return [];
      }
      return this.#relationships.flatMap((definition) => {
        const value = source.relationships[definition.key];
        if (value === undefined) {
          return [];
        }
        const values = Array.isArray(value) ? value : [value];
        return values.some((entry) =>
          wikilinks(entry).some((link) => {
            const resolved = this.#resolve(link);
            return (
              resolved.status === "resolved" &&
              resolved.matches[0]?.id === id
            );
          })
        )
          ? [{ key: definition.inverse, source: linkedNote(source) }]
          : [];
      });
    });
    return { outgoing, backlinks, relationships, inverseRelationships };
  }

  targetResolvesTo(target: string, id: string): boolean {
    return this.#linkResolvesTo(
      {
        target,
        label: target,
        sourceMarkdown: `[[${target}]]`
      },
      id
    );
  }

  readonlyDocuments(): readonly ProjectedDocument[] {
    return this.#documents();
  }

  assertUniqueObjectIds(): void {
    const pathsById = new Map<string, string>();
    for (const note of this.#documents()) {
      const priorPath = pathsById.get(note.id);
      if (priorPath) {
        throw new Error(
          `Duplicate object ID '${note.id}' in ${priorPath} and ${note.canonicalPath}`
        );
      }
      pathsById.set(note.id, note.canonicalPath);
    }
  }

  #documents(): ProjectedDocument[] {
    return [...this.#humanNotes.values(), ...this.#dailyNotes.values()];
  }

  #ensureResolutionIndex(): void {
    if (!this.#resolutionIndexDirty) {
      return;
    }
    const exactTargets = new Map<string, Set<ProjectedDocument>>();
    const linkKeys = new Map<string, Set<ProjectedDocument>>();
    const add = (
      index: Map<string, Set<ProjectedDocument>>,
      key: string,
      note: ProjectedDocument
    ) => {
      const matches = index.get(key) ?? new Set<ProjectedDocument>();
      matches.add(note);
      index.set(key, matches);
    };
    for (const note of this.#documents()) {
      const filename = note.canonicalPath
        .split("/")
        .at(-1)!
        .replace(/\.md$/, "");
      for (const candidate of [note.title, filename, ...note.aliases]) {
        add(exactTargets, candidate.toLocaleLowerCase(), note);
        add(linkKeys, linkKey(candidate), note);
      }
    }
    this.#documentsByExactTarget = exactTargets;
    this.#documentsByLinkKey = linkKeys;
    this.#resolutionIndexDirty = false;
  }

  #linkResolvesTo(
    link: { target: string; label: string; sourceMarkdown: string },
    id: string
  ): boolean {
    const resolved = this.#resolve(link);
    return (
      resolved.status === "resolved" &&
      resolved.matches[0]?.id === id
    );
  }

  #resolve(link: {
    target: string;
    label: string;
    sourceMarkdown: string;
  }): ResolvedWikilink {
    this.#ensureResolutionIndex();
    const normalized = link.target.toLocaleLowerCase();
    const normalizedKey = linkKey(link.target);
    const candidates = new Set<ProjectedDocument>([
      ...(this.#documentsByExactTarget.get(normalized) ?? []),
      ...(this.#documentsByLinkKey.get(normalizedKey) ?? [])
    ]);
    const matches = this.#documents().filter((note) => candidates.has(note));
    return {
      ...link,
      status:
        matches.length === 1
          ? "resolved"
          : matches.length > 1
            ? "ambiguous"
            : "unresolved",
      url: matches.length === 1 ? noteUrl(matches[0]!) : null,
      matches: matches.map(linkedNote)
    };
  }
}

function linkKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export type ProjectedDailyNote = {
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

function toProjectedDailyNote(
  note: DailyNoteSnapshot
): ProjectedDailyNote | undefined {
  if (!note.exists || !note.revision || !note.sourceMarkdown) {
    return undefined;
  }
  return {
    kind: "daily-note",
    id: note.id,
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
  };
}

function noteUrl(note: ProjectedHumanNote | ProjectedDailyNote): string {
  return "kind" in note ? note.url : `/notes/${note.id}`;
}

function linkedNote(note: ProjectedHumanNote | ProjectedDailyNote): {
  id: string;
  title: string;
  url: string;
} {
  return { id: note.id, title: note.title, url: noteUrl(note) };
}

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

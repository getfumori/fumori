import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type {
  HumanNoteListItem,
  HumanNoteResponse
} from "../contracts/human-note.js";
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
      inbox: active
        .filter((note) => note.state === this.#inboxState)
        .map(toListItem)
    };
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
      title: note.date,
      canonicalPath: `human/daily/${note.date}.md`,
      url: `/daily/${note.date}`,
      revision: note.revision,
      bodyMarkdown: note.bodyMarkdown,
      sourceMarkdown: note.sourceMarkdown
    });
  }

  async rebuildDailyNotes(vaultPath: string): Promise<void> {
    const directory = join(vaultPath, "human", "daily");
    for (const filename of await readdir(directory)) {
      const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!match?.[1]) {
        continue;
      }
      const date = match[1];
      const sourceMarkdown = await readFile(join(directory, filename), "utf8");
      const heading = `# ${date}\n`;
      const headingStart = sourceMarkdown.indexOf(heading);
      if (headingStart < 0) {
        throw new Error(`Daily Note is missing its date heading: ${filename}`);
      }
      const bodyMarkdown = sourceMarkdown
        .slice(headingStart + heading.length)
        .replace(/^\n/, "")
        .replace(/\n$/, "");
      this.publishDailyNote({
        date,
        exists: true,
        revision: createHash("sha256").update(sourceMarkdown).digest("hex"),
        bodyMarkdown,
        sourceMarkdown
      });
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
}

type ProjectedDailyNote = {
  kind: "daily-note";
  id: string;
  title: string;
  canonicalPath: string;
  url: string;
  revision: string;
  bodyMarkdown: string;
  sourceMarkdown: string;
};

function toListItem(note: ProjectedHumanNote): HumanNoteListItem {
  return {
    id: note.id,
    title: note.title,
    canonicalPath: note.canonicalPath,
    revision: note.revision,
    state: note.state,
    url: `/notes/${note.id}`
  };
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

import { createHash, randomUUID } from "node:crypto";
import {
  access,
  open,
  readFile,
  readdir,
  rename
} from "node:fs/promises";
import { basename, join } from "node:path";

import { parseDocument } from "yaml";
import { z } from "zod";

import type { SaveHumanNoteRequest } from "../contracts/human-note.js";
import {
  InMemoryProjection,
  type ProjectedHumanNote
} from "./in-memory-projection.js";
import { atomicReplace } from "./atomic-publication.js";
import type { OrganizationModel } from "./organization-model.js";

type HumanNoteMetadata = {
  id: string;
  created: string;
  state: string;
  frontmatter?: string;
};

export class HumanNoteNotFoundError extends Error {}

export class StaleHumanNoteRevisionError extends Error {
  constructor(readonly currentRevision: string) {
    super("The Human Note changed after this draft was loaded");
  }
}

export class InvalidHumanNoteMarkdownError extends Error {}

function workingRevision(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function reservedValue(frontmatter: string, key: string): string {
  const values = [
    ...frontmatter.matchAll(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "gm"))
  ];
  if (values.length !== 1) {
    throw new InvalidHumanNoteMarkdownError(
      `Reserved field '${key}' must appear exactly once.`
    );
  }
  return values[0]![1]!;
}

function titleFromBody(bodyMarkdown: string): string {
  let insideFence = false;
  for (const line of bodyMarkdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) {
      continue;
    }
    const title = line.match(/^#\s+(.+?)\s*$/)?.[1]?.trim();
    if (title) {
      return title;
    }
  }
  return "Untitled note";
}

function readableSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "note";
}

function decodeHumanNote(
  source: string,
  canonicalPath: string,
  model: OrganizationModel
): ProjectedHumanNote {
  const bodyMarker = "\n---\n";
  const bodyStart = source.indexOf(bodyMarker);
  if (!source.startsWith("---\n") || bodyStart < 0) {
    throw new InvalidHumanNoteMarkdownError(
      `Standalone Human Note must begin with YAML frontmatter: ${canonicalPath}`
    );
  }
  const frontmatter = source.slice(0, bodyStart + "\n---".length);
  const document = parseDocument(source.slice("---\n".length, bodyStart), {
    uniqueKeys: true
  });
  if (document.errors.length > 0) {
    throw new InvalidHumanNoteMarkdownError(
      `Invalid frontmatter in ${canonicalPath}: ${document.errors[0]!.message}`
    );
  }
  const id = reservedValue(frontmatter, "_id");
  const created = reservedValue(frontmatter, "_created");
  const state = reservedValue(frontmatter, "state");
  if (!z.uuid().safeParse(id).success) {
    throw new InvalidHumanNoteMarkdownError(
      `Reserved field '_id' must be a UUID: ${canonicalPath}`
    );
  }
  if (!z.iso.datetime({ offset: true }).safeParse(created).success) {
    throw new InvalidHumanNoteMarkdownError(
      `Reserved field '_created' must be an ISO 8601 timestamp: ${canonicalPath}`
    );
  }
  if (reservedValue(frontmatter, "_schema") !== "fumori.note") {
    throw new InvalidHumanNoteMarkdownError(
      "Reserved field '_schema' must be 'fumori.note'."
    );
  }
  if (reservedValue(frontmatter, "_version") !== "1") {
    throw new InvalidHumanNoteMarkdownError(
      "Reserved field '_version' must be '1'."
    );
  }
  if (!model.states.has(state)) {
    throw new InvalidHumanNoteMarkdownError(
      `Core property 'state' must name a Knowledge Lifecycle state: ${state}`
    );
  }
  const bodyMarkdown = source
    .slice(bodyStart + bodyMarker.length)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
  return {
    id,
    created,
    state,
    title: titleFromBody(bodyMarkdown),
    canonicalPath,
    revision: workingRevision(source),
    bodyMarkdown,
    sourceMarkdown: source
  };
}

function encodeHumanNote(
  metadata: HumanNoteMetadata,
  bodyMarkdown: string
): string {
  const frontmatter = metadata.frontmatter ?? `---
_id: ${metadata.id}
_schema: fumori.note
_version: 1
_created: ${metadata.created}
type: note
state: ${metadata.state}
tags: []
aliases: []
---`;
  return bodyMarkdown.length > 0
    ? `${frontmatter}\n\n${bodyMarkdown}\n`
    : `${frontmatter}\n`;
}

export class HumanNotes {
  readonly #directory: string;
  readonly #projection: InMemoryProjection;
  readonly #model: OrganizationModel;
  #writeTail = Promise.resolve();

  constructor(
    vaultPath: string,
    projection: InMemoryProjection,
    model: OrganizationModel
  ) {
    this.#directory = join(vaultPath, "human", "notes");
    this.#projection = projection;
    this.#model = model;
  }

  async rebuildProjection(): Promise<void> {
    const entries = await readdir(this.#directory);
    for (const filename of entries) {
      if (!filename.endsWith(".md")) {
        continue;
      }
      const canonicalPath = `human/notes/${filename}`;
      const source = await readFile(join(this.#directory, filename), "utf8");
      this.#projection.publishHumanNote(
        decodeHumanNote(source, canonicalPath, this.#model)
      );
    }
  }

  async create(): Promise<ProjectedHumanNote> {
    const id = randomUUID();
    const filename = `note-${id}.md`;
    const canonicalPath = `human/notes/${filename}`;
    const source = encodeHumanNote(
      {
        id,
        created: new Date().toISOString(),
        state: this.#model.standaloneCreationState
      },
      ""
    );
    const path = join(this.#directory, filename);
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(source, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const note = decodeHumanNote(source, canonicalPath, this.#model);
    this.#projection.publishHumanNote(note);
    return note;
  }

  read(id: string): ProjectedHumanNote | undefined {
    return this.#projection.humanNote(id);
  }

  async save(
    id: string,
    input: SaveHumanNoteRequest
  ): Promise<ProjectedHumanNote> {
    return this.#withWriteLock(async () => {
      const current = this.#projection.humanNote(id);
      if (!current) {
        throw new HumanNoteNotFoundError();
      }
      if (current.revision !== input.baseRevision) {
        throw new StaleHumanNoteRevisionError(current.revision);
      }
      let source: string;
      if (input.format === "raw") {
        const submitted = decodeHumanNote(
          input.sourceMarkdown,
          current.canonicalPath,
          this.#model
        );
        if (submitted.id !== current.id) {
          throw new InvalidHumanNoteMarkdownError(
            "Reserved field '_id' cannot be changed."
          );
        }
        if (submitted.created !== current.created) {
          throw new InvalidHumanNoteMarkdownError(
            "Reserved field '_created' cannot be changed."
          );
        }
        source = input.sourceMarkdown;
      } else {
        source = encodeHumanNote(
          {
            id: current.id,
            created: current.created,
            state: current.state,
            frontmatter: current.sourceMarkdown.slice(
              0,
              current.sourceMarkdown.indexOf("\n---\n") + "\n---".length
            )
          },
          input.bodyMarkdown
        );
      }

      let canonicalPath = current.canonicalPath;
      const temporaryFilename = `note-${current.id}.md`;
      const nextTitle = decodeHumanNote(
        source,
        canonicalPath,
        this.#model
      ).title;
      if (
        basename(current.canonicalPath) === temporaryFilename &&
        nextTitle !== "Untitled note"
      ) {
        canonicalPath = await this.#availableCanonicalPath(
          readableSlug(nextTitle)
        );
      }

      const currentPath = join(this.#directory, basename(current.canonicalPath));
      await atomicReplace(currentPath, source);
      if (canonicalPath !== current.canonicalPath) {
        const targetPath = join(this.#directory, basename(canonicalPath));
        try {
          await rename(currentPath, targetPath);
        } catch (error) {
          await atomicReplace(currentPath, current.sourceMarkdown);
          throw error;
        }
      }
      const note = decodeHumanNote(source, canonicalPath, this.#model);
      this.#projection.publishHumanNote(note);
      return note;
    });
  }

  lists(): ReturnType<InMemoryProjection["humanNoteLists"]> {
    return this.#projection.humanNoteLists();
  }

  async #availableCanonicalPath(slug: string): Promise<string> {
    for (let suffix = 1; ; suffix += 1) {
      const filename = suffix === 1 ? `${slug}.md` : `${slug}-${suffix}.md`;
      const exists = await access(join(this.#directory, filename))
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        return `human/notes/${filename}`;
      }
    }
  }

  async #withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#writeTail;
    let release = () => {};
    this.#writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

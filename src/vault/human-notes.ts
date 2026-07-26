import { createHash, randomUUID } from "node:crypto";
import {
  access,
  open,
  readFile,
  readdir,
  rename
} from "node:fs/promises";
import { basename, join } from "node:path";

import { parseDocument, type Document } from "yaml";
import { z } from "zod";

import type { SaveHumanNoteRequest } from "../contracts/human-note.js";
import {
  organizationModelValueMatches,
  type OrganizationModelValue
} from "../contracts/organization-model.js";
import {
  InMemoryProjection,
  type ProjectedHumanNote
} from "./in-memory-projection.js";
import { atomicReplace } from "./atomic-publication.js";
import type { OrganizationModel } from "./organization-model.js";

type HumanNoteMetadata = {
  id: string;
  created: string;
  type: string | null;
  state: string;
  tags?: string[];
  aliases?: string[];
  properties?: Record<string, OrganizationModelValue>;
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

function frontmatterDocument(
  source: string,
  canonicalPath: string
): {
  bodyStart: number;
  document: Document.Parsed;
  value: Record<string, unknown>;
} {
  const bodyMarker = "\n---\n";
  const bodyStart = source.indexOf(bodyMarker);
  if (!source.startsWith("---\n") || bodyStart < 0) {
    throw new InvalidHumanNoteMarkdownError(
      `Standalone Human Note must begin with YAML frontmatter: ${canonicalPath}`
    );
  }
  const document = parseDocument(source.slice("---\n".length, bodyStart), {
    uniqueKeys: true
  });
  if (document.errors.length > 0) {
    throw new InvalidHumanNoteMarkdownError(
      `Invalid frontmatter in ${canonicalPath}: ${document.errors[0]!.message}`
    );
  }
  const value = document.toJS();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidHumanNoteMarkdownError(
      `Frontmatter must be a mapping: ${canonicalPath}`
    );
  }
  return {
    bodyStart,
    document,
    value: value as Record<string, unknown>
  };
}

function stringList(
  value: unknown,
  key: "tags" | "aliases",
  canonicalPath: string
): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new InvalidHumanNoteMarkdownError(
      `Core property '${key}' must be a list of strings: ${canonicalPath}`
    );
  }
  return value;
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
  const { bodyStart, value } = frontmatterDocument(source, canonicalPath);
  const frontmatter = source.slice(0, bodyStart + "\n---".length);
  const id = reservedValue(frontmatter, "_id");
  const created = reservedValue(frontmatter, "_created");
  const state = reservedValue(frontmatter, "state");
  const primaryType =
    value.type === null || value.type === undefined
      ? null
      : typeof value.type === "string"
        ? value.type
        : undefined;
  if (primaryType === undefined || (primaryType && !model.type(primaryType))) {
    throw new InvalidHumanNoteMarkdownError(
      `Core property 'type' must name an Organization Model Type: ${String(value.type)}`
    );
  }
  const tags = stringList(value.tags, "tags", canonicalPath);
  const aliases = stringList(value.aliases, "aliases", canonicalPath);
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
  const properties: Record<string, OrganizationModelValue> = {};
  for (const property of model.type(primaryType ?? "")?.properties ?? []) {
    const propertyValue = value[property.key];
    if (property.required && propertyValue === undefined) {
      throw new InvalidHumanNoteMarkdownError(
        `Type property '${property.key}' is required: ${canonicalPath}`
      );
    }
    if (propertyValue !== undefined) {
      if (
        !organizationModelValueMatches(
          property.kind,
          propertyValue,
          property.options
        )
      ) {
        throw new InvalidHumanNoteMarkdownError(
          `Type property '${property.key}' does not match kind '${property.kind}': ${canonicalPath}`
        );
      }
      properties[property.key] = propertyValue as OrganizationModelValue;
    }
  }
  return {
    id,
    created,
    type: primaryType,
    state,
    tags,
    aliases,
    properties,
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
  const propertySource = Object.entries(metadata.properties ?? {})
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  const frontmatter = metadata.frontmatter ?? `---
_id: ${metadata.id}
_schema: fumori.note
_version: 1
_created: ${metadata.created}
type: ${metadata.type ?? "null"}
state: ${metadata.state}
tags: ${JSON.stringify(metadata.tags ?? [])}
aliases: ${JSON.stringify(metadata.aliases ?? [])}
${propertySource ? `${propertySource}\n` : ""}---`;
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

  async create(typeKey = "note"): Promise<ProjectedHumanNote> {
    const type = this.#model.type(typeKey);
    if (!type) {
      throw new InvalidHumanNoteMarkdownError(
        `Organization Model Type does not exist: ${typeKey}`
      );
    }
    const id = randomUUID();
    const filename = `note-${id}.md`;
    const canonicalPath = `human/notes/${filename}`;
    const source = encodeHumanNote(
      {
        id,
        created: new Date().toISOString(),
        type: type.key,
        state: type.defaultState ?? this.#model.standaloneCreationState,
        properties: Object.fromEntries(
          type.properties
            .filter((property) => property.default !== undefined)
            .map((property) => [property.key, property.default!])
        )
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
      } else if (input.format === "rich") {
        source = encodeHumanNote(
          {
            id: current.id,
            created: current.created,
            type: current.type,
            state: current.state,
            frontmatter: current.sourceMarkdown.slice(
              0,
              current.sourceMarkdown.indexOf("\n---\n") + "\n---".length
            )
          },
          input.bodyMarkdown
        );
      } else {
        if (!this.#model.states.has(input.state)) {
          throw new InvalidHumanNoteMarkdownError(
            `Core property 'state' must name a Knowledge Lifecycle state: ${input.state}`
          );
        }
        const type = input.type ? this.#model.type(input.type) : undefined;
        if (input.type && !type) {
          throw new InvalidHumanNoteMarkdownError(
            `Organization Model Type does not exist: ${input.type}`
          );
        }
        if (type) {
          for (const property of type.properties) {
            if (
              property.required &&
              input.properties[property.key] === undefined
            ) {
              throw new InvalidHumanNoteMarkdownError(
                `Type property '${property.key}' is required.`
              );
            }
            const value = input.properties[property.key];
            if (
              value !== undefined &&
              !organizationModelValueMatches(
                property.kind,
                value,
                property.options
              )
            ) {
              throw new InvalidHumanNoteMarkdownError(
                `Type property '${property.key}' does not match kind '${property.kind}'.`
              );
            }
          }
          for (const key of Object.keys(input.properties)) {
            if (!type.properties.some((property) => property.key === key)) {
              throw new InvalidHumanNoteMarkdownError(
                `Type '${type.key}' does not define property '${key}'.`
              );
            }
          }
        } else if (Object.keys(input.properties).length > 0) {
          throw new InvalidHumanNoteMarkdownError(
            "An untyped Human Note cannot define Type properties."
          );
        }
        const parsed = frontmatterDocument(
          current.sourceMarkdown,
          current.canonicalPath
        );
        parsed.document.set("type", input.type);
        parsed.document.set("state", input.state);
        parsed.document.set("tags", input.tags);
        parsed.document.set("aliases", input.aliases);
        for (const [key, value] of Object.entries(input.properties)) {
          parsed.document.set(key, value);
        }
        const frontmatter = `---\n${parsed.document.toString({ lineWidth: 0 })}---`;
        source = encodeHumanNote(
          {
            id: current.id,
            created: current.created,
            type: input.type,
            state: input.state,
            frontmatter
          },
          input.format === "document" ? input.bodyMarkdown : current.bodyMarkdown
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

import { createHash, randomUUID } from "node:crypto";
import {
  access,
  open,
  readFile,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import { basename, join } from "node:path";

import { parseDocument, type Document } from "yaml";
import { z } from "zod";

import type {
  DeleteHumanNoteRequest,
  SaveHumanNoteRequest
} from "../contracts/human-note.js";
import {
  organizationModelValueMatches,
  type OrganizationModelValue,
  type RelationshipDefinition
} from "../contracts/organization-model.js";
import type { DailyNoteSnapshot } from "./daily-notes.js";
import {
  InMemoryProjection,
  type ProjectedHumanNote
} from "./in-memory-projection.js";
import { atomicReplace } from "./atomic-publication.js";
import type { OrganizationModel } from "./organization-model.js";
import { rewriteWikilinks } from "./wikilinks.js";
import type { RepositoryCoordinator } from "./repository-coordinator.js";

type HumanNoteMetadata = {
  id: string;
  created: string;
  type: string | null;
  state: string;
  tags?: string[];
  aliases?: string[];
  properties?: Record<string, OrganizationModelValue>;
  relationships?: Record<string, string | string[]>;
  frontmatter?: string;
};

export class HumanNoteNotFoundError extends Error {}

export class StaleHumanNoteRevisionError extends Error {
  constructor(readonly currentRevision: string) {
    super("The Human Note changed after this draft was loaded");
  }
}

export class InvalidHumanNoteMarkdownError extends Error {}

export class HumanNoteDeletionImpactChangedError extends Error {
  constructor(readonly currentIncomingLinkCount: number) {
    super("The incoming-link impact changed after confirmation");
  }
}

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

function relationshipValue(
  value: unknown,
  definition: RelationshipDefinition,
  canonicalPath: string
): string | string[] {
  const validWikilink = (entry: unknown) =>
    typeof entry === "string" && /^\[\[[^\]\n]+\]\]$/.test(entry);
  if (definition.cardinality === "one" && validWikilink(value)) {
    return value as string;
  }
  if (
    definition.cardinality === "many" &&
    Array.isArray(value) &&
    value.every(validWikilink)
  ) {
    return value as string[];
  }
  throw new InvalidHumanNoteMarkdownError(
    `Relationship '${definition.key}' must contain ${
      definition.cardinality === "one" ? "one wikilink" : "a list of wikilinks"
    }: ${canonicalPath}`
  );
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
  const relationships: Record<string, string | string[]> = {};
  for (const relationship of model.relationships) {
    const relationshipSource = value[relationship.key];
    if (relationshipSource !== undefined) {
      relationships[relationship.key] = relationshipValue(
        relationshipSource,
        relationship,
        canonicalPath
      );
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
    relationships,
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
  const relationshipSource = Object.entries(metadata.relationships ?? {})
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
${propertySource ? `${propertySource}\n` : ""}${relationshipSource ? `${relationshipSource}\n` : ""}---`;
  return bodyMarkdown.length > 0
    ? `${frontmatter}\n\n${bodyMarkdown}\n`
    : `${frontmatter}\n`;
}

export class HumanNotes {
  readonly #vaultPath: string;
  readonly #directory: string;
  readonly #projection: InMemoryProjection;
  readonly #model: OrganizationModel;
  readonly #dailyProjectionSnapshots: (
    overrides: ReadonlyMap<string, string>
  ) => Promise<readonly DailyNoteSnapshot[]>;
  readonly #coordinator: RepositoryCoordinator;

  constructor(
    vaultPath: string,
    projection: InMemoryProjection,
    model: OrganizationModel,
    coordinator: RepositoryCoordinator,
    dailyProjectionSnapshots: (
      overrides: ReadonlyMap<string, string>
    ) => Promise<readonly DailyNoteSnapshot[]>
  ) {
    this.#vaultPath = vaultPath;
    this.#directory = join(vaultPath, "human", "notes");
    this.#projection = projection;
    this.#model = model;
    this.#coordinator = coordinator;
    this.#dailyProjectionSnapshots = dailyProjectionSnapshots;
  }

  async rebuildProjection(): Promise<void> {
    this.#projection.replaceHumanNotes(await this.#projectionNotes());
  }

  async #projectionNotes(
    overrides: ReadonlyMap<
      string,
      { destinationPath: string; source: string }
    > = new Map()
  ): Promise<ProjectedHumanNote[]> {
    const entries = await readdir(this.#directory);
    const notes: ProjectedHumanNote[] = [];
    for (const filename of entries) {
      if (!filename.endsWith(".md")) {
        continue;
      }
      const path = join(this.#directory, filename);
      const override = overrides.get(path);
      const canonicalPath = override
        ? `human/notes/${basename(override.destinationPath)}`
        : `human/notes/${filename}`;
      const source = override?.source ?? (await readFile(path, "utf8"));
      notes.push(decodeHumanNote(source, canonicalPath, this.#model));
    }
    return notes;
  }

  async create(typeKey = "note", title?: string): Promise<ProjectedHumanNote> {
    return this.#withWriteLock(() => this.#createUnlocked(typeKey, title));
  }

  async #createUnlocked(
    typeKey: string,
    title: string | undefined
  ): Promise<ProjectedHumanNote> {
    const type = this.#model.type(typeKey);
    if (!type) {
      throw new InvalidHumanNoteMarkdownError(
        `Organization Model Type does not exist: ${typeKey}`
      );
    }
    const id = randomUUID();
    const canonicalPath = `human/notes/note-${id}.md`;
    const filename = basename(canonicalPath);
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
      title ? `# ${title}` : ""
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
    if (!title) {
      this.#projection.publishHumanNote(note);
      return note;
    }
    const titledCanonicalPath = await this.#availableCanonicalPath(
      readableSlug(title)
    );
    const titledPath = join(this.#directory, basename(titledCanonicalPath));
    try {
      await rename(path, titledPath);
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    const titled = decodeHumanNote(source, titledCanonicalPath, this.#model);
    this.#projection.publishHumanNote(titled);
    return titled;
  }

  async read(id: string): Promise<ProjectedHumanNote | undefined> {
    return this.#coordinator.runRead(() => this.#readUnlocked(id));
  }

  async #readUnlocked(id: string): Promise<ProjectedHumanNote | undefined> {
    const projected = this.#projection.humanNote(id);
    if (!projected) {
      return undefined;
    }
    const source = await readFile(
      join(this.#directory, basename(projected.canonicalPath)),
      "utf8"
    ).catch((error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    });
    if (source !== undefined) {
      const current = decodeHumanNote(
        source,
        projected.canonicalPath,
        this.#model
      );
      this.#projection.publishHumanNote(current);
      return current;
    }
    await this.rebuildProjection();
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
        if (input.relationships) {
          for (const relationship of this.#model.relationships) {
            if (input.relationships[relationship.key] === undefined) {
              parsed.document.delete(relationship.key);
            } else {
              relationshipValue(
                input.relationships[relationship.key],
                relationship,
                current.canonicalPath
              );
              parsed.document.set(
                relationship.key,
                input.relationships[relationship.key]
              );
            }
          }
        }
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

  async deletionImpact(
    id: string
  ): Promise<{ id: string; revision: string; incomingLinkCount: number }> {
    return this.#coordinator.runRead(async () => {
      const note = await this.#readUnlocked(id);
      const incomingLinkCount = this.#projection.incomingLinkCount(id);
      if (!note || incomingLinkCount === undefined) {
        throw new HumanNoteNotFoundError();
      }
      return { id, revision: note.revision, incomingLinkCount };
    });
  }

  async delete(id: string, input: DeleteHumanNoteRequest): Promise<void> {
    await this.#withWriteLock(async () => {
      const current = this.#projection.humanNote(id);
      if (!current) {
        throw new HumanNoteNotFoundError();
      }
      if (current.revision !== input.baseRevision) {
        throw new StaleHumanNoteRevisionError(current.revision);
      }
      const incomingLinkCount = this.#projection.incomingLinkCount(id);
      if (incomingLinkCount === undefined) {
        throw new HumanNoteNotFoundError();
      }
      if (incomingLinkCount !== input.confirmedIncomingLinkCount) {
        throw new HumanNoteDeletionImpactChangedError(incomingLinkCount);
      }
      await this.#coordinator.publishDeletion(
        join(this.#directory, basename(current.canonicalPath)),
        current.sourceMarkdown,
        () => this.#projection.removeHumanNote(id)
      );
    });
  }

  async renameToTitle(
    id: string,
    baseRevision: string
  ): Promise<ProjectedHumanNote> {
    return this.#withWriteLock(async () => {
      const current = this.#projection.humanNote(id);
      if (!current) {
        throw new HumanNoteNotFoundError();
      }
      if (current.revision !== baseRevision) {
        throw new StaleHumanNoteRevisionError(current.revision);
      }
      if (current.title === "Untitled note") {
        throw new InvalidHumanNoteMarkdownError(
          "Rename to title requires a meaningful H1."
        );
      }
      if (/[\[\]|]/.test(current.title)) {
        throw new InvalidHumanNoteMarkdownError(
          "Rename to title requires a title that can be used as a readable wikilink target."
        );
      }
      const titleSlug = readableSlug(current.title);
      const preferredDestination = `human/notes/${titleSlug}.md`;
      const destination =
        preferredDestination === current.canonicalPath
          ? preferredDestination
          : await this.#availableCanonicalPath(titleSlug);
      const transaction = new Map<
        string,
        { destinationPath: string; beforeSource: string; source: string }
      >();
      for (const directory of ["human/notes", "human/daily"] as const) {
        const absoluteDirectory = join(this.#vaultPath, directory);
        for (const filename of await readdir(absoluteDirectory)) {
          if (!filename.endsWith(".md")) {
            continue;
          }
          const path = join(absoluteDirectory, filename);
          const source = await readFile(path, "utf8");
          const rewritten = rewriteWikilinks(
            source,
            (target) => this.#projection.targetResolvesTo(target, id),
            current.title
          );
          const isRenamedNote = path === join(
            this.#directory,
            basename(current.canonicalPath)
          );
          const targetPath = isRenamedNote
            ? join(this.#directory, basename(destination))
            : path;
          if (rewritten !== source || targetPath !== path) {
            transaction.set(path, {
              destinationPath: targetPath,
              beforeSource: source,
              source: rewritten
            });
          }
        }
      }
      for (const { destinationPath: path, source } of transaction.values()) {
        if (path.startsWith(`${this.#directory}/`)) {
          decodeHumanNote(
            source,
            `human/notes/${basename(path)}`,
            this.#model
          );
        }
      }
      const dailyOverrides = new Map(
        [...transaction]
          .filter(([path]) =>
            path.startsWith(`${join(this.#vaultPath, "human/daily")}/`)
          )
          .map(([path, file]) => [path, file.source])
      );
      const [humanNotes, dailyNotes] = await Promise.all([
        this.#projectionNotes(transaction),
        this.#dailyProjectionSnapshots(dailyOverrides)
      ]);
      const preparedProjection = this.#projection.prepareAllNotes(
        humanNotes,
        dailyNotes
      );
      await this.#coordinator.publishTransaction(
        [...transaction].map(([sourcePath, file]) => ({
          sourcePath,
          ...file
        })),
        "Rename Human Note to title",
        () => this.#projection.replaceAllNotes(preparedProjection)
      );
      return this.#projection.humanNote(id)!;
    });
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
    return this.#coordinator.runWrite(operation);
  }
}

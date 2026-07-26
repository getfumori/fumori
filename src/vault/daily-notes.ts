import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  readdir
} from "node:fs/promises";
import { join } from "node:path";

import { parseDocument } from "yaml";
import { z } from "zod";

import { dailyNoteDateSchema } from "../contracts/daily-note-date.js";
import type { SaveDailyNoteRequest } from "../contracts/daily-note.js";
import {
  organizationModelValueMatches,
  type OrganizationModelValue
} from "../contracts/organization-model.js";
import { atomicReplace } from "./atomic-publication.js";
import type { OrganizationModel } from "./organization-model.js";

type DailyNoteMetadata = {
  id: string;
  created: string;
  date: string;
  state: string;
  tags: string[];
  aliases: string[];
  properties: Record<string, OrganizationModelValue>;
  frontmatter?: string;
};

export type DailyNoteSnapshot = {
  date: string;
  exists: boolean;
  revision: string | null;
  bodyMarkdown: string;
  sourceMarkdown: string | null;
  type: "daily-note";
  state: string;
  tags: string[];
  aliases: string[];
  properties: Record<string, OrganizationModelValue>;
};

export class StaleDailyNoteRevisionError extends Error {
  constructor(readonly currentRevision: string | null) {
    super("The Daily Note changed after this draft was loaded");
  }
}

export class ExplicitDailyNoteCreationRequiredError extends Error {
  constructor() {
    super("A missing historical Daily Note must be created explicitly");
  }
}

export class InvalidDailyNoteMarkdownError extends Error {}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function workingRevision(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function createDailyNoteMetadata(
  date: string,
  model: OrganizationModel
): DailyNoteMetadata {
  const type = model.type("daily-note");
  if (!type) {
    throw new InvalidDailyNoteMarkdownError(
      "Organization Model Type does not exist: daily-note"
    );
  }
  return {
    id: randomUUID(),
    created: new Date().toISOString(),
    date,
    state: type.defaultState ?? "organized",
    tags: [],
    aliases: [],
    properties: Object.fromEntries(
      type.properties
        .filter((property) => property.default !== undefined)
        .map((property) => [property.key, property.default!])
    )
  };
}

function reservedValue(frontmatter: string, key: string): string {
  const values = [
    ...frontmatter.matchAll(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "gm"))
  ];
  if (values.length !== 1) {
    throw new InvalidDailyNoteMarkdownError(
      `Reserved field '${key}' must appear exactly once.`
    );
  }
  return values[0]![1]!;
}

function decodeDailyNote(
  source: string,
  expectedDate: string,
  model: OrganizationModel
): { bodyMarkdown: string; metadata: DailyNoteMetadata } {
  const bodyMarker = "\n---\n\n";
  const bodyStart = source.indexOf(bodyMarker);
  const requiredHeading = `# ${expectedDate}\n`;
  if (!source.startsWith("---\n") || bodyStart < 0) {
    throw new InvalidDailyNoteMarkdownError(
      "Canonical Markdown must begin with YAML frontmatter."
    );
  }
  const content = source.slice(bodyStart + bodyMarker.length);
  if (!content.startsWith(requiredHeading)) {
    throw new InvalidDailyNoteMarkdownError(
      `Canonical Markdown must retain the '# ${expectedDate}' date heading.`
    );
  }

  const frontmatter = source.slice(0, bodyStart + "\n---".length);
  const frontmatterDocument = parseDocument(
    source.slice("---\n".length, bodyStart),
    { uniqueKeys: true }
  );
  if (frontmatterDocument.errors.length > 0) {
    throw new InvalidDailyNoteMarkdownError(
      `Invalid frontmatter: ${frontmatterDocument.errors[0]!.message}`
    );
  }
  const parsedFrontmatter = frontmatterDocument.toJS();
  if (
    typeof parsedFrontmatter !== "object" ||
    parsedFrontmatter === null ||
    Array.isArray(parsedFrontmatter)
  ) {
    throw new InvalidDailyNoteMarkdownError(
      "Invalid frontmatter: expected a YAML mapping."
    );
  }
  const id = reservedValue(frontmatter, "_id");
  const created = reservedValue(frontmatter, "_created");
  const frontmatterValue = parsedFrontmatter as Record<string, unknown>;
  const state = reservedValue(frontmatter, "state");
  if (!model.states.has(state)) {
    throw new InvalidDailyNoteMarkdownError(
      `Core property 'state' must name a Knowledge Lifecycle state: ${state}`
    );
  }
  const tags = stringList(frontmatterValue.tags, "tags");
  const aliases = stringList(frontmatterValue.aliases, "aliases");
  if (!z.uuid().safeParse(id).success) {
    throw new InvalidDailyNoteMarkdownError(
      "Reserved field '_id' must be a UUID."
    );
  }
  if (!z.iso.datetime({ offset: true }).safeParse(created).success) {
    throw new InvalidDailyNoteMarkdownError(
      "Reserved field '_created' must be an ISO 8601 timestamp."
    );
  }
  const expectedValues = {
    _schema: "fumori.daily-note",
    _version: "1",
    type: "daily-note",
    date: expectedDate
  };
  for (const [key, expectedValue] of Object.entries(expectedValues)) {
    if (reservedValue(frontmatter, key) !== expectedValue) {
      throw new InvalidDailyNoteMarkdownError(
        `Reserved field '${key}' must be '${expectedValue}'.`
      );
    }
  }
  const metadata: DailyNoteMetadata = {
    id,
    created,
    date: expectedDate,
    state,
    tags,
    aliases,
    properties: decodeTypeProperties(frontmatterValue, model),
    frontmatter
  };
  let bodyMarkdown = content.slice(requiredHeading.length);
  if (bodyMarkdown.startsWith("\n")) {
    bodyMarkdown = bodyMarkdown.slice(1);
  }
  if (bodyMarkdown.endsWith("\n")) {
    bodyMarkdown = bodyMarkdown.slice(0, -1);
  }
  return { bodyMarkdown, metadata };
}

function decodeTypeProperties(
  frontmatter: Record<string, unknown>,
  model: OrganizationModel
): Record<string, OrganizationModelValue> {
  const properties: Record<string, OrganizationModelValue> = {};
  for (const property of model.type("daily-note")?.properties ?? []) {
    const value = frontmatter[property.key];
    if (property.required && value === undefined) {
      throw new InvalidDailyNoteMarkdownError(
        `Type property '${property.key}' is required.`
      );
    }
    if (value !== undefined) {
      if (
        !organizationModelValueMatches(
          property.kind,
          value,
          property.options
        )
      ) {
        throw new InvalidDailyNoteMarkdownError(
          `Type property '${property.key}' does not match kind '${property.kind}'.`
        );
      }
      properties[property.key] = value as OrganizationModelValue;
    }
  }
  return properties;
}

function stringList(
  value: unknown,
  key: "tags" | "aliases"
): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new InvalidDailyNoteMarkdownError(
      `Core property '${key}' must be a list of strings.`
    );
  }
  return value;
}

function encodeDailyNote(
  metadata: DailyNoteMetadata,
  bodyMarkdown: string
): string {
  const body = bodyMarkdown.length > 0 ? `\n${bodyMarkdown}\n` : "";
  const propertySource = Object.entries(metadata.properties)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  const frontmatter = metadata.frontmatter ?? `---
_id: ${metadata.id}
_schema: fumori.daily-note
_version: 1
_created: ${metadata.created}
type: daily-note
state: ${metadata.state}
tags: ${JSON.stringify(metadata.tags)}
aliases: ${JSON.stringify(metadata.aliases)}
${propertySource ? `${propertySource}\n` : ""}\
date: ${metadata.date}
---`;
  return `${frontmatter}

# ${metadata.date}
${body}`;
}

export class DailyNotes {
  readonly #dailyDirectory: string;
  readonly #today: () => string;
  readonly #model: OrganizationModel;
  readonly #writeTails = new Map<string, Promise<void>>();
  readonly #virtualMetadata = new Map<string, DailyNoteMetadata>();
  readonly #onPublication:
    | ((note: DailyNoteSnapshot) => void)
    | undefined;

  constructor(
    vaultPath: string,
    today: () => string,
    model: OrganizationModel,
    onPublication?: (note: DailyNoteSnapshot) => void
  ) {
    this.#dailyDirectory = join(vaultPath, "human", "daily");
    this.#today = today;
    this.#model = model;
    this.#onPublication = onPublication;
  }

  async read(dateInput: string): Promise<DailyNoteSnapshot> {
    const date = dailyNoteDateSchema.parse(dateInput);
    const path = join(this.#dailyDirectory, `${date}.md`);
    const source = await readFile(path, "utf8").catch((error: unknown) => {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    });
    if (source === undefined) {
      const sourceMarkdown =
        date === this.#today()
          ? encodeDailyNote(this.#metadataForMissing(date), "")
          : null;
      return {
        date,
        exists: false,
        revision: null,
        bodyMarkdown: "",
        sourceMarkdown,
        ...this.#publicMetadata(this.#metadataForMissing(date))
      };
    }
    const decoded = decodeDailyNote(source, date, this.#model);
    return {
      date,
      exists: true,
      revision: workingRevision(source),
      bodyMarkdown: decoded.bodyMarkdown,
      sourceMarkdown: source,
      ...this.#publicMetadata(decoded.metadata)
    };
  }

  async rebuildProjection(): Promise<void> {
    for (const filename of await readdir(this.#dailyDirectory)) {
      const date = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/)?.[1];
      if (!date) {
        continue;
      }
      this.#onPublication?.(await this.read(date));
    }
  }

  async save(
    dateInput: string,
    input: SaveDailyNoteRequest
  ): Promise<DailyNoteSnapshot> {
    const date = dailyNoteDateSchema.parse(dateInput);
    return this.#withWriteLock(date, async () => {
      const current = await this.read(date);
      if (current.revision !== input.baseRevision) {
        throw new StaleDailyNoteRevisionError(current.revision);
      }
      if (!current.exists && date !== this.#today()) {
        throw new ExplicitDailyNoteCreationRequiredError();
      }
      const path = join(this.#dailyDirectory, `${date}.md`);
      if (input.format === "raw") {
        const submittedMetadata = decodeDailyNote(
          input.sourceMarkdown,
          date,
          this.#model
        ).metadata;
        if (current.sourceMarkdown) {
          const currentMetadata = decodeDailyNote(
            current.sourceMarkdown,
            date,
            this.#model
          ).metadata;
          if (submittedMetadata.id !== currentMetadata.id) {
            throw new InvalidDailyNoteMarkdownError(
              "Reserved field '_id' cannot be changed."
            );
          }
          if (submittedMetadata.created !== currentMetadata.created) {
            throw new InvalidDailyNoteMarkdownError(
              "Reserved field '_created' cannot be changed."
            );
          }
        }
        await atomicReplace(path, input.sourceMarkdown);
        this.#virtualMetadata.delete(date);
        const saved = await this.read(date);
        this.#onPublication?.(saved);
        return saved;
      }
      const metadata = current.exists
        ? decodeDailyNote(await readFile(path, "utf8"), date, this.#model).metadata
        : this.#metadataForMissing(date);
      if (input.format === "document") {
        this.#validateMetadata(input);
        const existingFrontmatter =
          metadata.frontmatter ??
          (() => {
            const generated = encodeDailyNote(metadata, "");
            return generated.slice(
              0,
              generated.indexOf("\n---\n\n") + "\n---".length
            );
          })();
        const document = parseDocument(
          existingFrontmatter.slice(
            "---\n".length,
            existingFrontmatter.length - "\n---".length
          ),
          { uniqueKeys: true }
        );
        document.set("state", input.state);
        document.set("tags", input.tags);
        document.set("aliases", input.aliases);
        for (const [key, value] of Object.entries(input.properties)) {
          document.set(key, value);
        }
        metadata.frontmatter = `---\n${document.toString({ lineWidth: 0 })}---`;
        metadata.state = input.state;
        metadata.tags = input.tags;
        metadata.aliases = input.aliases;
        metadata.properties = input.properties;
      }
      await atomicReplace(path, encodeDailyNote(metadata, input.bodyMarkdown));
      this.#virtualMetadata.delete(date);
      const saved = await this.read(date);
      this.#onPublication?.(saved);
      return saved;
    });
  }

  async create(
    dateInput: string
  ): Promise<{ created: boolean; note: DailyNoteSnapshot }> {
    const date = dailyNoteDateSchema.parse(dateInput);
    return this.#withWriteLock(date, async () => {
      const current = await this.read(date);
      if (current.exists) {
        return { created: false, note: current };
      }
      const path = join(this.#dailyDirectory, `${date}.md`);
      await atomicReplace(
        path,
        encodeDailyNote(
          createDailyNoteMetadata(date, this.#model),
          ""
        )
      );
      this.#virtualMetadata.delete(date);
      const note = await this.read(date);
      this.#onPublication?.(note);
      return { created: true, note };
    });
  }

  #metadataForMissing(date: string): DailyNoteMetadata {
    const existing = this.#virtualMetadata.get(date);
    if (existing) {
      return existing;
    }
    const created = createDailyNoteMetadata(date, this.#model);
    this.#virtualMetadata.set(date, created);
    return created;
  }

  #publicMetadata(metadata: DailyNoteMetadata) {
    return {
      type: "daily-note" as const,
      state: metadata.state,
      tags: metadata.tags,
      aliases: metadata.aliases,
      properties: metadata.properties
    };
  }

  #validateMetadata(
    input: Extract<SaveDailyNoteRequest, { format: "document" }>
  ): void {
    if (!this.#model.states.has(input.state)) {
      throw new InvalidDailyNoteMarkdownError(
        `Core property 'state' must name a Knowledge Lifecycle state: ${input.state}`
      );
    }
    const type = this.#model.type("daily-note");
    for (const property of type?.properties ?? []) {
      const value = input.properties[property.key];
      if (property.required && value === undefined) {
        throw new InvalidDailyNoteMarkdownError(
          `Type property '${property.key}' is required.`
        );
      }
      if (
        value !== undefined &&
        !organizationModelValueMatches(
          property.kind,
          value,
          property.options
        )
      ) {
        throw new InvalidDailyNoteMarkdownError(
          `Type property '${property.key}' does not match kind '${property.kind}'.`
        );
      }
    }
    for (const key of Object.keys(input.properties)) {
      if (!type?.properties.some((property) => property.key === key)) {
        throw new InvalidDailyNoteMarkdownError(
          `Type 'daily-note' does not define property '${key}'.`
        );
      }
    }
  }

  async #withWriteLock<T>(date: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#writeTails.get(date) ?? Promise.resolve();
    let release = () => {};
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#writeTails.set(date, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#writeTails.get(date) === tail) {
        this.#writeTails.delete(date);
      }
    }
  }
}

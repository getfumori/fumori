import { createHash, randomUUID } from "node:crypto";
import {
  open,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { dailyNoteDateSchema } from "../contracts/daily-note-date.js";

type DailyNoteMetadata = {
  id: string;
  created: string;
  date: string;
  frontmatter?: string;
};

export type DailyNoteSnapshot = {
  date: string;
  exists: boolean;
  revision: string | null;
  bodyMarkdown: string;
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

function manifestValue(source: string, key: string): string | undefined {
  return source.match(new RegExp(`^${key}: (.+)$`, "m"))?.[1];
}

function decodeDailyNote(
  source: string,
  expectedDate: string
): { bodyMarkdown: string; metadata: DailyNoteMetadata } {
  const bodyMarker = "\n---\n\n";
  const bodyStart = source.indexOf(bodyMarker);
  const requiredHeading = `# ${expectedDate}\n`;
  if (bodyStart < 0) {
    throw new Error(`Daily Note ${expectedDate} has invalid frontmatter`);
  }
  const content = source.slice(bodyStart + bodyMarker.length);
  if (!content.startsWith(requiredHeading)) {
    throw new Error(`Daily Note ${expectedDate} is missing its date H1`);
  }

  const requiredMetadata = z
    .object({
      id: z.uuid(),
      created: z.string().min(1),
      date: z.literal(expectedDate)
    })
    .parse({
      id: manifestValue(source, "_id"),
      created: manifestValue(source, "_created"),
      date: manifestValue(source, "date")
    });
  const metadata: DailyNoteMetadata = {
    ...requiredMetadata,
    frontmatter: source.slice(0, bodyStart + "\n---".length)
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

function encodeDailyNote(
  metadata: DailyNoteMetadata,
  bodyMarkdown: string
): string {
  const body = bodyMarkdown.length > 0 ? `\n${bodyMarkdown}\n` : "";
  const frontmatter = metadata.frontmatter ?? `---
_id: ${metadata.id}
_schema: fumori.daily-note
_version: 1
_created: ${metadata.created}
type: daily-note
state: organized
tags: []
aliases: []
date: ${metadata.date}
---`;
  return `${frontmatter}

# ${metadata.date}
${body}`;
}

async function atomicReplace(path: string, source: string): Promise<void> {
  const temporaryPath = `${path}.fumori-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch (error) {
    await handle?.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export class DailyNotes {
  readonly #dailyDirectory: string;
  readonly #today: () => string;
  readonly #writeTails = new Map<string, Promise<void>>();

  constructor(vaultPath: string, today: () => string) {
    this.#dailyDirectory = join(vaultPath, "human", "daily");
    this.#today = today;
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
      return { date, exists: false, revision: null, bodyMarkdown: "" };
    }
    const decoded = decodeDailyNote(source, date);
    return {
      date,
      exists: true,
      revision: workingRevision(source),
      bodyMarkdown: decoded.bodyMarkdown
    };
  }

  async save(
    dateInput: string,
    input: { baseRevision: string | null; bodyMarkdown: string }
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
      const metadata = current.exists
        ? decodeDailyNote(await readFile(path, "utf8"), date).metadata
        : {
            id: randomUUID(),
            created: new Date().toISOString(),
            date
          };
      await atomicReplace(path, encodeDailyNote(metadata, input.bodyMarkdown));
      return this.read(date);
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
          {
            id: randomUUID(),
            created: new Date().toISOString(),
            date
          },
          ""
        )
      );
      return { created: true, note: await this.read(date) };
    });
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

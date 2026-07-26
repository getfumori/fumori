import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import type { CheckpointResponse } from "../contracts/checkpoint.js";
import { atomicReplace } from "./atomic-publication.js";

const execFileAsync = promisify(execFile);

function gitOptions() {
  const environment = Object.fromEntries(
    ["PATH", "LANG", "LC_ALL", "TMPDIR"].flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    })
  );
  return {
    env: {
      ...environment,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0"
    }
  };
}

export async function hardenedGit(vaultPath: string, arguments_: string[]) {
  const filterConfiguration = await execFileAsync(
    "git",
    [
      "-C",
      vaultPath,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "config",
      "--includes",
      "--name-only",
      "--get-regexp",
      "^filter\\..*\\.(clean|smudge|process|required)$"
    ],
    gitOptions()
  ).then(
    ({ stdout }) => stdout,
    (error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: number }).code === 1
      ) {
        return "";
      }
      throw error;
    }
  );
  const filterDrivers = new Set(
    filterConfiguration
      .split("\n")
      .map((key) =>
        key.match(/^filter\.(.+)\.(?:clean|smudge|process|required)$/)?.[1]
      )
      .filter((driver): driver is string => driver !== undefined)
  );
  const filterOverrides = [...filterDrivers].flatMap((driver) => [
    "-c",
    `filter.${driver}.clean=`,
    "-c",
    `filter.${driver}.smudge=`,
    "-c",
    `filter.${driver}.process=`,
    "-c",
    `filter.${driver}.required=false`
  ]);
  return execFileAsync(
    "git",
    [
      "-C",
      vaultPath,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "commit.gpgSign=false",
      "-c",
      "credential.helper=",
      ...filterOverrides,
      ...arguments_
    ],
    gitOptions()
  );
}

type TransactionFile = {
  sourcePath: string;
  destinationPath: string;
  beforeSource: string;
  source: string;
};

type Journal = {
  beforeHead: string;
  stagingDirectory: string;
  files: Array<
    TransactionFile & {
      temporaryPath: string;
      backupPath: string;
    }
  >;
};

const transactionFileSchema = z.object({
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
  beforeSource: z.string(),
  source: z.string(),
  temporaryPath: z.string().min(1),
  backupPath: z.string().min(1)
});

const journalSchema = z.object({
  beforeHead: z.string().regex(/^[0-9a-f]{40}$/),
  stagingDirectory: z.string().min(1),
  files: z.array(transactionFileSchema).min(1)
});

const CANONICAL_ROOTS = [
  ".second-brain",
  "assets",
  "human",
  "knowledge",
  "sources"
] as const;

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}

export class RepositoryCoordinator {
  readonly #vaultPath: string;
  readonly #journalPath: string;
  #writeTail = Promise.resolve();
  #publicationTail = Promise.resolve();

  private constructor(vaultPath: string, journalPath: string) {
    this.#vaultPath = vaultPath;
    this.#journalPath = journalPath;
  }

  static async open(vaultPath: string): Promise<RepositoryCoordinator> {
    const gitDirectory = (
      await hardenedGit(vaultPath, [
        "rev-parse",
        "--absolute-git-dir"
      ])
    ).stdout.trim();
    const coordinator = new RepositoryCoordinator(
      vaultPath,
      `${gitDirectory}/fumori-transaction.json`
    );
    await coordinator.#recover();
    return coordinator;
  }

  async runWrite<T>(operation: () => Promise<T>): Promise<T> {
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

  async runRead<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#publicationTail;
    let release = () => {};
    this.#publicationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async checkpoint(message = "Checkpoint Vault"): Promise<CheckpointResponse> {
    return this.runWrite(async () => {
      await this.#stage();
      const changedFileCount = await this.#stagedChangedFileCount();
      if (changedFileCount === 0) {
        return { created: false, sha: null, changedFileCount: 0 };
      }
      await this.#commitStaged(message);
      return {
        created: true,
        sha: await this.#head(),
        changedFileCount
      };
    });
  }

  async publishDeletion(
    path: string,
    beforeSource: string,
    afterPublication: () => void
  ): Promise<void> {
    await this.runRead(async () => {
      if ((await readFile(path, "utf8")) !== beforeSource) {
        throw new Error(`Deletion target changed: ${path}`);
      }
      await rm(path);
      afterPublication();
    });
  }

  async publishTransaction(
    files: readonly TransactionFile[],
    message: string,
    afterPublication?: () => void
  ): Promise<void> {
    if (files.length === 0) {
      return;
    }
    await this.#commit("Checkpoint before managed operation");
    for (const file of files) {
      if ((await readFile(file.sourcePath, "utf8")) !== file.beforeSource) {
        throw new Error(`Managed operation target changed: ${file.sourcePath}`);
      }
    }
    const beforeHead = await this.#head();
    const transactionId = randomUUID();
    const stagingDirectory = join(
      dirname(this.#journalPath),
      "fumori-transactions",
      transactionId
    );
    const journal: Journal = {
      beforeHead,
      stagingDirectory,
      files: files.map((file, index) => ({
        ...file,
        temporaryPath: join(stagingDirectory, `${index}.new`),
        backupPath: join(stagingDirectory, `${index}.before`)
      }))
    };
    await this.#validateJournalPaths(journal);
    try {
      await atomicReplace(this.#journalPath, JSON.stringify(journal));
      await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
      for (const file of journal.files) {
        await writeFile(file.temporaryPath, file.source, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
      }
    } catch (error) {
      await this.runRead(() => this.#restoreBefore(journal));
      throw error;
    }
    let eventCommitted = false;
    try {
      await this.runRead(async () => {
        try {
          for (const file of journal.files) {
            if (
              (await readFile(file.sourcePath, "utf8")) !== file.beforeSource
            ) {
              throw new Error(
                `Managed operation target changed: ${file.sourcePath}`
              );
            }
          }
          for (const file of journal.files) {
            await rename(file.sourcePath, file.backupPath);
          }
          for (const file of journal.files) {
            await rename(file.temporaryPath, file.destinationPath);
          }
          await this.#commit(
            message,
            journal.files.flatMap((file) => [
              relative(this.#vaultPath, file.sourcePath),
              relative(this.#vaultPath, file.destinationPath)
            ])
          );
          eventCommitted = true;
          afterPublication?.();
        } catch (error) {
          if (!eventCommitted) {
            await this.#restoreBefore(journal);
          }
          throw error;
        }
      });
    } catch (error) {
      if (eventCommitted) {
        await this.#finish(journal).catch(() => undefined);
      }
      throw error;
    }
    await this.#finish(journal).catch(() => undefined);
  }

  async #recover(): Promise<void> {
    const journalEntry = await lstat(this.#journalPath).catch(() => undefined);
    if (journalEntry && !journalEntry.isFile()) {
      throw new Error(
        `Vault transaction journal has an unsafe file type: ${this.#journalPath}`
      );
    }
    if (!journalEntry) {
      return;
    }
    const source = await readFile(this.#journalPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error("Vault transaction journal is not valid JSON");
    }
    const result = journalSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Vault transaction journal is invalid: ${result.error.issues[0]?.message ?? "unknown error"}`
      );
    }
    const journal = result.data;
    await this.#validateJournalPaths(journal);
    if ((await this.#head()) === journal.beforeHead) {
      await this.#restoreBefore(journal);
    } else {
      await this.#finish(journal);
    }
  }

  async #restoreBefore(journal: Journal): Promise<void> {
    for (const file of [...journal.files].reverse()) {
      if (await exists(file.backupPath)) {
        await rm(file.destinationPath, { force: true });
        await rename(file.backupPath, file.sourcePath);
      }
      await rm(file.temporaryPath, { force: true });
    }
    await this.#git(["add", "--all"]);
    await rm(journal.stagingDirectory, { recursive: true, force: true });
    await rm(this.#journalPath, { force: true });
  }

  async #finish(journal: Journal): Promise<void> {
    await rm(journal.stagingDirectory, { recursive: true, force: true });
    await rm(this.#journalPath, { force: true });
  }

  async #head(): Promise<string> {
    return (await this.#git(["rev-parse", "HEAD"])).stdout.trim();
  }

  async #validateJournalPaths(journal: Journal): Promise<void> {
    const transactionRoot = join(
      dirname(this.#journalPath),
      "fumori-transactions"
    );
    const expectedParent = relative(
      transactionRoot,
      dirname(journal.stagingDirectory)
    );
    if (
      expectedParent !== "" ||
      !z.uuid().safeParse(basename(journal.stagingDirectory)).success
    ) {
      throw new Error(
        `Vault transaction journal has an unsafe staging directory: ${journal.stagingDirectory}`
      );
    }
    for (const path of [transactionRoot, journal.stagingDirectory]) {
      const entry = await lstat(path).catch(() => undefined);
      if (entry?.isSymbolicLink() || (entry && !entry.isDirectory())) {
        throw new Error(
          `Vault transaction journal references an unsafe staging path: ${path}`
        );
      }
      if (entry) {
        const resolved = await realpath(path);
        const resolvedRelativePath = relative(transactionRoot, resolved);
        if (
          resolvedRelativePath.startsWith("..") ||
          isAbsolute(resolvedRelativePath)
        ) {
          throw new Error(
            `Vault transaction journal escapes its staging root: ${path}`
          );
        }
      }
    }
    for (const [index, file] of journal.files.entries()) {
      for (const [label, path] of [
        ["source", file.sourcePath],
        ["destination", file.destinationPath]
      ] as const) {
        const canonicalPath = relative(this.#vaultPath, path);
        if (
          canonicalPath.startsWith("..") ||
          isAbsolute(canonicalPath) ||
          !CANONICAL_ROOTS.some((root) =>
            canonicalPath.startsWith(`${root}/`)
          )
        ) {
          throw new Error(
            `Vault transaction journal has an unsafe ${label} path: ${path}`
          );
        }
      }
      if (
        file.temporaryPath !==
          join(journal.stagingDirectory, `${index}.new`) ||
        file.backupPath !== join(journal.stagingDirectory, `${index}.before`)
      ) {
        throw new Error(
          `Vault transaction journal has unsafe staged file paths at index ${index}`
        );
      }
      for (const path of [file.temporaryPath, file.backupPath]) {
        const entry = await lstat(path).catch(() => undefined);
        if (entry?.isSymbolicLink() || (entry && !entry.isFile())) {
          throw new Error(
            `Vault transaction journal references an unsafe staged file: ${path}`
          );
        }
      }
    }
  }

  async #stagedChangedFileCount(): Promise<number> {
    const output = (
      await this.#git([
        "diff",
        "--cached",
        "--name-status",
        "-z",
        "--find-renames",
        "HEAD"
      ])
    ).stdout;
    const records = output.split("\0");
    let count = 0;
    for (let index = 0; index < records.length; ) {
      const status = records[index++];
      if (!status) {
        continue;
      }
      count += 1;
      index += status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    }
    return count;
  }

  async #stage(paths?: readonly string[]): Promise<void> {
    await this.#git([
      "add",
      "--all",
      "--force",
      "--",
      ...(paths ? [...new Set(paths)] : [...CANONICAL_ROOTS])
    ]);
    if (!paths) {
      await this.#git(["add", "--all"]);
    }
  }

  async #commit(
    message: string,
    paths?: readonly string[]
  ): Promise<boolean> {
    await this.#stage(paths);
    const staged = await this.#git([
      "diff",
      "--cached",
      "--quiet",
      "--no-ext-diff"
    ]).then(
      () => false,
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: number }).code === 1
        ) {
          return true;
        }
        throw error;
      }
    );
    if (!staged) {
      return false;
    }
    await this.#commitStaged(message);
    return true;
  }

  async #commitStaged(message: string): Promise<void> {
    await this.#git([
      "-c",
      "user.name=Fumori",
      "-c",
      "user.email=fumori@localhost",
      "commit",
      "--no-gpg-sign",
      "--quiet",
      "--message",
      message
    ]);
  }

  async #git(arguments_: string[]) {
    return hardenedGit(this.#vaultPath, arguments_);
  }
}

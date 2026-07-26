import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";

import { atomicReplace } from "./atomic-publication.js";

const execFileAsync = promisify(execFile);

function gitOptions() {
  return {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0"
    }
  };
}

async function hardenedGit(vaultPath: string, arguments_: string[]) {
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
      "--local",
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
    const source = await readFile(this.#journalPath, "utf8").catch(
      () => undefined
    );
    if (!source) {
      return;
    }
    const journal = JSON.parse(source) as Journal;
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

  async #commit(message: string, paths?: readonly string[]): Promise<void> {
    await this.#git([
      "add",
      "--all",
      ...(paths ? ["--", ...new Set(paths)] : [])
    ]);
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
      return;
    }
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

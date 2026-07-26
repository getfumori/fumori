import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const OWNERSHIP_ZONES = [
  "assets",
  "human/daily",
  "human/notes",
  ".second-brain/model/relationships",
  "knowledge",
  "sources/files",
  "sources/records"
] as const;

type BootstrapOptions = {
  path: string;
};

async function git(repository: string, arguments_: string[]) {
  return execFileAsync("git", ["-C", repository, ...arguments_]);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertEmptyGitRepository(inputPath: string): Promise<string> {
  const repository = await realpath(resolve(inputPath)).catch(() => {
    throw new Error(`Vault path does not exist: ${inputPath}`);
  });
  const { stdout: topLevelOutput } = await git(repository, [
    "rev-parse",
    "--show-toplevel"
  ]).catch(() => {
    throw new Error(`Vault path is not a Git repository: ${repository}`);
  });
  const topLevel = await realpath(topLevelOutput.trim());

  if (topLevel !== repository) {
    throw new Error(
      `Vault path must be the root of its Git repository: ${repository}`
    );
  }

  const worktreeEntries = (await readdir(repository)).filter(
    (entry) => entry !== ".git"
  );
  if (worktreeEntries.length > 0) {
    throw new Error(
      `Vault bootstrap target must be empty; found: ${worktreeEntries.join(", ")}`
    );
  }

  const { stdout: refs } = await git(repository, [
    "for-each-ref",
    "--format=%(refname)"
  ]);
  if (refs.trim().length > 0) {
    throw new Error("Vault bootstrap target has existing Git history");
  }

  return repository;
}

function manifest(name: string, id: string, created: string): string {
  return `---
_id: ${id}
_schema: fumori.vault
_version: 1
_created: ${created}
name: ${JSON.stringify(name)}
---

# Vault
`;
}

const CORE_MODEL_FILES = {
  ".second-brain/model/core-properties.md": `---
_schema: fumori.model.core-properties
_version: 1
properties:
  - type
  - state
  - tags
  - aliases
---

# Core properties
`,
  ".second-brain/model/lifecycle.md": `---
_schema: fumori.model.lifecycle
_version: 1
states:
  - captured
  - organized
  - archived
archived_state: archived
---

# Knowledge lifecycle
`,
  ".second-brain/model/types/daily-note.md": `---
_schema: fumori.model.type
_version: 1
key: daily-note
name: Daily Note
space: human
---

# Daily Note
`,
  ".second-brain/model/types/note.md": `---
_schema: fumori.model.type
_version: 1
key: note
name: Note
space: human
default_state: captured
---

# Note
`,
  ".second-brain/model/views/inbox.md": `---
_schema: fumori.model.view
_version: 1
key: inbox
name: Inbox
space: human
kind: standalone
state: captured
---

# Inbox
`
} as const;

export async function bootstrapVault({
  path: inputPath
}: BootstrapOptions): Promise<{ id: string; path: string }> {
  const repository = await assertEmptyGitRepository(inputPath);
  const id = randomUUID();
  const created = new Date().toISOString();
  const vaultName = basename(repository);
  const gitDirectoryOutput = await git(repository, [
    "rev-parse",
    "--absolute-git-dir"
  ]);
  const gitIndexPath = join(gitDirectoryOutput.stdout.trim(), "index");
  const hadIndex = await fileExists(gitIndexPath);
  const priorIndex = hadIndex ? await readFile(gitIndexPath) : undefined;
  const createdRoots = [
    ".second-brain",
    ...OWNERSHIP_ZONES.map((zone) => zone.split("/", 1)[0]!)
  ].filter((value, index, values) => values.indexOf(value) === index);

  try {
    const files: Record<string, string> = {
      ".second-brain/vault.md": manifest(vaultName, id, created),
      ...CORE_MODEL_FILES
    };

    for (const zone of OWNERSHIP_ZONES) {
      files[`${zone}/.gitkeep`] = "";
    }

    await Promise.all(
      Object.entries(files).map(async ([relativePath, contents]) => {
        const target = join(repository, relativePath);
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, contents, { encoding: "utf8", flag: "wx" });
      })
    );

    await git(repository, ["add", "--all"]);
    await git(repository, [
      "-c",
      "user.name=Fumori",
      "-c",
      "user.email=fumori@localhost",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--no-gpg-sign",
      "--quiet",
      "--message",
      "Initialize Fumori Vault"
    ]);
  } catch (error) {
    await Promise.all(
      createdRoots.map((relativePath) =>
        rm(join(repository, relativePath), { recursive: true, force: true })
      )
    );
    if (hadIndex && priorIndex) {
      await writeFile(gitIndexPath, priorIndex);
    } else {
      await rm(gitIndexPath, { force: true });
    }
    throw error;
  }

  return { id, path: repository };
}

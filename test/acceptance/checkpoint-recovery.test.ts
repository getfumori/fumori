import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import {
  runGit as git,
  stopChildProcess
} from "../helpers/subprocess.js";
import { waitForFumoriServer } from "../helpers/wait-for-fumori-server.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const servers: ChildProcess[] = [];

async function makeVault(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "fumori-checkpoint-"));
  temporaryDirectories.push(repository);
  await execFileAsync("git", ["init", "--quiet", repository]);
  await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "vault",
      "bootstrap",
      "--path",
      repository
    ],
    { cwd: process.cwd() }
  );
  return repository;
}

async function startServer(
  vault: string,
  extraArguments: string[] = []
): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "serve",
      "--vault",
      vault,
      "--port",
      "0",
      ...extraArguments
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  servers.push(child);
  return { child, url: await waitForFumoriServer(child) };
}

async function stopServer(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  await stopChildProcess(child, signal);
  const index = servers.indexOf(child);
  if (index >= 0) {
    servers.splice(index, 1);
  }
}

async function startupFailure(vault: string): Promise<string> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "serve",
      "--vault",
      vault,
      "--port",
      "0"
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const outcome = await Promise.race([
    new Promise<"exited">((resolve) => child.once("exit", () => resolve("exited"))),
    new Promise<"started">((resolve) => {
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        if (chunk.includes("Fumori is listening at")) {
          resolve("started");
        }
      });
    }),
    new Promise<"timed-out">((resolve) =>
      setTimeout(() => resolve("timed-out"), 5_000)
    )
  ]);
  if (outcome !== "exited") {
    child.kill("SIGKILL");
    throw new Error(`Expected startup to fail, but it ${outcome}. ${stderr}`);
  }
  return stderr;
}

async function createNote(url: string): Promise<{
  id: string;
  revision: string;
  canonicalPath: string;
}> {
  const response = await fetch(`${url}/api/v1/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: "global" })
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    revision: string;
    canonicalPath: string;
  };
}

async function createNamedNote(
  url: string,
  title: string
): Promise<{ id: string; canonicalPath: string }> {
  const response = await fetch(`${url}/api/v1/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: "wikilink", target: title })
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    canonicalPath: string;
  };
}

afterEach(async () => {
  for (const child of servers.splice(0)) {
    child.kill("SIGKILL");
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("Vault checkpoint and recovery", () => {
  test("uses one checkpoint operation for owner requests, scheduler runs, and overlap", async () => {
    const vault = await makeVault();
    const initialHead = (await git(vault, "rev-parse", "HEAD")).trim();
    const { url } = await startServer(vault, [
      "--checkpoint-interval-ms",
      "600000"
    ]);

    const note = await createNote(url);
    expect((await git(vault, "rev-parse", "HEAD")).trim()).toBe(initialHead);

    const checkpointResponses = await Promise.all([
      fetch(`${url}/api/v1/checkpoint`, { method: "POST" }),
      fetch(`${url}/api/v1/checkpoint`, { method: "POST" })
    ]);
    const checkpoints = await Promise.all(
      checkpointResponses.map(async (response) => {
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toContain("no-store");
        return response.json() as Promise<{
          created: boolean;
          sha: string | null;
          changedFileCount: number;
        }>;
      })
    );
    expect(checkpoints.filter(({ created }) => created)).toHaveLength(1);
    expect(checkpoints.find(({ created }) => created)).toMatchObject({
      sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      changedFileCount: 1
    });
    expect(checkpoints.find(({ created }) => !created)).toEqual({
      created: false,
      sha: null,
      changedFileCount: 0
    });
    expect((await git(vault, "rev-list", "--count", "HEAD")).trim()).toBe("2");
    expect(await git(vault, "status", "--porcelain")).toBe("");

    const saved = await fetch(`${url}/api/v1/notes/${note.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: "rich",
        baseRevision: note.revision,
        bodyMarkdown: "# Scheduled checkpoint"
      })
    });
    expect(saved.status).toBe(200);
    const headBeforeScheduler = (await git(vault, "rev-parse", "HEAD")).trim();
    const config = await fetch(`${url}/api/v1/config`);
    await expect(config.json()).resolves.toMatchObject({
      checkpoint: { intervalMs: 600_000 }
    });
    expect((await git(vault, "rev-parse", "HEAD")).trim()).toBe(
      headBeforeScheduler
    );
  });

  test("runs the same dirty-only checkpoint use case on the configured schedule", async () => {
    const vault = await makeVault();
    const { url } = await startServer(vault, [
      "--checkpoint-interval-ms",
      "50"
    ]);
    const head = (await git(vault, "rev-parse", "HEAD")).trim();

    await createNote(url);
    const deadline = Date.now() + 5_000;
    let scheduledHead = head;
    while (scheduledHead === head && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      scheduledHead = (await git(vault, "rev-parse", "HEAD")).trim();
    }

    expect(scheduledHead).not.toBe(head);
    expect(
      (await git(vault, "log", "-1", "--pretty=%s")).trim()
    ).toBe("Checkpoint Vault");
    expect(await git(vault, "status", "--porcelain")).toBe("");
    const commitsAfterDirtyRun = await git(vault, "rev-list", "--count", "HEAD");
    await new Promise((resolve) => setTimeout(resolve, 125));
    expect(await git(vault, "rev-list", "--count", "HEAD")).toBe(
      commitsAfterDirtyRun
    );
  });

  test("checkpoints canonical files despite every effective Git ignore scope", async () => {
    const vault = await makeVault();
    await writeFile(
      join(vault, ".gitignore"),
      "human/notes/from-gitignore.md\n"
    );
    const infoExcludePath = join(vault, ".git", "info", "exclude");
    await writeFile(
      infoExcludePath,
      `${await readFile(infoExcludePath, "utf8")}\nhuman/notes/from-info-exclude.md\n`
    );
    const configuredExcludePath = join(vault, ".git", "configured-excludes");
    await writeFile(
      configuredExcludePath,
      "human/notes/from-configured-exclude.md\n"
    );
    await git(vault, "config", "core.excludesFile", configuredExcludePath);
    await git(vault, "add", ".gitignore");
    await git(
      vault,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--quiet",
      "--message",
      "Configure fixture ignores"
    );
    const { url } = await startServer(vault);

    const notes = await Promise.all([
      createNamedNote(url, "from gitignore"),
      createNamedNote(url, "from info exclude"),
      createNamedNote(url, "from configured exclude")
    ]);
    expect(notes.map((note) => note.canonicalPath).sort()).toEqual([
      "human/notes/from-configured-exclude.md",
      "human/notes/from-gitignore.md",
      "human/notes/from-info-exclude.md"
    ]);
    expect(
      (
        await git(
          vault,
          "check-ignore",
          ...notes.map((note) => note.canonicalPath)
        )
      )
        .trim()
        .split("\n")
    ).toHaveLength(3);

    const response = await fetch(`${url}/api/v1/checkpoint`, {
      method: "POST"
    });
    await expect(response.json()).resolves.toMatchObject({
      created: true,
      sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      changedFileCount: 3
    });
    const tree = await git(vault, "ls-tree", "-r", "--name-only", "HEAD");
    for (const note of notes) {
      expect(tree).toContain(note.canonicalPath);
    }
    expect(await git(vault, "status", "--porcelain")).toBe("");
  });

  test("rebuilds projections from valid offline changes and seals interrupted saves", async () => {
    const vault = await makeVault();
    const first = await startServer(vault);
    const note = await createNote(first.url);
    const saved = await fetch(`${first.url}/api/v1/notes/${note.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: "raw",
        baseRevision: note.revision,
        sourceMarkdown: (
          await readFile(join(vault, note.canonicalPath), "utf8")
        ).replace(
          "aliases: []",
          'aliases: []\noffline_key: preserved\nrelated_to: "[[Archived offline]]"'
        ).replace(/\n---\n$/, "\n---\n\n# Recovered note\n")
      })
    });
    expect(saved.status).toBe(200);
    const savedNote = (await saved.json()) as { canonicalPath: string };
    const dirtySource = await readFile(
      join(vault, savedNote.canonicalPath),
      "utf8"
    );
    const headBeforeCrash = (await git(vault, "rev-parse", "HEAD")).trim();

    await stopServer(first.child, "SIGKILL");
    const archivedId = "123e4567-e89b-42d3-a456-426614174001";
    await writeFile(
      join(vault, "human/notes/archived-offline.md"),
      `---
_id: ${archivedId}
_schema: fumori.note
_version: 1
_created: 2026-07-26T00:00:00.000Z
type: note
state: archived
tags: [offline]
aliases: []
ordinary_unknown: accepted
---

# Archived offline

Links [[Recovered note]].
`
    );
    await writeFile(
      join(vault, ".second-brain/model/types/project.md"),
      `---
_schema: fumori.model.type
_version: 1
key: project
name: Project
space: human
default_state: captured
---

# Project
`
    );
    await writeFile(
      join(vault, ".second-brain/model/views/offline-notes.md"),
      `---
_schema: fumori.model.view
_version: 1
key: offline-notes
name: Offline notes
space: human
query:
  filter:
    field: type
    operator: equals
    value: note
  layout: list
---

# Offline notes
`
    );
    await writeFile(
      join(vault, ".second-brain/model/relationships/related_to.md"),
      `---
_schema: fumori.model.relationship
_version: 1
key: related_to
name: Related to
cardinality: one
inverse: related_from
target_types: [note]
---

# Related to
`
    );
    const dailyId = "123e4567-e89b-42d3-a456-426614174002";
    await writeFile(
      join(vault, "human/daily/2026-07-25.md"),
      `---
_id: ${dailyId}
_schema: fumori.daily-note
_version: 1
_created: 2026-07-25T00:00:00.000Z
type: daily-note
date: 2026-07-25
state: organized
tags: []
aliases: []
offline_daily_key: accepted
---

# 2026-07-25

Daily link [[Recovered note]].
`
    );
    const second = await startServer(vault);

    expect(await readFile(join(vault, savedNote.canonicalPath), "utf8")).toBe(
      dirtySource
    );
    const recoveredHead = (await git(vault, "rev-parse", "HEAD")).trim();
    expect(recoveredHead).not.toBe(headBeforeCrash);
    expect(
      (await git(vault, "log", "-1", "--pretty=%s")).trim()
    ).toBe("Recovery checkpoint");
    expect(await git(vault, "status", "--porcelain")).toBe("");

    const notes = await fetch(`${second.url}/api/v1/notes`);
    await expect(notes.json()).resolves.toEqual([
      expect.objectContaining({ id: note.id, title: "Recovered note" })
    ]);
    const inbox = await fetch(`${second.url}/api/v1/inbox`);
    await expect(inbox.json()).resolves.toEqual([
      expect.objectContaining({ id: note.id })
    ]);
    const archive = await fetch(`${second.url}/api/v1/archive`);
    await expect(archive.json()).resolves.toEqual([
      expect.objectContaining({ id: archivedId, title: "Archived offline" })
    ]);
    const types = await fetch(`${second.url}/api/v1/types`);
    await expect(types.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "project", name: "Project" })
      ])
    );
    const view = await fetch(`${second.url}/api/v1/views/offline-notes`);
    await expect(view.json()).resolves.toMatchObject({
      key: "offline-notes",
      items: expect.arrayContaining([
        expect.objectContaining({ id: note.id }),
        expect.objectContaining({ id: archivedId })
      ])
    });
    const search = await fetch(`${second.url}/api/v1/search?q=Recovered`);
    await expect(search.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: note.id, title: "Recovered note" }),
        expect.objectContaining({ id: archivedId }),
        expect.objectContaining({ id: dailyId })
      ])
    );
    const connections = await fetch(
      `${second.url}/api/v1/notes/${note.id}/connections`
    );
    await expect(connections.json()).resolves.toMatchObject({
      relationships: [
        {
          key: "related_to",
          targets: [
            expect.objectContaining({
              status: "resolved",
              matches: [expect.objectContaining({ id: archivedId })]
            })
          ]
        }
      ],
      backlinks: expect.arrayContaining([
        expect.objectContaining({ id: archivedId }),
        expect.objectContaining({ id: dailyId })
      ])
    });
    expect(dirtySource).toContain("offline_key: preserved");
  });

  test.each([
    {
      name: "duplicate object IDs",
      prepare: async (vault: string) => {
        const source = `---
_id: 123e4567-e89b-42d3-a456-426614174000
_schema: fumori.note
_version: 1
_created: 2026-07-26T00:00:00.000Z
type: note
state: captured
tags: []
aliases: []
---

# Duplicate
`;
        await writeFile(join(vault, "human/notes/one.md"), source);
        await writeFile(join(vault, "human/notes/two.md"), source);
      },
      diagnostic: "Duplicate object ID"
    },
    {
      name: "malformed reserved metadata",
      prepare: async (vault: string) => {
        await writeFile(
          join(vault, "human/notes/broken.md"),
          "---\n_schema: fumori.note\n_version: 1\n---\n\n# Broken\n"
        );
      },
      diagnostic: "Reserved field '_id'"
    },
    {
      name: "invalid model definitions",
      prepare: async (vault: string) => {
        await writeFile(
          join(vault, ".second-brain/model/types/note.md"),
          "---\n_schema: fumori.model.type\n_version: 1\nkey: wrong-name\nname: Note\nspace: human\n---\n"
        );
      },
      diagnostic: "note.md"
    },
    {
      name: "unsafe repository paths",
      prepare: async (vault: string) => {
        const outside = join(vault, "..", "fumori-outside-note.md");
        await writeFile(outside, "outside\n");
        temporaryDirectories.push(outside);
        await symlink(outside, join(vault, "human/notes/unsafe.md"));
      },
      diagnostic: "symbolic link"
    },
    {
      name: "hidden canonical index paths",
      prepare: async (vault: string) => {
        await git(
          vault,
          "update-index",
          "--assume-unchanged",
          "human/notes/.gitkeep"
        );
      },
      diagnostic: "index hides a canonical path"
    },
    {
      name: "unmerged Git index entries",
      prepare: async (vault: string) => {
        const source = `---
_id: 123e4567-e89b-42d3-a456-426614174010
_schema: fumori.note
_version: 1
_created: 2026-07-26T00:00:00.000Z
type: note
state: captured
tags: []
aliases: []
---

# Base
`;
        const path = join(vault, "human/notes/conflicted.md");
        await writeFile(path, source);
        await git(vault, "add", "human/notes/conflicted.md");
        await git(
          vault,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.com",
          "commit",
          "--quiet",
          "--message",
          "Add conflict fixture"
        );
        const baseBranch = (await git(vault, "branch", "--show-current")).trim();
        await git(vault, "checkout", "--quiet", "-b", "conflict-other");
        await writeFile(path, source.replace("# Base", "# Other"));
        await git(vault, "add", "human/notes/conflicted.md");
        await git(
          vault,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.com",
          "commit",
          "--quiet",
          "--message",
          "Change conflict fixture on other"
        );
        await git(vault, "checkout", "--quiet", baseBranch);
        await writeFile(path, source.replace("# Base", "# Current"));
        await git(vault, "add", "human/notes/conflicted.md");
        await git(
          vault,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.com",
          "commit",
          "--quiet",
          "--message",
          "Change conflict fixture on current"
        );
        await expect(
          git(
            vault,
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.com",
            "merge",
            "--no-edit",
            "conflict-other"
          )
        ).rejects.toThrow();
        expect(
          await git(
            vault,
            "ls-files",
            "--unmerged",
            "human/notes/conflicted.md"
          )
        ).not.toBe("");
      },
      diagnostic: "unmerged canonical path"
    },
    {
      name: "in-progress Git operations",
      prepare: async (vault: string) => {
        const baseBranch = (await git(vault, "branch", "--show-current")).trim();
        await git(vault, "checkout", "--quiet", "-b", "operation-other");
        await writeFile(join(vault, "human/notes/other.txt"), "other\n");
        await git(vault, "add", "human/notes/other.txt");
        await git(
          vault,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.com",
          "commit",
          "--quiet",
          "--message",
          "Add other operation fixture"
        );
        await git(vault, "checkout", "--quiet", baseBranch);
        await writeFile(join(vault, "human/notes/current.txt"), "current\n");
        await git(vault, "add", "human/notes/current.txt");
        await git(
          vault,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.com",
          "commit",
          "--quiet",
          "--message",
          "Add current operation fixture"
        );
        await git(
          vault,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.com",
          "merge",
          "--no-commit",
          "--no-ff",
          "operation-other"
        );
        expect(await lstat(join(vault, ".git/MERGE_HEAD"))).toBeDefined();
      },
      diagnostic: "in-progress operation"
    }
  ])("fails startup closed for $name", async ({ prepare, diagnostic }) => {
    const vault = await makeVault();
    await prepare(vault);
    const head = (await git(vault, "rev-parse", "HEAD")).trim();
    const before = await git(vault, "status", "--porcelain");

    const stderr = await startupFailure(vault);

    expect(stderr).toContain(diagnostic);
    expect((await git(vault, "rev-parse", "HEAD")).trim()).toBe(head);
    expect(await git(vault, "status", "--porcelain")).toBe(before);
    if (diagnostic.includes("_id")) {
      expect(await lstat(join(vault, "human/notes/broken.md"))).toBeDefined();
    }
  });

  test("does not execute repository hooks or filter processes while recovering", async () => {
    const vault = await makeVault();
    const marker = join(vault, ".git", "repository-code-ran");
    const hook = join(vault, ".git", "hooks", "pre-commit");
    await writeFile(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`);
    await execFileAsync("chmod", ["+x", hook]);
    await git(vault, "config", "extensions.worktreeConfig", "true");
    await git(
      vault,
      "config",
      "--worktree",
      "filter.hostile.clean",
      `touch ${marker}`
    );
    await git(
      vault,
      "config",
      "--worktree",
      "filter.hostile.process",
      `touch ${marker}`
    );
    await git(
      vault,
      "config",
      "--worktree",
      "filter.hostile.required",
      "true"
    );
    await writeFile(join(vault, ".gitattributes"), "*.md filter=hostile\n");
    await writeFile(join(vault, "human/notes/offline.txt"), "data only\n");

    await expect(startServer(vault)).resolves.toBeDefined();

    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(
      await git(
        vault,
        "-c",
        "filter.hostile.clean=cat",
        "-c",
        "filter.hostile.process=",
        "-c",
        "filter.hostile.required=false",
        "status",
        "--porcelain"
      )
    ).toBe("");
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(
      (await git(vault, "log", "-1", "--pretty=%s")).trim()
    ).toBe("Recovery checkpoint");
  });

  test("rejects an unsafe transaction journal without touching its paths", async () => {
    const vault = await makeVault();
    const outside = join(tmpdir(), randomUUID());
    temporaryDirectories.push(outside);
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep\n");
    const head = (await git(vault, "rev-parse", "HEAD")).trim();
    await writeFile(
      join(vault, ".git", "fumori-transaction.json"),
      JSON.stringify({
        beforeHead: head,
        stagingDirectory: outside,
        files: [
          {
            sourcePath: join(vault, "human/notes/.gitkeep"),
            destinationPath: join(vault, "human/notes/.gitkeep"),
            beforeSource: "",
            source: "",
            temporaryPath: join(outside, "0.new"),
            backupPath: join(outside, "0.before")
          }
        ]
      })
    );

    const stderr = await startupFailure(vault);

    expect(stderr).toContain("unsafe staging directory");
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep\n");
    expect(
      await readFile(join(vault, ".git", "fumori-transaction.json"), "utf8")
    ).toContain(outside);
    expect((await git(vault, "rev-parse", "HEAD")).trim()).toBe(head);
  });

  test("rejects an empty transaction journal without changing the Vault", async () => {
    const vault = await makeVault();
    const journalPath = join(vault, ".git", "fumori-transaction.json");
    const head = (await git(vault, "rev-parse", "HEAD")).trim();
    const status = await git(vault, "status", "--porcelain");
    await writeFile(journalPath, "");

    const stderr = await startupFailure(vault);

    expect(stderr).toContain("transaction journal is not valid JSON");
    expect((await git(vault, "rev-parse", "HEAD")).trim()).toBe(head);
    expect(await git(vault, "status", "--porcelain")).toBe(status);
    expect(await readFile(journalPath, "utf8")).toBe("");
  });
});

import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import { waitForFumoriServer } from "../helpers/wait-for-fumori-server.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const servers: ChildProcess[] = [];

async function makeRunningVault(): Promise<{ url: string; vault: string }> {
  const vault = await mkdtemp(join(tmpdir(), "fumori-human-note-"));
  temporaryDirectories.push(vault);
  await execFileAsync("git", ["init", "--quiet", vault]);
  await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "vault",
      "bootstrap",
      "--path",
      vault
    ],
    { cwd: process.cwd() }
  );

  return { url: await startServer(vault), vault };
}

async function startServer(vault: string): Promise<string> {
  const server = spawn(
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
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
  );
  servers.push(server);
  return waitForFumoriServer(server);
}

async function stopServer(): Promise<void> {
  const server = servers.pop();
  if (!server || server.exitCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
  });
  server.kill("SIGTERM");
  await exited;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.kill("SIGTERM");
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("standalone Human Notes HTTP contract", () => {
  test("Global and Inbox creation publish captured notes into derived lists", async () => {
    const { url, vault } = await makeRunningVault();

    const globalResponse = await fetch(`${url}/api/v1/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "global" })
    });
    const inboxResponse = await fetch(`${url}/api/v1/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "inbox" })
    });

    expect(globalResponse.status).toBe(201);
    expect(inboxResponse.status).toBe(201);
    const globalNote = (await globalResponse.json()) as {
      id: string;
      title: string;
      canonicalPath: string;
      revision: string;
      bodyMarkdown: string;
      sourceMarkdown: string;
    };
    const inboxNote = (await inboxResponse.json()) as typeof globalNote;
    for (const note of [globalNote, inboxNote]) {
      expect(note).toMatchObject({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title: "Untitled note",
        canonicalPath: expect.stringMatching(
          /^human\/notes\/note-[0-9a-f-]{36}\.md$/
        ),
        revision: expect.stringMatching(/^[0-9a-f]{64}$/),
        bodyMarkdown: ""
      });
      expect(note.sourceMarkdown).toMatch(
        new RegExp(
          `^---\\n_id: ${note.id}\\n_schema: fumori\\.note\\n_version: 1\\n_created: .+\\ntype: note\\nstate: captured\\ntags: \\[\\]\\naliases: \\[\\]\\n---\\n$`
        )
      );
      await expect(
        readFile(join(vault, note.canonicalPath), "utf8")
      ).resolves.toBe(note.sourceMarkdown);
    }

    const invalidRawResponse = await fetch(
      `${url}/api/v1/notes/${globalNote.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "raw",
          baseRevision: globalNote.revision,
          sourceMarkdown: "not canonical Markdown"
        })
      }
    );
    expect(invalidRawResponse.status).toBe(422);
    await expect(invalidRawResponse.json()).resolves.toMatchObject({
      error: "invalid_canonical_markdown"
    });
    await expect(
      readFile(join(vault, globalNote.canonicalPath), "utf8")
    ).resolves.toBe(globalNote.sourceMarkdown);

    expect(
      (await readdir(join(vault, "human", "notes"))).filter(
        (name) => name !== ".gitkeep"
      )
    ).toHaveLength(2);
    const notesResponse = await fetch(`${url}/api/v1/notes`);
    const inboxListResponse = await fetch(`${url}/api/v1/inbox`);
    expect(notesResponse.headers.get("cache-control")).toContain("no-store");
    expect(inboxListResponse.headers.get("cache-control")).toContain("no-store");
    const expectedEntries = [
      expect.objectContaining({
        id: globalNote.id,
        title: "Untitled note",
        url: `/notes/${globalNote.id}`
      }),
      expect.objectContaining({
        id: inboxNote.id,
        title: "Untitled note",
        url: `/notes/${inboxNote.id}`
      })
    ];
    await expect(notesResponse.json()).resolves.toEqual(expectedEntries);
    await expect(inboxListResponse.json()).resolves.toEqual(expectedEntries);
  });

  test("the first meaningful H1 adopts a readable filename only once", async () => {
    const { url, vault } = await makeRunningVault();
    const created = (await (
      await fetch(`${url}/api/v1/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "global" })
      })
    ).json()) as {
      id: string;
      canonicalPath: string;
      revision: string;
    };

    const titledResponse = await fetch(`${url}/api/v1/notes/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "rich",
        baseRevision: created.revision,
        bodyMarkdown: "A preface.\n\n# Cedar Grove\n\nFirst draft."
      })
    });
    expect(titledResponse.status).toBe(200);
    const titled = (await titledResponse.json()) as {
      id: string;
      title: string;
      canonicalPath: string;
      revision: string;
    };
    expect(titled).toMatchObject({
      id: created.id,
      title: "Cedar Grove",
      canonicalPath: "human/notes/cedar-grove.md"
    });
    await expect(
      readFile(join(vault, created.canonicalPath), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(vault, titled.canonicalPath), "utf8")
    ).resolves.toContain("# Cedar Grove");

    const retitledResponse = await fetch(`${url}/api/v1/notes/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "rich",
        baseRevision: titled.revision,
        bodyMarkdown: "# Misty Grove\n\nSecond draft."
      })
    });
    const retitled = (await retitledResponse.json()) as {
      title: string;
      canonicalPath: string;
      revision: string;
    };
    expect(retitled).toMatchObject({
      title: "Misty Grove",
      canonicalPath: "human/notes/cedar-grove.md"
    });

    const second = (await (
      await fetch(`${url}/api/v1/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "inbox" })
      })
    ).json()) as {
      id: string;
      revision: string;
    };
    const colliding = (await (
      await fetch(`${url}/api/v1/notes/${second.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "rich",
          baseRevision: second.revision,
          bodyMarkdown: "# Cedar Grove\n\nAnother note."
        })
      })
    ).json()) as {
      canonicalPath: string;
    };
    expect(colliding.canonicalPath).toBe("human/notes/cedar-grove-2.md");

    const stableRead = await fetch(`${url}/api/v1/notes/${created.id}`);
    expect(stableRead.status).toBe(200);
    await expect(stableRead.json()).resolves.toMatchObject({
      id: created.id,
      title: "Misty Grove",
      canonicalPath: "human/notes/cedar-grove.md",
      revision: retitled.revision
    });
  });

  test("an H1-looking line inside fenced code is not a meaningful title", async () => {
    const { url } = await makeRunningVault();
    const created = (await (
      await fetch(`${url}/api/v1/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "global" })
      })
    ).json()) as {
      id: string;
      canonicalPath: string;
      revision: string;
    };

    const codeOnly = (await (
      await fetch(`${url}/api/v1/notes/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "rich",
          baseRevision: created.revision,
          bodyMarkdown: "```markdown\n# Not a title\n```"
        })
      })
    ).json()) as {
      title: string;
      canonicalPath: string;
      revision: string;
    };
    expect(codeOnly).toMatchObject({
      title: "Untitled note",
      canonicalPath: created.canonicalPath
    });

    const titled = (await (
      await fetch(`${url}/api/v1/notes/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "rich",
          baseRevision: codeOnly.revision,
          bodyMarkdown: "```markdown\n# Not a title\n```\n\n# Actual Title"
        })
      })
    ).json()) as {
      title: string;
      canonicalPath: string;
    };
    expect(titled).toEqual(
      expect.objectContaining({
        title: "Actual Title",
        canonicalPath: "human/notes/actual-title.md"
      })
    );
  });

  test("lists and lexical search rebuild from canonical Markdown", async () => {
    const { url, vault } = await makeRunningVault();
    const created = (await (
      await fetch(`${url}/api/v1/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "global" })
      })
    ).json()) as {
      id: string;
      revision: string;
      sourceMarkdown: string;
    };
    const saved = (await (
      await fetch(`${url}/api/v1/notes/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "raw",
          baseRevision: created.revision,
          sourceMarkdown: created.sourceMarkdown
            .replace("aliases: []", "aliases: []\nproject: Borealis")
            .concat("\n# Misty Grove\n\nA quiet rainfall gathers here.\n")
        })
      })
    ).json()) as {
      id: string;
      revision: string;
      canonicalPath: string;
      sourceMarkdown: string;
    };
    expect(saved.canonicalPath).toBe("human/notes/misty-grove.md");

    const archivedCreated = (await (
      await fetch(`${url}/api/v1/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "global" })
      })
    ).json()) as {
      id: string;
      revision: string;
      sourceMarkdown: string;
    };
    await fetch(`${url}/api/v1/notes/${archivedCreated.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "raw",
        baseRevision: archivedCreated.revision,
        sourceMarkdown: archivedCreated.sourceMarkdown.replace(
          "state: captured",
          "state: archived"
        )
      })
    });

    const today = (await (
      await fetch(`${url}/api/v1/today`)
    ).json()) as {
      date: string;
      revision: null;
    };
    await fetch(`${url}/api/v1/daily/${today.date}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "rich",
        baseRevision: today.revision,
        bodyMarkdown: "The orchid constellation is visible tonight."
      })
    });

    const notes = (await (
      await fetch(`${url}/api/v1/notes`)
    ).json()) as Array<{ id: string }>;
    const inbox = (await (
      await fetch(`${url}/api/v1/inbox`)
    ).json()) as Array<{ id: string }>;
    expect(notes.map((note) => note.id)).toEqual([saved.id]);
    expect(inbox.map((note) => note.id)).toEqual([saved.id]);

    for (const [query, expected] of [
      ["Misty Grove", { kind: "note", id: saved.id }],
      ["misty-grove.md", { kind: "note", id: saved.id }],
      ["Borealis", { kind: "note", id: saved.id }],
      ["quiet rainfall", { kind: "note", id: saved.id }],
      ["orchid constellation", { kind: "daily-note", title: today.date }]
    ] as const) {
      const response = await fetch(
        `${url}/api/v1/search?q=${encodeURIComponent(query)}`
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const results = (await response.json()) as Array<{
        kind: string;
        id: string;
        title: string;
        snippet: string;
      }>;
      expect(results).toEqual([
        expect.objectContaining({
          ...expected,
          snippet: expect.stringMatching(new RegExp(query, "i"))
        })
      ]);
    }

    const organizedResponse = await fetch(
      `${url}/api/v1/notes/${saved.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "raw",
          baseRevision: saved.revision,
          sourceMarkdown: saved.sourceMarkdown.replace(
            "state: captured",
            "state: organized"
          )
        })
      }
    );
    expect(organizedResponse.status).toBe(200);
    await expect(
      (await fetch(`${url}/api/v1/inbox`)).json()
    ).resolves.toEqual([]);

    await stopServer();
    const inboxViewPath = join(
      vault,
      ".second-brain",
      "model",
      "views",
      "inbox.md"
    );
    await writeFile(
      inboxViewPath,
      (await readFile(inboxViewPath, "utf8")).replace(
        "state: captured",
        "state: organized"
      ),
      "utf8"
    );
    const restartedUrl = await startServer(vault);
    await expect(
      (await fetch(`${restartedUrl}/api/v1/inbox`)).json()
    ).resolves.toEqual([
      expect.objectContaining({
        id: saved.id,
        state: "organized"
      })
    ]);
    const newlyCaptured = (await (
      await fetch(`${restartedUrl}/api/v1/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "inbox" })
      })
    ).json()) as {
      id: string;
      state: string;
    };
    expect(newlyCaptured.state).toBe("captured");
    expect(
      ((await (
        await fetch(`${restartedUrl}/api/v1/inbox`)
      ).json()) as Array<{ id: string }>).map((note) => note.id)
    ).not.toContain(newlyCaptured.id);
    await expect(
      (
        await fetch(
          `${restartedUrl}/api/v1/search?q=${encodeURIComponent("quiet rainfall")}`
        )
      ).json()
    ).resolves.toEqual([
      expect.objectContaining({
        id: saved.id,
        canonicalPath: "human/notes/misty-grove.md"
      })
    ]);
  });
});

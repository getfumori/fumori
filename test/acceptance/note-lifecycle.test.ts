import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
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

async function makeVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), "fumori-note-lifecycle-"));
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
  await mkdir(join(vault, ".second-brain/model/relationships"), {
    recursive: true
  });
  await writeFile(
    join(vault, ".second-brain/model/relationships/related_to.md"),
    `---
_schema: fumori.model.relationship
_version: 1
key: related_to
name: Related to
cardinality: many
inverse: related_from
target_types: [note]
---

# Related to
`,
    "utf8"
  );
  return vault;
}

function noteSource(options: {
  id: string;
  title: string;
  state: "captured" | "organized" | "archived";
  relationships?: string;
  body?: string;
}): string {
  return `---
_id: ${options.id}
_schema: fumori.note
_version: 1
_created: 2026-01-01T00:00:00.000Z
type: note
state: ${options.state}
tags: []
aliases: []
${options.relationships ?? ""}---

# ${options.title}

${options.body ?? ""}
`;
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

describe("standalone Human Note lifecycle HTTP contract", () => {
  test("archives, restores, and confirmed deletion leaves incoming references unresolved after restart", async () => {
    const vault = await makeVault();
    const targetId = "11111111-1111-4111-8111-111111111111";
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const targetPath = join(vault, "human/notes/cedar.md");
    const sourcePath = join(vault, "human/notes/source.md");
    const targetSource = noteSource({
      id: targetId,
      title: "Cedar",
      state: "captured",
      relationships: 'related_to: ["[[Cedar]]"]\n',
      body: "Keep this body exactly. Self reference: [[Cedar]]."
    });
    const incomingSource = noteSource({
      id: sourceId,
      title: "Source",
      state: "organized",
      relationships: 'related_to: ["[[Cedar]]"]\n',
      body: "Body link to [[Cedar]]."
    });
    await Promise.all([
      writeFile(targetPath, targetSource, "utf8"),
      writeFile(sourcePath, incomingSource, "utf8"),
      writeFile(
        join(vault, "human/daily/2026-01-02.md"),
        `---
_id: 33333333-3333-4333-8333-333333333333
_schema: fumori.daily-note
_version: 1
_created: 2026-01-02T00:00:00.000Z
type: daily-note
state: organized
tags: []
aliases: []
date: 2026-01-02
---

# 2026-01-02

Daily link to [[Cedar]].
`,
        "utf8"
      )
    ]);
    let url = await startServer(vault);

    const initial = (await (
      await fetch(`${url}/api/v1/notes/${targetId}`)
    ).json()) as {
      canonicalPath: string;
      revision: string;
      bodyMarkdown: string;
      type: string;
      tags: string[];
      aliases: string[];
      properties: Record<string, unknown>;
      relationships: Record<string, string | string[]>;
    };
    const saveState = async (state: "archived" | "organized", revision: string) =>
      fetch(`${url}/api/v1/notes/${targetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "metadata",
          baseRevision: revision,
          type: initial.type,
          state,
          tags: initial.tags,
          aliases: initial.aliases,
          properties: initial.properties,
          relationships: initial.relationships
        })
      });

    const archivedResponse = await saveState("archived", initial.revision);
    expect(archivedResponse.status).toBe(200);
    const archived = (await archivedResponse.json()) as {
      canonicalPath: string;
      revision: string;
      bodyMarkdown: string;
      state: string;
    };
    expect(archived).toMatchObject({
      canonicalPath: initial.canonicalPath,
      bodyMarkdown: initial.bodyMarkdown,
      state: "archived"
    });
    expect(
      ((await (await fetch(`${url}/api/v1/notes`)).json()) as Array<{
        id: string;
      }>).map((note) => note.id)
    ).not.toContain(targetId);
    expect(
      ((await (await fetch(`${url}/api/v1/inbox`)).json()) as Array<{
        id: string;
      }>).map((note) => note.id)
    ).not.toContain(targetId);
    await expect(
      (await fetch(`${url}/api/v1/archive`)).json()
    ).resolves.toEqual([
      expect.objectContaining({ id: targetId, state: "archived" })
    ]);

    await stopServer();
    url = await startServer(vault);
    const archivedAfterRestart = (await (
      await fetch(`${url}/api/v1/notes/${targetId}`)
    ).json()) as {
      canonicalPath: string;
      revision: string;
      bodyMarkdown: string;
      state: string;
    };
    expect(archivedAfterRestart).toMatchObject({
      canonicalPath: initial.canonicalPath,
      revision: archived.revision,
      bodyMarkdown: initial.bodyMarkdown,
      state: "archived"
    });
    for (const endpoint of ["/api/v1/notes", "/api/v1/inbox"]) {
      expect(
        ((await (await fetch(`${url}${endpoint}`)).json()) as Array<{
          id: string;
        }>).map((note) => note.id)
      ).not.toContain(targetId);
    }
    await expect(
      (await fetch(`${url}/api/v1/archive`)).json()
    ).resolves.toEqual([
      expect.objectContaining({ id: targetId, state: "archived" })
    ]);

    const restoredResponse = await saveState("organized", archived.revision);
    expect(restoredResponse.status).toBe(200);
    const restored = (await restoredResponse.json()) as {
      revision: string;
      bodyMarkdown: string;
      state: string;
    };
    expect(restored).toMatchObject({
      bodyMarkdown: initial.bodyMarkdown,
      state: "organized"
    });

    const impactResponse = await fetch(
      `${url}/api/v1/notes/${targetId}/deletion-impact`
    );
    expect(impactResponse.status).toBe(200);
    const impact = (await impactResponse.json()) as {
      id: string;
      revision: string;
      incomingLinkCount: number;
    };
    expect(impact).toEqual({
      id: targetId,
      revision: restored.revision,
      incomingLinkCount: 3
    });

    const unconfirmedDelete = await fetch(`${url}/api/v1/notes/${targetId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseRevision: impact.revision,
        confirmedIncomingLinkCount: 2
      })
    });
    expect(unconfirmedDelete.status).toBe(409);
    await expect(unconfirmedDelete.json()).resolves.toEqual({
      error: "deletion_impact_changed",
      currentIncomingLinkCount: 3
    });
    await expect(readFile(targetPath, "utf8")).resolves.toContain(
      "Keep this body exactly."
    );

    const deleteResponse = await fetch(`${url}/api/v1/notes/${targetId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseRevision: impact.revision,
        confirmedIncomingLinkCount: impact.incomingLinkCount
      })
    });
    expect(deleteResponse.status).toBe(204);
    await expect(readFile(targetPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(sourcePath, "utf8")).resolves.toBe(incomingSource);
    expect(
      ((await (await fetch(`${url}/api/v1/search?q=Cedar`)).json()) as Array<{
        id: string;
      }>).map((result) => result.id)
    ).toEqual([
      sourceId,
      "33333333-3333-4333-8333-333333333333"
    ]);
    for (const endpoint of ["/api/v1/notes", "/api/v1/inbox", "/api/v1/archive"]) {
      expect(
        ((await (await fetch(`${url}${endpoint}`)).json()) as Array<{
          id: string;
        }>).map((note) => note.id)
      ).not.toContain(targetId);
    }
    const sourceConnections = (await (
      await fetch(`${url}/api/v1/connections/${sourceId}`)
    ).json()) as {
      outgoing: Array<{ status: string }>;
      relationships: Array<{ targets: Array<{ status: string }> }>;
    };
    expect(sourceConnections.outgoing).toEqual([
      expect.objectContaining({ status: "unresolved" })
    ]);
    expect(sourceConnections.relationships[0]?.targets).toEqual([
      expect.objectContaining({ status: "unresolved" })
    ]);

    await stopServer();
    url = await startServer(vault);
    expect((await fetch(`${url}/api/v1/notes/${targetId}`)).status).toBe(404);
    await expect(
      (await fetch(`${url}/api/v1/connections/${sourceId}`)).json()
    ).resolves.toMatchObject({
      outgoing: [expect.objectContaining({ status: "unresolved" })],
      relationships: [
        {
          key: "related_to",
          name: "Related to",
          cardinality: "many",
          targets: [expect.objectContaining({ status: "unresolved" })]
        }
      ]
    });
  });
});

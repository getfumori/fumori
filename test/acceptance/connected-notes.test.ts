import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
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

async function makeVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), "fumori-connected-notes-"));
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
  return vault;
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

function noteSource(options: {
  id: string;
  title: string;
  aliases?: string[];
  relationships?: string;
  body?: string;
}): string {
  return `---
_id: ${options.id}
_schema: fumori.note
_version: 1
_created: 2026-01-01T00:00:00.000Z
type: note
state: organized
tags: []
aliases: ${JSON.stringify(options.aliases ?? [])}
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

describe("connected-note HTTP and canonical-file contract", () => {
  test("resolves readable links and derives backlinks and Relationship inverses", async () => {
    const vault = await makeVault();
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
    await writeFile(
      join(vault, "human/notes/cedar.md"),
      noteSource({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Cedar",
        aliases: ["Old Cedar"]
      }),
      "utf8"
    );
    await writeFile(
      join(vault, "human/notes/cedar-copy.md"),
      noteSource({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Cedar Copy",
        aliases: ["Old Cedar"]
      }),
      "utf8"
    );
    await writeFile(
      join(vault, "human/notes/map.md"),
      noteSource({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Map",
        relationships:
          "related_to: [\"[[Cedar]]\", \"[[Old Cedar]]\"]\n",
        body: "Visit [[Cedar|the cedar]], [[Old Cedar]], and [[Missing Grove]]."
      }),
      "utf8"
    );
    await writeFile(
      join(vault, "human/daily/2026-01-02.md"),
      `---
_id: 55555555-5555-4555-8555-555555555555
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

Remember [[Cedar]].
`,
      "utf8"
    );

    const url = await startServer(vault);
    const model = await fetch(`${url}/api/v1/model`).then((response) =>
      response.json()
    );
    expect(model.relationships).toEqual([
      {
        key: "related_to",
        name: "Related to",
        cardinality: "many",
        inverse: "related_from",
        targetTypes: ["note"]
      }
    ]);

    const connections = await fetch(
      `${url}/api/v1/notes/33333333-3333-4333-8333-333333333333/connections`
    ).then((response) => response.json());
    expect(connections.outgoing).toEqual([
      expect.objectContaining({
        target: "Cedar",
        label: "the cedar",
        status: "resolved",
        url: "/notes/11111111-1111-4111-8111-111111111111"
      }),
      expect.objectContaining({
        target: "Old Cedar",
        status: "ambiguous",
        url: null
      }),
      expect.objectContaining({
        target: "Missing Grove",
        status: "unresolved",
        url: null
      })
    ]);
    expect(connections.relationships).toEqual([
      expect.objectContaining({
        key: "related_to",
        targets: [
          expect.objectContaining({
            target: "Cedar",
            status: "resolved"
          }),
          expect.objectContaining({
            target: "Old Cedar",
            status: "ambiguous"
          })
        ]
      })
    ]);

    const cedarConnections = await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111/connections`
    ).then((response) => response.json());
    expect(cedarConnections.backlinks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Map"
      }),
      expect.objectContaining({
        id: "55555555-5555-4555-8555-555555555555",
        title: "2026-01-02"
      })
    ]));
    expect(cedarConnections.inverseRelationships).toEqual([
      expect.objectContaining({
        key: "related_from",
        source: expect.objectContaining({ title: "Map" })
      })
    ]);
    const dailyConnections = await fetch(
      `${url}/api/v1/connections/55555555-5555-4555-8555-555555555555`
    ).then((response) => response.json());
    expect(dailyConnections.outgoing).toEqual([
      expect.objectContaining({
        target: "Cedar",
        status: "resolved",
        url: "/notes/11111111-1111-4111-8111-111111111111"
      })
    ]);
  });

  test("creates a missing target and renames a note as one complete managed operation", async () => {
    const vault = await makeVault();
    await writeFile(
      join(vault, "human/notes/other-grove.md"),
      noteSource({
        id: "44444444-4444-4444-8444-444444444444",
        title: "Other Grove"
      }),
      "utf8"
    );
    await writeFile(
      join(vault, "human/notes/cedar.md"),
      noteSource({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Cedar"
      }),
      "utf8"
    );
    await writeFile(
      join(vault, "human/notes/map.md"),
      noteSource({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Map",
        body:
          "Visit [[Cedar]] and [[Cedar|the cedar]].\n\n```\n[[Cedar]]\n```"
      }),
      "utf8"
    );
    await execFileAsync("git", [
      "-C",
      vault,
      "config",
      "filter.forbidden.clean",
      "false"
    ]);
    await execFileAsync("git", [
      "-C",
      vault,
      "config",
      "filter.forbidden.required",
      "true"
    ]);
    await writeFile(
      join(vault, ".gitattributes"),
      "*.md filter=forbidden\n",
      "utf8"
    );
    const url = await startServer(vault);

    const createdResponse = await fetch(`${url}/api/v1/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "wikilink", target: "Missing Grove" })
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      title: string;
      state: string;
    };
    expect(created).toMatchObject({ title: "Missing Grove", state: "captured" });

    const cedarResponse = await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111`
    );
    const cedar = (await cedarResponse.json()) as {
      revision: string;
      bodyMarkdown: string;
    };
    const titleResponse = await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "rich",
          baseRevision: cedar.revision,
          bodyMarkdown: cedar.bodyMarkdown.replace("# Cedar", "# Other Grove")
        })
      }
    );
    const titled = (await titleResponse.json()) as {
      revision: string;
      canonicalPath: string;
    };
    expect(titled.canonicalPath).toBe("human/notes/cedar.md");

    const beforeStaleRename = await readFile(
      join(vault, "human/notes/map.md"),
      "utf8"
    );
    const staleRename = await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111/rename-to-title`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: cedar.revision })
      }
    );
    expect(staleRename.status).toBe(409);
    expect(await readFile(join(vault, "human/notes/map.md"), "utf8")).toBe(
      beforeStaleRename
    );
    expect(await readdir(join(vault, "human/notes"))).toContain("cedar.md");

    const renameResponse = await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111/rename-to-title`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: titled.revision })
      }
    );
    expect(renameResponse.status).toBe(200);
    const renamed = (await renameResponse.json()) as {
      id: string;
      canonicalPath: string;
    };
    expect(renamed).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      canonicalPath: "human/notes/other-grove-2.md"
    });
    const rewrittenMap = await readFile(
      join(vault, "human/notes/map.md"),
      "utf8"
    );
    expect(rewrittenMap).toContain(
      "Visit [[Other Grove]] and [[Other Grove|the cedar]]."
    );
    expect(rewrittenMap).toContain("```\n[[Cedar]]\n```");
    await expect(
      readFile(join(vault, "human/notes/cedar.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    const { stdout: status } = await execFileAsync("git", [
      "-C",
      vault,
      "-c",
      "filter.forbidden.clean=",
      "-c",
      "filter.forbidden.required=false",
      "status",
      "--porcelain"
    ]);
    const { stdout: trackedFiles } = await execFileAsync("git", [
      "-C",
      vault,
      "ls-files"
    ]);
    expect(status).toBe("");
    expect(trackedFiles).not.toContain(".fumori-");
  });

  test("serves only complete projection snapshots during a mixed note rename", async () => {
    const vault = await makeVault();
    await writeFile(
      join(vault, "human/notes/old-target.md"),
      noteSource({
        id: "11111111-1111-4111-8111-111111111111",
        title: "OldTarget",
        aliases: ["OldTarget"]
      }),
      "utf8"
    );
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        writeFile(
          join(vault, `human/notes/reference-${index}.md`),
          noteSource({
            id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            title: `Reference ${index}`,
            body: "Remember [[OldTarget]]."
          }),
          "utf8"
        )
      )
    );
    await Promise.all(
      Array.from({ length: 40 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 0, index + 1))
          .toISOString()
          .slice(0, 10);
        return writeFile(
          join(vault, `human/daily/${date}.md`),
          `---
_id: 30000000-0000-4000-8000-${String(index).padStart(12, "0")}
_schema: fumori.daily-note
_version: 1
_created: 2026-01-01T00:00:00.000Z
type: daily-note
state: organized
tags: []
aliases: []
date: ${date}
---

# ${date}

Remember [[OldTarget]].
`,
          "utf8"
        );
      })
    );
    const url = await startServer(vault);
    const current = (await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111`
    ).then((response) => response.json())) as {
      revision: string;
      bodyMarkdown: string;
    };
    const titled = (await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "rich",
          baseRevision: current.revision,
          bodyMarkdown: current.bodyMarkdown.replace(
            "# OldTarget",
            "# New Beacon"
          )
        })
      }
    ).then((response) => response.json())) as { revision: string };
    const searchCount = () =>
      fetch(`${url}/api/v1/search?q=OldTarget`)
        .then((response) => response.json())
        .then((results: unknown[]) => results.length);
    const observedCounts = [await searchCount()];
    let renameFinished = false;
    const rename = fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111/rename-to-title`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: titled.revision })
      }
    ).finally(() => {
      renameFinished = true;
    });
    while (!renameFinished) {
      observedCounts.push(await searchCount());
    }
    expect((await rename).status).toBe(200);
    observedCounts.push(await searchCount());

    expect(observedCounts).toContain(81);
    expect(observedCounts).toContain(1);
    expect(new Set(observedCounts)).toEqual(new Set([81, 1]));
  });

  test("leaves canonical files unchanged when a prepared Daily rewrite is invalid", async () => {
    const vault = await makeVault();
    await writeFile(
      join(vault, "human/notes/cedar.md"),
      noteSource({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Cedar",
        aliases: ["Cedar"]
      }),
      "utf8"
    );
    const dailyPath = join(vault, "human/daily/2026-01-02.md");
    await writeFile(
      dailyPath,
      `---
_id: 55555555-5555-4555-8555-555555555555
_schema: fumori.daily-note
_version: 1
_created: 2026-01-02T00:00:00.000Z
type: daily-note
state: organized
tags: ["[[Cedar]]"]
aliases: []
date: 2026-01-02
---

# 2026-01-02

Remember [[Cedar]].
`,
      "utf8"
    );
    const url = await startServer(vault);
    const current = (await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111`
    ).then((response) => response.json())) as {
      revision: string;
      bodyMarkdown: string;
    };
    const titledResponse = await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "rich",
          baseRevision: current.revision,
          bodyMarkdown: current.bodyMarkdown.replace(
            "# Cedar",
            '# Broken", bad: {'
          )
        })
      }
    );
    expect(titledResponse.status).toBe(200);
    const titled = (await titledResponse.json()) as { revision: string };
    const beforeRename = await readFile(dailyPath, "utf8");

    const renameResponse = await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111/rename-to-title`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: titled.revision })
      }
    );
    expect(renameResponse.status).toBe(500);
    expect(await readFile(dailyPath, "utf8")).toBe(beforeRename);
    expect(await readdir(join(vault, "human/notes"))).toContain("cedar.md");
    await expect(
      readFile(join(vault, "human/notes/broken-bad.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("recovers the complete before state after a crash during publication", async () => {
    const vault = await makeVault();
    await writeFile(
      join(vault, "human/notes/cedar.md"),
      noteSource({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Cedar",
        aliases: ["Cedar"]
      }),
      "utf8"
    );
    await Promise.all(
      Array.from({ length: 300 }, (_, index) =>
        writeFile(
          join(vault, `human/notes/reference-${index}.md`),
          noteSource({
            id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            title: `Reference ${index}`,
            body: "Remember [[Cedar]]."
          }),
          "utf8"
        )
      )
    );
    const url = await startServer(vault);
    const server = servers.at(-1)!;
    const beforeTitleChange = (await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111`
    ).then((response) => response.json())) as {
      revision: string;
      bodyMarkdown: string;
    };
    const titled = (await fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "rich",
          baseRevision: beforeTitleChange.revision,
          bodyMarkdown: beforeTitleChange.bodyMarkdown.replace(
            "# Cedar",
            "# Cedar Beacon"
          )
        })
      }
    ).then((response) => response.json())) as {
      revision: string;
    };
    const renameAttempt = fetch(
      `${url}/api/v1/notes/11111111-1111-4111-8111-111111111111/rename-to-title`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: titled.revision })
      }
    ).catch(() => undefined);
    const { stdout: gitDirectoryOutput } = await execFileAsync("git", [
      "-C",
      vault,
      "rev-parse",
      "--absolute-git-dir"
    ]);
    const stagingRoot = join(
      gitDirectoryOutput.trim(),
      "fumori-transactions"
    );
    let publicationStarted = false;
    const deadline = Date.now() + 15_000;
    while (!publicationStarted && Date.now() < deadline) {
      publicationStarted = await readdir(stagingRoot, {
        recursive: true
      }).then(
        (entries) => entries.some((entry) => entry.endsWith(".before")),
        () => false
      );
      if (!publicationStarted) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
    expect(publicationStarted).toBe(true);
    const exited = new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
    });
    server.kill("SIGKILL");
    await exited;
    await renameAttempt;

    const recoveredUrl = await startServer(vault);
    const recovered = (await fetch(
      `${recoveredUrl}/api/v1/notes/11111111-1111-4111-8111-111111111111`
    ).then((response) => response.json())) as {
      id: string;
      title: string;
      canonicalPath: string;
    };
    expect(recovered).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Cedar Beacon",
      canonicalPath: "human/notes/cedar.md"
    });
    expect(
      await readFile(join(vault, "human/notes/reference-0.md"), "utf8")
    ).toContain("[[Cedar]]");
    await expect(
      readFile(join(vault, "human/notes/cedar-beacon.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await readdir(stagingRoot).catch(() => [])
    ).toEqual([]);
    const { stdout: status } = await execFileAsync("git", [
      "-C",
      vault,
      "status",
      "--porcelain"
    ]);
    expect(status).toBe("");
  });
});

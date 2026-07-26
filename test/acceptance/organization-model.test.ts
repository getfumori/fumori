import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
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
  const vault = await mkdtemp(join(tmpdir(), "fumori-organization-model-"));
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

describe("Organization Model HTTP contract", () => {
  test("loads ordered Type properties and Saved View preferences authored offline", async () => {
    const vault = await makeVault();
    await writeFile(
      join(vault, ".second-brain/model/types/project.md"),
      `---
_schema: fumori.model.type
_version: 1
key: project
name: Project
space: human
properties:
  - key: priority
    name: Priority
    kind: select
    options:
      - low
      - high
    default: low
    required: true
  - key: estimate
    name: Estimate
    kind: number
    default: 1
    advisory: Keep estimates small.
---

# Project
`,
      "utf8"
    );
    await writeFile(
      join(vault, ".second-brain/model/views/high-priority-projects.md"),
      `---
_schema: fumori.model.view
_version: 1
key: high-priority-projects
name: High-priority projects
space: human
query:
  filter:
    all:
      - field: type
        operator: equals
        value: project
      - field: priority
        operator: equals
        value: high
  order:
    - field: title
      direction: ascending
  group_by: state
  layout: table
  visible_columns:
    - title
    - priority
---

# High-priority projects
`,
      "utf8"
    );

    const url = await startServer(vault);
    const typesResponse = await fetch(`${url}/api/v1/types`);
    const viewsResponse = await fetch(`${url}/api/v1/views`);

    expect(typesResponse.status).toBe(200);
    expect(typesResponse.headers.get("cache-control")).toContain("no-store");
    await expect(typesResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "project",
          name: "Project",
          properties: [
            {
              key: "priority",
              name: "Priority",
              kind: "select",
              options: ["low", "high"],
              default: "low",
              required: true
            },
            {
              key: "estimate",
              name: "Estimate",
              kind: "number",
              default: 1,
              advisory: "Keep estimates small."
            }
          ]
        })
      ])
    );
    expect(viewsResponse.status).toBe(200);
    await expect(viewsResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "high-priority-projects",
          name: "High-priority projects",
          query: expect.objectContaining({
            groupBy: "state",
            layout: "table",
            visibleColumns: ["title", "priority"]
          })
        })
      ])
    );
  });

  test("creates from a Type and saves inspector metadata through object revisions", async () => {
    const vault = await makeVault();
    await writeFile(
      join(vault, ".second-brain/model/types/project.md"),
      `---
_schema: fumori.model.type
_version: 1
key: project
name: Project
space: human
properties:
  - key: priority
    name: Priority
    kind: select
    options:
      - low
      - high
    default: low
    required: true
  - key: estimate
    name: Estimate
    kind: number
    default: 1
---

# Project
`,
      "utf8"
    );
    const url = await startServer(vault);

    const createResponse = await fetch(`${url}/api/v1/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "type", type: "project" })
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      id: string;
      revision: string;
      sourceMarkdown: string;
      type: string;
      state: string;
      tags: string[];
      aliases: string[];
      properties: Record<string, unknown>;
    };
    expect(created).toMatchObject({
      type: "project",
      state: "captured",
      tags: [],
      aliases: [],
      properties: {
        priority: "low",
        estimate: 1
      }
    });

    const rawResponse = await fetch(`${url}/api/v1/notes/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "raw",
        baseRevision: created.revision,
        sourceMarkdown: created.sourceMarkdown.replace(
          "aliases: []",
          "aliases: []\noperator_note: preserve me"
        )
      })
    });
    const raw = (await rawResponse.json()) as { revision: string };

    const metadataResponse = await fetch(
      `${url}/api/v1/notes/${created.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "metadata",
          baseRevision: raw.revision,
          type: "project",
          state: "organized",
          tags: ["planning", "active"],
          aliases: ["North star"],
          properties: {
            priority: "high",
            estimate: 3
          }
        })
      }
    );
    expect(metadataResponse.status).toBe(200);
    const saved = (await metadataResponse.json()) as {
      revision: string;
      sourceMarkdown: string;
      type: string;
      state: string;
      tags: string[];
      aliases: string[];
      properties: Record<string, unknown>;
    };
    expect(saved).toMatchObject({
      type: "project",
      state: "organized",
      tags: ["planning", "active"],
      aliases: ["North star"],
      properties: {
        priority: "high",
        estimate: 3
      }
    });
    expect(saved.sourceMarkdown).toContain("operator_note: preserve me");

    const invalidRawResponse = await fetch(
      `${url}/api/v1/notes/${created.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "raw",
          baseRevision: saved.revision,
          sourceMarkdown: saved.sourceMarkdown.replace(
            'priority: "high"',
            "priority: impossible"
          )
        })
      }
    );
    expect(invalidRawResponse.status).toBe(422);

    const staleResponse = await fetch(`${url}/api/v1/notes/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "metadata",
        baseRevision: raw.revision,
        type: "project",
        state: "captured",
        tags: [],
        aliases: [],
        properties: {
          priority: "low",
          estimate: 1
        }
      })
    });
    expect(staleResponse.status).toBe(409);
  });

  test("Types and Saved Views evaluate one bounded projection query without membership", async () => {
    const vault = await makeVault();
    await writeFile(
      join(vault, ".second-brain/model/types/project.md"),
      `---
_schema: fumori.model.type
_version: 1
key: project
name: Project
space: human
properties:
  - key: priority
    name: Priority
    kind: select
    options: [low, high]
  - key: estimate
    name: Estimate
    kind: number
---

# Project
`,
      "utf8"
    );
    await writeFile(
      join(vault, ".second-brain/model/views/planning.md"),
      `---
_schema: fumori.model.view
_version: 1
key: planning
name: Planning
space: human
query:
  filter:
    all:
      - field: type
        operator: equals
        value: project
      - any:
          - field: priority
            operator: equals
            value: high
          - field: tags
            operator: contains
            value: urgent
      - not:
          field: state
          operator: equals
          value: archived
  order:
    - field: estimate
      direction: descending
    - field: title
      direction: ascending
  group_by: created
  layout: board
  visible_columns: [title, canonical_path, created]
---

# Planning
`,
      "utf8"
    );
    const notes = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        filename: "alpha.md",
        title: "Alpha",
        state: "organized",
        tags: "[]",
        priority: "high",
        estimate: 5
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        filename: "bravo.md",
        title: "Bravo",
        state: "captured",
        tags: "[urgent]",
        priority: "low",
        estimate: 8
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        filename: "charlie.md",
        title: "Charlie",
        state: "archived",
        tags: "[urgent]",
        priority: "high",
        estimate: 13
      }
    ];
    await Promise.all(
      notes.map((note) =>
        writeFile(
          join(vault, "human/notes", note.filename),
          `---
_id: ${note.id}
_schema: fumori.note
_version: 1
_created: 2026-01-01T00:00:00.000Z
type: project
state: ${note.state}
tags: ${note.tags}
aliases: []
priority: ${note.priority}
estimate: ${note.estimate}
---

# ${note.title}
`,
          "utf8"
        )
      )
    );

    const url = await startServer(vault);
    const typeResponse = await fetch(`${url}/api/v1/types/project`);
    const viewResponse = await fetch(`${url}/api/v1/views/planning`);

    expect(typeResponse.status).toBe(200);
    await expect(typeResponse.json()).resolves.toMatchObject({
      key: "project",
      name: "Project",
      items: [
        expect.objectContaining({ title: "Alpha" }),
        expect.objectContaining({ title: "Bravo" }),
        expect.objectContaining({ title: "Charlie" })
      ]
    });
    expect(viewResponse.status).toBe(200);
    await expect(viewResponse.json()).resolves.toMatchObject({
      key: "planning",
      name: "Planning",
      query: {
        groupBy: "created",
        layout: "board",
        visibleColumns: ["title", "canonical_path", "created"]
      },
      items: [
        expect.objectContaining({
          title: "Bravo",
          fields: expect.objectContaining({
            kind: "standalone",
            canonical_path: "human/notes/bravo.md",
            created: "2026-01-01T00:00:00.000Z"
          })
        }),
        expect.objectContaining({ title: "Alpha" })
      ],
      groups: [
        {
          key: "2026-01-01T00:00:00.000Z",
          items: [
            expect.objectContaining({ title: "Bravo" }),
            expect.objectContaining({ title: "Alpha" })
          ]
        }
      ]
    });
  });

  test("Daily Notes expose the same revision-aware inspector metadata seam", async () => {
    const vault = await makeVault();
    await writeFile(
      join(vault, ".second-brain/model/types/daily-note.md"),
      `---
_schema: fumori.model.type
_version: 1
key: daily-note
name: Daily Note
space: human
properties:
  - key: mood
    name: Mood
    kind: select
    options: [clear, foggy]
    default: clear
---

# Daily Note
`,
      "utf8"
    );
    const url = await startServer(vault);
    const today = (await (
      await fetch(`${url}/api/v1/today`)
    ).json()) as {
      date: string;
      revision: null;
      type: string;
      state: string;
      tags: string[];
      aliases: string[];
      properties: Record<string, unknown>;
    };
    expect(today).toMatchObject({
      type: "daily-note",
      state: "organized",
      tags: [],
      aliases: [],
      properties: { mood: "clear" }
    });

    const response = await fetch(`${url}/api/v1/daily/${today.date}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "document",
        baseRevision: today.revision,
        bodyMarkdown: "A typed day.",
        state: "captured",
        tags: ["journal"],
        aliases: ["The clear day"],
        properties: { mood: "foggy" }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      bodyMarkdown: "A typed day.",
      type: "daily-note",
      state: "captured",
      tags: ["journal"],
      aliases: ["The clear day"],
      properties: { mood: "foggy" }
    });
    await expect(
      (await fetch(`${url}/api/v1/types/daily-note`)).json()
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          kind: "daily",
          title: today.date,
          url: `/daily/${today.date}`
        })
      ]
    });
  });
});

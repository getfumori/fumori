import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
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
  const vault = await mkdtemp(join(tmpdir(), "fumori-daily-note-"));
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
  return { url: await waitForFumoriServer(server), vault };
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

describe("Daily Notes HTTP contract", () => {
  test("the first Today edit creates its canonical Daily Note", async () => {
    const { url, vault } = await makeRunningVault();
    const virtualResponse = await fetch(`${url}/api/v1/today`);
    const virtual = (await virtualResponse.json()) as {
      date: string;
      exists: boolean;
      revision: string | null;
      bodyMarkdown: string;
    };
    const dailyPath = join(vault, "human", "daily", `${virtual.date}.md`);

    expect(virtual).toMatchObject({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      exists: false,
      revision: null,
      bodyMarkdown: ""
    });
    await expect(readFile(dailyPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const saveResponse = await fetch(
      `${url}/api/v1/daily/${virtual.date}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRevision: null,
          bodyMarkdown: "A first thought."
        })
      }
    );
    expect(saveResponse.status).toBe(200);
    const saved = (await saveResponse.json()) as {
      exists: boolean;
      revision: string;
      bodyMarkdown: string;
    };
    expect(saved).toMatchObject({
      exists: true,
      revision: expect.stringMatching(/^[0-9a-f]{64}$/),
      bodyMarkdown: "A first thought."
    });

    const canonical = await readFile(dailyPath, "utf8");
    expect(canonical).toMatch(
      new RegExp(
        `^---\\n_id: [0-9a-f-]{36}\\n_schema: fumori\\.daily-note\\n_version: 1\\n_created: .+\\ntype: daily-note\\nstate: organized\\ntags: \\[\\]\\naliases: \\[\\]\\ndate: ${virtual.date}\\n---\\n\\n# ${virtual.date}\\n\\nA first thought\\.\\n$`
      )
    );
    const { stdout: commits } = await execFileAsync("git", [
      "-C",
      vault,
      "rev-list",
      "--count",
      "HEAD"
    ]);
    expect(commits.trim()).toBe("1");
  });

  test("a save replaces complete Markdown only at its base revision", async () => {
    const { url, vault } = await makeRunningVault();
    const virtual = (await (
      await fetch(`${url}/api/v1/today`)
    ).json()) as { date: string };
    const dailyPath = join(vault, "human", "daily", `${virtual.date}.md`);
    const createResponse = await fetch(
      `${url}/api/v1/daily/${virtual.date}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRevision: null,
          bodyMarkdown: "First version."
        })
      }
    );
    const created = (await createResponse.json()) as { revision: string };
    const createdCanonical = await readFile(dailyPath, "utf8");
    const customizedCanonical = createdCanonical
      .replace("state: organized", "state: captured")
      .replace("tags: []", "tags: [daily, focus]")
      .replace("aliases: []", "aliases: []\nweather: foggy");
    await writeFile(dailyPath, customizedCanonical, "utf8");
    const current = (await (
      await fetch(`${url}/api/v1/daily/${virtual.date}`)
    ).json()) as { revision: string };
    const stableEnvelope = customizedCanonical.slice(
      0,
      customizedCanonical.indexOf(`# ${virtual.date}`)
    );

    const updateResponse = await fetch(
      `${url}/api/v1/daily/${virtual.date}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRevision: current.revision,
          bodyMarkdown: "Second **complete** version."
        })
      }
    );
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as {
      revision: string;
      bodyMarkdown: string;
    };
    const updatedCanonical = await readFile(dailyPath, "utf8");
    expect(updated).toMatchObject({
      revision: expect.stringMatching(/^[0-9a-f]{64}$/),
      bodyMarkdown: "Second **complete** version."
    });
    expect(updated.revision).not.toBe(current.revision);
    expect(updated.revision).toBe(
      createHash("sha256").update(updatedCanonical).digest("hex")
    );
    expect(updatedCanonical.startsWith(stableEnvelope)).toBe(true);
    expect(updatedCanonical).not.toContain("First version.");
    expect(updatedCanonical).toContain("Second **complete** version.");

    const staleResponse = await fetch(
      `${url}/api/v1/daily/${virtual.date}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRevision: created.revision,
          bodyMarkdown: "Stale overwrite."
        })
      }
    );
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({
      error: "stale_revision",
      currentRevision: updated.revision
    });
    expect(await readFile(dailyPath, "utf8")).toBe(updatedCanonical);
    expect(
      (await readdir(join(vault, "human", "daily"))).filter((entry) =>
        entry.includes(".fumori-")
      )
    ).toEqual([]);
  });

  test("a missing historical Daily Note requires explicit creation", async () => {
    const { url, vault } = await makeRunningVault();
    const date = "2000-01-02";
    const dailyPath = join(vault, "human", "daily", `${date}.md`);

    const missing = await fetch(`${url}/api/v1/daily/${date}`);
    expect(missing.status).toBe(200);
    await expect(missing.json()).resolves.toMatchObject({
      date,
      exists: false,
      revision: null
    });
    await expect(readFile(dailyPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const implicitCreate = await fetch(`${url}/api/v1/daily/${date}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseRevision: null,
        bodyMarkdown: "This must not create the note."
      })
    });
    expect(implicitCreate.status).toBe(409);
    await expect(implicitCreate.json()).resolves.toMatchObject({
      error: "explicit_creation_required"
    });
    await expect(readFile(dailyPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const explicitCreate = await fetch(`${url}/api/v1/daily/${date}`, {
      method: "POST"
    });
    expect(explicitCreate.status).toBe(201);
    const created = (await explicitCreate.json()) as {
      exists: boolean;
      revision: string;
      bodyMarkdown: string;
    };
    expect(created).toMatchObject({
      exists: true,
      revision: expect.stringMatching(/^[0-9a-f]{64}$/),
      bodyMarkdown: ""
    });
    expect(await readFile(dailyPath, "utf8")).toMatch(
      new RegExp(`\\n# ${date}\\n$`)
    );

    const update = await fetch(`${url}/api/v1/daily/${date}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseRevision: created.revision,
        bodyMarkdown: "Explicitly opened history."
      })
    });
    expect(update.status).toBe(200);
    expect(await readFile(dailyPath, "utf8")).toContain(
      "# 2000-01-02\n\nExplicitly opened history.\n"
    );
  });
});

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import { waitForFumoriServer } from "../helpers/wait-for-fumori-server.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const servers: ChildProcess[] = [];

async function makeBootstrappedVault(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "fumori-serve-"));
  temporaryDirectories.push(path);
  await execFileAsync("git", ["init", "--quiet", path]);
  await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "vault",
      "bootstrap",
      "--path",
      path
    ],
    { cwd: process.cwd() }
  );
  return path;
}

async function startFumoriServer(
  vault: string,
  extraArguments: string[] = []
): Promise<string> {
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
  return waitForFumoriServer(child);
}

afterEach(async () => {
  for (const child of servers.splice(0)) {
    child.kill("SIGTERM");
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("fumori serve", () => {
  test("opens only the configured Vault and exposes Today as virtual state", async () => {
    const vault = await makeBootstrappedVault();
    const url = await startFumoriServer(vault);

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const rootResponse = await fetch(url, { redirect: "manual" });
    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.get("location")).toBe("/today");

    const todayResponse = await fetch(`${url}/api/v1/today`);
    expect(todayResponse.status).toBe(200);
    expect(todayResponse.headers.get("cache-control")).toContain("no-store");
    const today = (await todayResponse.json()) as {
      date: string;
      exists: boolean;
      vault: { id: string; name: string };
    };
    expect(today).toMatchObject({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      exists: false,
      vault: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: expect.any(String)
      }
    });

    await expect(
      readFile(join(vault, "human/daily", `${today.date}.md`), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    const { stdout: status } = await execFileAsync("git", [
      "-C",
      vault,
      "status",
      "--porcelain"
    ]);
    expect(status).toBe("");
  });

  test("publishes the default autosave policy", async () => {
    const vault = await makeBootstrappedVault();
    const url = await startFumoriServer(vault);

    const response = await fetch(`${url}/api/v1/config`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      autosave: {
        debounceMs: 1_500,
        maxDirtyMs: 10_000
      }
    });
  });

  test("accepts an explicit autosave policy", async () => {
    const vault = await makeBootstrappedVault();
    const url = await startFumoriServer(vault, [
      "--autosave-debounce-ms",
      "250",
      "--autosave-max-dirty-ms",
      "2000"
    ]);

    const response = await fetch(`${url}/api/v1/config`);
    await expect(response.json()).resolves.toEqual({
      autosave: {
        debounceMs: 250,
        maxDirtyMs: 2_000
      }
    });
  });
});

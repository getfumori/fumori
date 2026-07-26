import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { waitForFumoriServer } from "../test/helpers/wait-for-fumori-server.js";

const execFileAsync = promisify(execFile);

async function packAndInstall(root: string): Promise<string> {
  const packageDirectory = join(root, "package");
  const installDirectory = join(root, "consumer");
  await Promise.all([
    import("node:fs/promises").then(({ mkdir }) =>
      mkdir(packageDirectory, { recursive: true })
    ),
    import("node:fs/promises").then(({ mkdir }) =>
      mkdir(installDirectory, { recursive: true })
    )
  ]);

  const { stdout } = await execFileAsync(
    "npm",
    ["--silent", "pack", "--json", "--pack-destination", packageDirectory],
    { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 }
  );
  const jsonStart = stdout.lastIndexOf("\n[\n  {");
  const json = stdout.slice(jsonStart >= 0 ? jsonStart + 1 : 0);
  const packages = JSON.parse(json) as Array<{ filename: string }>;
  const filename = packages[0]?.filename;
  if (!filename) {
    throw new Error("npm pack did not produce an artifact");
  }
  const artifact = join(packageDirectory, filename);

  await execFileAsync("npm", ["init", "--yes"], { cwd: installDirectory });
  await execFileAsync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", artifact],
    { cwd: installDirectory, maxBuffer: 10 * 1024 * 1024 }
  );
  return join(installDirectory, "node_modules", ".bin", "fumori");
}

test("the packed CLI bootstraps a Vault and opens virtual Today in Chromium", async ({
  browser
}) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fumori-packed-e2e-"));
  let server: ChildProcess | undefined;

  try {
    const fumori = await packAndInstall(temporaryRoot);
    const vault = join(temporaryRoot, "vault");
    await execFileAsync("git", ["init", "--quiet", vault]);
    await execFileAsync(fumori, ["vault", "bootstrap", "--path", vault], {
      cwd: temporaryRoot
    });

    server = spawn(fumori, ["serve", "--vault", vault, "--port", "0"], {
      cwd: temporaryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const url = await waitForFumoriServer(server, {
      label: "Packed Fumori server",
      timeoutMs: 20_000
    });

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 }
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(url);

      await expect(page).toHaveURL(`${url}/today`);
      await expect(page).toHaveTitle("Today — Fumori");
      await expect(page.locator("[data-app-ready='true']")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
      await expect(page.locator("[data-zone]")).toHaveCount(3);
      expect(
        (
          await page
          .getByRole("navigation", { name: "Primary" })
          .getByRole("link")
          .allTextContents()
        ).map((label) => label.trim())
      ).toEqual(["Today", "Notes", "Inbox", "Types", "Views", "Archive"]);
      await expect(page.getByText("No Daily Note yet")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await context.close();
    }

    const todayResponse = await fetch(`${url}/api/v1/today`);
    const todayPayload = (await todayResponse.json()) as { date: string };
    await expect(
      readFile(
        join(vault, "human", "daily", `${todayPayload.date}.md`),
        "utf8"
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
    const { stdout: status } = await execFileAsync("git", [
      "-C",
      vault,
      "status",
      "--porcelain"
    ]);
    expect(status).toBe("");
  } finally {
    server?.kill("SIGTERM");
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
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

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
  });
  server.kill("SIGTERM");
  await exited;
}

test("the packed CLI edits canonical Daily Notes through Chromium", async ({
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
    const todayPayload = (await todayResponse.json()) as {
      date: string;
      revision: string | null;
    };
    const dailyPath = join(
      vault,
      "human",
      "daily",
      `${todayPayload.date}.md`
    );
    await expect(
      readFile(dailyPath, "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    const { stdout: status } = await execFileAsync("git", [
      "-C",
      vault,
      "status",
      "--porcelain"
    ]);
    expect(status).toBe("");

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();
    await page.goto(url);
    const editor = page
      .getByTestId("rich-editor")
      .locator("[contenteditable='true']");
    await expect(editor).toBeVisible();
    await editor.fill("The first thought grows here.");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 5_000
    });
    await expect
      .poll(() => readFile(dailyPath, "utf8"))
      .toContain("The first thought grows here.");

    const toolbar = page.getByRole("toolbar", { name: "Formatting" });
    await editor.fill("Opening paragraph with ");
    await toolbar.getByRole("button", { name: "Bold" }).click();
    await page.keyboard.type("bold");
    await toolbar.getByRole("button", { name: "Bold" }).click();
    await page.keyboard.type(", ");
    await toolbar.getByRole("button", { name: "Italic" }).click();
    await page.keyboard.type("italic");
    await toolbar.getByRole("button", { name: "Italic" }).click();
    await page.keyboard.type(", and ");
    await toolbar.getByRole("button", { name: "Inline code" }).click();
    await page.keyboard.type("inline code");
    await toolbar.getByRole("button", { name: "Inline code" }).click();
    await page.keyboard.type(".");

    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Heading 1" }).click();
    await page.keyboard.type("Heading One");
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Heading 2" }).click();
    await page.keyboard.type("Heading Two");
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Heading 3" }).click();
    await page.keyboard.type("Heading Three");
    await page.keyboard.press("Enter");

    await toolbar.getByRole("button", { name: "Bullet list" }).click();
    await page.keyboard.type("Bullet one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Bullet two");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await toolbar.getByRole("button", { name: "Ordered list" }).click();
    await page.keyboard.type("Ordered one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Ordered two");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await toolbar.getByRole("button", { name: "Checklist" }).click();
    await page.keyboard.type("Open task");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Done task");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await toolbar.getByRole("button", { name: "Blockquote" }).click();
    await page.keyboard.type("Quoted thought");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Code block" }).click();
    await page.keyboard.type("const answer = 42;");
    const taskCheckboxes = editor.locator(
      "ul[data-type='taskList'] input[type='checkbox']"
    );
    await expect(taskCheckboxes).toHaveCount(2);
    await taskCheckboxes.nth(1).click();
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();

    await expect(editor.locator("h1")).toHaveText("Heading One");
    await expect(editor.locator("h2")).toHaveText("Heading Two");
    await expect(editor.locator("h3")).toHaveText("Heading Three");
    await expect(editor.locator("strong")).toHaveText("bold");
    await expect(editor.locator("em")).toHaveText("italic");
    await expect(editor.locator("code").first()).toHaveText("inline code");
    await expect(editor.locator("ul").first()).toContainText("Bullet one");
    await expect(editor.locator("ol")).toContainText("Ordered one");
    await expect(editor.locator("ul[data-type='taskList']")).toContainText(
      "Open task"
    );
    await expect(editor.locator("blockquote")).toContainText("Quoted thought");
    await expect(editor.locator("pre code")).toContainText(
      "const answer = 42;"
    );

    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Rich re-edit survives.");
    await page.keyboard.press("Control+s");
    await expect
      .poll(() => readFile(dailyPath, "utf8"), { timeout: 1_000 })
      .toContain("Rich re-edit survives.");
    const afterRichEdit = await readFile(dailyPath, "utf8");
    for (const expected of [
      "**bold**",
      "*italic*",
      "`inline code`",
      "# Heading One",
      "## Heading Two",
      "### Heading Three",
      "- Bullet one",
      "1. Ordered one",
      "- [ ] Open task",
      "- [x] Done task",
      "> Quoted thought",
      "```",
      "const answer = 42;"
    ]) {
      expect(afterRichEdit).toContain(expected);
    }

    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Background flush survives.");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect
      .poll(() => readFile(dailyPath, "utf8"), { timeout: 1_000 })
      .toContain("Background flush survives.");

    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Primary navigation flush survives.");
    await page.getByRole("link", { name: "Notes", exact: true }).click();
    await expect
      .poll(() => readFile(dailyPath, "utf8"), { timeout: 1_000 })
      .toContain("Primary navigation flush survives.");

    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Navigation flush survives.");
    await page.getByRole("link", { name: /Open day/ }).click();
    await expect
      .poll(() => readFile(dailyPath, "utf8"), { timeout: 1_000 })
      .toContain("Navigation flush survives.");
    await page.goto(url);
    const persistedCanonical = await readFile(dailyPath, "utf8");
    const persisted = (await (
      await fetch(`${url}/api/v1/today`)
    ).json()) as { revision: string };
    expect(persisted.revision).toBe(
      createHash("sha256").update(persistedCanonical).digest("hex")
    );

    await stopServer(server);
    server = spawn(fumori, ["serve", "--vault", vault, "--port", "0"], {
      cwd: temporaryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const restartedUrl = await waitForFumoriServer(server, {
      label: "Restarted packed Fumori server",
      timeoutMs: 20_000
    });
    await page.goto(restartedUrl);
    await expect(
      page.getByTestId("rich-editor").getByText("Rich re-edit survives.")
    ).toBeVisible();
    await expect(
      page.getByTestId("rich-editor").locator("ul[data-type='taskList']")
    ).toContainText("Done task");
    await expect(
      page.getByTestId("rich-editor").locator("pre code")
    ).toContainText("const answer = 42;");

    const historicalDate = "2000-01-02";
    const historicalPath = join(
      vault,
      "human",
      "daily",
      `${historicalDate}.md`
    );
    await page.goto(`${restartedUrl}/daily/${historicalDate}`);
    await expect(page.getByText("No Daily Note for this day")).toBeVisible();
    await expect(page.getByTestId("rich-editor")).toHaveCount(0);
    await expect(readFile(historicalPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await page.getByRole("button", { name: "Create Daily Note" }).click();
    await expect(page.getByTestId("rich-editor")).toBeVisible();
    await expect(readFile(historicalPath, "utf8")).resolves.toContain(
      `# ${historicalDate}`
    );
    await context.close();
  } finally {
    server?.kill("SIGTERM");
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

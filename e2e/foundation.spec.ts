import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  test.setTimeout(180_000);
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
    await page.getByRole("button", { name: "Raw Markdown" }).click();
    const virtualRawEditor = page.getByRole("textbox", {
      name: "Raw Markdown editor"
    });
    await expect(virtualRawEditor).toHaveValue(
      new RegExp(`# ${todayPayload.date}\\n$`)
    );
    await page.getByRole("button", { name: "Rich editor" }).click();
    await expect(editor).toBeVisible();
    await expect(readFile(dailyPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await page.getByRole("button", { name: "Raw Markdown" }).click();
    const firstRawSource = (await virtualRawEditor.inputValue()).replace(
      `# ${todayPayload.date}\n`,
      `# ${todayPayload.date}\n\nStarted in Raw Markdown.\n`
    );
    await virtualRawEditor.fill(firstRawSource);
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect(await readFile(dailyPath, "utf8")).toBe(firstRawSource);
    await page.getByRole("button", { name: "Rich editor" }).click();
    await expect(editor).toContainText("Started in Raw Markdown.");
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
    const beforeModeSwitch = await readFile(dailyPath, "utf8");
    await page.getByRole("button", { name: "Raw Markdown" }).click();
    const rawEditor = page.getByRole("textbox", {
      name: "Raw Markdown editor"
    });
    await expect(rawEditor).toHaveValue(beforeModeSwitch);
    await page.getByRole("button", { name: "Rich editor" }).click();
    await expect(editor).toBeVisible();
    expect(await readFile(dailyPath, "utf8")).toBe(beforeModeSwitch);

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
    await page.goBack();
    await expect(page).toHaveURL(`${url}/today`);
    await expect(editor).toBeVisible();

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
    const projectTypePath = join(
      vault,
      ".second-brain",
      "model",
      "types",
      "project.md"
    );
    const activeProjectsViewPath = join(
      vault,
      ".second-brain",
      "model",
      "views",
      "active-projects.md"
    );
    const projectTypeSource = `---
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
    default: low
    required: true
  - key: estimate
    name: Estimate
    kind: number
    default: 1
    advisory: Use a small whole number.
---

# Project
`;
    const activeProjectsViewSource = `---
_schema: fumori.model.view
_version: 1
key: active-projects
name: Active projects
space: human
query:
  filter:
    all:
      - field: type
        operator: equals
        value: project
      - field: state
        operator: not_equals
        value: archived
  order:
    - field: priority
      direction: descending
  group_by: priority
  layout: table
  visible_columns: [title, state, priority]
---

# Active projects
`;
    await Promise.all([
      writeFile(projectTypePath, projectTypeSource, "utf8"),
      writeFile(activeProjectsViewPath, activeProjectsViewSource, "utf8")
    ]);
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

    const currentAfterRestart = (await (
      await fetch(`${restartedUrl}/api/v1/today`)
    ).json()) as { revision: string };
    const unsupportedSource = [
      (await readFile(dailyPath, "utf8"))
        .replace("aliases: []", "aliases: []\nweather: foggy")
        .trimEnd(),
      "",
      "| Key | Value |",
      "| --- | --- |",
      "| mist | high |",
      "",
      "$$",
      "x^2 + y^2",
      "$$",
      "",
      "```mermaid",
      "graph TD",
      "  seed --> forest",
      "```",
      "",
      "<section data-kind=\"weather\">Fog</section>",
      ""
    ].join("\n");
    const seedUnsupported = await fetch(
      `${restartedUrl}/api/v1/daily/${todayPayload.date}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "raw",
          baseRevision: currentAfterRestart.revision,
          sourceMarkdown: unsupportedSource
        })
      }
    );
    expect(seedUnsupported.status).toBe(200);
    await page.reload();

    const unsupportedRichEditor = page.getByTestId("rich-editor");
    await expect(unsupportedRichEditor).toBeVisible();
    await expect(
      unsupportedRichEditor.locator("[data-opaque-markdown]")
    ).toHaveCount(4);
    for (const label of [
      "Table — edit in Raw Markdown",
      "Math — edit in Raw Markdown",
      "Mermaid — edit in Raw Markdown",
      "HTML — edit in Raw Markdown"
    ]) {
      await expect(unsupportedRichEditor).toContainText(label);
    }
    await expect(
      page.getByRole("textbox", { name: "Raw Markdown editor" })
    ).toHaveCount(0);
    expect(await readFile(dailyPath, "utf8")).toBe(unsupportedSource);

    const unsupportedContentEditable = unsupportedRichEditor.locator(
      "[contenteditable='true']"
    );
    await unsupportedContentEditable.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Supported rich edit preserves opaque blocks.");
    await page.keyboard.press("Control+s");
    await expect
      .poll(() => readFile(dailyPath, "utf8"))
      .toContain("Supported rich edit preserves opaque blocks.");
    const unsupportedAfterRichEdit = await readFile(dailyPath, "utf8");
    for (const preserved of [
      "weather: foggy",
      "| Key | Value |",
      "$$\nx^2 + y^2\n$$",
      "```mermaid\ngraph TD\n  seed --> forest\n```",
      "<section data-kind=\"weather\">Fog</section>"
    ]) {
      expect(unsupportedAfterRichEdit).toContain(preserved);
    }

    await page.getByRole("button", { name: "Raw Markdown" }).click();
    const protectedRawEditor = page.getByRole("textbox", {
      name: "Raw Markdown editor"
    });
    await expect(protectedRawEditor).toHaveValue(unsupportedAfterRichEdit);
    await page.getByRole("button", { name: "Rich editor" }).click();
    await expect(unsupportedRichEditor).toBeVisible();
    expect(await readFile(dailyPath, "utf8")).toBe(unsupportedAfterRichEdit);

    await page.getByRole("button", { name: "Raw Markdown" }).click();
    const invalidIdentitySource = unsupportedAfterRichEdit.replace(
      /^_id: .+$/m,
      "_id: 11111111-1111-4111-8111-111111111111"
    );
    await protectedRawEditor.fill(invalidIdentitySource);
    await page.keyboard.press("Control+s");
    await expect(
      page.getByText("Reserved field '_id' cannot be changed.")
    ).toBeVisible();
    await expect(protectedRawEditor).toHaveValue(invalidIdentitySource);
    expect(await readFile(dailyPath, "utf8")).toBe(unsupportedAfterRichEdit);

    const frontmatterEnd = unsupportedAfterRichEdit.indexOf("\n---\n\n");
    const validRawEdit = `${unsupportedAfterRichEdit
      .slice(0, frontmatterEnd + "\n---".length)
      .replace(
        "weather: foggy",
        "weather: rainy"
      )}\n\n# ${todayPayload.date}\n\nRaw edit survives.\n`;
    await protectedRawEditor.fill(validRawEdit);
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect
      .poll(() => readFile(dailyPath, "utf8"))
      .toBe(validRawEdit);
    await page.getByRole("button", { name: "Rich editor" }).click();
    await expect(page.getByTestId("rich-editor")).toContainText(
      "Raw edit survives."
    );
    expect(await readFile(dailyPath, "utf8")).toBe(validRawEdit);
    const rawToRichEditor = page
      .getByTestId("rich-editor")
      .locator("[contenteditable='true']");
    await rawToRichEditor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Rich edit after Raw survives.");
    await page.keyboard.press("Control+s");
    await expect
      .poll(() => readFile(dailyPath, "utf8"))
      .toContain("Rich edit after Raw survives.");
    expect(await readFile(dailyPath, "utf8")).toContain("weather: rainy");

    await stopServer(server);
    server = spawn(fumori, ["serve", "--vault", vault, "--port", "0"], {
      cwd: temporaryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const rawRestartedUrl = await waitForFumoriServer(server, {
      label: "Raw Markdown restarted packed Fumori server",
      timeoutMs: 20_000
    });
    await page.goto(rawRestartedUrl);
    await expect(page.getByTestId("rich-editor")).toContainText(
      "Rich edit after Raw survives."
    );
    const afterRawToRich = await readFile(dailyPath, "utf8");
    await page.getByRole("button", { name: "Raw Markdown" }).click();
    await expect(
      page.getByRole("textbox", { name: "Raw Markdown editor" })
    ).toHaveValue(afterRawToRich);

    const historicalDate = "2000-01-02";
    const historicalPath = join(
      vault,
      "human",
      "daily",
      `${historicalDate}.md`
    );
    await page.goto(`${rawRestartedUrl}/daily/${historicalDate}`);
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

    await page.goto(`${rawRestartedUrl}/notes`);
    await expect(page).toHaveTitle("Notes — Fumori");
    await expect(page.getByRole("heading", { name: "Notes", level: 2 })).toBeVisible();
    await page
      .locator("[data-zone='primary']")
      .getByRole("button", { name: "New note" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    const firstStandaloneUrl = page.url();
    const standaloneEditor = page
      .getByTestId("rich-editor")
      .locator("[contenteditable='true']");
    await standaloneEditor.fill(
      "# Lantern Archive\n\nThe winter signal waits beside the cedar."
    );
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect
      .poll(async () =>
        (await readdir(join(vault, "human", "notes"))).includes(
          "lantern-archive.md"
        )
      )
      .toBe(true);
    const standalonePath = join(
      vault,
      "human",
      "notes",
      "lantern-archive.md"
    );
    await expect
      .poll(() => readFile(standalonePath, "utf8"))
      .toContain("The winter signal waits beside the cedar.");
    await page.reload();
    await expect(standaloneEditor).toContainText("Lantern Archive");

    const secondTab = await context.newPage();
    await secondTab.goto(firstStandaloneUrl);
    await expect(
      secondTab.getByTestId("rich-editor").getByText("Lantern Archive")
    ).toBeVisible();
    await secondTab.close();

    await page.getByRole("link", { name: "Notes", exact: true }).click();
    await expect(page).toHaveURL(`${rawRestartedUrl}/notes`);
    await page.goBack();
    await expect(page).toHaveURL(firstStandaloneUrl);
    await page.goForward();
    await expect(page).toHaveURL(`${rawRestartedUrl}/notes`);
    await expect(page.getByRole("link", { name: "Lantern Archive" })).toBeVisible();

    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(page).toHaveURL(`${rawRestartedUrl}/inbox`);
    await expect(page.getByRole("link", { name: "Lantern Archive" })).toBeVisible();
    await page
      .getByRole("button", { name: "Capture note" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    await page
      .getByTestId("rich-editor")
      .locator("[contenteditable='true']")
      .fill("# Inbox Seed\n\nCaptured from Inbox.");
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Types", exact: true }).click();
    await expect(page).toHaveURL(`${rawRestartedUrl}/types`);
    await page.getByRole("link", { name: /^Project\b/ }).click();
    await expect(page).toHaveURL(`${rawRestartedUrl}/types/project`);
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Inspector" }).click();
    const inspector = page.getByRole("form", { name: "Document inspector" });
    await expect(inspector.getByLabel("Type")).toHaveValue("project");
    await expect(inspector.getByLabel("State")).toHaveValue("captured");
    await expect(inspector.getByLabel("Priority")).toHaveValue("low");
    await expect(inspector.getByText("Required")).toBeVisible();
    await expect(inspector.getByText("Use a small whole number.")).toBeVisible();
    await inspector.getByLabel("Priority").selectOption("high");
    await inspector.getByLabel("Estimate").fill("3");
    await inspector.getByLabel("Tags").fill("active, lighthouse");
    await inspector.getByLabel("Aliases").fill("Beacon plan");
    await page
      .getByTestId("rich-editor")
      .locator("[contenteditable='true']")
      .fill("# Fog Beacon\n\nKeep the channel visible.");
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const typedNotePath = join(vault, "human", "notes", "fog-beacon.md");
    await expect.poll(() => readFile(typedNotePath, "utf8")).toContain(
      'priority: "high"'
    );
    const typedSource = await readFile(typedNotePath, "utf8");
    for (const expected of [
      "type: project",
      "state: captured",
      "tags:",
      "- active",
      "- lighthouse",
      "aliases:",
      "- Beacon plan",
      'priority: "high"',
      "estimate: 3"
    ]) {
      expect(typedSource).toContain(expected);
    }

    await page.getByRole("link", { name: "Types", exact: true }).click();
    await page.getByRole("link", { name: /^Project\b/ }).click();
    await expect(page.getByRole("link", { name: "Fog Beacon" })).toBeVisible();
    await page.getByRole("link", { name: "Views", exact: true }).click();
    await page
      .getByRole("link", { name: /^Active projects\b/ })
      .click();
    await expect(
      page
        .locator("[data-zone='context']")
        .getByRole("link", { name: "Fog Beacon" })
    ).toBeVisible();
    expect(await readFile(projectTypePath, "utf8")).toBe(projectTypeSource);
    expect(await readFile(activeProjectsViewPath, "utf8")).toBe(
      activeProjectsViewSource
    );

    await page.keyboard.press("Control+k");
    await expect(page).toHaveURL(`${rawRestartedUrl}/search`);
    const search = page.getByRole("searchbox", { name: "Search notes" });
    await search.fill("winter signal");
    await expect(page.getByRole("link", { name: "Lantern Archive" })).toContainText(
      "winter signal"
    );
    await page.getByRole("link", { name: "Lantern Archive" }).click();
    await expect(page).toHaveURL(firstStandaloneUrl);

    await page.keyboard.press("Control+k");
    await search.fill("Raw edit survives");
    await expect(
      page.getByRole("link", { name: todayPayload.date })
    ).toContainText("Raw edit survives");
    await context.close();
  } finally {
    if (server) {
      await stopServer(server);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

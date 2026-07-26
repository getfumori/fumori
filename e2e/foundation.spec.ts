import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { packAndInstallFumori } from "../test/helpers/packed-fumori.js";
import {
  runGit,
  stopChildProcess
} from "../test/helpers/subprocess.js";
import { waitForFumoriServer } from "../test/helpers/wait-for-fumori-server.js";

const execFileAsync = promisify(execFile);
const FOUNDATION_DESKTOP_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 }
] as const;

test("the packed CLI edits canonical Daily Notes through Chromium", async ({
  browser
}) => {
  test.setTimeout(240_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fumori-packed-e2e-"));
  let server: ChildProcess | undefined;

  try {
    const { executable: fumori } = await packAndInstallFumori(temporaryRoot);
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

    for (const viewport of FOUNDATION_DESKTOP_VIEWPORTS) {
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
      const richEditor = page
        .getByTestId("rich-editor")
        .locator("[contenteditable='true']");
      await expect(richEditor).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Inspector" })
      ).toBeInViewport();
      await page.getByRole("button", { name: "Inspector" }).click();
      await expect(
        page.getByRole("form", { name: "Document inspector" })
      ).toBeInViewport();
      await page.getByRole("button", { name: "Close inspector" }).click();
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

    const headBeforeInterruption = (
      await runGit(vault, "rev-parse", "HEAD")
    ).trim();
    expect(await runGit(vault, "status", "--porcelain")).not.toBe("");
    await stopChildProcess(server, "SIGKILL");
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
    const relatedToPath = join(
      vault,
      ".second-brain",
      "model",
      "relationships",
      "related_to.md"
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
    const relatedToSource = `---
_schema: fumori.model.relationship
_version: 1
key: related_to
name: Related to
cardinality: many
inverse: related_from
target_types: [note]
---

# Related to
`;
    await Promise.all([
      writeFile(projectTypePath, projectTypeSource, "utf8"),
      writeFile(activeProjectsViewPath, activeProjectsViewSource, "utf8"),
      writeFile(relatedToPath, relatedToSource, "utf8")
    ]);
    server = spawn(fumori, ["serve", "--vault", vault, "--port", "0"], {
      cwd: temporaryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const restartedUrl = await waitForFumoriServer(server, {
      label: "Restarted packed Fumori server",
      timeoutMs: 20_000
    });
    const recoveryHead = (await runGit(vault, "rev-parse", "HEAD")).trim();
    expect(recoveryHead).not.toBe(headBeforeInterruption);
    expect((await runGit(vault, "log", "-1", "--pretty=%s")).trim()).toBe(
      "Recovery checkpoint"
    );
    expect(await runGit(vault, "status", "--porcelain")).toBe("");
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
    const checkpointResponse = await fetch(
      `${restartedUrl}/api/v1/checkpoint`,
      { method: "POST" }
    );
    expect(checkpointResponse.status).toBe(200);
    expect(checkpointResponse.headers.get("cache-control")).toContain(
      "no-store"
    );
    const checkpoint = (await checkpointResponse.json()) as {
      changedFileCount: number;
      created: boolean;
      sha: string | null;
    };
    expect(checkpoint).toEqual({
      changedFileCount: 1,
      created: true,
      sha: expect.stringMatching(/^[0-9a-f]{40}$/)
    });
    expect((await runGit(vault, "rev-parse", "HEAD")).trim()).toBe(checkpoint.sha);
    expect((await runGit(vault, "log", "-1", "--pretty=%s")).trim()).toBe(
      "Checkpoint Vault"
    );
    expect(await runGit(vault, "status", "--porcelain")).toBe("");
    const cleanCheckpointResponse = await fetch(
      `${restartedUrl}/api/v1/checkpoint`,
      { method: "POST" }
    );
    await expect(cleanCheckpointResponse.json()).resolves.toEqual({
      changedFileCount: 0,
      created: false,
      sha: null
    });
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

    await stopChildProcess(server);
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

    await page.goto(rawRestartedUrl);
    const connectedDailyEditor = page
      .getByTestId("rich-editor")
      .locator("[contenteditable='true']");
    await connectedDailyEditor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("[[Lan");
    await page
      .getByRole("option", { name: "Lantern Archive" })
      .click();
    await page
      .getByTestId("rich-editor")
      .getByText("Lantern Archive")
      .last()
      .click();
    await expect(page).toHaveURL(firstStandaloneUrl);

    await page.getByRole("link", { name: "Notes", exact: true }).click();
    await page
      .locator("[data-zone='primary']")
      .getByRole("button", { name: "New note" })
      .click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    const mapUrl = page.url();
    const mapEditor = page
      .getByTestId("rich-editor")
      .locator("[contenteditable='true']");
    await mapEditor.fill("# Trail Map\n\n[[Lan");
    await page
      .getByRole("option", { name: "Lantern Archive" })
      .click();
    await expect(mapEditor).toContainText("Lantern Archive");
    await mapEditor.getByText("Lantern Archive").click();
    await expect(page).toHaveURL(firstStandaloneUrl);
    await page.goBack();
    await expect(page).toHaveURL(mapUrl);
    await page.getByRole("button", { name: "Inspector" }).click();
    const mapInspector = page.getByRole("form", {
      name: "Document inspector"
    });
    await mapInspector.getByLabel("Related to").fill("[[Lantern Archive]]");
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        readFile(join(vault, "human", "notes", "trail-map.md"), "utf8")
      )
      .toContain('related_to:\n  - "[[Lantern Archive]]"');
    await mapEditor.getByText("Lantern Archive").click();
    await expect(page).toHaveURL(firstStandaloneUrl);
    await page.getByRole("button", { name: "Inspector" }).click();
    await expect(
      page.getByRole("form", { name: "Document inspector" })
        .getByRole("link", { name: "Trail Map", exact: true })
    ).toBeVisible();
    await page
      .getByTestId("rich-editor")
      .getByRole("heading", { name: "Lantern Archive", level: 1 })
      .fill("Lantern Beacon");
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect(await readdir(join(vault, "human", "notes"))).toContain(
      "lantern-archive.md"
    );
    await page.getByRole("button", { name: "Rename file to title" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect
      .poll(() => readdir(join(vault, "human", "notes")))
      .toContain("lantern-beacon.md");
    const canonicalMapAfterRename = await readFile(
      join(vault, "human", "notes", "trail-map.md"),
      "utf8"
    );
    expect(
      canonicalMapAfterRename.slice(
        canonicalMapAfterRename.indexOf("\n---\n") + "\n---\n".length
      )
    ).toContain("[[Lantern Beacon]]");
    await expect.poll(() => readFile(dailyPath, "utf8")).toContain(
      "[[Lantern Beacon]]"
    );
    const mapAfterRename = (await (
      await fetch(
        `${rawRestartedUrl}/api/v1/notes/${mapUrl.split("/").at(-1)!}`
      )
    ).json()) as { bodyMarkdown: string };
    expect(mapAfterRename.bodyMarkdown).toContain("[[Lantern Beacon]]");
    await page.goto(mapUrl);
    await expect(
      page.getByTestId("rich-editor").getByText("Lantern Beacon")
    ).toBeVisible();
    await mapEditor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("[[Missing Grove]]");
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByTestId("rich-editor").getByText("Missing Grove").click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: "Missing Grove", level: 1 })
        .first()
    ).toBeVisible();
    await page.goto(firstStandaloneUrl);
    await expect(
      page.getByTestId("rich-editor").getByText("Lantern Beacon")
    ).toBeVisible();

    const secondTab = await context.newPage();
    await secondTab.goto(firstStandaloneUrl);
    await expect(
      secondTab.getByTestId("rich-editor").getByText("Lantern Beacon")
    ).toBeVisible();
    await secondTab.close();

    await page.getByRole("link", { name: "Notes", exact: true }).click();
    await expect(page).toHaveURL(`${rawRestartedUrl}/notes`);
    await page.goBack();
    await expect(page).toHaveURL(firstStandaloneUrl);
    await page.goForward();
    await expect(page).toHaveURL(`${rawRestartedUrl}/notes`);
    await expect(page.getByRole("link", { name: "Lantern Beacon" })).toBeVisible();

    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(page).toHaveURL(`${rawRestartedUrl}/inbox`);
    await expect(page.getByRole("link", { name: "Lantern Beacon" })).toBeVisible();
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
    await expect(page.getByRole("link", { name: "Lantern Beacon" })).toContainText(
      "winter signal"
    );
    await page.getByRole("link", { name: "Lantern Beacon" }).click();
    await expect(page).toHaveURL(firstStandaloneUrl);

    await page.keyboard.press("Control+k");
    await search.fill("Raw edit survives");
    await expect(
      page.getByRole("link", { name: todayPayload.date })
    ).toContainText("Raw edit survives");
    expect(
      await page.evaluate(async () => ({
        cacheNames: "caches" in window ? await caches.keys() : [],
        indexedDatabases:
          typeof indexedDB.databases === "function"
            ? (await indexedDB.databases()).map((database) => database.name)
            : [],
        localStorageKeys: Object.keys(localStorage),
        serviceWorkerRegistrations:
          "serviceWorker" in navigator
            ? (await navigator.serviceWorker.getRegistrations()).length
            : 0,
        sessionStorageKeys: Object.keys(sessionStorage)
      }))
    ).toEqual({
      cacheNames: [],
      indexedDatabases: [],
      localStorageKeys: [],
      serviceWorkerRegistrations: 0,
      sessionStorageKeys: []
    });
    await context.close();
  } finally {
    if (server) {
      await stopChildProcess(server);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("two tabs resolve stale Human Note drafts without silent overwrite", async ({
  browser
}) => {
  test.setTimeout(240_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fumori-conflict-e2e-"));
  let server: ChildProcess | undefined;

  try {
    const { executable: fumori } = await packAndInstallFumori(temporaryRoot);
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
      label: "Packed conflict Fumori server",
      timeoutMs: 20_000
    });
    const created = (await (
      await fetch(`${url}/api/v1/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "global" })
      })
    ).json()) as { id: string };
    const noteUrl = `${url}/notes/${created.id}`;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const firstTab = await context.newPage();
    const secondTab = await context.newPage();
    await Promise.all([firstTab.goto(noteUrl), secondTab.goto(noteUrl)]);
    const rawEditor = (page: typeof firstTab) =>
      page.getByRole("textbox", { name: "Raw Markdown editor" });
    const openRawEditor = async (page: typeof firstTab) => {
      await page.getByRole("button", { name: "Raw Markdown" }).click();
      await expect(rawEditor(page)).toBeVisible();
    };
    await Promise.all([openRawEditor(firstTab), openRawEditor(secondTab)]);
    const initialSource = await rawEditor(firstTab).inputValue();
    let failNextCurrentLoad = true;
    await secondTab.route(`**/api/v1/notes/${created.id}`, async (route) => {
      if (failNextCurrentLoad && route.request().method() === "GET") {
        failNextCurrentLoad = false;
        await route.fulfill({ status: 503, body: "temporarily unavailable" });
        return;
      }
      await route.continue();
    });
    const withBody = (source: string, body: string) => {
      const envelope = source.match(/^---\n[\s\S]*?\n---\n/)?.[0];
      if (!envelope) {
        throw new Error("Human Note source has no canonical envelope");
      }
      return `${envelope}\n# Shared Note\n\n${body}\n`;
    };
    const saveSource = async (page: typeof firstTab, source: string) => {
      await rawEditor(page).fill(source);
      await page.keyboard.press("Control+s");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    };
    const canonicalPath = async () => {
      const current = (await (
        await fetch(`${url}/api/v1/notes/${created.id}`, {
          cache: "no-store"
        })
      ).json()) as { canonicalPath: string };
      return join(vault, current.canonicalPath);
    };

    const currentToAdopt = withBody(
      initialSource,
      "Current content to adopt."
    );
    await saveSource(firstTab, currentToAdopt);
    const notePath = await canonicalPath();
    const localDraft = withBody(
      initialSource,
      "Local draft that must survive."
    );
    await rawEditor(secondTab).fill(localDraft);
    await secondTab.keyboard.press("Control+s");
    const adoptDialog = secondTab.getByRole("dialog", {
      name: "Resolve newer content"
    });
    await expect(adoptDialog).toBeVisible();
    await expect(rawEditor(secondTab)).toHaveValue(localDraft);
    expect(await readFile(notePath, "utf8")).toBe(currentToAdopt);
    await adoptDialog
      .getByRole("button", { name: "Retry loading current content" })
      .click();
    await expect(
      adoptDialog.getByRole("textbox", { name: "Current saved content" })
    ).toHaveValue(currentToAdopt);
    await expect(adoptDialog).not.toContainText(/\b(?:Git|branch|merge)\b/i);
    for (const viewport of FOUNDATION_DESKTOP_VIEWPORTS) {
      await secondTab.setViewportSize(viewport);
      for (const name of [
        "Close",
        "Use current saved content",
        "Replace with my draft",
        "Combine manually"
      ]) {
        await expect(
          adoptDialog.getByRole("button", { name })
        ).toBeInViewport();
      }
      expect(
        await secondTab.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
    }
    await adoptDialog.getByRole("button", { name: "Close" }).click();
    await expect(adoptDialog).not.toBeVisible();
    const completeLocalDraft = withBody(
      initialSource,
      "Complete local draft after closing."
    );
    await rawEditor(secondTab).fill(completeLocalDraft);
    await secondTab.waitForTimeout(1_800);
    expect(await readFile(notePath, "utf8")).toBe(currentToAdopt);
    await secondTab
      .getByRole("button", { name: "Review newer content" })
      .click();
    await adoptDialog
      .getByRole("button", { name: "Use current saved content" })
      .click();
    await expect(rawEditor(secondTab)).toHaveValue(currentToAdopt);
    await secondTab.waitForTimeout(1_800);
    expect(await readFile(notePath, "utf8")).toBe(currentToAdopt);

    await Promise.all([firstTab.reload(), secondTab.reload()]);
    await Promise.all([openRawEditor(firstTab), openRawEditor(secondTab)]);
    const currentBeforeReplacement = withBody(
      currentToAdopt,
      "Current content before replacement."
    );
    await saveSource(firstTab, currentBeforeReplacement);
    const replacementDraft = withBody(
      currentToAdopt,
      "Draft chosen as the replacement."
    );
    await rawEditor(secondTab).fill(replacementDraft);
    await secondTab.keyboard.press("Control+s");
    const replaceDialog = secondTab.getByRole("dialog", {
      name: "Resolve newer content"
    });
    await expect(replaceDialog).toBeVisible();
    await replaceDialog
      .getByRole("button", { name: "Replace with my draft" })
      .click();
    await expect
      .poll(() => readFile(notePath, "utf8"))
      .toBe(replacementDraft);

    await Promise.all([firstTab.reload(), secondTab.reload()]);
    await Promise.all([openRawEditor(firstTab), openRawEditor(secondTab)]);
    const currentBeforeManual = withBody(
      replacementDraft,
      "Current side of the manual combination."
    );
    await saveSource(firstTab, currentBeforeManual);
    const manualDraft = withBody(
      replacementDraft,
      "Draft side of the manual combination."
    );
    await rawEditor(secondTab).fill(manualDraft);
    await secondTab.keyboard.press("Control+s");
    const manualDialog = secondTab.getByRole("dialog", {
      name: "Resolve newer content"
    });
    await expect(manualDialog).toBeVisible();
    await manualDialog
      .getByRole("button", { name: "Combine manually" })
      .click();
    await expect(manualDialog).not.toBeVisible();
    const combinedDraft = withBody(
      replacementDraft,
      [
        "Current side of the manual combination.",
        "",
        "Draft side of the manual combination."
      ].join("\n")
    );
    await rawEditor(secondTab).fill(combinedDraft);
    await secondTab
      .getByRole("button", { name: "Save combined draft" })
      .click();
    await expect
      .poll(() => readFile(notePath, "utf8"))
      .toBe(combinedDraft);
    await context.close();
  } finally {
    if (server) {
      await stopChildProcess(server);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the packed CLI archives and deletes a linked Human Note through Chromium", async ({
  browser
}) => {
  test.setTimeout(240_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fumori-lifecycle-e2e-"));
  let server: ChildProcess | undefined;

  try {
    const { executable: fumori } = await packAndInstallFumori(temporaryRoot);
    const vault = join(temporaryRoot, "vault");
    await execFileAsync("git", ["init", "--quiet", vault]);
    await execFileAsync(fumori, ["vault", "bootstrap", "--path", vault], {
      cwd: temporaryRoot
    });
    const lifecyclePath = join(
      vault,
      ".second-brain",
      "model",
      "lifecycle.md"
    );
    await writeFile(
      lifecyclePath,
      (await readFile(lifecyclePath, "utf8"))
        .replace("  - archived", "  - cold")
        .replace("archived_state: archived", "archived_state: cold"),
      "utf8"
    );
    server = spawn(fumori, ["serve", "--vault", vault, "--port", "0"], {
      cwd: temporaryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let url = await waitForFumoriServer(server, {
      label: "Packed lifecycle Fumori server",
      timeoutMs: 20_000
    });

    const createNote = async (title: string, body: string) => {
      const created = (await (
        await fetch(`${url}/api/v1/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: "global" })
        })
      ).json()) as { id: string; revision: string };
      return (await (
        await fetch(`${url}/api/v1/notes/${created.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            format: "rich",
            baseRevision: created.revision,
            bodyMarkdown: `# ${title}\n\n${body}`
          })
        })
      ).json()) as {
        id: string;
        canonicalPath: string;
        revision: string;
      };
    };
    const target = await createNote("Cedar", "Keep this note.");
    const source = await createNote("Source", "Follow [[Cedar]].");
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();
    await page.goto(`${url}/notes/${target.id}`);

    await page.getByRole("button", { name: "Archive note" }).click();
    await expect(page).toHaveURL(`${url}/archive`);
    await expect(page.getByRole("link", { name: "Cedar" })).toBeVisible();
    expect(await readFile(join(vault, target.canonicalPath), "utf8")).toContain(
      "state: cold"
    );
    await page.getByRole("link", { name: "Notes", exact: true }).click();
    await expect(page.getByRole("link", { name: "Cedar" })).toHaveCount(0);
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(page.getByRole("link", { name: "Cedar" })).toHaveCount(0);

    await stopChildProcess(server);
    server = undefined;
    server = spawn(fumori, ["serve", "--vault", vault, "--port", "0"], {
      cwd: temporaryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    url = await waitForFumoriServer(server, {
      label: "Restarted archived-note Fumori server",
      timeoutMs: 20_000
    });
    await page.goto(`${url}/archive`);
    await expect(page.getByRole("link", { name: "Cedar" })).toBeVisible();
    await page.getByRole("link", { name: "Archive", exact: true }).click();
    await page.getByRole("link", { name: "Cedar" }).click();
    await expect(page).toHaveURL(`${url}/notes/${target.id}`);
    await expect(page.getByText("Keep this note.")).toBeVisible();
    await page.getByRole("button", { name: "Unarchive note" }).click();
    await expect(page).toHaveURL(`${url}/notes`);
    await expect(page.getByRole("link", { name: "Cedar" })).toBeVisible();
    expect(await readFile(join(vault, target.canonicalPath), "utf8")).toContain(
      "state: captured"
    );
    await page.getByRole("link", { name: "Cedar" }).click();

    await page.getByRole("button", { name: "Delete note" }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete Cedar?" });
    await expect(confirmation).toContainText(
      "1 incoming link will become unresolved."
    );
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(readFile(join(vault, target.canonicalPath), "utf8")).resolves
      .toContain("Keep this note.");
    await page.getByRole("button", { name: "Delete note" }).click();
    await confirmation.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page).toHaveURL(`${url}/notes`);
    await expect(readFile(join(vault, target.canonicalPath), "utf8")).rejects
      .toMatchObject({ code: "ENOENT" });

    await page.goto(`${url}/notes/${source.id}`);
    await page.getByRole("button", { name: "Inspector" }).click();
    const inspector = page.getByRole("form", { name: "Document inspector" });
    await expect(inspector.getByRole("button", { name: /Cedar unresolved/ }))
      .toBeVisible();

    await stopChildProcess(server);
    server = undefined;
    server = spawn(fumori, ["serve", "--vault", vault, "--port", "0"], {
      cwd: temporaryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    url = await waitForFumoriServer(server, {
      label: "Restarted lifecycle Fumori server",
      timeoutMs: 20_000
    });
    await page.goto(`${url}/notes/${source.id}`);
    await page.getByRole("button", { name: "Inspector" }).click();
    await expect(
      page
        .getByRole("form", { name: "Document inspector" })
        .getByRole("button", { name: /Cedar unresolved/ })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Archive note" })).toBeVisible();
    await context.close();
  } finally {
    if (server) {
      await stopChildProcess(server);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

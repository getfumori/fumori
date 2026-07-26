import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

import {
  FOUNDATION_PERFORMANCE_BUDGETS_MS,
  FOUNDATION_QUALIFICATION_PROFILE,
  FOUNDATION_QUALIFICATION_VIEWPORTS,
  createFoundationQualificationFixture,
  p95
} from "../test/helpers/foundation-qualification.js";
import { packAndInstallFumori } from "../test/helpers/packed-fumori.js";
import {
  runGit,
  stopChildProcess
} from "../test/helpers/subprocess.js";
import { waitForFumoriServer } from "../test/helpers/wait-for-fumori-server.js";

const execFileAsync = promisify(execFile);

type HumanNote = {
  id: string;
  title: string;
  canonicalPath: string;
  revision: string;
  sourceMarkdown: string;
};

type PerformanceEvidence = {
  coldStartup: number;
  searchP95: number;
  projectedReadP95: number;
  canonicalSaveP95: number;
  dirtyCheckpoint: number;
  routeTransitionP95: number;
};

let packedRoot: string;
let fumori: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  packedRoot = await mkdtemp(join(tmpdir(), "fumori-qualification-packed-"));
  ({ executable: fumori } = await packAndInstallFumori(packedRoot));
});

test.afterAll(async () => {
  await rm(packedRoot, { recursive: true, force: true });
});

function startPackedServer(vault: string): ChildProcess {
  return spawn(fumori, ["serve", "--vault", vault, "--port", "0"], {
    cwd: packedRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function responseDuration(
  input: string,
  init?: RequestInit
): Promise<{ duration: number; response: Response }> {
  const started = performance.now();
  const response = await fetch(input, init);
  await response.clone().arrayBuffer();
  return { duration: performance.now() - started, response };
}

function expectWithinBudget(
  name: keyof PerformanceEvidence,
  value: number
): void {
  const budget = {
    coldStartup: FOUNDATION_PERFORMANCE_BUDGETS_MS.coldStartup,
    searchP95: FOUNDATION_PERFORMANCE_BUDGETS_MS.searchP95,
    projectedReadP95: FOUNDATION_PERFORMANCE_BUDGETS_MS.projectedReadP95,
    canonicalSaveP95: FOUNDATION_PERFORMANCE_BUDGETS_MS.canonicalSaveP95,
    dirtyCheckpoint: FOUNDATION_PERFORMANCE_BUDGETS_MS.dirtyCheckpoint,
    routeTransitionP95:
      FOUNDATION_PERFORMANCE_BUDGETS_MS.routeTransitionP95
  }[name];
  expect(value, `${name} ${value.toFixed(1)}ms exceeds ${budget}ms`).toBeLessThanOrEqual(
    budget
  );
}

async function measureRouteTransitions(
  page: Page,
  baseUrl: string
): Promise<number> {
  const destinations = [
    { name: "Notes", path: "/notes" },
    { name: "Inbox", path: "/inbox" },
    { name: "Types", path: "/types" },
    { name: "Views", path: "/views" },
    { name: "Archive", path: "/archive" },
    { name: "Today", path: "/today" },
    { name: "Notes", path: "/notes" },
    { name: "Types", path: "/types" },
    { name: "Views", path: "/views" },
    { name: "Today", path: "/today" },
    { name: "Inbox", path: "/inbox" },
    { name: "Archive", path: "/archive" },
    { name: "Notes", path: "/notes" },
    { name: "Views", path: "/views" },
    { name: "Types", path: "/types" },
    { name: "Today", path: "/today" },
    { name: "Archive", path: "/archive" },
    { name: "Inbox", path: "/inbox" },
    { name: "Notes", path: "/notes" },
    { name: "Today", path: "/today" }
  ] as const;
  const samples: number[] = [];

  for (const destination of destinations) {
    const started = performance.now();
    await Promise.all([
      page.waitForURL(`${baseUrl}${destination.path}`),
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: destination.name, exact: true })
        .click()
    ]);
    await expect(page.locator("[data-app-ready='true']")).toBeVisible();
    const readyOutcome = {
      "/notes": page.getByRole("link", {
        name: /^Qualification Note 0001\b/
      }),
      "/inbox": page.getByRole("link", {
        name: /^Qualification Note 0000\b/
      }),
      "/types": page.getByRole("link", { name: /^Project\b/ }),
      "/views": page.getByRole("link", { name: /^Active projects\b/ }),
      "/archive": page.getByRole("link", {
        name: /^Qualification Note 0002\b/
      }),
      "/today": page.getByRole("heading", { name: "Today", level: 1 })
    }[destination.path];
    await expect(readyOutcome).toBeVisible();
    samples.push(performance.now() - started);
  }
  return p95(samples);
}

for (const viewport of FOUNDATION_QUALIFICATION_VIEWPORTS) {
  test(`the packed Foundation release qualifies at ${viewport.width}x${viewport.height}`, async ({
    browser
  }, testInfo) => {
    test.setTimeout(300_000);
    const viewportRoot = await mkdtemp(
      join(tmpdir(), `fumori-qualification-${viewport.width}-`)
    );
    const vault = join(viewportRoot, "vault");
    let server: ChildProcess | undefined;

    try {
      await execFileAsync("git", ["init", "--quiet", vault]);
      await execFileAsync(fumori, ["vault", "bootstrap", "--path", vault], {
        cwd: viewportRoot
      });
      const fixture = await createFoundationQualificationFixture(vault);
      expect(fixture).toMatchObject(FOUNDATION_QUALIFICATION_PROFILE);
      expect(await runGit(vault, "status", "--porcelain")).toBe("");
      expect(await runGit(vault, "fsck", "--strict")).toBe("");

      const startupStarted = performance.now();
      server = startPackedServer(vault);
      let url = await waitForFumoriServer(server, {
        label: `Packed ${viewport.width} qualification server`,
        timeoutMs: FOUNDATION_PERFORMANCE_BUDGETS_MS.coldStartup
      });
      const coldStartup = performance.now() - startupStarted;
      expectWithinBudget("coldStartup", coldStartup);

      for (let index = 0; index < 5; index += 1) {
        await fetch(
          `${url}/api/v1/search?q=qualification-${String(index).padStart(4, "0")}`
        ).then((response) => response.arrayBuffer());
        await fetch(
          `${url}/api/v1/notes/${fixture.representativeNoteId}`
        ).then((response) => response.arrayBuffer());
      }

      const searchSamples: number[] = [];
      const readSamples: number[] = [];
      for (let index = 0; index < 40; index += 1) {
        const queryIndex = (index * 23) % fixture.humanNotes;
        const search = await responseDuration(
          `${url}/api/v1/search?q=qualification-${String(queryIndex).padStart(4, "0")}`
        );
        expect(search.response.status).toBe(200);
        searchSamples.push(search.duration);

        const read = await responseDuration(
          `${url}/api/v1/notes/${fixture.representativeNoteId}`
        );
        expect(read.response.status).toBe(200);
        readSamples.push(read.duration);
      }
      const searchP95 = p95(searchSamples);
      const projectedReadP95 = p95(readSamples);
      expectWithinBudget("searchP95", searchP95);
      expectWithinBudget("projectedReadP95", projectedReadP95);

      let saveNote = (await (
        await fetch(`${url}/api/v1/notes/00000000-0000-4000-8000-000000000900`)
      ).json()) as HumanNote;
      const saveSamples: number[] = [];
      for (let index = 0; index < 40; index += 1) {
        const sourceMarkdown = `${saveNote.sourceMarkdown.trimEnd()}\n\nBounded save sample ${index}.\n`;
        const save = await responseDuration(
          `${url}/api/v1/notes/${saveNote.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              format: "raw",
              baseRevision: saveNote.revision,
              sourceMarkdown
            })
          }
        );
        expect(save.response.status).toBe(200);
        saveNote = (await save.response.json()) as HumanNote;
        saveSamples.push(save.duration);
      }
      const canonicalSaveP95 = p95(saveSamples);
      expectWithinBudget("canonicalSaveP95", canonicalSaveP95);

      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(url);
      await expect(page).toHaveURL(`${url}/today`);
      await expect(page.locator("[data-app-ready='true']")).toBeVisible();
      await expect(page.locator("[data-zone]")).toHaveCount(3);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);

      const routeTransitionP95 = await measureRouteTransitions(page, url);
      expectWithinBudget("routeTransitionP95", routeTransitionP95);

      await page.goto(`${url}/today`);
      await page.getByRole("button", { name: "Raw Markdown" }).click();
      const todayRaw = page.getByRole("textbox", {
        name: "Raw Markdown editor"
      });
      const todaySource = await todayRaw.inputValue();
      await todayRaw.fill(
        `${todaySource.trimEnd()}\n\nQualified in Raw Markdown at ${viewport.width}.\n`
      );
      await page.keyboard.press("Control+s");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Rich editor" }).click();
      const todayRich = page
        .getByTestId("rich-editor")
        .locator("[contenteditable='true']");
      await todayRich.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type(`Qualified in rich editing at ${viewport.width}.`);
      await page.keyboard.press("Control+s");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      const today = (await (
        await fetch(`${url}/api/v1/today`)
      ).json()) as { date: string };
      const todayPath = join(vault, "human", "daily", `${today.date}.md`);
      await expect
        .poll(() => readFile(todayPath, "utf8"))
        .toContain(`Qualified in Raw Markdown at ${viewport.width}.`);
      await expect
        .poll(() => readFile(todayPath, "utf8"))
        .toContain(`Qualified in rich editing at ${viewport.width}.`);

      await page.goto(`${url}/types/project`);
      await expect(
        page.getByRole("heading", { name: "Project", level: 1 })
      ).toBeVisible();
      await page.getByRole("button", { name: "New Project" }).click();
      await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
      await page.getByRole("button", { name: "Inspector" }).click();
      const inspector = page.getByRole("form", {
        name: "Document inspector"
      });
      await expect(inspector.getByLabel("Type")).toHaveValue("project");
      await expect(inspector.getByLabel("Priority")).toHaveValue("medium");
      await inspector.getByLabel("Priority").selectOption("high");
      await inspector
        .getByLabel("Tags")
        .fill(`qualification, viewport-${viewport.width}`);
      await page.getByRole("button", { name: "Raw Markdown" }).click();
      const capturedRaw = page.getByRole("textbox", {
        name: "Raw Markdown editor"
      });
      const capturedSource = await capturedRaw.inputValue();
      const capturedEnvelope = capturedSource.match(
        /^---\n[\s\S]*?\n---\n/
      )?.[0];
      expect(capturedEnvelope).toBeTruthy();
      await capturedRaw.fill(
        `${capturedEnvelope}\n# Qualification Journey ${viewport.width}\n\nStandalone capture survives. Follow [[Qualification Note 0037]].\n`
      );
      await page.keyboard.press("Control+s");
      const capturedApiUrl = page.url().replace(url, `${url}/api/v1`);
      let captured = {} as HumanNote;
      await expect
        .poll(async () => {
          captured = (await (await fetch(capturedApiUrl)).json()) as HumanNote;
          return captured.title;
        })
        .toBe(`Qualification Journey ${viewport.width}`);
      expect(await readFile(join(vault, captured.canonicalPath), "utf8")).toContain(
        'priority: "high"'
      );
      expect(await readFile(join(vault, captured.canonicalPath), "utf8")).toContain(
        "[[Qualification Note 0037]]"
      );

      await capturedRaw.fill(
        captured.sourceMarkdown.replace(
          `# Qualification Journey ${viewport.width}`,
          `# Renamed Qualification Journey ${viewport.width}`
        )
      );
      await page.keyboard.press("Control+s");
      await expect
        .poll(async () => {
          captured = (await (await fetch(capturedApiUrl)).json()) as HumanNote;
          return captured.title;
        })
        .toBe(`Renamed Qualification Journey ${viewport.width}`);
      await page.getByRole("button", { name: "Rename file to title" }).click();
      const renamedPath =
        `human/notes/renamed-qualification-journey-${viewport.width}.md`;
      await expect
        .poll(async () => {
          captured = (await (
            await fetch(`${url}/api/v1/notes/${captured.id}`)
          ).json()) as HumanNote;
          return captured.canonicalPath;
        })
        .toBe(renamedPath);
      expect(captured.canonicalPath).toBe(
        renamedPath
      );
      expect(await readFile(join(vault, captured.canonicalPath), "utf8")).toContain(
        `# Renamed Qualification Journey ${viewport.width}`
      );

      await page.keyboard.press("Control+k");
      const searchBox = page.getByRole("searchbox", { name: "Search notes" });
      await searchBox.fill(`qualification-${String(37).padStart(4, "0")}`);
      await expect(
        page.getByRole("link", { name: "Qualification Note 0037" })
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Qualification Note 0037" })
        .click();
      await expect(page).toHaveURL(
        `${url}/notes/00000000-0000-4000-8000-000000000037`
      );
      await page.getByRole("button", { name: "Inspector" }).click();
      const linksInspector = page.getByRole("form", {
        name: "Document inspector"
      });
      await expect(linksInspector).toContainText("Qualification Note 0038");
      await expect(linksInspector).toContainText("Missing Qualification Target 0037");
      await expect(linksInspector).toContainText("unresolved");
      await expect(linksInspector).toContainText(
        `Renamed Qualification Journey ${viewport.width}`
      );

      const firstTab = await context.newPage();
      const secondTab = await context.newPage();
      const conflictUrl = `${url}/notes/00000000-0000-4000-8000-000000000901`;
      await Promise.all([firstTab.goto(conflictUrl), secondTab.goto(conflictUrl)]);
      const openRaw = async (tab: Page) => {
        await tab.getByRole("button", { name: "Raw Markdown" }).click();
        return tab.getByRole("textbox", { name: "Raw Markdown editor" });
      };
      const [firstRaw, secondRaw] = await Promise.all([
        openRaw(firstTab),
        openRaw(secondTab)
      ]);
      const sharedSource = await firstRaw.inputValue();
      const acceptedSource = `${sharedSource.trimEnd()}\n\nAccepted tab ${viewport.width}.\n`;
      await firstRaw.fill(acceptedSource);
      await firstTab.keyboard.press("Control+s");
      await expect(firstTab.getByText("Saved", { exact: true })).toBeVisible();
      const staleDraft = `${sharedSource.trimEnd()}\n\nStale draft ${viewport.width}.\n`;
      await secondRaw.fill(staleDraft);
      await secondTab.keyboard.press("Control+s");
      const conflict = secondTab.getByRole("dialog", {
        name: "Resolve newer content"
      });
      await expect(conflict).toBeVisible();
      await expect(secondRaw).toHaveValue(staleDraft);
      await conflict
        .getByRole("button", { name: "Use current saved content" })
        .click();
      await expect(secondRaw).toHaveValue(acceptedSource);
      await Promise.all([firstTab.close(), secondTab.close()]);

      await page.goto(`${url}/notes/${captured.id}`);
      await page.getByRole("button", { name: "Archive note" }).click();
      await expect(page).toHaveURL(`${url}/archive`);
      expect(await readFile(join(vault, captured.canonicalPath), "utf8")).toContain(
        "state: archived"
      );
      await page.getByRole("link", {
        name: `Renamed Qualification Journey ${viewport.width}`
      }).click();
      await page.getByRole("button", { name: "Unarchive note" }).click();
      await expect(page).toHaveURL(`${url}/notes`);
      await page.getByRole("link", {
        name: `Renamed Qualification Journey ${viewport.width}`
      }).click();
      await page.getByRole("button", { name: "Delete note" }).click();
      await page
        .getByRole("dialog", {
          name: `Delete Renamed Qualification Journey ${viewport.width}?`
        })
        .getByRole("button", { name: "Delete permanently" })
        .click();
      await expect(page).toHaveURL(`${url}/notes`);
      await expect
        .poll(() =>
          readFile(join(vault, captured.canonicalPath), "utf8").then(
            () => false,
            (error: NodeJS.ErrnoException) => error.code === "ENOENT"
          )
        )
        .toBe(true);

      await page.goto(`${url}/views/active-projects`);
      await expect(
        page.getByRole("heading", { name: "Active projects", level: 1 })
      ).toBeVisible();
      await expect(page.locator("table")).toBeVisible();
      await expect(page.locator("th")).toHaveText([
        "title",
        "priority",
        "state"
      ]);

      const checkpointStarted = performance.now();
      const checkpointResponse = await fetch(`${url}/api/v1/checkpoint`, {
        method: "POST"
      });
      const checkpoint = (await checkpointResponse.json()) as {
        created: boolean;
        sha: string;
      };
      const dirtyCheckpoint = performance.now() - checkpointStarted;
      expect(checkpointResponse.status).toBe(200);
      expectWithinBudget("dirtyCheckpoint", dirtyCheckpoint);
      expect(checkpoint.created).toBe(true);
      expect((await runGit(vault, "rev-parse", "HEAD")).trim()).toBe(
        checkpoint.sha
      );
      expect(await runGit(vault, "status", "--porcelain")).toBe("");

      const performanceEvidence: PerformanceEvidence = {
        coldStartup,
        searchP95,
        projectedReadP95,
        canonicalSaveP95,
        dirtyCheckpoint,
        routeTransitionP95
      };
      await testInfo.attach(`performance-${viewport.width}x${viewport.height}`, {
        body: Buffer.from(JSON.stringify(performanceEvidence, null, 2)),
        contentType: "application/json"
      });
      console.log(
        `QUALIFICATION_PERFORMANCE ${viewport.width}x${viewport.height} ${JSON.stringify(performanceEvidence)}`
      );

      await stopChildProcess(server);
      server = undefined;
      server = startPackedServer(vault);
      url = await waitForFumoriServer(server, {
        label: `Restarted ${viewport.width} qualification server`
      });
      await page.goto(
        `${url}/notes/${fixture.representativeNoteId}`
      );
      await expect(
        page.locator(".document-zone > .document > h1")
      ).toHaveText("Qualification Note 0000");

      await stopChildProcess(server);
      server = undefined;
      const offlinePath = join(
        vault,
        "human",
        "notes",
        "qualification-note-0000.md"
      );
      await writeFile(
        offlinePath,
        (await readFile(offlinePath, "utf8"))
          .replace("aliases: [Q0000]", "aliases: [Q0000]\noffline_key: preserved")
          .replace(
            "Deterministic marker qualification-0000.",
            `Deterministic marker qualification-0000.\n\nOffline edit ${viewport.width}.`
          ),
        "utf8"
      );
      server = startPackedServer(vault);
      url = await waitForFumoriServer(server, {
        label: `Offline-rebuild ${viewport.width} qualification server`
      });
      await page.goto(`${url}/search`);
      await page
        .getByRole("searchbox", { name: "Search notes" })
        .fill(`Offline edit ${viewport.width}`);
      await expect(
        page.getByRole("link", { name: "Qualification Note 0000" })
      ).toBeVisible();
      expect(
        (await runGit(vault, "show", "-s", "--format=%s", "HEAD")).trim()
      ).toBe("Recovery checkpoint");

      const crashNoteResponse = await fetch(
        `${url}/api/v1/notes/00000000-0000-4000-8000-000000000902`
      );
      const crashNote = (await crashNoteResponse.json()) as HumanNote;
      const crashMarker = `Crash recovery ${viewport.width}.`;
      const crashSave = await fetch(`${url}/api/v1/notes/${crashNote.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "raw",
          baseRevision: crashNote.revision,
          sourceMarkdown: `${crashNote.sourceMarkdown.trimEnd()}\n\n${crashMarker}\n`
        })
      });
      expect(crashSave.status).toBe(200);
      const headBeforeCrash = (await runGit(vault, "rev-parse", "HEAD")).trim();
      expect(await runGit(vault, "status", "--porcelain")).not.toBe("");
      await stopChildProcess(server, "SIGKILL");
      server = undefined;
      server = startPackedServer(vault);
      url = await waitForFumoriServer(server, {
        label: `Crash-recovery ${viewport.width} qualification server`
      });
      expect((await runGit(vault, "rev-parse", "HEAD")).trim()).not.toBe(
        headBeforeCrash
      );
      expect(
        (await runGit(vault, "show", "-s", "--format=%s", "HEAD")).trim()
      ).toBe("Recovery checkpoint");
      expect(await runGit(vault, "status", "--porcelain")).toBe("");
      await page.goto(`${url}/notes/${crashNote.id}`);
      await expect(page.getByText(crashMarker, { exact: true })).toBeVisible();
      await context.close();
    } finally {
      if (server) {
        await stopChildProcess(server);
      }
      await rm(viewportRoot, { recursive: true, force: true });
    }
  });
}

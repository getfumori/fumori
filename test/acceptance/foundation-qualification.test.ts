import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import {
  FOUNDATION_PERFORMANCE_BUDGETS_MS,
  FOUNDATION_QUALIFICATION_PROFILE,
  FOUNDATION_QUALIFICATION_VIEWPORTS,
  createFoundationQualificationFixture,
  p95
} from "../helpers/foundation-qualification.js";
import { runGit } from "../helpers/subprocess.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function makeVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), "fumori-qualification-unit-"));
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      })
    )
  );
});

describe("Foundation qualification fixture", () => {
  test("builds the fixed release workload as a reproducible real Git tree", async () => {
    const [firstVault, secondVault] = await Promise.all([
      makeVault(),
      makeVault()
    ]);

    const [first, second] = await Promise.all([
      createFoundationQualificationFixture(firstVault),
      createFoundationQualificationFixture(secondVault)
    ]);

    expect(first).toEqual({
      ...FOUNDATION_QUALIFICATION_PROFILE,
      markdownBytes: second.markdownBytes,
      fixtureDigest: second.fixtureDigest,
      representativeNoteId: "00000000-0000-4000-8000-000000000000",
      representativeDailyDate: "2025-12-31"
    });
    expect(first.fixtureDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.markdownBytes).toBeLessThanOrEqual(
      FOUNDATION_QUALIFICATION_PROFILE.maximumMarkdownBytes
    );
    expect(await runGit(firstVault, "status", "--porcelain")).toBe("");
    expect(await runGit(firstVault, "fsck", "--strict")).toBe("");
    expect(
      (await runGit(firstVault, "show", "-s", "--format=%s", "HEAD")).trim()
    ).toBe("Install Foundation qualification fixture");
    const representativeSources = await Promise.all(
      [0, 1, 2].map((index) =>
        readFile(
          join(
            firstVault,
            "human",
            "notes",
            `qualification-note-${String(index).padStart(4, "0")}.md`
          ),
          "utf8"
        )
      )
    );
    expect(representativeSources[0]).toContain("type: project");
    expect(representativeSources[0]).toContain("state: captured");
    expect(representativeSources[0]).toContain("related_to: \"[[");
    expect(representativeSources[0]).toContain(
      "[[Missing Qualification Target 0000]]"
    );
    expect(representativeSources[1]).toContain("type: note");
    expect(representativeSources[1]).toContain("state: organized");
    expect(representativeSources[2]).toContain("state: archived");
    expect(representativeSources[2]).toContain(
      "tags: [qualification, cohort-2]"
    );
  });

  test("keeps the accepted release gates literal", () => {
    expect(FOUNDATION_QUALIFICATION_PROFILE).toEqual({
      humanNotes: 1_000,
      dailyNotes: 365,
      connections: 5_000,
      maximumMarkdownBytes: 25 * 1024 * 1024
    });
    expect(FOUNDATION_PERFORMANCE_BUDGETS_MS).toEqual({
      coldStartup: 5_000,
      searchP95: 200,
      projectedReadP95: 100,
      canonicalSaveP95: 500,
      dirtyCheckpoint: 3_000,
      routeTransitionP95: 300
    });
    expect(FOUNDATION_QUALIFICATION_VIEWPORTS).toEqual([
      { width: 1280, height: 720 },
      { width: 1440, height: 900 }
    ]);
    expect(p95(Array.from({ length: 20 }, (_, index) => index + 1))).toBe(19);
  });
});

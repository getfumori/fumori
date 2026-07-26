import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function makeGitRepository(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "fumori-bootstrap-"));
  temporaryDirectories.push(path);
  await execFileAsync("git", ["init", "--quiet", path]);
  return path;
}

async function runFumori(...arguments_: string[]) {
  return execFileAsync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", ...arguments_],
    { cwd: process.cwd() }
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    })
  );
});

describe("fumori vault bootstrap", () => {
  test("turns an operator-created empty Git repository into a Blank Vault", async () => {
    const repository = await makeGitRepository();

    const result = await runFumori("vault", "bootstrap", "--path", repository);

    expect(result.stdout).toContain("Bootstrapped Blank Vault");
    expect(
      await readFile(join(repository, ".second-brain/vault.md"), "utf8")
    ).toMatch(
      /^---\n_id: [0-9a-f-]+\n_schema: fumori\.vault\n_version: 1\n_created: .+\nname: .+\n---\n\n# Vault\n$/
    );
    expect(
      await readdir(join(repository, ".second-brain/model"), {
        recursive: true
      })
    ).toEqual(
      expect.arrayContaining([
        "core-properties.md",
        "lifecycle.md",
        "types/daily-note.md",
        "types/note.md",
        "views/inbox.md"
      ])
    );
    expect(
      await readFile(
        join(repository, ".second-brain/model/lifecycle.md"),
        "utf8"
      )
    ).toContain(
      "states:\n  - captured\n  - organized\n  - archived\narchived_state: archived"
    );
    expect(
      await readFile(
        join(repository, ".second-brain/model/views/inbox.md"),
        "utf8"
      )
    ).toContain("kind: standalone\nstate: captured");
    expect(
      await Promise.all(
        ["assets", "human/daily", "human/notes", "knowledge", "sources/files", "sources/records"].map(
          async (path) => readFile(join(repository, path, ".gitkeep"), "utf8")
        )
      )
    ).toEqual(["", "", "", "", "", ""]);

    const { stdout: commits } = await execFileAsync(
      "git",
      ["-C", repository, "rev-list", "--count", "HEAD"]
    );
    const { stdout: status } = await execFileAsync("git", [
      "-C",
      repository,
      "status",
      "--porcelain"
    ]);
    expect(commits.trim()).toBe("1");
    expect(status).toBe("");
  });

  test("rejects a non-empty repository without changing it", async () => {
    const repository = await makeGitRepository();
    await writeFile(join(repository, "keep.md"), "keep me\n", "utf8");

    await expect(
      runFumori("vault", "bootstrap", "--path", repository)
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("must be empty")
    });

    expect(await readFile(join(repository, "keep.md"), "utf8")).toBe("keep me\n");
    expect(await readdir(repository)).not.toContain(".second-brain");
  });

  test("rejects an incompatible target without changing it", async () => {
    const target = await mkdtemp(join(tmpdir(), "fumori-not-git-"));
    temporaryDirectories.push(target);

    await expect(
      runFumori("vault", "bootstrap", "--path", target)
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("is not a Git repository")
    });

    expect(await readdir(target)).toEqual([]);
  });

  test("rejects history retained outside the unborn HEAD without changing it", async () => {
    const repository = await makeGitRepository();
    await execFileAsync(
      "git",
      [
        "-C",
        repository,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "--quiet",
        "--allow-empty",
        "--message",
        "Existing history"
      ]
    );
    await execFileAsync("git", [
      "-C",
      repository,
      "symbolic-ref",
      "HEAD",
      "refs/heads/blank"
    ]);
    const { stdout: refsBefore } = await execFileAsync("git", [
      "-C",
      repository,
      "show-ref"
    ]);

    await expect(
      runFumori("vault", "bootstrap", "--path", repository)
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("existing Git history")
    });

    const { stdout: refsAfter } = await execFileAsync("git", [
      "-C",
      repository,
      "show-ref"
    ]);
    expect(refsAfter).toBe(refsBefore);
    expect((await readdir(repository)).filter((entry) => entry !== ".git")).toEqual(
      []
    );
  });

  test("creates its system commit without signing or repository hooks", async () => {
    const repository = await makeGitRepository();
    const hookMarker = join(repository, ".git", "hook-ran");
    const hook = join(repository, ".git", "hooks", "pre-commit");
    await writeFile(
      hook,
      `#!/bin/sh\ntouch ${JSON.stringify(hookMarker)}\nexit 1\n`,
      "utf8"
    );
    await chmod(hook, 0o755);
    await execFileAsync("git", [
      "-C",
      repository,
      "config",
      "commit.gpgSign",
      "true"
    ]);
    await execFileAsync("git", [
      "-C",
      repository,
      "config",
      "gpg.program",
      "/bin/false"
    ]);

    await expect(
      runFumori("vault", "bootstrap", "--path", repository)
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Bootstrapped Blank Vault")
    });

    await expect(readFile(hookMarker, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    const { stdout: commits } = await execFileAsync("git", [
      "-C",
      repository,
      "rev-list",
      "--count",
      "HEAD"
    ]);
    expect(commits.trim()).toBe("1");
  });
});

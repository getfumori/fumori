import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { packAndInstallFumori } from "../helpers/packed-fumori.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("the npm distribution", () => {
  test("installs the supported runtime without source-checkout files", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "fumori-package-"));
    temporaryDirectories.push(temporaryRoot);
    const {
      manifestPath,
      packagedPaths,
      readmePath
    } = await packAndInstallFumori(temporaryRoot);
    expect(packagedPaths).toContain("dist/cli.js");
    expect(packagedPaths).toContain("dist/server/server.js");
    expect(packagedPaths).toContain("dist/web/index.html");
    expect(
      packagedPaths.some((path) => /^dist\/web\/assets\/.+\.js$/.test(path))
    ).toBe(true);
    expect(packagedPaths.some((path) => path.startsWith("src/"))).toBe(false);

    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as {
      bin?: Record<string, string>;
      engines?: Record<string, string>;
    };
    expect(manifest.bin).toEqual({ fumori: "dist/cli.js" });
    expect(manifest.engines).toEqual({ node: ">=24 <25" });
    const readme = await readFile(readmePath, "utf8");
    expect(readme).toContain(
      "The Foundation npm runtime supports Node.js 24 on Linux x64 and arm64."
    );
    expect(readme).toContain(
      "macOS\narm64 is supported for development, local use, and package smoke testing."
    );
  }, 30_000);
});

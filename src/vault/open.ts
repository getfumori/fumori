import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseDocument } from "yaml";
import { z } from "zod";

import { hardenedGit } from "./repository-coordinator.js";
import { validateVaultWorktree } from "./validate-worktree.js";

const manifestSchema = z.object({
  _id: z.uuid(),
  _schema: z.literal("fumori.vault"),
  _version: z.literal(1),
  _created: z.iso.datetime({ offset: true }),
  name: z.string().min(1)
});

export type OpenVault = {
  id: string;
  name: string;
  path: string;
};

async function validateGitIndex(path: string): Promise<void> {
  const gitDirectory = (
    await hardenedGit(path, ["rev-parse", "--absolute-git-dir"])
  ).stdout.trim();
  const expectedGitDirectory = await realpath(join(path, ".git"));
  if ((await realpath(gitDirectory)) !== expectedGitDirectory) {
    throw new Error(
      `Vault Git metadata escapes the Vault root: ${gitDirectory}`
    );
  }
  const stagedEntries = (
    await hardenedGit(path, ["ls-files", "--stage", "-z"])
  ).stdout.split("\0");
  for (const entry of stagedEntries) {
    if (!entry) {
      continue;
    }
    const separator = entry.indexOf("\t");
    const [mode, _objectId, stage] = entry
      .slice(0, separator)
      .split(" ");
    const canonicalPath = entry.slice(separator + 1);
    if (mode === "160000") {
      throw new Error(
        `Vault contains an unsafe Git submodule path: ${canonicalPath}`
      );
    }
    if (stage !== "0") {
      throw new Error(
        `Vault Git index has an unmerged canonical path: ${canonicalPath}`
      );
    }
  }
  const flaggedEntries = (
    await hardenedGit(path, ["ls-files", "-v", "-z"])
  ).stdout.split("\0");
  for (const entry of flaggedEntries) {
    if (/^[a-zS] /.test(entry)) {
      throw new Error(
        `Vault Git index hides a canonical path from complete scanning: ${entry.slice(2)}`
      );
    }
  }
  for (const operationPath of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
    "index.lock"
  ]) {
    if (await lstat(join(gitDirectory, operationPath)).catch(() => undefined)) {
      throw new Error(
        `Vault Git repository has an in-progress operation: ${operationPath}`
      );
    }
  }
}

export async function openVault(inputPath: string): Promise<OpenVault> {
  const path = await realpath(resolve(inputPath)).catch(() => {
    throw new Error(`Vault path does not exist: ${inputPath}`);
  });
  await validateVaultWorktree(path);
  const { stdout: topLevelOutput } = await hardenedGit(path, [
    "rev-parse",
    "--show-toplevel"
  ]).catch(() => {
    throw new Error(`Vault path is not a Git repository: ${path}`);
  });
  const topLevel = await realpath(topLevelOutput.trim());
  if (topLevel !== path) {
    throw new Error(`Vault path must be the repository root: ${path}`);
  }
  await validateGitIndex(path);

  const source = await readFile(join(path, ".second-brain/vault.md"), "utf8").catch(
    () => {
      throw new Error(`Vault Manifest is missing: ${path}`);
    }
  );
  const frontmatterEnd = source.indexOf("\n---\n", "---\n".length);
  if (!source.startsWith("---\n") || frontmatterEnd < 0) {
    throw new Error(
      `Vault Manifest has invalid frontmatter: .second-brain/vault.md`
    );
  }
  const document = parseDocument(
    source.slice("---\n".length, frontmatterEnd),
    { uniqueKeys: true }
  );
  if (document.errors.length > 0) {
    throw new Error(
      `Vault Manifest has invalid frontmatter: .second-brain/vault.md: ${document.errors[0]!.message}`
    );
  }
  const manifest = manifestSchema.safeParse(document.toJS());
  if (!manifest.success) {
    const diagnostic = manifest.error.issues[0];
    throw new Error(
      `Vault Manifest is invalid at .second-brain/vault.md${
        diagnostic
          ? ` (${diagnostic.path.join(".") || "frontmatter"}): ${diagnostic.message}`
          : ""
      }`
    );
  }
  return {
    id: manifest.data._id,
    name: manifest.data.name,
    path
  };
}

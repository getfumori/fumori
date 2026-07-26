import { lstat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const DIRECT_FILE_DIRECTORIES = new Set([
  "human/daily",
  "human/notes",
  ".second-brain/model/types",
  ".second-brain/model/views",
  ".second-brain/model/relationships"
]);

function displayPath(vaultPath: string, path: string): string {
  return relative(vaultPath, path).replaceAll("\\", "/") || ".";
}

export async function validateVaultWorktree(vaultPath: string): Promise<void> {
  const gitPath = join(vaultPath, ".git");
  const gitEntry = await lstat(gitPath).catch(() => undefined);
  if (!gitEntry?.isDirectory()) {
    throw new Error(
      `Vault Git metadata must be a directory inside the Vault: ${gitPath}`
    );
  }

  async function scan(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const canonicalPath = displayPath(vaultPath, path);
      if (canonicalPath === ".git") {
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Vault contains an unsafe symbolic link: ${canonicalPath}`
        );
      }
      if (entry.isDirectory()) {
        if (entry.name === ".git") {
          throw new Error(
            `Vault contains nested Git metadata at unsafe path: ${canonicalPath}`
          );
        }
        const parent = displayPath(vaultPath, directory);
        if (DIRECT_FILE_DIRECTORIES.has(parent)) {
          throw new Error(
            `Canonical files must be directly contained in ${parent}: ${canonicalPath}`
          );
        }
        await scan(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `Vault contains an unsafe special file: ${canonicalPath}`
        );
      }
      if (
        canonicalPath.startsWith("human/daily/") &&
        canonicalPath.endsWith(".md") &&
        !/^human\/daily\/\d{4}-\d{2}-\d{2}\.md$/.test(canonicalPath)
      ) {
        throw new Error(
          `Daily Note has an unsafe canonical path: ${canonicalPath}`
        );
      }
    }
  }

  await scan(vaultPath);
}

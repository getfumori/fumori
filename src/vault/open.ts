import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);

const manifestSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1)
});

export type OpenVault = z.infer<typeof manifestSchema> & {
  path: string;
};

function manifestValue(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`^${key}: (.+)$`, "m"));
  return match?.[1];
}

function parseName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return value;
  }
}

export async function openVault(inputPath: string): Promise<OpenVault> {
  const path = await realpath(resolve(inputPath)).catch(() => {
    throw new Error(`Vault path does not exist: ${inputPath}`);
  });
  const { stdout: topLevelOutput } = await execFileAsync("git", [
    "-C",
    path,
    "rev-parse",
    "--show-toplevel"
  ]).catch(() => {
    throw new Error(`Vault path is not a Git repository: ${path}`);
  });
  const topLevel = await realpath(topLevelOutput.trim());
  if (topLevel !== path) {
    throw new Error(`Vault path must be the repository root: ${path}`);
  }

  const source = await readFile(join(path, ".second-brain/vault.md"), "utf8").catch(
    () => {
      throw new Error(`Vault Manifest is missing: ${path}`);
    }
  );
  if (
    manifestValue(source, "_schema") !== "fumori.vault" ||
    manifestValue(source, "_version") !== "1"
  ) {
    throw new Error(`Vault Manifest is incompatible: ${path}`);
  }

  const manifest = manifestSchema.safeParse({
    id: manifestValue(source, "_id"),
    name: parseName(manifestValue(source, "name"))
  });
  if (!manifest.success) {
    throw new Error(`Vault Manifest is invalid: ${path}`);
  }

  return { ...manifest.data, path };
}

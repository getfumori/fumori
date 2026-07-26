import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function packAndInstallFumori(
  root: string
): Promise<{
  executable: string;
  manifestPath: string;
  packagedPaths: string[];
  readmePath: string;
}> {
  const packageDirectory = join(root, "package");
  const installDirectory = join(root, "consumer");
  await Promise.all([
    mkdir(packageDirectory, { recursive: true }),
    mkdir(installDirectory, { recursive: true })
  ]);

  const { stdout } = await execFileAsync(
    "npm",
    ["--silent", "pack", "--json", "--pack-destination", packageDirectory],
    { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 }
  );
  const jsonStart = stdout.lastIndexOf("\n[\n  {");
  const packed = JSON.parse(
    stdout.slice(jsonStart >= 0 ? jsonStart + 1 : 0)
  ) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  const artifact = packed[0];
  if (!artifact) {
    throw new Error("npm pack did not produce an artifact");
  }

  await execFileAsync("npm", ["init", "--yes"], { cwd: installDirectory });
  await execFileAsync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(packageDirectory, artifact.filename)
    ],
    { cwd: installDirectory, maxBuffer: 10 * 1024 * 1024 }
  );
  const installedPackage = join(
    installDirectory,
    "node_modules",
    "fumori"
  );
  return {
    executable: join(installDirectory, "node_modules", ".bin", "fumori"),
    manifestPath: join(installedPackage, "package.json"),
    packagedPaths: artifact.files.map((file) => file.path),
    readmePath: join(installedPackage, "README.md")
  };
}

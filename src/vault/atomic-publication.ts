import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";

export async function atomicReplace(
  path: string,
  source: string
): Promise<void> {
  const temporaryPath = `${path}.fumori-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch (error) {
    await handle?.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

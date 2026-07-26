import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runGit(
  repository: string,
  ...arguments_: string[]
): Promise<string> {
  return (
    await execFileAsync("git", ["-C", repository, ...arguments_])
  ).stdout;
}

export async function stopChildProcess(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM"
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const onExit = () => resolve();
    child.once("exit", onExit);
    if (!child.kill(signal)) {
      child.off("exit", onExit);
      resolve();
    }
  });
}

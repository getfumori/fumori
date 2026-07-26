import type { ChildProcess } from "node:child_process";

export function waitForFumoriServer(
  child: ChildProcess,
  options: { label?: string; timeoutMs?: number } = {}
): Promise<string> {
  const label = options.label ?? "Fumori server";
  let stderr = "";
  let stdout = "";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} did not start. ${stderr}`));
    }, options.timeoutMs ?? 10_000);

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`${label} exited with code ${code}. ${stderr}`));
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const match = stdout.match(/Fumori is listening at (http:\/\/\S+)/);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
}

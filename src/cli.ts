#!/usr/bin/env node

import { parseArgs } from "node:util";

import { z } from "zod";

import { startServer } from "./server/server.js";
import { bootstrapVault } from "./vault/bootstrap.js";

const HELP = `Usage:
  fumori vault bootstrap --path <repository>
  fumori serve --vault <repository> [--host <host>] [--port <port>]
    [--autosave-debounce-ms <milliseconds>]
    [--autosave-max-dirty-ms <milliseconds>]
`;

const bootstrapSchema = z.object({
  path: z.string().min(1)
});

const serveSchema = z.object({
  vault: z.string().min(1),
  host: z.string().min(1).default("127.0.0.1"),
  port: z.coerce.number().int().min(0).max(65_535).default(3000),
  autosaveDebounceMs: z.coerce.number().int().positive().default(1_500),
  autosaveMaxDirtyMs: z.coerce.number().int().positive().default(10_000)
});

function bootstrapArguments(arguments_: string[]) {
  const parsed = parseArgs({
    args: arguments_,
    options: {
      path: { type: "string" }
    },
    allowPositionals: false,
    strict: true
  });
  return bootstrapSchema.parse({ path: parsed.values.path });
}

function serveArguments(arguments_: string[]) {
  const parsed = parseArgs({
    args: arguments_,
    options: {
      vault: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      "autosave-debounce-ms": { type: "string" },
      "autosave-max-dirty-ms": { type: "string" }
    },
    allowPositionals: false,
    strict: true
  });
  return serveSchema.parse({
    vault: parsed.values.vault,
    host: parsed.values.host,
    port: parsed.values.port,
    autosaveDebounceMs: parsed.values["autosave-debounce-ms"],
    autosaveMaxDirtyMs: parsed.values["autosave-max-dirty-ms"]
  });
}

async function main(arguments_: string[]): Promise<void> {
  const [command, subcommand, ...rest] = arguments_;

  if (command === "vault" && subcommand === "bootstrap") {
    const options = bootstrapArguments(rest);
    const result = await bootstrapVault(options);
    process.stdout.write(`Bootstrapped Blank Vault at ${result.path}\n`);
    return;
  }

  if (command === "serve") {
    const options = serveArguments(
      subcommand === undefined ? rest : [subcommand, ...rest]
    );
    const server = await startServer(options, ({ url }) => {
      process.stdout.write(`Fumori is listening at ${url}\n`);
    });
    const shutdown = () => {
      server.close(() => {
        process.exitCode = 0;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  process.stderr.write(HELP);
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`fumori: ${message}\n`);
  process.exitCode = 1;
});

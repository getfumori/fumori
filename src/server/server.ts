import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { appConfigSchema } from "../contracts/app-config.js";
import {
  dailyNoteResponseSchema,
  explicitCreationRequiredResponseSchema,
  saveDailyNoteRequestSchema,
  staleDailyNoteResponseSchema
} from "../contracts/daily-note.js";
import { todayResponseSchema } from "../contracts/today.js";
import {
  DailyNotes,
  ExplicitDailyNoteCreationRequiredError,
  StaleDailyNoteRevisionError
} from "../vault/daily-notes.js";
import { openVault } from "../vault/open.js";

type ServerOptions = {
  vault: string;
  host: string;
  port: number;
  autosaveDebounceMs: number;
  autosaveMaxDirtyMs: number;
};

type ListeningInfo = {
  url: string;
};

function todayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export async function startServer(
  options: ServerOptions,
  onListening?: (info: ListeningInfo) => void
): Promise<ServerType> {
  const vault = await openVault(options.vault);
  const webRoot = fileURLToPath(new URL("../web", import.meta.url));
  const indexPath = fileURLToPath(new URL("../web/index.html", import.meta.url));
  const dailyNotes = new DailyNotes(vault.path, todayDate);
  const app = new Hono();

  app.get("/", (context) => context.redirect("/today"));
  app.get("/api/v1/config", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(
      appConfigSchema.parse({
        autosave: {
          debounceMs: options.autosaveDebounceMs,
          maxDirtyMs: options.autosaveMaxDirtyMs
        }
      })
    );
  });
  app.get("/api/v1/today", async (context) => {
    context.header("Cache-Control", "no-store");
    const dailyNote = await dailyNotes.read(todayDate());
    return context.json(
      todayResponseSchema.parse({
        ...dailyNote,
        vault: {
          id: vault.id,
          name: vault.name
        }
      })
    );
  });
  app.get("/api/v1/daily/:date", async (context) => {
    context.header("Cache-Control", "no-store");
    const dailyNote = await dailyNotes.read(context.req.param("date"));
    return context.json(
      dailyNoteResponseSchema.parse({
        ...dailyNote,
        vault: { id: vault.id, name: vault.name }
      })
    );
  });
  app.put("/api/v1/daily/:date", async (context) => {
    const input = saveDailyNoteRequestSchema.parse(await context.req.json());
    try {
      const dailyNote = await dailyNotes.save(context.req.param("date"), input);
      context.header("Cache-Control", "no-store");
      return context.json(
        dailyNoteResponseSchema.parse({
          ...dailyNote,
          vault: { id: vault.id, name: vault.name }
        })
      );
    } catch (error) {
      if (error instanceof StaleDailyNoteRevisionError) {
        context.header("Cache-Control", "no-store");
        return context.json(
          staleDailyNoteResponseSchema.parse({
            error: "stale_revision",
            currentRevision: error.currentRevision
          }),
          409
        );
      }
      if (error instanceof ExplicitDailyNoteCreationRequiredError) {
        context.header("Cache-Control", "no-store");
        return context.json(
          explicitCreationRequiredResponseSchema.parse({
            error: "explicit_creation_required"
          }),
          409
        );
      }
      throw error;
    }
  });
  app.post("/api/v1/daily/:date", async (context) => {
    const result = await dailyNotes.create(context.req.param("date"));
    context.header("Cache-Control", "no-store");
    return context.json(
      dailyNoteResponseSchema.parse({
        ...result.note,
        vault: { id: vault.id, name: vault.name }
      }),
      result.created ? 201 : 200
    );
  });
  app.get(
    "/assets/*",
    serveStatic({
      root: webRoot,
      onFound(_path, context) {
        context.header("Cache-Control", "public, max-age=31536000, immutable");
      }
    })
  );
  app.get("/today", async (context) => {
    const index = await readFile(indexPath, "utf8").catch(() => undefined);
    if (!index) {
      return context.text("Fumori Web assets are missing. Reinstall the package.", 500);
    }
    context.header("Cache-Control", "no-store");
    return context.html(index);
  });
  app.get("/daily/:date", async (context) => {
    const index = await readFile(indexPath, "utf8").catch(() => undefined);
    if (!index) {
      return context.text("Fumori Web assets are missing. Reinstall the package.", 500);
    }
    context.header("Cache-Control", "no-store");
    return context.html(index);
  });

  if (!isLoopback(options.host)) {
    process.stderr.write(
      "Warning: Fumori provides neither authentication nor TLS. Use a trusted network or authenticated gateway.\n"
    );
  }

  return serve(
    {
      fetch: app.fetch,
      hostname: options.host,
      port: options.port
    },
    (info: AddressInfo) => {
      const address = info.address.includes(":") ? `[${info.address}]` : info.address;
      onListening?.({ url: `http://${address}:${info.port}` });
    }
  );
}

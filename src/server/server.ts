import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";

import { appConfigSchema } from "../contracts/app-config.js";
import {
  dailyNoteResponseSchema,
  explicitCreationRequiredResponseSchema,
  invalidCanonicalMarkdownResponseSchema,
  saveDailyNoteRequestSchema,
  staleDailyNoteResponseSchema
} from "../contracts/daily-note.js";
import {
  createHumanNoteRequestSchema,
  humanNoteListResponseSchema,
  humanNoteResponseSchema,
  saveHumanNoteRequestSchema
} from "../contracts/human-note.js";
import {
  searchQuerySchema,
  searchResponseSchema
} from "../contracts/search.js";
import {
  organizationModelResponseSchema,
  savedViewListResponseSchema,
  savedViewResultResponseSchema,
  typeResultResponseSchema,
  typeDefinitionListResponseSchema
} from "../contracts/organization-model.js";
import { todayResponseSchema } from "../contracts/today.js";
import {
  ExplicitDailyNoteCreationRequiredError,
  HumanNoteNotFoundError,
  InvalidDailyNoteMarkdownError,
  InvalidHumanNoteMarkdownError,
  StaleDailyNoteRevisionError,
  StaleHumanNoteRevisionError
} from "../vault/vault-module.js";
import { VaultModule } from "../vault/vault-module.js";

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
  const vault = await VaultModule.open(options.vault, todayDate);
  const webRoot = fileURLToPath(new URL("../web", import.meta.url));
  const indexPath = fileURLToPath(new URL("../web/index.html", import.meta.url));
  const app = new Hono();
  const serveWebApp = async (context: Context) => {
    const index = await readFile(indexPath, "utf8").catch(() => undefined);
    if (!index) {
      return context.text(
        "Fumori Web assets are missing. Reinstall the package.",
        500
      );
    }
    context.header("Cache-Control", "no-store");
    return context.html(index);
  };

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
    const dailyNote = await vault.readDailyNote(todayDate());
    return context.json(
      todayResponseSchema.parse({
        ...dailyNote,
        vault: {
          id: vault.identity.id,
          name: vault.identity.name
        }
      })
    );
  });
  app.get("/api/v1/daily/:date", async (context) => {
    context.header("Cache-Control", "no-store");
    const dailyNote = await vault.readDailyNote(context.req.param("date"));
    return context.json(
      dailyNoteResponseSchema.parse({
        ...dailyNote,
        vault: vault.identity
      })
    );
  });
  app.put("/api/v1/daily/:date", async (context) => {
    const input = saveDailyNoteRequestSchema.parse(await context.req.json());
    try {
      const dailyNote = await vault.saveDailyNote(
        context.req.param("date"),
        input
      );
      context.header("Cache-Control", "no-store");
      return context.json(
        dailyNoteResponseSchema.parse({
          ...dailyNote,
          vault: vault.identity
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
      if (error instanceof InvalidDailyNoteMarkdownError) {
        context.header("Cache-Control", "no-store");
        return context.json(
          invalidCanonicalMarkdownResponseSchema.parse({
            error: "invalid_canonical_markdown",
            message: error.message
          }),
          422
        );
      }
      throw error;
    }
  });
  app.post("/api/v1/daily/:date", async (context) => {
    const result = await vault.createDailyNote(context.req.param("date"));
    context.header("Cache-Control", "no-store");
    return context.json(
      dailyNoteResponseSchema.parse({
        ...result.note,
        vault: vault.identity
      }),
      result.created ? 201 : 200
    );
  });
  app.get("/api/v1/notes", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(
      humanNoteListResponseSchema.parse(vault.humanNoteLists().notes)
    );
  });
  app.post("/api/v1/notes", async (context) => {
    const input = createHumanNoteRequestSchema.parse(await context.req.json());
    const note = await vault.createHumanNote(
      input.context === "type" ? input.type : undefined
    );
    context.header("Cache-Control", "no-store");
    return context.json(
      humanNoteResponseSchema.parse({
        ...note,
        vault: vault.identity
      }),
      201
    );
  });
  app.get("/api/v1/notes/:id", (context) => {
    const note = vault.humanNote(context.req.param("id"));
    if (!note) {
      return context.json({ error: "not_found" }, 404);
    }
    context.header("Cache-Control", "no-store");
    return context.json(
      humanNoteResponseSchema.parse({
        ...note,
        vault: vault.identity
      })
    );
  });
  app.put("/api/v1/notes/:id", async (context) => {
    const input = saveHumanNoteRequestSchema.parse(await context.req.json());
    try {
      const note = await vault.saveHumanNote(context.req.param("id"), input);
      context.header("Cache-Control", "no-store");
      return context.json(
        humanNoteResponseSchema.parse({
          ...note,
          vault: vault.identity
        })
      );
    } catch (error) {
      context.header("Cache-Control", "no-store");
      if (error instanceof HumanNoteNotFoundError) {
        return context.json({ error: "not_found" }, 404);
      }
      if (error instanceof StaleHumanNoteRevisionError) {
        return context.json(
          {
            error: "stale_revision",
            currentRevision: error.currentRevision
          },
          409
        );
      }
      if (error instanceof InvalidHumanNoteMarkdownError) {
        return context.json(
          {
            error: "invalid_canonical_markdown",
            message: error.message
          },
          422
        );
      }
      throw error;
    }
  });
  app.get("/api/v1/inbox", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(
      humanNoteListResponseSchema.parse(vault.humanNoteLists().inbox)
    );
  });
  app.get("/api/v1/types", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(typeDefinitionListResponseSchema.parse(vault.types()));
  });
  app.get("/api/v1/model", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(
      organizationModelResponseSchema.parse(vault.modelSummary())
    );
  });
  app.get("/api/v1/types/:key", (context) => {
    const result = vault.typeResult(context.req.param("key"));
    if (!result) {
      return context.json({ error: "not_found" }, 404);
    }
    context.header("Cache-Control", "no-store");
    return context.json(typeResultResponseSchema.parse(result));
  });
  app.get("/api/v1/views", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(savedViewListResponseSchema.parse(vault.views()));
  });
  app.get("/api/v1/views/:key", (context) => {
    const result = vault.viewResult(context.req.param("key"));
    if (!result) {
      return context.json({ error: "not_found" }, 404);
    }
    context.header("Cache-Control", "no-store");
    return context.json(savedViewResultResponseSchema.parse(result));
  });
  app.get("/api/v1/search", (context) => {
    const query = searchQuerySchema.parse(context.req.query("q"));
    context.header("Cache-Control", "no-store");
    return context.json(searchResponseSchema.parse(vault.search(query)));
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
  app.get("/today", serveWebApp);
  app.get("/daily/:date", serveWebApp);
  app.get("/notes", serveWebApp);
  app.get("/notes/:id", serveWebApp);
  app.get("/inbox", serveWebApp);
  app.get("/search", serveWebApp);
  app.get("/types", serveWebApp);
  app.get("/types/:key", serveWebApp);
  app.get("/views", serveWebApp);
  app.get("/views/:key", serveWebApp);

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

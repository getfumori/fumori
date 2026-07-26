import { z } from "zod";

import { dailyNoteDateSchema } from "./daily-note-date.js";
import { organizationModelValueSchema } from "./organization-model.js";

export const dailyNoteResponseSchema = z.object({
  date: dailyNoteDateSchema,
  exists: z.boolean(),
  revision: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  bodyMarkdown: z.string(),
  sourceMarkdown: z.string().nullable(),
  type: z.literal("daily-note"),
  state: z.string().min(1),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  properties: z.record(z.string(), organizationModelValueSchema),
  vault: z.object({
    id: z.uuid(),
    name: z.string().min(1)
  })
});

const baseRevisionSchema = z.string().regex(/^[0-9a-f]{64}$/).nullable();

export const saveDailyNoteRequestSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("rich"),
    baseRevision: baseRevisionSchema,
    bodyMarkdown: z.string()
  }),
  z.object({
    format: z.literal("raw"),
    baseRevision: baseRevisionSchema,
    sourceMarkdown: z.string()
  }),
  z.object({
    format: z.literal("document"),
    baseRevision: baseRevisionSchema,
    bodyMarkdown: z.string(),
    state: z.string().min(1),
    tags: z.array(z.string()),
    aliases: z.array(z.string()),
    properties: z.record(z.string(), organizationModelValueSchema)
  })
]);

export const staleDailyNoteResponseSchema = z.object({
  error: z.literal("stale_revision"),
  currentRevision: z.string().regex(/^[0-9a-f]{64}$/).nullable()
});

export const explicitCreationRequiredResponseSchema = z.object({
  error: z.literal("explicit_creation_required")
});

export const invalidCanonicalMarkdownResponseSchema = z.object({
  error: z.literal("invalid_canonical_markdown"),
  message: z.string().min(1)
});

export type DailyNoteResponse = z.infer<typeof dailyNoteResponseSchema>;
export type SaveDailyNoteRequest = z.infer<typeof saveDailyNoteRequestSchema>;

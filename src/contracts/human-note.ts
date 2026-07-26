import { z } from "zod";

import { organizationModelValueSchema } from "./organization-model.js";

const revisionSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const humanNoteResponseSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  canonicalPath: z.string().regex(/^human\/notes\/[^/]+\.md$/),
  revision: revisionSchema,
  bodyMarkdown: z.string(),
  sourceMarkdown: z.string(),
  type: z.string().min(1).nullable(),
  state: z.string().min(1),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  properties: z.record(z.string(), organizationModelValueSchema),
  relationships: z.record(
    z.string(),
    z.union([z.string().min(1), z.array(z.string().min(1))])
  ),
  vault: z.object({
    id: z.uuid(),
    name: z.string().min(1)
  })
});

export const createHumanNoteRequestSchema = z.discriminatedUnion("context", [
  z.object({ context: z.enum(["global", "inbox"]) }),
  z.object({
    context: z.literal("wikilink"),
    target: z.string().trim().min(1).regex(/^[^\[\]\n|]+$/)
  }),
  z.object({
    context: z.literal("type"),
    type: z.string().regex(/^[a-z][a-z0-9_-]*$/)
  })
]);

const baseRevisionSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const saveHumanNoteRequestSchema = z.discriminatedUnion("format", [
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
    format: z.literal("metadata"),
    baseRevision: baseRevisionSchema,
    type: z.string().regex(/^[a-z][a-z0-9_-]*$/).nullable(),
    state: z.string().min(1),
    tags: z.array(z.string()),
    aliases: z.array(z.string()),
    properties: z.record(z.string(), organizationModelValueSchema),
    relationships: z
      .record(
        z.string(),
        z.union([z.string().min(1), z.array(z.string().min(1))])
      )
      .optional()
  }),
  z.object({
    format: z.literal("document"),
    baseRevision: baseRevisionSchema,
    bodyMarkdown: z.string(),
    type: z.string().regex(/^[a-z][a-z0-9_-]*$/).nullable(),
    state: z.string().min(1),
    tags: z.array(z.string()),
    aliases: z.array(z.string()),
    properties: z.record(z.string(), organizationModelValueSchema),
    relationships: z
      .record(
        z.string(),
        z.union([z.string().min(1), z.array(z.string().min(1))])
      )
      .optional()
  })
]);

export const humanNoteListItemSchema = humanNoteResponseSchema
  .pick({
    id: true,
    title: true,
    canonicalPath: true,
    revision: true,
    state: true
  })
  .extend({
    url: z.string().regex(/^\/notes\/[0-9a-f-]{36}$/)
  });

export const humanNoteListResponseSchema = z.array(humanNoteListItemSchema);

export type HumanNoteResponse = z.infer<typeof humanNoteResponseSchema>;
export type HumanNoteListItem = z.infer<typeof humanNoteListItemSchema>;
export type SaveHumanNoteRequest = z.infer<typeof saveHumanNoteRequestSchema>;

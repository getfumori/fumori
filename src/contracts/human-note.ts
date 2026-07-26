import { z } from "zod";

const revisionSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const humanNoteResponseSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  canonicalPath: z.string().regex(/^human\/notes\/[^/]+\.md$/),
  revision: revisionSchema,
  bodyMarkdown: z.string(),
  sourceMarkdown: z.string(),
  state: z.string().min(1),
  vault: z.object({
    id: z.uuid(),
    name: z.string().min(1)
  })
});

export const createHumanNoteRequestSchema = z.object({
  context: z.enum(["global", "inbox"])
});

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

import { z } from "zod";

const resolvedTargetSchema = z.object({
  target: z.string().min(1),
  label: z.string().min(1),
  sourceMarkdown: z.string().min(4),
  status: z.enum(["resolved", "ambiguous", "unresolved"]),
  url: z.string().nullable(),
  matches: z.array(
    z.object({
      id: z.uuid(),
      title: z.string().min(1),
      url: z.string()
    })
  )
});

const backlinkSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  url: z.string()
});

export const noteConnectionsResponseSchema = z.object({
  outgoing: z.array(resolvedTargetSchema),
  backlinks: z.array(backlinkSchema),
  relationships: z.array(
    z.object({
      key: z.string().min(1),
      name: z.string().min(1),
      cardinality: z.enum(["one", "many"]),
      targets: z.array(resolvedTargetSchema)
    })
  ),
  inverseRelationships: z.array(
    z.object({
      key: z.string().min(1),
      source: backlinkSchema
    })
  )
});

export const wikilinkSuggestionListSchema = z.array(
  z.object({
    target: z.string().min(1),
    title: z.string().min(1),
    url: z.string()
  })
);

export const renameToTitleRequestSchema = z.object({
  baseRevision: z.string().regex(/^[0-9a-f]{64}$/)
});

export type ResolvedWikilink = z.infer<typeof resolvedTargetSchema>;
export type NoteConnections = z.infer<typeof noteConnectionsResponseSchema>;

import { z } from "zod";

export const searchQuerySchema = z.string().trim().min(1).max(500);

export const searchResultSchema = z.object({
  kind: z.enum(["note", "daily-note"]),
  id: z.uuid(),
  title: z.string().min(1),
  canonicalPath: z.string().min(1),
  url: z.string().startsWith("/"),
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  snippet: z.string().min(1)
});

export const searchResponseSchema = z.array(searchResultSchema);

export type SearchResult = z.infer<typeof searchResultSchema>;

import { z } from "zod";

export const appConfigSchema = z.object({
  autosave: z.object({
    debounceMs: z.number().int().positive(),
    maxDirtyMs: z.number().int().positive()
  }),
  checkpoint: z.object({
    intervalMs: z.number().int().positive()
  })
});

export type AppConfig = z.infer<typeof appConfigSchema>;

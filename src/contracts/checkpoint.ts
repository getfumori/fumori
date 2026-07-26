import { z } from "zod";

export const checkpointResponseSchema = z.object({
  created: z.boolean(),
  sha: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
  changedFileCount: z.number().int().nonnegative()
});

export type CheckpointResponse = z.infer<typeof checkpointResponseSchema>;

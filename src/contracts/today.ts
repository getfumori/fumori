import { z } from "zod";

export const todayResponseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exists: z.boolean(),
  vault: z.object({
    id: z.uuid(),
    name: z.string().min(1)
  })
});

export type TodayResponse = z.infer<typeof todayResponseSchema>;

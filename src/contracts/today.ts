import { z } from "zod";

import { dailyNoteResponseSchema } from "./daily-note.js";

export const todayResponseSchema = dailyNoteResponseSchema;

export type TodayResponse = z.infer<typeof todayResponseSchema>;

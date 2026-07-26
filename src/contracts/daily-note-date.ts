import { z } from "zod";

export const dailyNoteDateSchema = z.iso.date();

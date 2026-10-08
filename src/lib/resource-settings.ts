import { z } from "zod"
import { MAX_DESCRIPTION_LENGTH } from "./description"

export const resourceSettingsSchema = z
  .object({
    description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
    visibility: z.enum(["public", "private"]).optional(),
  })
  .strict()
  .refine(
    (value) => value.description !== undefined || value.visibility !== undefined,
    "Provide a description or visibility change.",
  )

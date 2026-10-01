import { z } from "zod"

export const newPasswordSchema = z
  .string()
  .min(12, "Use a password with at least 12 characters.")
  .max(72, "Passwords cannot exceed 72 UTF-8 bytes.")
  .refine(
    (password) => Buffer.byteLength(password, "utf8") <= 72,
    "Passwords cannot exceed 72 UTF-8 bytes.",
  )

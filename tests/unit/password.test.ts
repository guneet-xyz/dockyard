import { describe, expect, it } from "vitest"
import { newPasswordSchema } from "@/lib/password"

describe("password policy", () => {
  it("requires strong passwords", () => {
    expect(newPasswordSchema.safeParse("short").success).toBe(false)
    expect(newPasswordSchema.safeParse("a-strong-test-password").success).toBe(true)
  })
  it("rejects passwords bcrypt would silently truncate", () => {
    expect(newPasswordSchema.safeParse("a".repeat(72)).success).toBe(true)
    expect(newPasswordSchema.safeParse("a".repeat(73)).success).toBe(false)
    expect(newPasswordSchema.safeParse("🔒".repeat(19)).success).toBe(false)
  })
})

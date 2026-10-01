import { describe, expect, it } from "vitest"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"
import { z } from "zod"

describe("HTTP security", () => {
  it("accepts only the configured origin for browser writes", () => {
    process.env.APP_URL = "https://registry.example.com"
    expect(() =>
      assertSameOrigin(
        new Request("https://registry.example.com/api/auth/login", {
          headers: { origin: "https://registry.example.com" },
        }),
      ),
    ).not.toThrow()
    expect(() =>
      assertSameOrigin(
        new Request("https://registry.example.com/api/auth/login", {
          headers: { origin: "https://evil.example.com" },
        }),
      ),
    ).toThrow(HttpError)
    expect(() =>
      assertSameOrigin(new Request("https://registry.example.com/api/auth/login")),
    ).toThrow(HttpError)
    delete process.env.APP_URL
  })
  it("rejects oversized JSON payloads", async () => {
    await expect(
      jsonBody(new Request("http://localhost", { method: "POST", body: "x".repeat(16385) })),
    ).rejects.toThrow("too large")
  })
  it("maps authorization and validation errors without leaking internals", async () => {
    expect(apiError(new HttpError(403, "Not allowed")).status).toBe(403)
    const result = z.string().safeParse(123)
    if (!result.success) expect(apiError(result.error).status).toBe(400)
    expect(apiError(new SyntaxError()).status).toBe(400)
  })
})

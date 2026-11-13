import { beforeEach, describe, expect, it, vi } from "vitest"

import { HttpError } from "@/lib/http"

const requireUser = vi.fn()
const updateStatus = vi.fn()

vi.mock("@/lib/auth", () => ({ requireUser }))
vi.mock("@/lib/version", () => ({ updateStatus }))

const { GET } = await import("@/app/api/version/route")

beforeEach(() => {
  requireUser.mockReset()
  updateStatus.mockReset()
})

describe("update status endpoint", () => {
  it.each([
    [401, "Please sign in to continue."],
    [403, "Administrator access is required."],
  ])(
    "returns %i without checking for updates for non-administrators",
    async (status, message) => {
      requireUser.mockRejectedValue(new HttpError(status, message))
      const response = await GET()
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: message })
      expect(updateStatus).not.toHaveBeenCalled()
    },
  )

  it("returns update details to administrators", async () => {
    requireUser.mockResolvedValue({ role: "admin" })
    const status = {
      current: "0.2.0",
      enabled: true,
      latest: null,
      available: false,
    }
    updateStatus.mockResolvedValue(status)
    const response = await GET()
    expect(requireUser).toHaveBeenCalledWith(true)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual(status)
  })
})

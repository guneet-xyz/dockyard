import { describe, expect, it } from "vitest"
import { cn, formatBytes, timeAgo } from "@/lib/utils"

describe("presentation utilities", () => {
  it("formats compressed image sizes", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB")
  })
  it("merges conflicting Tailwind classes", () => expect(cn("p-2", "p-5", false)).toBe("p-5"))
  it("handles missing or recent dates", () => {
    expect(timeAgo(null)).toBe("—")
    expect(timeAgo(new Date())).toBe("Just now")
    expect(timeAgo(new Date(Date.now() - 120000))).toBe("2m ago")
  })
})

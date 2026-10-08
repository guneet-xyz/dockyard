import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { normalizeLogo } from "@/lib/logos"
import { MAX_LOGO_BYTES, logoUrl } from "@/lib/logo-constants"
import { resourceSettingsSchema } from "@/lib/resource-settings"

describe("photo/logo upload normalization", () => {
  it.each(["png", "jpeg", "webp"] as const)(
    "decodes %s and stores a static bounded WebP",
    async (format) => {
      const bytes = await sharp({
        create: { width: 1200, height: 900, channels: 4, background: "#55ddaa" },
      })
        .toFormat(format)
        .toBuffer()
      const logo = await normalizeLogo(bytes)
      const meta = await sharp(logo.data).metadata()
      expect(meta.format).toBe("webp")
      expect(meta.width).toBe(512)
      expect(meta.height).toBe(384)
      expect(meta.exif).toBeUndefined()
      expect(logo.digest).toMatch(/^[a-f0-9]{64}$/)
      expect(logo.data.length).toBeLessThan(1024 ** 2)
    },
  )
  it("preserves small photo proportions without enlarging them", async () => {
    const bytes = await sharp({
      create: { width: 30, height: 60, channels: 4, background: "transparent" },
    })
      .png()
      .toBuffer()
    const logo = await normalizeLogo(bytes)
    const meta = await sharp(logo.data).metadata()
    expect([meta.width, meta.height]).toEqual([30, 60])
    expect(meta.hasAlpha).toBe(true)
  })
  it.each([
    "<svg><script>alert(1)</script></svg>",
    "GIF89a",
    "not a photo",
    "Docker image archive",
  ])("rejects unsupported or executable data %j", async (data) => {
    await expect(normalizeLogo(Buffer.from(data))).rejects.toThrow("PNG, JPEG, or WebP")
  })
  it("rejects corrupt raster data, excessive bytes, and excessive decoded pixels", async () => {
    await expect(normalizeLogo(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).rejects.toThrow(
      "could not be decoded",
    )
    await expect(normalizeLogo(Buffer.alloc(MAX_LOGO_BYTES + 1))).rejects.toThrow("5 MiB")
    const large = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer()
    await expect(normalizeLogo(large)).rejects.toThrow("16 megapixels")
  })
  it("encodes resource names in same-origin logo URLs without external fetches", () => {
    const url = new URL(logoUrl("image", "team/legacy/deep", "abc"), "https://dockyard.example")
    expect(url.origin).toBe("https://dockyard.example")
    expect(url.pathname).toBe("/api/logos")
    expect(url.searchParams.get("name")).toBe("team/legacy/deep")
  })
})

describe("preserved description improvements", () => {
  it("supports multiline text and description-only updates without visibility fields", () => {
    expect(resourceSettingsSchema.parse({ description: "  line one\nline two  " })).toEqual({
      description: "line one\nline two",
    })
    expect(resourceSettingsSchema.parse({ description: "" })).toEqual({ description: "" })
    expect(
      resourceSettingsSchema.parse({ description: "a".repeat(5000) }).description,
    ).toHaveLength(5000)
    expect(() => resourceSettingsSchema.parse({ description: "a".repeat(5001) })).toThrow()
    expect(() => resourceSettingsSchema.parse({})).toThrow()
  })
})

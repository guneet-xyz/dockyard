import { describe, expect, it } from "vitest"
import { keyExportFilename, serializeKeyCredentials, type KeyCredentials } from "@/lib/key-export"

const key: KeyCredentials = {
  id: "12345678-1234-1234-1234-123456789012",
  name: "Build init",
  registryHost: "cr.guneet.dev",
  username: "_key_test",
  secret: "dk_test-secret",
  grants: [{ type: "image", target: "dockyard/init", actions: ["pull", "push"] }],
  expiresAt: "2027-01-01T00:00:00Z",
}

describe("one-time key JSON export", () => {
  it("exports credentials and grant metadata in a versioned readable format", () => {
    const text = serializeKeyCredentials(key)
    expect(JSON.parse(text)).toEqual({ version: 1, ...key })
    expect(text).toContain('\n  "username":')
    expect(text.endsWith("\n")).toBe(true)
  })
  it("does not export extra internal fields", () => {
    const payload = JSON.parse(
      serializeKeyCredentials({
        ...key,
        secretHash: "internal-hash",
        passwordHash: "owner-password-hash",
      } as KeyCredentials),
    )
    expect(payload).not.toHaveProperty("secretHash")
    expect(payload).not.toHaveProperty("passwordHash")
  })
  it("retains null expiration and produces a path-safe filename without the secret", () => {
    expect(JSON.parse(serializeKeyCredentials({ ...key, expiresAt: null })).expiresAt).toBeNull()
    expect(keyExportFilename(key.id)).toBe(`dockyard-key-${key.id}.json`)
    expect(keyExportFilename("../../secret\n")).toBe("dockyard-key-secret.json")
    expect(keyExportFilename("")).toBe("dockyard-key-credentials.json")
  })
})

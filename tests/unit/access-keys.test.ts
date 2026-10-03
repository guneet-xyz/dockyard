import { describe, expect, it } from "vitest"
import { generateKeyCredentials, hashKeySecret, keyId, keyUsername } from "@/lib/access-keys"
import { allowedKeyActions } from "@/lib/key-permissions"
import { registryTokenExpiry } from "@/lib/registry-token"
import type { KeyGrant } from "@/lib/types"

const requested = ["pull", "push", "delete", "*", "unknown"]

describe("scoped automation key permissions", () => {
  it("project grants match only the exact namespace boundary", () => {
    const grants: KeyGrant[] = [{ type: "project", target: "dockyard", actions: ["pull", "push"] }]
    expect(allowedKeyActions(grants, "maintainer", "private", "dockyard/init", requested)).toEqual([
      "pull",
      "push",
    ])
    expect(allowedKeyActions(grants, "admin", "public", "dockyard-tools/init", requested)).toEqual(
      [],
    )
    expect(allowedKeyActions(grants, "admin", "public", "other/dockyard", requested)).toEqual([])
    expect(allowedKeyActions(grants, "admin", "public", "dockyard", requested)).toEqual([])
  })

  it("image grants match exactly, including legacy names", () => {
    const grants: KeyGrant[] = [
      { type: "image", target: "dockyard/init", actions: ["pull"] },
      { type: "image", target: "legacy/deep/image", actions: ["pull"] },
    ]
    expect(allowedKeyActions(grants, "admin", "private", "dockyard/init", requested)).toEqual([
      "pull",
    ])
    expect(allowedKeyActions(grants, "admin", "public", "dockyard/init-extra", requested)).toEqual(
      [],
    )
    expect(allowedKeyActions(grants, "admin", "public", "dockyard/web", requested)).toEqual([])
    expect(allowedKeyActions(grants, "viewer", "private", "legacy/deep/image", requested)).toEqual([
      "pull",
    ])
  })

  it("intersects additive grants with requested actions and the current owner role", () => {
    const grants: KeyGrant[] = [
      { type: "project", target: "dockyard", actions: ["pull"] },
      { type: "image", target: "dockyard/init", actions: ["push", "delete"] },
    ]
    expect(allowedKeyActions(grants, "admin", "public", "dockyard/init", requested)).toEqual([
      "pull",
      "push",
      "delete",
    ])
    expect(allowedKeyActions(grants, "viewer", "private", "dockyard/init", requested)).toEqual([
      "pull",
    ])
    expect(
      allowedKeyActions(grants, "maintainer", "public", "dockyard/init", ["push", "push"]),
    ).toEqual(["push"])
    expect(allowedKeyActions(grants, "admin", "public", "dockyard/web", requested)).toEqual([
      "pull",
    ])
    expect(allowedKeyActions([], "admin", "public", "dockyard/init", requested)).toEqual([])
  })

  it("does not silently fall back to anonymous public pulls outside a key's grants", () => {
    expect(
      allowedKeyActions(
        [{ type: "image", target: "team/api", actions: ["pull"] }],
        "admin",
        "public",
        "public/alpine",
        ["pull"],
      ),
    ).toEqual([])
  })
})

describe("key credentials and expiry", () => {
  it("creates distinct high-entropy secrets and reserved Docker usernames", () => {
    const first = generateKeyCredentials()
    const second = generateKeyCredentials()
    expect(first.secret).toMatch(/^dk_[A-Za-z0-9_-]{43}$/)
    expect(first.secret).not.toBe(second.secret)
    expect(first.secretHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.secretHash).toBe(hashKeySecret(first.secret))
    expect(first.secretHash).not.toContain(first.secret)
    expect(keyId(first.username)).toBe(first.id)
    expect(keyUsername(first.id)).toBe(first.username)
    expect(keyId("admin")).toBeNull()
    expect(keyId("_key_not-a-uuid")).toBeNull()
  })

  it("never issues registry authorization beyond key expiry", () => {
    expect(registryTokenExpiry(null, 1000)).toBe(1300)
    expect(registryTokenExpiry(new Date(1100 * 1000), 1000)).toBe(1100)
    expect(registryTokenExpiry(new Date(2000 * 1000), 1000)).toBe(1300)
  })
})

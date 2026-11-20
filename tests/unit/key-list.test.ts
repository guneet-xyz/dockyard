import { describe, expect, it } from "vitest"

import {
  expiresSoon,
  filterKeys,
  owners,
  paginate,
  type KeyListOptions,
} from "@/lib/key-list"
import type { AccessKeyInfo } from "@/lib/types"

const now = new Date("2026-11-20T00:00:00Z").getTime()
const days = (n: number) => new Date(now + n * 86_400_000).toISOString()

function key(overrides: Partial<AccessKeyInfo>): AccessKeyInfo {
  return {
    id: overrides.name ?? "id",
    username: `_key_${overrides.name ?? "id"}`,
    name: "key",
    ownerId: "admin-id",
    ownerUsername: "admin",
    ownerEnabled: true,
    status: "Active",
    grants: [{ type: "project", target: "dockyard", actions: ["pull"] }],
    createdAt: days(-10),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    rotatedAt: null,
    ...overrides,
  }
}

const keys = [
  key({
    name: "deploy-10",
    createdAt: days(-1),
    lastUsedAt: days(-2),
    expiresAt: days(30),
  }),
  key({
    name: "deploy-9",
    createdAt: days(-3),
    expiresAt: days(5),
    ownerId: "maria-id",
    ownerUsername: "maria",
    grants: [{ type: "image", target: "walls/app", actions: ["push"] }],
  }),
  key({
    name: "release",
    createdAt: days(-5),
    lastUsedAt: days(-1),
    status: "Revoked",
    revokedAt: days(-1),
    expiresAt: days(1),
  }),
  key({ name: "nightly", createdAt: days(-7), status: "Expired" }),
]
const defaults: KeyListOptions = {
  search: "",
  status: "all",
  owner: "all",
  sort: "newest",
  viewerId: "admin-id",
}
const names = (options: Partial<KeyListOptions>) =>
  filterKeys(keys, { ...defaults, ...options }).map((item) => item.name)

describe("automation key list", () => {
  it("lists newest keys first by default", () => {
    expect(names({})).toEqual(["deploy-10", "deploy-9", "release", "nightly"])
  })

  it("searches names, usernames, owners and grant targets case-insensitively", () => {
    expect(names({ search: " WALLS/ " })).toEqual(["deploy-9"])
    expect(names({ search: "maria" })).toEqual(["deploy-9"])
    expect(names({ search: "_key_nightly" })).toEqual(["nightly"])
    expect(names({ search: "missing" })).toEqual([])
    expect(names({ search: "   " })).toHaveLength(keys.length)
  })

  it("filters by status and owner", () => {
    expect(names({ status: "Revoked" })).toEqual(["release"])
    expect(names({ owner: "mine" })).toEqual([
      "deploy-10",
      "release",
      "nightly",
    ])
    expect(names({ owner: "maria" })).toEqual(["deploy-9"])
    expect(names({ owner: "nobody" })).toEqual([])
    expect(names({ owner: "mine", viewerId: undefined })).toEqual([])
  })

  it("sorts names naturally", () => {
    expect(names({ sort: "name" })).toEqual([
      "deploy-9",
      "deploy-10",
      "nightly",
      "release",
    ])
  })

  it("sorts by last authentication with never-used keys last", () => {
    expect(names({ sort: "last-used" })).toEqual([
      "release",
      "deploy-10",
      "deploy-9",
      "nightly",
    ])
  })

  it("sorts active keys by soonest expiry, then never-expiring and inactive keys", () => {
    expect(names({ sort: "expiry" })).toEqual([
      "deploy-9",
      "deploy-10",
      "release",
      "nightly",
    ])
    const forever = key({ name: "forever", createdAt: days(-20) })
    expect(
      filterKeys([...keys, forever], { ...defaults, sort: "expiry" }).map(
        (item) => item.name,
      ),
    ).toEqual(["deploy-9", "deploy-10", "forever", "release", "nightly"])
  })

  it("does not mutate its input", () => {
    const before = keys.map((item) => item.name)
    filterKeys(keys, { ...defaults, sort: "name" })
    expect(keys.map((item) => item.name)).toEqual(before)
  })

  it("paginates and clamps the page", () => {
    const items = Array.from({ length: 30 }, (_, index) => index)
    expect(paginate(items, 1, 25)).toMatchObject({
      page: 1,
      pages: 2,
      first: 1,
      last: 25,
    })
    expect(paginate(items, 2, 25)).toMatchObject({
      items: [25, 26, 27, 28, 29],
      first: 26,
      last: 30,
    })
    expect(paginate(items, 9, 25).page).toBe(2)
    expect(paginate(items, 0, 25).page).toBe(1)
    expect(paginate([], 3, 25)).toMatchObject({
      items: [],
      page: 1,
      pages: 1,
      first: 0,
      last: 0,
    })
  })

  it("warns only about active keys expiring within 14 days", () => {
    expect(expiresSoon(keys[1], now)).toBe(true)
    expect(expiresSoon(keys[0], now)).toBe(false)
    expect(expiresSoon(keys[2], now)).toBe(false)
    expect(expiresSoon(key({ expiresAt: days(-1) }), now)).toBe(true)
    expect(expiresSoon(key({ expiresAt: null }), now)).toBe(false)
    expect(expiresSoon(key({ expiresAt: days(14) }), now)).toBe(true)
    expect(expiresSoon(key({ expiresAt: days(14.01) }), now)).toBe(false)
  })

  it("lists distinct owners alphabetically", () => {
    expect(owners(keys)).toEqual(["admin", "maria"])
  })
})

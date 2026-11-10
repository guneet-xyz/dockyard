import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  countablePull,
  pullAfterReset,
  pullClientKey,
  INTERNAL_REGISTRY_USER_AGENT,
  type RegistryEvent,
} from "@/lib/registry-events"
import { recordPull } from "@/lib/pull-counts"
import { imageTagPulls, registryPullEvents, registryPullWindows } from "@/lib/db/schema"

const mocks = vi.hoisted(() => ({
  receipt: vi.fn(),
  window: vi.fn(),
  increment: vi.fn(),
  rows: [] as { deletedAt: Date | null; resetAt: Date | null }[],
  active: false,
}))
vi.mock("@/lib/resource-locks", () => ({
  withImageResource: async (
    _name: string,
    callback: (tx: unknown) => Promise<unknown>,
    write: boolean,
  ) => {
    expect(write).toBe(false)
    mocks.active = true
    const tx = {
      insert: (table: unknown) => {
        if (table === registryPullEvents)
          return { values: () => ({ onConflictDoNothing: () => ({ returning: mocks.receipt }) }) }
        if (table === registryPullWindows)
          return {
            values: (values: unknown) => ({
              onConflictDoUpdate: (update: unknown) => ({
                returning: () => mocks.window(values, update),
              }),
            }),
          }
        if (table === imageTagPulls)
          return {
            values: (values: unknown) => ({
              onConflictDoUpdate: (update: unknown) => mocks.increment(values, update),
            }),
          }
        throw new Error("Unexpected table")
      },
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [mocks.rows.shift()] }) }),
      }),
    }
    try {
      return await callback(tx)
    } finally {
      mocks.active = false
    }
  },
}))

const event: RegistryEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  action: "pull",
  timestamp: "2026-10-04T00:00:00Z",
  request: { method: "GET", useragent: "Docker/28" },
  target: {
    repository: "dockyard/web",
    tag: "latest",
    digest: `sha256:${"a".repeat(64)}`,
    mediaType: "application/vnd.oci.image.index.v1+json",
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.rows = [
    { deletedAt: null, resetAt: null },
    { deletedAt: null, resetAt: null },
  ]
  mocks.receipt.mockResolvedValue([{ id: event.id }])
  mocks.window.mockResolvedValue([{ key: "window" }])
  mocks.increment.mockResolvedValue(undefined)
})

describe("pull event definition", () => {
  it("counts tagged GETs for anonymous clients and automation keys without mapping digest aliases", () => {
    expect(countablePull(event)).toEqual({ repositoryName: "dockyard/web", tag: "latest" })
    expect(
      countablePull({
        ...event,
        actor: { name: "_key_ci" },
        target: { ...event.target, tag: "0.1.0" },
      }),
    ).toEqual({ repositoryName: "dockyard/web", tag: "0.1.0" })
  })
  it.each([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ])("accepts supported manifest type %s", (mediaType) => {
    expect(countablePull({ ...event, target: { ...event.target, mediaType } })).not.toBeNull()
  })
  it("counts HEAD tag lookups, which Docker and containerd use before fetching by digest", () => {
    expect(
      countablePull({ ...event, request: { method: "HEAD", useragent: "docker/28" } }),
    ).toEqual({ repositoryName: "dockyard/web", tag: "latest" })
  })
  it("excludes UI browsing, digest children, blob reads, pushes, and invalid references", () => {
    const ignored = [
      { ...event, request: { method: "GET", useragent: INTERNAL_REGISTRY_USER_AGENT } },
      { ...event, request: { method: "HEAD", useragent: INTERNAL_REGISTRY_USER_AGENT } },
      { ...event, request: { method: "DELETE" } },
      { ...event, request: undefined },
      { ...event, target: { ...event.target, tag: undefined } },
      { ...event, target: { ...event.target, mediaType: "application/octet-stream" } },
      { ...event, action: "push" },
      { ...event, target: { ...event.target, repository: "../secret" } },
      { ...event, target: { ...event.target, tag: "bad/tag" } },
      { ...event, target: { ...event.target, digest: "invalid" } },
    ]
    for (const candidate of ignored) expect(countablePull(candidate)).toBeNull()
  })
  it("uses independent per-tag names even when digests match", () => {
    expect(countablePull(event)?.tag).toBe("latest")
    expect(countablePull({ ...event, target: { ...event.target, tag: "stable" } })?.tag).toBe(
      "stable",
    )
  })
  it("rejects notifications older than an explicitly recreated image/project", () => {
    expect(pullAfterReset(event.timestamp, null)).toBe(true)
    expect(pullAfterReset(event.timestamp, new Date(event.timestamp))).toBe(true)
    expect(pullAfterReset(event.timestamp, null, new Date("2026-10-04T00:00:01Z"))).toBe(false)
    expect(pullAfterReset("invalid", null)).toBe(false)
  })
})

describe("client deduplication key", () => {
  const target = { repositoryName: "dockyard/web", tag: "latest" }
  const client = (request: RegistryEvent["request"], actor?: string) =>
    pullClientKey({ ...event, request, actor: actor ? { name: actor } : undefined }, target, "s")

  it("does not merge events without a reported client address", () => {
    expect(client({ method: "GET", useragent: "docker/28" })).toBeNull()
    expect(client({ method: "GET", addr: " " })).toBeNull()
  })
  it("matches one client across methods and connection ports", () => {
    const key = client({ method: "HEAD", addr: "203.0.113.5:41000", useragent: "docker/28" })
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(client({ method: "GET", addr: "203.0.113.5:52000", useragent: "docker/28" })).toBe(key)
    expect(client({ method: "GET", addr: "203.0.113.5", useragent: "docker/28" })).toBe(key)
    const v6 = client({ method: "GET", addr: "[2001:DB8::1]:41000", useragent: "docker/28" })
    expect(client({ method: "GET", addr: "2001:db8::1", useragent: "docker/28" })).toBe(v6)
  })
  it("separates addresses, user agents, accounts, tags, and secrets without exposing them", () => {
    const base = { method: "GET", addr: "203.0.113.5", useragent: "docker/28" }
    const key = client(base)
    expect(key).not.toContain("203.0.113.5")
    expect(client({ ...base, addr: "203.0.113.6" })).not.toBe(key)
    expect(client({ ...base, useragent: "containerd/2" })).not.toBe(key)
    expect(client(base, "_key_ci")).not.toBe(key)
    expect(pullClientKey({ ...event, request: base }, { ...target, tag: "stable" }, "s")).not.toBe(
      key,
    )
    expect(pullClientKey({ ...event, request: base }, target, "other")).not.toBe(key)
  })
})

describe("atomic counter collection", () => {
  it("increments by one inside the receipt transaction using an SQL upsert", async () => {
    mocks.increment.mockImplementation(async (values, update) => {
      expect(mocks.active).toBe(true)
      expect(values).toEqual({ repositoryName: "dockyard/web", tag: "latest", pullCount: 1 })
      expect(update.target).toEqual([imageTagPulls.repositoryName, imageTagPulls.tag])
    })
    await recordPull(event)
    expect(mocks.increment).toHaveBeenCalledTimes(1)
  })
  it("counts one pull per client window and does not count a lookup inside an open window", async () => {
    vi.stubEnv("REGISTRY_WEBHOOK_SECRET", "s".repeat(32))
    const lookup = { ...event, request: { method: "HEAD", addr: "203.0.113.5", useragent: "d" } }
    mocks.window.mockImplementation(async (values, update) => {
      expect(mocks.active).toBe(true)
      expect(values.key).toBe(
        pullClientKey(lookup, { repositoryName: "dockyard/web", tag: "latest" }, "s".repeat(32)),
      )
      expect(values.countedAt).toEqual(new Date(event.timestamp))
      expect(update.target).toBe(registryPullWindows.key)
      expect(update.setWhere).toBeDefined()
      return [{ key: values.key }]
    })
    await recordPull(lookup)
    expect(mocks.increment).toHaveBeenCalledTimes(1)
    mocks.window.mockResolvedValue([])
    mocks.rows = [
      { deletedAt: null, resetAt: null },
      { deletedAt: null, resetAt: null },
    ]
    await recordPull({ ...lookup, request: { ...lookup.request, method: "GET" } })
    expect(mocks.increment).toHaveBeenCalledTimes(1)
    vi.unstubAllEnvs()
  })
  it("skips the client window when the registry reports no client address", async () => {
    await recordPull(event)
    expect(mocks.window).not.toHaveBeenCalled()
    expect(mocks.increment).toHaveBeenCalledTimes(1)
  })
  it("ignores duplicate delivery without reading metadata or changing counts", async () => {
    mocks.receipt.mockResolvedValue([])
    await recordPull(event)
    expect(mocks.increment).not.toHaveBeenCalled()
    expect(mocks.rows).toHaveLength(2)
  })
  it.each(["image", "project", "reset"])(
    "does not count retired/stale %s notifications",
    async (mode) => {
      if (mode === "image") mocks.rows[0].deletedAt = new Date()
      if (mode === "project") mocks.rows[1].deletedAt = new Date()
      if (mode === "reset") mocks.rows[0].resetAt = new Date("2026-10-04T00:00:01Z")
      await recordPull({ ...event, request: { method: "GET", addr: "203.0.113.5" } })
      expect(mocks.receipt).toHaveBeenCalledTimes(1)
      expect(mocks.window).not.toHaveBeenCalled()
      expect(mocks.increment).not.toHaveBeenCalled()
    },
  )
})

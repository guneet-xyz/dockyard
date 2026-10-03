import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/registry/token/route"

const mocks = vi.hoisted(() => ({
  active: false,
  events: [] as string[],
  lock: vi.fn(),
  sign: vi.fn(),
  metadata: vi.fn(),
}))
vi.mock("@/lib/db", () => ({
  db: () => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      mocks.active = true
      mocks.events.push("begin")
      try {
        return await callback({ marker: "tx" })
      } finally {
        mocks.events.push("commit")
        mocks.active = false
      }
    },
  }),
}))
vi.mock("@/lib/auth", () => ({
  checkCredentials: async () => ({
    id: "owner",
    username: "maintainer",
    name: "Maintainer",
    role: "maintainer",
    enabled: true,
  }),
}))
vi.mock("@/lib/access-keys", () => ({ authenticateAccessKey: vi.fn() }))
vi.mock("@/lib/resource-locks", () => ({ lockImageNamespace: mocks.lock }))
vi.mock("@/lib/registry", () => ({ repositoryMetadata: mocks.metadata, repositoryExists: vi.fn() }))
vi.mock("@/lib/registry-token", () => ({
  signRegistryToken: mocks.sign,
  registryTokenExpiry: () => Math.floor(Date.now() / 1000) + 300,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.active = false
  mocks.events.length = 0
  mocks.lock.mockImplementation(async (_tx, name, write) => {
    expect(mocks.active).toBe(true)
    expect(write).toBe(false)
    mocks.events.push(`lock:${name}`)
  })
  mocks.metadata.mockImplementation(async (name, tx) => {
    expect(tx).toEqual({ marker: "tx" })
    mocks.events.push(`read:${name}`)
    return { visibility: "public", configured: true, deleted: name.endsWith("gone") }
  })
  mocks.sign.mockImplementation(async () => {
    expect(mocks.active).toBe(true)
    mocks.events.push("sign")
    return "test-token"
  })
})

describe("token issuance coordinated with deletion", () => {
  it("locks every resource before reading and retains locks until signing finishes", async () => {
    const request = new Request(
      "http://localhost/api/registry/token?service=dockyard-registry&scope=repository:team/gone:pull,push&scope=repository:team/api:pull,push",
      { headers: { Authorization: `Basic ${Buffer.from("maintainer:dummy").toString("base64")}` } },
    )
    const response = await GET(request)
    expect(response.status).toBe(200)
    expect(mocks.events).toEqual([
      "begin",
      "lock:team/api",
      "lock:team/gone",
      "read:team/gone",
      "read:team/api",
      "sign",
      "commit",
    ])
    expect(mocks.sign.mock.calls[0][1]).toEqual([
      { type: "repository", name: "team/gone", actions: [] },
      { type: "repository", name: "team/api", actions: ["pull", "push"] },
    ])
  })
})

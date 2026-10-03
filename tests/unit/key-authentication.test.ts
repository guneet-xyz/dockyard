import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { authenticateAccessKey, generateKeyCredentials } from "@/lib/access-keys"

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  updateWhere: vi.fn(),
  limit: vi.fn(),
  returning: vi.fn(),
  consume: vi.fn(),
  reset: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ db: () => ({ select: mocks.select, update: mocks.update }) }))
vi.mock("@/lib/auth", () => ({
  consumeCredentialAttempt: mocks.consume,
  resetCredentialAttempts: mocks.reset,
}))

const credentials = generateKeyCredentials()
const row = {
  key: {
    ...credentials,
    revokedAt: null,
    expiresAt: null,
    grants: [{ type: "image" as const, target: "team/api", actions: ["pull" as const] }],
  },
  user: { id: "owner", username: "owner", name: "Owner", role: "viewer" as const, enabled: true },
}

beforeEach(() => {
  vi.resetAllMocks()
  const select = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: mocks.limit,
  }
  const update = {
    set: vi.fn().mockReturnThis(),
    where: mocks.updateWhere,
    returning: mocks.returning,
  }
  mocks.select.mockReturnValue(select)
  mocks.update.mockReturnValue(update)
  mocks.updateWhere.mockReturnValue(update)
  mocks.limit.mockResolvedValue([row])
  mocks.returning.mockResolvedValue([{ id: credentials.id }])
})

describe("key authentication during rotation", () => {
  it("rechecks the validated hash before accepting the secret", async () => {
    const authenticated = await authenticateAccessKey(credentials.username, credentials.secret)
    expect(authenticated?.id).toBe(credentials.id)
    const query = new PgDialect().sqlToQuery(mocks.updateWhere.mock.calls[0][0])
    expect(query.sql).toContain('"secret_hash" =')
    expect(query.params).toContain(credentials.secretHash)
    expect(query.sql).toContain('"revoked_at" is null')
  })

  it("rejects a secret if rotation or revocation wins the concurrent update", async () => {
    mocks.returning.mockResolvedValue([])
    const authenticated = await authenticateAccessKey(credentials.username, credentials.secret)
    expect(authenticated).toBeNull()
  })

  it("does not update usage for a mismatched secret", async () => {
    expect(await authenticateAccessKey(credentials.username, "dk_wrong")).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
  })
})

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "./db"
import { accessKeys, users } from "./db/schema"
import { consumeCredentialAttempt, resetCredentialAttempts } from "./auth"
import type { KeyGrant, SessionUser } from "./types"

export function keyUsername(id: string) {
  return `_key_${id}`
}
export function keyId(username: string) {
  const match = /^_key_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    username,
  )
  return match?.[1].toLowerCase() ?? null
}
export function hashKeySecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex")
}
export function generateKeyCredentials() {
  const id = randomUUID()
  const secret = `dk_${randomBytes(32).toString("base64url")}`
  return { id, username: keyUsername(id), secret, secretHash: hashKeySecret(secret) }
}

export type AuthenticatedKey = {
  id: string
  subject: string
  grants: KeyGrant[]
  expiresAt: Date | null
  user: SessionUser
}

export async function authenticateAccessKey(
  username: string,
  secret: string,
): Promise<AuthenticatedKey | null> {
  const id = keyId(username)
  if (!id || !secret || secret.length > 128) return null
  await consumeCredentialAttempt(keyUsername(id))
  const [row] = await db()
    .select({
      key: accessKeys,
      user: {
        id: users.id,
        username: users.username,
        name: users.name,
        role: users.role,
        enabled: users.enabled,
      },
    })
    .from(accessKeys)
    .innerJoin(users, eq(users.id, accessKeys.ownerId))
    .where(eq(accessKeys.id, id))
    .limit(1)
  const actual = Buffer.from(hashKeySecret(secret), "hex")
  const expected = Buffer.from(row?.key.secretHash ?? "0".repeat(64), "hex")
  const valid = expected.length === actual.length && timingSafeEqual(actual, expected)
  if (
    !row ||
    !valid ||
    !row.user.enabled ||
    row.key.revokedAt ||
    (row.key.expiresAt &&
      Math.floor(row.key.expiresAt.getTime() / 1000) <= Math.floor(Date.now() / 1000))
  )
    return null
  await resetCredentialAttempts(keyUsername(id))
  const updated = await db()
    .update(accessKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(accessKeys.id, id), isNull(accessKeys.revokedAt)))
    .returning({ id: accessKeys.id })
  if (!updated.length) return null
  return {
    id,
    subject: keyUsername(id),
    grants: row.key.grants,
    expiresAt: row.key.expiresAt,
    user: row.user,
  }
}

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "./db"
import { accessKeys, users } from "./db/schema"
import { consumeCredentialAttempt, resetCredentialAttempts } from "./auth"
import { HttpError } from "./http"
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
export function generateKeyCredentials(id: string = randomUUID()) {
  const secret = `dk_${randomBytes(32).toString("base64url")}`
  return { id, username: keyUsername(id), secret, secretHash: hashKeySecret(secret) }
}

export function assertKeyRotatable(
  key: { revokedAt: Date | null; expiresAt: Date | null; ownerEnabled: boolean },
  now = Date.now(),
) {
  if (key.revokedAt) throw new HttpError(409, "Revoked keys cannot be rotated. Create a new key.")
  if (key.expiresAt && Math.floor(key.expiresAt.getTime() / 1000) <= Math.floor(now / 1000))
    throw new HttpError(409, "Expired keys cannot be rotated. Create a new key.")
  if (!key.ownerEnabled)
    throw new HttpError(409, "Keys belonging to a disabled owner cannot be rotated.")
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
  // A concurrent rotation must invalidate authentication that read the previous hash.
  const updated = await db()
    .update(accessKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(accessKeys.id, id),
        isNull(accessKeys.revokedAt),
        eq(accessKeys.secretHash, row.key.secretHash),
      ),
    )
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

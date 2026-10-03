import { createHash, randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import bcrypt from "bcryptjs"
import { and, eq, gt, lt, sql } from "drizzle-orm"
import { db } from "./db"
import { auditEvents, loginAttempts, sessions, users } from "./db/schema"
import type { SessionUser } from "./types"
import { HttpError } from "./http"
import { config } from "./config"

const cookieName = "dockyard_session"
const sessionDuration = 7 * 24 * 60 * 60
const hash = (token: string) => createHash("sha256").update(token).digest("hex")
// A valid bcrypt hash keeps missing-user checks comparable to real-user checks.
const dummyHash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxfxaXBaKOjxNJFaFSxIXKZSaKS"

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(cookieName)?.value
  if (!token) return null
  const result = await db()
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      enabled: users.enabled,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, hash(token)),
        gt(sessions.expiresAt, new Date()),
        eq(users.enabled, true),
      ),
    )
    .limit(1)
  return result[0] ?? null
}

export async function requireUser(admin = false) {
  const user = await currentUser()
  if (!user) throw new HttpError(401, "Please sign in to continue.")
  if (admin && user.role !== "admin") throw new HttpError(403, "Administrator access is required.")
  return user
}

export async function consumeCredentialAttempt(username: string) {
  const key = hash(`login:${username.toLowerCase()}`)
  const now = new Date()
  // Atomic upsert avoids parallel requests bypassing the limit.
  const [attempt] = await db()
    .insert(loginAttempts)
    .values({ key, count: 1, resetAt: new Date(now.getTime() + 15 * 60 * 1000) })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        count: sql`CASE WHEN ${loginAttempts.resetAt} < ${now.toISOString()}::timestamptz THEN 1 ELSE ${loginAttempts.count} + 1 END`,
        resetAt: sql`CASE WHEN ${loginAttempts.resetAt} < ${now.toISOString()}::timestamptz THEN ${new Date(now.getTime() + 15 * 60 * 1000).toISOString()}::timestamptz ELSE ${loginAttempts.resetAt} END`,
      },
    })
    .returning()
  if (attempt.count > 20) throw new HttpError(429, "Too many attempts. Try again in 15 minutes.")
}

export async function resetCredentialAttempts(username: string) {
  await db()
    .delete(loginAttempts)
    .where(eq(loginAttempts.key, hash(`login:${username.toLowerCase()}`)))
}

export async function checkCredentials(
  username: string,
  password: string,
): Promise<SessionUser | null> {
  if (Buffer.byteLength(password, "utf8") > 72 || !username || username.length > 64) return null
  await consumeCredentialAttempt(username)
  const [user] = await db()
    .select()
    .from(users)
    .where(eq(users.username, username.toLowerCase()))
    .limit(1)
  const valid = await bcrypt.compare(password, user?.passwordHash ?? dummyHash)
  if (!user || !valid || !user.enabled) return null
  await resetCredentialAttempts(username)
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    enabled: user.enabled,
  }
}

export async function createSession(userId: string) {
  const jar = await cookies()
  const previous = jar.get(cookieName)?.value
  if (previous)
    await db()
      .delete(sessions)
      .where(eq(sessions.id, hash(previous)))
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()))
  const token = randomBytes(32).toString("base64url")
  await db()
    .insert(sessions)
    .values({ id: hash(token), userId, expiresAt: new Date(Date.now() + sessionDuration * 1000) })
  jar.set(cookieName, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: sessionDuration,
  })
}

export async function endSession() {
  const jar = await cookies()
  const token = jar.get(cookieName)?.value
  if (token)
    await db()
      .delete(sessions)
      .where(eq(sessions.id, hash(token)))
  jar.delete(cookieName)
}

export async function audit(
  actor: string,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  await db().insert(auditEvents).values({ actor, action, target, details })
}

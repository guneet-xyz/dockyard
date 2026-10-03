import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { requireUser, credentialAttemptKey } from "@/lib/auth"
import { assertKeyRotatable, generateKeyCredentials } from "@/lib/access-keys"
import { config } from "@/lib/config"
import { db } from "@/lib/db"
import { accessKeys, auditEvents, loginAttempts, users } from "@/lib/db/schema"
import { apiError, assertSameOrigin, HttpError } from "@/lib/http"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const actor = await requireUser()
    const id = z
      .uuid()
      .parse((await context.params).id)
      .toLowerCase()
    const credentials = await db().transaction(async (tx) => {
      // Serialize rotation with revocation and owner disablement; never revive an inactive key.
      const [row] = await tx
        .select({ key: accessKeys, ownerEnabled: users.enabled })
        .from(accessKeys)
        .innerJoin(users, eq(users.id, accessKeys.ownerId))
        .where(
          and(
            eq(accessKeys.id, id),
            actor.role === "admin" ? undefined : eq(accessKeys.ownerId, actor.id),
          ),
        )
        .limit(1)
        .for("update")
      if (!row) throw new HttpError(404, "Key not found.")
      assertKeyRotatable({ ...row.key, ownerEnabled: row.ownerEnabled })
      const rotated = generateKeyCredentials(row.key.id)
      const rotatedAt = new Date()
      await tx
        .update(accessKeys)
        .set({ secretHash: rotated.secretHash, rotatedAt, lastUsedAt: null })
        .where(eq(accessKeys.id, id))
      await tx
        .delete(loginAttempts)
        .where(eq(loginAttempts.key, credentialAttemptKey(rotated.username)))
      await tx.insert(auditEvents).values({
        actor: actor.username,
        action: "key.rotate",
        target: row.key.name,
        details: { keyId: id, ownerId: row.key.ownerId, rotatedAt: rotatedAt.toISOString() },
      })
      return {
        id,
        username: rotated.username,
        secret: rotated.secret,
        name: row.key.name,
        grants: row.key.grants,
        expiresAt: row.key.expiresAt,
        registryHost: config.registryHost,
      }
    })
    return NextResponse.json(credentials, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return apiError(error)
  }
}

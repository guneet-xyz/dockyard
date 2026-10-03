import { NextResponse } from "next/server"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { requireUser } from "@/lib/auth"
import { db } from "@/lib/db"
import { accessKeys, auditEvents } from "@/lib/db/schema"
import { apiError, assertSameOrigin, HttpError } from "@/lib/http"

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const id = z.uuid().parse((await context.params).id)
    await db().transaction(async (tx) => {
      const [key] = await tx
        .select({ id: accessKeys.id, name: accessKeys.name, revokedAt: accessKeys.revokedAt })
        .from(accessKeys)
        .where(
          and(
            eq(accessKeys.id, id),
            user.role === "admin" ? undefined : eq(accessKeys.ownerId, user.id),
          ),
        )
        .limit(1)
      if (!key) throw new HttpError(404, "Key not found.")
      if (key.revokedAt) return
      const revoked = await tx
        .update(accessKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(accessKeys.id, id), isNull(accessKeys.revokedAt)))
        .returning({ id: accessKeys.id })
      if (revoked.length)
        await tx.insert(auditEvents).values({
          actor: user.username,
          action: "key.revoke",
          target: key.name,
          details: { keyId: id },
        })
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

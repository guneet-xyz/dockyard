import { NextResponse } from "next/server"
import { eq, sql } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { requireUser } from "@/lib/auth"
import { db } from "@/lib/db"
import { auditEvents, sessions, users } from "@/lib/db/schema"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"
import { newPasswordSchema } from "@/lib/password"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const actor = await requireUser(true)
    const id = z.uuid().parse((await context.params).id)
    const input = z
      .object({
        role: z.enum(["admin", "maintainer", "viewer"]).optional(),
        enabled: z.boolean().optional(),
        password: newPasswordSchema.optional(),
      })
      .refine((value) => Object.keys(value).length > 0, "No changes supplied.")
      .parse(await jsonBody(request))
    if (id === actor.id && (input.enabled === false || (input.role && input.role !== "admin")))
      throw new HttpError(400, "You cannot disable or demote your own account.")
    const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : undefined
    await db().transaction(async (tx) => {
      // Serialize admin edits so concurrent requests cannot remove the last admin.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(713921)`)
      const [user] = await tx.select().from(users).where(eq(users.id, id)).limit(1)
      if (!user) throw new HttpError(404, "User not found.")
      if (
        user.role === "admin" &&
        user.enabled &&
        (input.enabled === false || (input.role && input.role !== "admin"))
      ) {
        const admins = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`${users.role} = 'admin' AND ${users.enabled} = true`)
        if (admins.length <= 1)
          throw new HttpError(400, "At least one active administrator is required.")
      }
      await tx
        .update(users)
        .set({ role: input.role, enabled: input.enabled, passwordHash })
        .where(eq(users.id, id))
      await tx.delete(sessions).where(eq(sessions.userId, id))
      await tx.insert(auditEvents).values({
        actor: actor.username,
        action: "user.update",
        target: user.username,
        details: {
          role: input.role,
          enabled: input.enabled,
          passwordReset: Boolean(input.password),
        },
      })
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

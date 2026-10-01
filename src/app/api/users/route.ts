import { NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { audit, requireUser } from "@/lib/auth"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"
import { newPasswordSchema } from "@/lib/password"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireUser(true)
    const result = await db()
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        role: users.role,
        enabled: users.enabled,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
    return NextResponse.json({ users: result }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const actor = await requireUser(true)
    const input = z
      .object({
        username: z
          .string()
          .trim()
          .toLowerCase()
          .min(3)
          .max(64)
          .regex(/^[a-z0-9][a-z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores."),
        name: z.string().trim().min(1).max(100),
        password: newPasswordSchema,
        role: z.enum(["admin", "maintainer", "viewer"]),
      })
      .parse(await jsonBody(request))
    const [user] = await db()
      .insert(users)
      .values({
        username: input.username,
        name: input.name,
        role: input.role,
        passwordHash: await bcrypt.hash(input.password, 12),
      })
      .onConflictDoNothing()
      .returning({ id: users.id })
    if (!user) throw new HttpError(409, "That username is already in use.")
    await audit(actor.username, "user.create", input.username, { role: input.role })
    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

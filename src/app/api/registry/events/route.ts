import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { auditEvents, repositories } from "@/lib/db/schema"
import { config } from "@/lib/config"
import { apiError, HttpError } from "@/lib/http"
import { validRepositoryName } from "@/lib/permissions"

const eventSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.uuid(),
        action: z.string(),
        timestamp: z.iso.datetime({ offset: true }),
        actor: z.object({ name: z.string().optional() }).optional(),
        target: z.object({
          repository: z.string().optional(),
          mediaType: z.string().optional(),
          digest: z.string().optional(),
          tag: z.string().optional(),
        }),
      }),
    )
    .max(500),
})

export async function POST(request: Request) {
  try {
    const secret = process.env.REGISTRY_WEBHOOK_SECRET
    if (!secret || secret.length < 32)
      throw new HttpError(503, "Registry notifications are not configured.")
    const expected = Buffer.from(`Bearer ${secret}`)
    const actual = Buffer.from(request.headers.get("authorization") ?? "")
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new HttpError(401, "Unauthorized.")
    const text = await request.text()
    if (text.length > 1024 * 1024) throw new HttpError(413, "Notification is too large.")
    const { events } = eventSchema.parse(JSON.parse(text))
    for (const event of events) {
      const name = event.target.repository
      const type = event.target.mediaType ?? ""
      if (
        event.action !== "push" ||
        !name ||
        !validRepositoryName(name) ||
        (!type.includes("manifest") && !type.includes("image.index"))
      )
        continue
      await db().transaction(async (tx) => {
        const inserted = await tx
          .insert(auditEvents)
          .values({
            id: event.id,
            actor: event.actor?.name || "registry-client",
            action: "image.push",
            target: name,
            details: { digest: event.target.digest, tag: event.target.tag },
            createdAt: new Date(event.timestamp),
          })
          .onConflictDoNothing()
          .returning({ id: auditEvents.id })
        if (!inserted.length) return
        await tx
          .insert(repositories)
          .values({
            name,
            visibility: config.defaultVisibility,
            updatedAt: new Date(event.timestamp),
          })
          .onConflictDoUpdate({
            target: repositories.name,
            set: { updatedAt: new Date(event.timestamp) },
          })
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

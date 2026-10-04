import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { auditEvents, projects, repositories } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { repositoryIdentity } from "@/lib/image-names"
import { config } from "@/lib/config"
import { apiError, HttpError } from "@/lib/http"
import { validRepositoryName } from "@/lib/permissions"
import { withImageResource } from "@/lib/resource-locks"
import { registryEventSchema } from "@/lib/registry-events"
import { recordPull } from "@/lib/pull-counts"

const eventSchema = z.object({
  events: z.array(registryEventSchema).max(500),
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
      if (event.action === "pull") {
        await recordPull(event)
        continue
      }
      const name = event.target.repository
      const type = event.target.mediaType ?? ""
      if (
        event.action !== "push" ||
        !name ||
        !validRepositoryName(name) ||
        (!type.includes("manifest") && !type.includes("image.index"))
      )
        continue
      await withImageResource(name, async (tx) => {
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
        const { projectName } = repositoryIdentity(name)
        let visibility = config.defaultVisibility
        let deletedAt: Date | null = null
        if (projectName) {
          await tx.insert(projects).values({ name: projectName, visibility }).onConflictDoNothing()
          const [project] = await tx
            .select()
            .from(projects)
            .where(eq(projects.name, projectName))
            .limit(1)
          visibility = project.visibility
          deletedAt = project.deletedAt
        }
        await tx
          .insert(repositories)
          .values({
            name,
            visibility,
            updatedAt: new Date(event.timestamp),
            deletedAt,
          })
          .onConflictDoUpdate({
            target: repositories.name,
            set: { updatedAt: new Date(event.timestamp), ...(deletedAt ? { deletedAt } : {}) },
          })
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

import { NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireUser } from "@/lib/auth"
import { db } from "@/lib/db"
import { auditEvents } from "@/lib/db/schema"
import { apiError } from "@/lib/http"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireUser(true)
    const events = await db()
      .select({
        id: auditEvents.id,
        actor: auditEvents.actor,
        action: auditEvents.action,
        target: auditEvents.target,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(100)
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return apiError(error)
  }
}

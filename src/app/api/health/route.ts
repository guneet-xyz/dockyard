import { NextResponse } from "next/server"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { registryRequest } from "@/lib/registry"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await Promise.all([db().execute(sql`SELECT 1`), registryRequest("/v2/")])
    return NextResponse.json({ status: "healthy" }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 })
  }
}

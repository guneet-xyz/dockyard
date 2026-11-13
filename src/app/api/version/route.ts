import { NextResponse } from "next/server"

import { requireUser } from "@/lib/auth"
import { apiError } from "@/lib/http"
import { updateStatus } from "@/lib/version"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireUser(true)
    return NextResponse.json(await updateStatus(), {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return apiError(error)
  }
}

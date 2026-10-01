import { NextResponse } from "next/server"
import { currentUser } from "@/lib/auth"
import { apiError } from "@/lib/http"
import { config } from "@/lib/config"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json(
      { user: await currentUser(), registryHost: config.registryHost },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return apiError(error)
  }
}

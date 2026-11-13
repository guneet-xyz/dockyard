import { NextResponse } from "next/server"

import { currentUser } from "@/lib/auth"
import { apiError } from "@/lib/http"
import { versionInfo } from "@/lib/version"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await currentUser()
    return NextResponse.json(await versionInfo(user?.role === "admin"), {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return apiError(error)
  }
}

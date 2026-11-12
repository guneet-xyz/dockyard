import { NextResponse } from "next/server"

import { apiError } from "@/lib/http"
import { popularPublic } from "@/lib/popular"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json(await popularPublic(), {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return apiError(error)
  }
}

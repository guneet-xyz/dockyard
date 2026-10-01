import { NextResponse } from "next/server"
import { endSession } from "@/lib/auth"
import { apiError, assertSameOrigin } from "@/lib/http"

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await endSession()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

import { NextResponse } from "next/server"
import { z } from "zod"
import { audit, checkCredentials, createSession } from "@/lib/auth"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const input = z
      .object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(72) })
      .parse(await jsonBody(request))
    const user = await checkCredentials(input.username, input.password)
    if (!user) throw new HttpError(401, "Incorrect username or password.")
    await createSession(user.id)
    await audit(user.username, "user.login", user.username)
    return NextResponse.json({ user })
  } catch (error) {
    return apiError(error)
  }
}

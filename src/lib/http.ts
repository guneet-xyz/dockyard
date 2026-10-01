import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { config } from "./config"

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin || origin !== new URL(config.appUrl).origin)
    throw new HttpError(403, "Request origin is not allowed.")
}

export function apiError(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  if (error instanceof SyntaxError)
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  console.error(error)
  return NextResponse.json(
    { error: "Something went wrong. Check the service logs and try again." },
    { status: 500 },
  )
}

export async function jsonBody(request: Request) {
  const text = await request.text()
  if (text.length > 16384) throw new HttpError(413, "Request body is too large.")
  return JSON.parse(text)
}

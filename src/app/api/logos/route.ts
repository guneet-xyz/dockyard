import { NextResponse } from "next/server"
import { z } from "zod"
import { currentUser, requireUser } from "@/lib/auth"
import { apiError, assertSameOrigin, HttpError } from "@/lib/http"
import { canWrite, validRepositoryName } from "@/lib/permissions"
import { validProjectName } from "@/lib/image-names"
import { MAX_LOGO_BYTES } from "@/lib/logo-constants"
import { changeLogo, normalizeLogo, readLogo } from "@/lib/logos"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function target(request: Request) {
  const query = new URL(request.url).searchParams
  const result = z
    .object({ kind: z.enum(["project", "image"]), name: z.string() })
    .parse({ kind: query.get("kind"), name: query.get("name") })
  if (
    !(result.kind === "project" ? validProjectName(result.name) : validRepositoryName(result.name))
  )
    throw new HttpError(400, "Invalid resource name.")
  return result
}

export async function GET(request: Request) {
  try {
    const { kind, name } = target(request)
    const logo = await readLogo(kind, name, await currentUser())
    return new Response(new Uint8Array(logo.data), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(logo.data.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'inline; filename="dockyard-logo.webp"',
      },
    })
  } catch (error) {
    const response = apiError(error)
    response.headers.set("Cache-Control", "private, no-store")
    return response
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    if (!canWrite(user)) throw new HttpError(403, "Maintainer or administrator access is required.")
    const { kind, name } = target(request)
    const length = request.headers.get("content-length")
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_LOGO_BYTES))
      throw new HttpError(413, "Choose a photo/logo no larger than 5 MiB.")
    if (!request.body) throw new HttpError(400, "Choose a photo/logo to upload.")
    const chunks: Buffer[] = []
    let size = 0
    const reader = request.body.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_LOGO_BYTES) {
          await reader.cancel()
          throw new HttpError(413, "Choose a photo/logo no larger than 5 MiB.")
        }
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    return NextResponse.json(
      await changeLogo(kind, name, await requireUser(), await normalizeLogo(Buffer.concat(chunks))),
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { kind, name } = target(request)
    return NextResponse.json(await changeLogo(kind, name, user, null), {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return apiError(error)
  }
}

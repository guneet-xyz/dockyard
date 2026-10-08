import { NextResponse } from "next/server"
import { Readable } from "node:stream"
import type { ReadableStream } from "node:stream/web"
import { requireUser } from "@/lib/auth"
import { apiError, assertSameOrigin, HttpError } from "@/lib/http"
import { canWrite } from "@/lib/permissions"
import { acquireImageUpload, imageUploadLimits } from "@/lib/upload-config"
import { imageUploadStatus, imageUploadTargetSchema, publishImageArchive } from "@/lib/image-upload"
import { planImageImport, stageImageArchive, type ImageArchive } from "@/lib/image-archive"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 1800

function target(request: Request) {
  const query = new URL(request.url).searchParams
  return imageUploadTargetSchema.parse({
    name: query.get("name"),
    tag: query.get("tag"),
    expectedDigest: query.get("expectedDigest"),
  })
}

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    if (!canWrite(user)) throw new HttpError(403, "Maintainer or administrator access is required.")
    return NextResponse.json(
      { ...(await imageUploadStatus(target(request), user)), ...imageUploadLimits() },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  let archive: ImageArchive | undefined
  let release: (() => void) | undefined
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    if (!canWrite(user)) throw new HttpError(403, "Maintainer or administrator access is required.")
    const input = target(request)
    const limits = imageUploadLimits()
    const length = request.headers.get("content-length")
    if (length && (!/^\d+$/.test(length) || Number(length) > limits.maxBytes))
      throw new HttpError(413, "Image archive exceeds the configured size limit.")
    if (!request.body) throw new HttpError(400, "Choose a Docker-save or OCI image archive.")
    const status = await imageUploadStatus(input, user)
    if (status.currentDigest !== input.expectedDigest)
      throw new HttpError(
        409,
        "The tag already exists or changed. Confirm replacement before uploading.",
      )
    release = acquireImageUpload()
    archive = await stageImageArchive(
      Readable.fromWeb(request.body as ReadableStream<Uint8Array>),
      limits,
      request.signal,
    )
    const plan = await planImageImport(archive)
    const current = await requireUser()
    if (!canWrite(current)) throw new HttpError(403, "Your write access changed during upload.")
    return NextResponse.json(await publishImageArchive(plan, input, current, request.signal), {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return request.signal.aborted
      ? NextResponse.json(
          { error: "Upload cancelled. Check the destination tag before retrying." },
          { status: 499 },
        )
      : apiError(error)
  } finally {
    try {
      if (archive) await archive.dispose()
    } catch (error) {
      console.error("Could not remove temporary image archive", error)
    } finally {
      release?.()
    }
  }
}

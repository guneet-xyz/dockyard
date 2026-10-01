import { NextResponse } from "next/server"
import { z } from "zod"
import { audit, currentUser, requireUser } from "@/lib/auth"
import { config } from "@/lib/config"
import { db } from "@/lib/db"
import { repositories } from "@/lib/db/schema"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"
import { canWrite, validRepositoryName } from "@/lib/permissions"
import { listRepositories } from "@/lib/registry"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await currentUser()
    return NextResponse.json(
      {
        repositories: await listRepositories(user),
        registryHost: config.registryHost,
        defaultVisibility: config.defaultVisibility,
        canWrite: canWrite(user),
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return apiError(error)
  }
}

// Reserve a name and visibility before the first push, so private images are never briefly public.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    if (!canWrite(user)) throw new HttpError(403, "Maintainer or administrator access is required.")
    const input = z
      .object({
        name: z
          .string()
          .refine(validRepositoryName, "Use a lowercase Docker repository name, e.g. team/api."),
        description: z.string().trim().max(500).default(""),
        visibility: z.enum(["public", "private"]),
      })
      .parse(await jsonBody(request))
    const [created] = await db()
      .insert(repositories)
      .values(input)
      .onConflictDoNothing()
      .returning()
    if (!created)
      throw new HttpError(
        409,
        "This repository is already configured. Edit it from its detail page.",
      )
    await audit(user.username, "repository.create", input.name, { visibility: input.visibility })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

import { NextResponse } from "next/server"
import { z } from "zod"
import { audit, currentUser, requireUser } from "@/lib/auth"
import { config } from "@/lib/config"
import { db } from "@/lib/db"
import { projects } from "@/lib/db/schema"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"
import { validProjectName } from "@/lib/image-names"
import { canWrite } from "@/lib/permissions"
import { listProjects } from "@/lib/projects"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await currentUser()
    return NextResponse.json(
      {
        ...(await listProjects(user)),
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

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    if (!canWrite(user)) throw new HttpError(403, "Maintainer or administrator access is required.")
    const input = z
      .object({
        name: z
          .string()
          .refine(validProjectName, "Use a single lowercase project name, e.g. dockyard."),
        description: z.string().trim().max(500).default(""),
        visibility: z.enum(["public", "private"]),
      })
      .parse(await jsonBody(request))
    const [project] = await db().insert(projects).values(input).onConflictDoNothing().returning()
    if (!project) throw new HttpError(409, "That project already exists.")
    await audit(user.username, "project.create", input.name, { visibility: input.visibility })
    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

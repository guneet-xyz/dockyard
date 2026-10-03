import { NextResponse } from "next/server"
import { z } from "zod"
import { audit, currentUser, requireUser } from "@/lib/auth"
import { config } from "@/lib/config"
import { db } from "@/lib/db"
import { projects, repositories } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"
import { canWrite } from "@/lib/permissions"
import { repositoryIdentity, validImageRepository } from "@/lib/image-names"
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
          .refine(
            validImageRepository,
            "Use exactly project/image, e.g. dockyard/init. Nested or unscoped names are not allowed for new images.",
          ),
        description: z.string().trim().max(500).default(""),
        visibility: z.enum(["public", "private"]),
      })
      .parse(await jsonBody(request))
    const projectName = repositoryIdentity(input.name).projectName!
    const created = await db().transaction(async (tx) => {
      await tx
        .insert(projects)
        .values({ name: projectName, visibility: config.defaultVisibility })
        .onConflictDoNothing()
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.name, projectName))
        .limit(1)
      if (project.visibility === "private" && input.visibility === "public")
        throw new HttpError(400, "Images in a private project must be private.")
      const [image] = await tx.insert(repositories).values(input).onConflictDoNothing().returning()
      return image
    })
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

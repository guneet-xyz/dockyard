import { NextResponse } from "next/server"
import { z } from "zod"
import { audit, currentUser, requireUser } from "@/lib/auth"
import { config } from "@/lib/config"
import { projects } from "@/lib/db/schema"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"
import { canWrite } from "@/lib/permissions"
import { readableProject } from "@/lib/projects"
import { withProjectResource } from "@/lib/resource-locks"
import { deleteProject } from "@/lib/resource-deletion"

type Context = { params: Promise<{ name: string }> }
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: Context) {
  try {
    const user = await currentUser()
    const name = (await context.params).name
    return NextResponse.json(
      {
        ...(await readableProject(name, user)),
        registryHost: config.registryHost,
        canWrite: canWrite(user),
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    if (!canWrite(user)) throw new HttpError(403, "Maintainer or administrator access is required.")
    const name = (await context.params).name
    const input = z
      .object({
        description: z.string().trim().max(500),
        visibility: z.enum(["public", "private"]),
      })
      .parse(await jsonBody(request))
    await withProjectResource(name, async (tx) => {
      await readableProject(name, user, tx)
      await tx
        .insert(projects)
        .values({ name, ...input })
        .onConflictDoUpdate({ target: projects.name, set: { ...input, updatedAt: new Date() } })
    })
    await audit(user.username, "project.update", name, { visibility: input.visibility })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    if (!canWrite(user)) throw new HttpError(403, "Maintainer or administrator access is required.")
    const name = (await context.params).name
    const { confirmName } = z
      .object({ confirmName: z.string() })
      .strict()
      .parse(await jsonBody(request))
    if (confirmName !== name)
      throw new HttpError(400, "Type the exact project name to confirm deletion.")
    return NextResponse.json(await deleteProject(name, user), {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return apiError(error)
  }
}

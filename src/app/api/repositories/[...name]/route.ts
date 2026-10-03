import { NextResponse } from "next/server"
import { z } from "zod"
import { audit, currentUser, requireUser } from "@/lib/auth"
import { repositories } from "@/lib/db/schema"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"
import { canWrite } from "@/lib/permissions"
import {
  deleteManifest,
  imageTag,
  listTags,
  readableRepository,
  repositoryPath,
} from "@/lib/registry"
import { withImageResource } from "@/lib/resource-locks"
import { deleteImageRepository } from "@/lib/resource-deletion"

type Context = { params: Promise<{ name: string[] }> }
export const dynamic = "force-dynamic"

export async function GET(request: Request, context: Context) {
  try {
    const name = (await context.params).name.join("/")
    const user = await currentUser()
    const metadata = await readableRepository(name, user)
    const tags = await listTags(name)
    const query = new URL(request.url).searchParams
    const page = Math.max(1, Number(query.get("page")) || 1)
    const search = query.get("search") ?? ""
    const filtered = tags
      .filter((tag) => tag.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        if (a === "latest") return -1
        if (b === "latest") return 1
        return b.localeCompare(a, undefined, { numeric: true })
      })
    const selected = filtered.slice((page - 1) * 10, page * 10)
    const images = []
    for (let i = 0; i < selected.length; i += 4)
      images.push(
        ...(await Promise.all(selected.slice(i, i + 4).map((tag) => imageTag(name, tag)))),
      )
    return NextResponse.json(
      {
        repository: { ...metadata, tagCount: tags.length, tags },
        images,
        total: filtered.length,
        page,
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
    const name = (await context.params).name.join("/")
    repositoryPath(name)
    const input = z
      .object({
        description: z.string().trim().max(500),
        visibility: z.enum(["public", "private"]),
      })
      .parse(await jsonBody(request))
    await withImageResource(name, async (tx) => {
      const current = await readableRepository(name, user, tx)
      if (current.projectVisibility === "private" && input.visibility === "public")
        throw new HttpError(400, "Images in a private project must be private.")
      await tx
        .insert(repositories)
        .values({ name, ...input })
        .onConflictDoUpdate({ target: repositories.name, set: { ...input, updatedAt: new Date() } })
    })
    await audit(user.username, "repository.update", name, { visibility: input.visibility })
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
    const name = (await context.params).name.join("/")
    repositoryPath(name)
    const input = z
      .union([
        z.object({ digest: z.string() }).strict(),
        z.object({ confirmName: z.string() }).strict(),
      ])
      .parse(await jsonBody(request))
    if ("confirmName" in input) {
      if (input.confirmName !== name)
        throw new HttpError(400, "Type the exact image path to confirm deletion.")
      return NextResponse.json(await deleteImageRepository(name, user), {
        headers: { "Cache-Control": "no-store" },
      })
    }
    await withImageResource(name, async (tx) => {
      await readableRepository(name, user, tx)
      await deleteManifest(name, input.digest)
    })
    await audit(user.username, "image.delete", name, { digest: input.digest })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

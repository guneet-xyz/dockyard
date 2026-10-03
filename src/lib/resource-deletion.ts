import { db, type DatabaseExecutor } from "./db"
import { auditEvents, projects, repositories } from "./db/schema"
import { HttpError } from "./http"
import { projectMetadata } from "./projects"
import {
  deleteManifest,
  listRepositories,
  listTags,
  registryRequest,
  repositoryExists,
  repositoryMetadata,
  repositoryPath,
} from "./registry"
import { withImageResource, withProjectResource } from "./resource-locks"
import type { SessionUser } from "./types"
import { config } from "./config"
import { canWrite } from "./permissions"

export async function deleteTaggedManifests(
  name: string,
  connection: DatabaseExecutor,
  onDeleted: () => void,
) {
  let tags: string[]
  try {
    tags = await listTags(name, connection)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return
    throw error
  }
  // Resolve every tag before deleting anything. Alias tags share one digest.
  const digests = new Set<string>()
  for (let i = 0; i < tags.length; i += 4) {
    const batch = await Promise.all(
      tags.slice(i, i + 4).map(async (tag) => {
        try {
          const response = await registryRequest(
            `/v2/${repositoryPath(name)}/manifests/${encodeURIComponent(tag)}`,
            name,
            "HEAD",
          )
          const digest = response.headers.get("Docker-Content-Digest")
          if (!digest || !/^sha256:[a-f0-9]{64}$/.test(digest))
            throw new HttpError(502, "The registry returned an invalid manifest digest.")
          return digest
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) return null
          throw error
        }
      }),
    )
    for (const digest of batch) if (digest) digests.add(digest)
  }
  for (const digest of digests) {
    try {
      await deleteManifest(name, digest)
      onDeleted()
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error
    }
  }
  try {
    if ((await listTags(name, connection)).length)
      throw new HttpError(409, "New tags appeared during deletion. Pause pushes and retry.")
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 404)) throw error
  }
}

async function retireImage(connection: DatabaseExecutor, name: string, deletedAt: Date) {
  const meta = await repositoryMetadata(name, connection)
  await connection
    .insert(repositories)
    .values({
      name,
      description: meta.description,
      visibility: meta.visibility,
      deletedAt,
      updatedAt: deletedAt,
    })
    .onConflictDoUpdate({ target: repositories.name, set: { deletedAt, updatedAt: deletedAt } })
}

async function reportPartialFailure(
  actor: SessionUser,
  action: string,
  name: string,
  deletedManifests: number,
  error: unknown,
): Promise<never> {
  if (deletedManifests) {
    try {
      await db()
        .insert(auditEvents)
        .values({
          actor: actor.username,
          action: `${action}_failed`,
          target: name,
          details: { deletedManifests },
        })
    } catch (auditError) {
      console.error("Could not record incomplete deletion", auditError)
    }
    throw new HttpError(
      error instanceof HttpError ? error.status : 502,
      "Deletion did not finish. Some manifests were already removed; metadata and visibility were retained. Pause pushes and retry.",
    )
  }
  throw error
}

export async function deleteImageRepository(name: string, actor: SessionUser) {
  if (!actor.enabled || !canWrite(actor))
    throw new HttpError(403, "Maintainer or administrator access is required.")
  let deletedManifests = 0
  try {
    return await withImageResource(name, async (tx) => {
      const metadata = await repositoryMetadata(name, tx)
      if (!metadata.configured && !(await repositoryExists(name)))
        throw new HttpError(404, "Image not found.")
      await deleteTaggedManifests(name, tx, () => deletedManifests++)
      await retireImage(tx, name, new Date())
      await tx.insert(auditEvents).values({
        actor: actor.username,
        action: "repository.delete",
        target: name,
        details: { deletedManifests },
      })
      return { ok: true, deletedManifests }
    })
  } catch (error) {
    return reportPartialFailure(actor, "repository.delete", name, deletedManifests, error)
  }
}

export async function deleteProject(name: string, actor: SessionUser) {
  if (!actor.enabled || !canWrite(actor))
    throw new HttpError(403, "Maintainer or administrator access is required.")
  let deletedManifests = 0
  try {
    return await withProjectResource(name, async (tx) => {
      const metadata = await projectMetadata(name, tx)
      const images = await listRepositories(actor, tx, true, name)
      if (!metadata && !images.length) throw new HttpError(404, "Project not found.")
      for (const image of images)
        await deleteTaggedManifests(image.name, tx, () => deletedManifests++)
      const remaining = await listRepositories(actor, tx, true, name)
      if (remaining.some((image) => image.tagCount))
        throw new HttpError(409, "New tags appeared during deletion. Pause pushes and retry.")
      const deletedAt = new Date()
      for (const image of remaining) await retireImage(tx, image.name, deletedAt)
      await tx
        .insert(projects)
        .values({
          name,
          description: metadata?.description ?? "",
          visibility: metadata?.visibility ?? config.defaultVisibility,
          deletedAt,
          updatedAt: deletedAt,
        })
        .onConflictDoUpdate({ target: projects.name, set: { deletedAt, updatedAt: deletedAt } })
      await tx.insert(auditEvents).values({
        actor: actor.username,
        action: "project.delete",
        target: name,
        details: { deletedImages: remaining.length, deletedManifests },
      })
      return { ok: true, deletedImages: remaining.length, deletedManifests }
    })
  } catch (error) {
    return reportPartialFailure(actor, "project.delete", name, deletedManifests, error)
  }
}

import { createReadStream } from "node:fs"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { config } from "./config"
import { HttpError } from "./http"
import { repositoryPath, readableRepository, repositoryExists } from "./registry"
import { signRegistryToken } from "./registry-token"
import { withImageResource } from "./resource-locks"
import { auditEvents, repositories, users } from "./db/schema"
import { canWrite, validRepositoryName } from "./permissions"
import type { SessionUser } from "./types"
import type { ImageImportPlan } from "./image-archive"
import { INTERNAL_REGISTRY_USER_AGENT } from "./registry-events"
import type { DatabaseExecutor } from "./db"

export const imageUploadTargetSchema = z.object({
  name: z.string().refine(validRepositoryName, "Invalid image path."),
  tag: z
    .string()
    .regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, "Use a valid Docker tag (up to 128 characters)."),
  expectedDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .nullable()
    .default(null),
})
export type ImageUploadTarget = z.infer<typeof imageUploadTargetSchema>

async function assertWritable(name: string, actor: SessionUser, connection: DatabaseExecutor) {
  const [current] = await connection
    .select({ enabled: users.enabled, role: users.role })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1)
  if (!current?.enabled || !canWrite(current))
    throw new HttpError(403, "Maintainer or administrator access is required.")
  const image = await readableRepository(name, actor, connection)
  if (!image.configured && !(await repositoryExists(name)))
    throw new HttpError(404, "Create or reserve the image before uploading an archive.")
  return image
}

function scopedClient(name: string, actor: SessionUser, signal?: AbortSignal) {
  const base = new URL(config.registryUrl)
  if (base.username || base.password || base.pathname !== "/")
    throw new HttpError(503, "The internal registry URL must be a root origin.")
  return async (
    resource: string | URL,
    method: string,
    body?: BodyInit | NodeJS.ReadableStream | Buffer,
    headers: Record<string, string> = {},
  ) => {
    const url = new URL(resource, base)
    if (url.origin !== base.origin)
      throw new HttpError(502, "Refusing to send upload credentials outside the registry origin.")
    const token = await signRegistryToken(actor.username, [
      { type: "repository", name, actions: ["pull", "push"] },
    ])
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": INTERNAL_REGISTRY_USER_AGENT,
        Accept:
          "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json",
        ...headers,
      },
      body: body as BodyInit | undefined,
      ...(body ? { duplex: "half" as const } : {}),
      redirect: "error",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(600000)])
        : AbortSignal.timeout(600000),
    }
    try {
      return await fetch(url, init)
    } catch (error) {
      if (signal?.aborted) throw error
      throw new HttpError(
        503,
        "The registry is unavailable or the upload timed out. Check the destination tag before retrying; an interrupted final request may have committed.",
      )
    }
  }
}

export function registryUploadLocation(
  location: string,
  name: string,
  registryUrl = config.registryUrl,
) {
  const base = new URL(registryUrl)
  const url = new URL(location, base)
  const prefix = `/v2/${repositoryPath(name)}/blobs/uploads/`
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.startsWith(prefix) ||
    !/^[A-Za-z0-9_-]+$/.test(url.pathname.slice(prefix.length))
  )
    throw new HttpError(502, "The registry returned an unsafe blob upload location.")
  return url
}

function checkResponse(response: Response, expected: number) {
  if (response.status !== expected)
    throw new HttpError(
      502,
      "The registry rejected the archive upload. Check the destination tag before retrying; unreferenced data may need garbage collection.",
    )
}

async function tagDigest(client: ReturnType<typeof scopedClient>, name: string, tag: string) {
  const response = await client(
    `/v2/${repositoryPath(name)}/manifests/${encodeURIComponent(tag)}`,
    "HEAD",
  )
  if (response.status === 404) return null
  checkResponse(response, 200)
  const digest = response.headers.get("Docker-Content-Digest")
  if (!digest || !/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new HttpError(502, "The registry returned an invalid manifest digest.")
  return digest
}

export async function imageUploadStatus(target: ImageUploadTarget, actor: SessionUser) {
  return withImageResource(
    target.name,
    async (tx) => {
      await assertWritable(target.name, actor, tx)
      return {
        currentDigest: await tagDigest(scopedClient(target.name, actor), target.name, target.tag),
      }
    },
    false,
  )
}

export async function publishImageArchive(
  plan: ImageImportPlan,
  target: ImageUploadTarget,
  actor: SessionUser,
  signal?: AbortSignal,
) {
  return withImageResource(target.name, async (tx) => {
    const metadata = await assertWritable(target.name, actor, tx)
    const client = scopedClient(target.name, actor, signal)
    const current = await tagDigest(client, target.name, target.tag)
    if (current !== target.expectedDigest)
      throw new HttpError(
        409,
        "The tag already exists or changed. Refresh its status and explicitly confirm replacement.",
      )
    const path = repositoryPath(target.name)
    for (const blob of plan.blobs) {
      const head = await client(`/v2/${path}/blobs/${blob.digest}`, "HEAD")
      if (head.status === 200) {
        if (
          head.headers.get("Docker-Content-Digest") !== blob.digest ||
          Number(head.headers.get("Content-Length")) !== blob.size
        )
          throw new HttpError(502, "Registry blob verification failed.")
        continue
      }
      checkResponse(head, 404)
      const started = await client(`/v2/${path}/blobs/uploads/`, "POST")
      checkResponse(started, 202)
      const location = started.headers.get("Location")
      if (!location)
        throw new HttpError(502, "The registry did not provide a blob upload location.")
      const url = registryUploadLocation(location, target.name)
      url.searchParams.set("digest", blob.digest)
      const response = await client(url, "PUT", createReadStream(blob.path), {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(blob.size),
      })
      checkResponse(response, 201)
      if (response.headers.get("Docker-Content-Digest") !== blob.digest)
        throw new HttpError(502, "Registry blob digest verification failed.")
    }
    for (const manifest of plan.manifests) {
      const response = await client(
        `/v2/${path}/manifests/${manifest.digest}`,
        "PUT",
        manifest.bytes,
        { "Content-Type": manifest.mediaType },
      )
      checkResponse(response, 201)
      if (response.headers.get("Docker-Content-Digest") !== manifest.digest)
        throw new HttpError(502, "Registry child manifest digest verification failed.")
    }
    // Cached CLI tokens can still write while namespace locks protect app/API writes.
    if ((await tagDigest(client, target.name, target.tag)) !== target.expectedDigest)
      throw new HttpError(
        409,
        "The destination tag changed during upload. Retry and confirm its current version.",
      )
    const published = await client(
      `/v2/${path}/manifests/${encodeURIComponent(target.tag)}`,
      "PUT",
      plan.root.bytes,
      { "Content-Type": plan.root.mediaType },
    )
    checkResponse(published, 201)
    if (published.headers.get("Docker-Content-Digest") !== plan.root.digest)
      throw new HttpError(502, "Registry manifest digest verification failed.")
    await tx
      .insert(repositories)
      .values({
        name: target.name,
        description: metadata.description,
        visibility: metadata.visibility,
      })
      .onConflictDoUpdate({ target: repositories.name, set: { updatedAt: new Date() } })
    await tx.insert(auditEvents).values({
      actor: actor.username,
      action: "image.upload",
      target: target.name,
      details: {
        tag: target.tag,
        digest: plan.root.digest,
        format: plan.format,
        platforms: plan.platforms,
        replacedDigest: current,
      },
    })
    return {
      ok: true,
      tag: target.tag,
      digest: plan.root.digest,
      platforms: plan.platforms,
      format: plan.format,
    }
  })
}

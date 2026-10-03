import { eq } from "drizzle-orm"
import { db, type DatabaseExecutor } from "./db"
import { projects, repositories } from "./db/schema"
import { config } from "./config"
import { HttpError } from "./http"
import { canRead, validRepositoryName } from "./permissions"
import { signRegistryToken } from "./registry-token"
import { effectiveVisibility, repositoryIdentity } from "./image-names"
import type { ImageTag, Repository, SessionUser } from "./types"

const acceptedManifests = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ")

type Descriptor = {
  digest: string
  size: number
  platform?: { os: string; architecture: string; variant?: string }
}
type Manifest = {
  mediaType: string
  config?: Descriptor
  layers?: Descriptor[]
  manifests?: Descriptor[]
}

export function repositoryPath(name: string) {
  if (!validRepositoryName(name)) throw new HttpError(400, "Invalid repository name.")
  return name.split("/").map(encodeURIComponent).join("/")
}

export async function registryRequest(path: string, name?: string, method = "GET") {
  const access = name
    ? [{ type: "repository", name, actions: ["pull", ...(method === "DELETE" ? ["delete"] : [])] }]
    : [{ type: "registry", name: "catalog", actions: ["*"] }]
  const token = await signRegistryToken("dockyard-service", access)
  let response: Response
  try {
    response = await fetch(`${config.registryUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: acceptedManifests },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    })
  } catch {
    throw new HttpError(
      503,
      "The registry is unavailable. Check that the registry service is running.",
    )
  }
  if (response.status === 404) throw new HttpError(404, "Repository or image not found.")
  if (!response.ok) {
    console.error("Registry error", response.status, path)
    throw new HttpError(502, "The registry rejected the request. Check the registry configuration.")
  }
  return response
}

async function paginatedList(
  path: string,
  field: "repositories" | "tags",
  name?: string,
): Promise<string[]> {
  const values: string[] = []
  let last: string | undefined
  // Pagination is based on the last name rather than following an untrusted Link URL.
  for (let page = 0; page < 1000; page++) {
    const response = await registryRequest(
      `${path}?n=1000${last ? `&last=${encodeURIComponent(last)}` : ""}`,
      name,
    )
    const data = await response.json()
    const entries: string[] = data[field] ?? []
    values.push(...entries)
    if (entries.length < 1000) return values
    const next = entries.at(-1)
    if (!next || next === last) throw new HttpError(502, "Invalid registry pagination.")
    last = next
  }
  throw new HttpError(502, "Registry listing exceeded the page limit.")
}

export async function repositoryMetadata(name: string, connection: DatabaseExecutor = db()) {
  repositoryPath(name)
  const identity = repositoryIdentity(name)
  const [metadata, project] = await Promise.all([
    connection
      .select()
      .from(repositories)
      .where(eq(repositories.name, name))
      .limit(1)
      .then((rows) => rows[0]),
    identity.projectName
      ? connection
          .select()
          .from(projects)
          .where(eq(projects.name, identity.projectName))
          .limit(1)
          .then((rows) => rows[0])
      : Promise.resolve(undefined),
  ])
  return {
    name,
    ...identity,
    configured: Boolean(metadata),
    deleted: Boolean(metadata?.deletedAt || project?.deletedAt),
    projectVisibility: project?.visibility ?? null,
    visibility: effectiveVisibility(
      metadata?.visibility,
      project?.visibility,
      config.defaultVisibility,
    ),
    description: metadata?.description ?? "",
    updatedAt: metadata?.updatedAt?.toISOString() ?? null,
  }
}

export async function repositoryExists(name: string) {
  try {
    await registryRequest(`/v2/${repositoryPath(name)}/tags/list?n=1`, name)
    return true
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return false
    throw error
  }
}

export async function readableRepository(
  name: string,
  user: SessionUser | null,
  connection: DatabaseExecutor = db(),
) {
  const metadata = await repositoryMetadata(name, connection)
  // Do not disclose existence of private repositories to guests.
  if (metadata.deleted || !canRead(user, metadata.visibility))
    throw new HttpError(404, "Repository not found.")
  return metadata
}

export async function listTags(name: string, connection: DatabaseExecutor = db()) {
  try {
    return await paginatedList(`/v2/${repositoryPath(name)}/tags/list`, "tags", name)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      const [reserved] = await connection
        .select({ name: repositories.name })
        .from(repositories)
        .where(eq(repositories.name, name))
        .limit(1)
      if (reserved) return []
    }
    throw error
  }
}

export async function listRepositories(
  user: SessionUser | null,
  connection: DatabaseExecutor = db(),
  includeDeleted = false,
  projectName?: string,
): Promise<Repository[]> {
  const [names, metadata, projectRows] = await Promise.all([
    paginatedList("/v2/_catalog", "repositories"),
    connection.select().from(repositories),
    connection.select().from(projects),
  ])
  const byName = new Map(metadata.map((repo) => [repo.name, repo]))
  const byProject = new Map(projectRows.map((project) => [project.name, project]))
  const visible = [...new Set([...names, ...metadata.map((repo) => repo.name)])]
    .sort()
    .filter((name) => {
      // Project operations must not enumerate tags in unrelated namespaces.
      if (projectName !== undefined && repositoryIdentity(name).projectName !== projectName)
        return false
      const meta = byName.get(name)
      const project = byProject.get(repositoryIdentity(name).projectName ?? "")
      return (
        (includeDeleted || (!meta?.deletedAt && !project?.deletedAt)) &&
        canRead(
          user,
          effectiveVisibility(
            byName.get(name)?.visibility,
            byProject.get(repositoryIdentity(name).projectName ?? "")?.visibility,
            config.defaultVisibility,
          ),
        )
      )
    })
  const results: Repository[] = []
  // Bounded concurrency prevents a large catalog from exhausting the registry.
  for (let i = 0; i < visible.length; i += 8) {
    const batch = await Promise.all(
      visible.slice(i, i + 8).map(async (name) => {
        const meta = byName.get(name)
        const identity = repositoryIdentity(name)
        const project = byProject.get(identity.projectName ?? "")
        const tags = await listTags(name, connection)
        return {
          name,
          ...identity,
          projectVisibility: project?.visibility ?? null,
          tags,
          tagCount: tags.length,
          visibility: effectiveVisibility(
            meta?.visibility,
            project?.visibility,
            config.defaultVisibility,
          ),
          description: meta?.description ?? "",
          updatedAt: meta?.updatedAt?.toISOString() ?? null,
        }
      }),
    )
    results.push(...batch)
  }
  return results
}

export async function imageTag(name: string, tag: string): Promise<ImageTag> {
  const path = repositoryPath(name)
  const response = await registryRequest(`/v2/${path}/manifests/${encodeURIComponent(tag)}`, name)
  const manifest: Manifest = await response.json()
  const digest = response.headers.get("Docker-Content-Digest") ?? ""
  const base = { name: tag, digest, created: null, mediaType: manifest.mediaType }
  if (manifest.manifests) {
    // Descriptor sizes are manifest sizes, not image sizes; inspect child manifests.
    let size = 0
    const platforms: string[] = []
    for (const descriptor of manifest.manifests) {
      if (descriptor.platform?.os === "unknown") continue // OCI attestation, not an image.
      const child: Manifest = await (
        await registryRequest(`/v2/${path}/manifests/${descriptor.digest}`, name)
      ).json()
      size +=
        (child.layers ?? []).reduce((sum, layer) => sum + layer.size, 0) + (child.config?.size ?? 0)
      const platform = descriptor.platform
      if (platform)
        platforms.push(
          `${platform.os}/${platform.architecture}${platform.variant ? `/${platform.variant}` : ""}`,
        )
    }
    return { ...base, size, platforms }
  }
  const size =
    (manifest.layers ?? []).reduce((sum, layer) => sum + layer.size, 0) +
    (manifest.config?.size ?? 0)
  if (!manifest.config) return { ...base, size, platforms: [] }
  const imageConfig = await (
    await registryRequest(`/v2/${path}/blobs/${manifest.config.digest}`, name)
  ).json()
  return {
    ...base,
    size,
    created: imageConfig.created ?? null,
    platforms:
      imageConfig.os && imageConfig.architecture
        ? [`${imageConfig.os}/${imageConfig.architecture}`]
        : [],
  }
}

export async function deleteManifest(name: string, digest: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new HttpError(400, "Invalid manifest digest.")
  await registryRequest(`/v2/${repositoryPath(name)}/manifests/${digest}`, name, "DELETE")
}

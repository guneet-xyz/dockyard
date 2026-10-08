import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable, Transform, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createGunzip } from "node:zlib"
import tar from "tar-stream"
import { z } from "zod"
import { HttpError } from "./http"

export const MAX_ARCHIVE_FILES = 10000
const MAX_JSON_BYTES = 4 * 1024 ** 2
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
const OCI_INDEX = "application/vnd.oci.image.index.v1+json"
const DOCKER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json"
const DOCKER_INDEX = "application/vnd.docker.distribution.manifest.list.v2+json"

export type ArchiveFile = { path: string; size: number; digest: string }
export type ImageArchive = {
  directory: string
  files: Map<string, ArchiveFile>
  dispose: () => Promise<void>
}
export type ImageImportPlan = {
  format: "docker" | "oci"
  blobs: ArchiveFile[]
  manifests: { bytes: Buffer; digest: string; mediaType: string }[]
  root: { bytes: Buffer; digest: string; mediaType: string }
  platforms: string[]
}
export type ArchiveLimits = {
  maxBytes: number
  maxExpandedBytes: number
  maxFiles?: number
  tempRoot?: string
}

export function archivePath(name: string) {
  if (
    !name ||
    name.length > 1024 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    /^[a-z]:/i.test(name) ||
    name.split("/").includes("..")
  )
    throw new HttpError(400, "Archive contains an unsafe path.")
  const normalized = path.posix.normalize(name).replace(/\/$/, "")
  if (normalized === "." || normalized.split("/").length > 64)
    throw new HttpError(400, "Archive contains an unsafe path.")
  return normalized
}

export function byteLimit(maxBytes: number) {
  let count = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      count += chunk.length
      done(
        count > maxBytes
          ? new HttpError(413, "Image archive exceeds the configured size limit.")
          : null,
        chunk,
      )
    },
  })
}

export async function stageImageArchive(
  source: Readable,
  limits: ArchiveLimits,
  signal?: AbortSignal,
): Promise<ImageArchive> {
  const directory = await mkdtemp(path.join(limits.tempRoot ?? tmpdir(), "dockyard-upload-"))
  const dispose = () => rm(directory, { recursive: true, force: true })
  const files = new Map<string, ArchiveFile>()
  const entries = new Set<string>()
  const tasks: Promise<unknown>[] = []
  try {
    const archiveFile = path.join(directory, "archive")
    await pipeline(
      source,
      byteLimit(limits.maxBytes),
      createWriteStream(archiveFile, { flags: "wx", mode: 0o600 }),
      { signal },
    )
    const handle = await open(archiveFile, "r")
    const magic = Buffer.alloc(2)
    await handle.read(magic, 0, 2, 0)
    await handle.close()
    const gzip = magic[0] === 0x1f && magic[1] === 0x8b
    const root = path.join(directory, "files")
    await mkdir(root, { mode: 0o700 })
    const extract = tar.extract()
    let entryCount = 0
    extract.on("entry", (header, entry, next) => {
      const task = (async () => {
        if (++entryCount > (limits.maxFiles ?? MAX_ARCHIVE_FILES))
          throw new HttpError(413, "Image archive contains too many entries.")
        if (header.type !== "file" && header.type !== "directory")
          throw new HttpError(400, "Archive links, devices, and special files are not supported.")
        if (
          !Number.isSafeInteger(header.size) ||
          header.size! < 0 ||
          header.size! > limits.maxExpandedBytes
        )
          throw new HttpError(413, "Invalid or oversized archive entry.")
        if (header.type === "directory" && [".", "./"].includes(header.name)) {
          entry.resume()
          return
        }
        const name = archivePath(header.name)
        if (entries.has(name)) throw new HttpError(400, "Archive contains duplicate paths.")
        entries.add(name)
        if (header.type === "directory") {
          if (header.size !== 0) throw new HttpError(400, "Invalid archive directory.")
          await pipeline(
            entry,
            new Writable({
              write(_chunk, _encoding, done) {
                done()
              },
            }),
          )
          return
        }
        const destination = path.join(root, name)
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
        const hash = createHash("sha256")
        let size = 0
        const hashing = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            size += chunk.length
            hash.update(chunk)
            done(null, chunk)
          },
        })
        await pipeline(
          entry,
          hashing,
          createWriteStream(destination, { flags: "wx", mode: 0o600 }),
          { signal },
        )
        if (size !== header.size) throw new HttpError(400, "Truncated archive entry.")
        files.set(name, { path: destination, size, digest: `sha256:${hash.digest("hex")}` })
      })()
      tasks.push(task)
      task.then(
        () => next(),
        (error: Error) => extract.destroy(error),
      )
    })
    const decoding = gzip
      ? createGunzip()
      : new Transform({
          transform(chunk, _encoding, done) {
            done(null, chunk)
          },
        })
    await pipeline(
      createReadStream(archiveFile),
      decoding,
      byteLimit(limits.maxExpandedBytes),
      extract,
      { signal },
    )
    await Promise.all(tasks)
    if (!files.size) throw new HttpError(400, "Image archive is empty.")
    return { directory, files, dispose }
  } catch (error) {
    await Promise.allSettled(tasks)
    await dispose()
    if (error instanceof HttpError || signal?.aborted) throw error
    throw new HttpError(400, "Invalid or truncated TAR/gzip image archive.")
  }
}

async function metadata(archive: ImageArchive, name: string) {
  const file = archive.files.get(archivePath(name))
  if (!file) throw new HttpError(400, `Archive is missing required content: ${name.slice(0, 128)}.`)
  if (file.size > MAX_JSON_BYTES) throw new HttpError(413, "Archive metadata is too large.")
  const bytes = await readFile(file.path)
  try {
    return { file, bytes, value: JSON.parse(bytes.toString("utf8")) as unknown }
  } catch {
    throw new HttpError(400, "Archive metadata is not valid JSON.")
  }
}

function manifestResult(bytes: Buffer, mediaType: string) {
  return { bytes, mediaType, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` }
}

const descriptorSchema = z
  .object({
    mediaType: z.string().min(1).max(255),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(),
    platform: z
      .object({
        os: z.string().min(1).max(64),
        architecture: z.string().min(1).max(64),
        variant: z.string().max(64).optional(),
      })
      .optional(),
    urls: z.array(z.string()).max(0).optional(),
  })
  .passthrough()
const indexSchema = z
  .object({
    schemaVersion: z.literal(2),
    mediaType: z.string().optional(),
    manifests: z.array(descriptorSchema).min(1).max(256),
    subject: descriptorSchema.optional(),
  })
  .passthrough()
const manifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    mediaType: z.string(),
    config: descriptorSchema,
    layers: z.array(descriptorSchema).max(4096),
    subject: descriptorSchema.optional(),
  })
  .passthrough()

async function dockerPlan(archive: ImageArchive): Promise<ImageImportPlan> {
  const manifest = await metadata(archive, "manifest.json")
  const entries = z
    .array(
      z.object({
        Config: z.string(),
        Layers: z.array(z.string()).max(4096),
        RepoTags: z.array(z.string()).nullable().optional(),
      }),
    )
    .length(1, "Export a single image with docker save.")
    .parse(manifest.value)
  const entry = entries[0]
  const image = await metadata(archive, entry.Config)
  const config = z
    .object({
      os: z.string().min(1).max(64),
      architecture: z.string().min(1).max(64),
      rootfs: z.object({
        type: z.literal("layers"),
        diff_ids: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/)),
      }),
    })
    .passthrough()
    .parse(image.value)
  if (entry.Layers.length !== config.rootfs.diff_ids.length)
    throw new HttpError(400, "Docker archive layer count does not match its image configuration.")
  const layers = entry.Layers.map((name, i) => {
    const file = archive.files.get(archivePath(name))
    if (!file || file.digest !== config.rootfs.diff_ids[i])
      throw new HttpError(
        400,
        "Docker archive has missing or corrupt uncompressed layers. Use an OCI archive for compressed layers.",
      )
    return file
  })
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: OCI_MANIFEST,
      config: {
        mediaType: "application/vnd.oci.image.config.v1+json",
        digest: image.file.digest,
        size: image.file.size,
      },
      layers: layers.map((file) => ({
        mediaType: "application/vnd.oci.image.layer.v1.tar",
        digest: file.digest,
        size: file.size,
      })),
    }),
  )
  return {
    format: "docker",
    blobs: [...new Map([image.file, ...layers].map((file) => [file.digest, file])).values()],
    manifests: [],
    root: manifestResult(bytes, OCI_MANIFEST),
    platforms: [`${config.os}/${config.architecture}`],
  }
}

async function ociPlan(archive: ImageArchive): Promise<ImageImportPlan> {
  z.object({ imageLayoutVersion: z.literal("1.0.0") }).parse(
    (await metadata(archive, "oci-layout")).value,
  )
  const outer = await metadata(archive, "index.json")
  const index = indexSchema.parse(outer.value)
  const unique = [...new Map(index.manifests.map((entry) => [entry.digest, entry])).values()]
  const manifests: ImageImportPlan["manifests"] = []
  const blobs = new Map<string, ArchiveFile>()
  const visited = new Set<string>()
  const platforms = new Set<string>()
  function content(descriptor: z.infer<typeof descriptorSchema>) {
    const file = archive.files.get(`blobs/sha256/${descriptor.digest.slice(7)}`)
    if (!file || file.digest !== descriptor.digest || file.size !== descriptor.size)
      throw new HttpError(400, "OCI archive has missing or corrupt content.")
    return file
  }
  async function visit(descriptor: z.infer<typeof descriptorSchema>, depth = 0) {
    content(descriptor)
    if (depth > 32 || visited.size >= 512)
      throw new HttpError(413, "OCI manifest graph is too large.")
    if (descriptor.platform && descriptor.platform.os !== "unknown")
      platforms.add(
        `${descriptor.platform.os}/${descriptor.platform.architecture}${descriptor.platform.variant ? `/${descriptor.platform.variant}` : ""}`,
      )
    if (visited.has(descriptor.digest)) return
    visited.add(descriptor.digest)
    const document = await metadata(archive, `blobs/sha256/${descriptor.digest.slice(7)}`)
    if ([OCI_INDEX, DOCKER_INDEX].includes(descriptor.mediaType)) {
      const nested = indexSchema.parse(document.value)
      if (nested.mediaType && nested.mediaType !== descriptor.mediaType)
        throw new HttpError(400, "OCI index media type does not match its descriptor.")
      for (const child of nested.manifests) await visit(child, depth + 1)
      if (nested.subject) await visit(nested.subject, depth + 1)
    } else if ([OCI_MANIFEST, DOCKER_MANIFEST].includes(descriptor.mediaType)) {
      const manifest = manifestSchema.parse(document.value)
      if (manifest.mediaType !== descriptor.mediaType)
        throw new HttpError(400, "OCI manifest media type does not match its descriptor.")
      for (const child of [manifest.config, ...manifest.layers])
        blobs.set(child.digest, content(child))
      if (manifest.subject) await visit(manifest.subject, depth + 1)
      if (
        manifest.config.mediaType === "application/vnd.oci.image.config.v1+json" ||
        manifest.config.mediaType === "application/vnd.docker.container.image.v1+json"
      ) {
        const config = z
          .object({ os: z.string().min(1).max(64), architecture: z.string().min(1).max(64) })
          .passthrough()
          .parse((await metadata(archive, `blobs/sha256/${manifest.config.digest.slice(7)}`)).value)
        if (
          descriptor.platform &&
          descriptor.platform.os !== "unknown" &&
          (descriptor.platform.os !== config.os ||
            descriptor.platform.architecture !== config.architecture)
        )
          throw new HttpError(400, "OCI platform metadata does not match the image configuration.")
        if (!descriptor.platform && config.os !== "unknown" && config.architecture !== "unknown")
          platforms.add(`${config.os}/${config.architecture}`)
      }
    } else throw new HttpError(400, "Unsupported OCI manifest type.")
    manifests.push(manifestResult(document.bytes, descriptor.mediaType))
  }
  if (unique.length > 1 && !unique.every((entry) => entry.platform))
    throw new HttpError(
      400,
      "OCI archive contains multiple unrelated image references. Export one image or a multi-platform index.",
    )
  for (const root of unique) await visit(root)
  const root =
    unique.length === 1
      ? manifests.find((entry) => entry.digest === unique[0].digest)!
      : manifestResult(Buffer.from(JSON.stringify({ ...index, mediaType: OCI_INDEX })), OCI_INDEX)
  if (!platforms.size)
    throw new HttpError(400, "OCI archive does not contain a container image configuration.")
  return {
    format: "oci",
    blobs: [...blobs.values()],
    manifests: manifests.filter((entry) => entry.digest !== root.digest),
    root,
    platforms: [...platforms].sort(),
  }
}

export async function planImageImport(archive: ImageArchive) {
  try {
    if (archive.files.has("oci-layout")) return await ociPlan(archive)
    if (archive.files.has("manifest.json")) return await dockerPlan(archive)
    throw new HttpError(
      400,
      "Choose a Docker-save or OCI-layout archive, not a Dockerfile, filesystem export, or ordinary file.",
    )
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof z.ZodError)
      throw new HttpError(
        400,
        "Image archive metadata does not match the supported Docker/OCI format.",
      )
    throw error
  }
}

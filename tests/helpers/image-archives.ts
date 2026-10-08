import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
import tar from "tar-stream"
import type { Header } from "tar-stream"

export async function tarBytes(
  entries: { name: string; bytes?: Buffer | string; type?: Header["type"]; linkname?: string }[],
) {
  const pack = tar.pack()
  const collecting = (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of pack) chunks.push(Buffer.from(chunk as Uint8Array))
    return Buffer.concat(chunks)
  })()
  for (const entry of entries) {
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes ?? "")
    await new Promise<void>((resolve, reject) =>
      pack.entry(
        {
          name: entry.name,
          type: entry.type ?? "file",
          linkname: entry.linkname,
          size: bytes.length,
          mode: 0o644,
        },
        bytes,
        (error) => (error ? reject(error) : resolve()),
      ),
    )
  }
  pack.finalize()
  return collecting
}

export async function dockerArchive({
  gzip = false,
  multiple = false,
  corruptLayer = false,
  architecture = "arm64",
} = {}) {
  const layer = await tarBytes([{ name: "hello.txt", bytes: "Uploaded from Dockyard\n" }])
  const diff = `sha256:${createHash("sha256").update(layer).digest("hex")}`
  const config = Buffer.from(
    JSON.stringify({
      architecture,
      os: "linux",
      config: {},
      rootfs: { type: "layers", diff_ids: [corruptLayer ? `sha256:${"0".repeat(64)}` : diff] },
      history: [{ created_by: "archive fixture" }],
    }),
  )
  const record = {
    Config: "config.json",
    RepoTags: ["source/example:latest"],
    Layers: ["layer/layer.tar"],
  }
  const bytes = await tarBytes([
    { name: "manifest.json", bytes: JSON.stringify(multiple ? [record, record] : [record]) },
    { name: "config.json", bytes: config },
    { name: "layer/", type: "directory" },
    { name: "layer/layer.tar", bytes: layer },
  ])
  return gzip ? gzipSync(bytes) : bytes
}

export async function ociArchive({
  multi = false,
  corrupt = false,
  gzip = false,
  platformMismatch = false,
} = {}) {
  const files = new Map<string, Buffer>()
  function blob(bytes: Buffer) {
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    files.set(`blobs/sha256/${digest.slice(7)}`, bytes)
    return { digest, size: bytes.length }
  }
  const layer = await tarBytes([{ name: "hello.txt", bytes: "OCI upload\n" }])
  const compressed = blob(gzipSync(layer))
  const diff = `sha256:${createHash("sha256").update(layer).digest("hex")}`
  const manifests = (multi ? ["amd64", "arm64"] : ["arm64"]).map((architecture) => {
    const config = blob(
      Buffer.from(
        JSON.stringify({
          os: "linux",
          architecture,
          config: {},
          rootfs: { type: "layers", diff_ids: [diff] },
        }),
      ),
    )
    const bytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        config: { ...config, mediaType: "application/vnd.oci.image.config.v1+json" },
        layers: [{ ...compressed, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip" }],
      }),
    )
    return {
      ...blob(bytes),
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      platform: { os: "linux", architecture: platformMismatch ? "incorrect" : architecture },
    }
  })
  const root = multi
    ? {
        ...blob(
          Buffer.from(
            JSON.stringify({
              schemaVersion: 2,
              mediaType: "application/vnd.oci.image.index.v1+json",
              manifests,
            }),
          ),
        ),
        mediaType: "application/vnd.oci.image.index.v1+json",
      }
    : manifests[0]
  if (corrupt) files.set(`blobs/sha256/${compressed.digest.slice(7)}`, Buffer.from("wrong content"))
  const archive = await tarBytes([
    { name: "oci-layout", bytes: JSON.stringify({ imageLayoutVersion: "1.0.0" }) },
    { name: "index.json", bytes: JSON.stringify({ schemaVersion: 2, manifests: [root] }) },
    ...[...files].map(([name, bytes]) => ({ name, bytes })),
  ])
  return gzip ? gzipSync(archive) : archive
}

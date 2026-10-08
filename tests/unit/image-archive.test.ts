import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { Readable } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  archivePath,
  planImageImport,
  stageImageArchive,
  type ImageArchive,
} from "@/lib/image-archive"
import { registryUploadLocation, imageUploadTargetSchema } from "@/lib/image-upload"
import { acquireImageUpload, imageUploadLimits } from "@/lib/upload-config"
import { resourceSettingsSchema } from "@/lib/resource-settings"
import { dockerArchive, ociArchive, tarBytes } from "../helpers/image-archives"

const staged: ImageArchive[] = []
const tempRoot = existsSync("/tmp/opencode") ? "/tmp/opencode" : undefined
async function stage(bytes: Buffer, limits = {}) {
  const archive = await stageImageArchive(Readable.from([bytes]), {
    maxBytes: 1024 * 1024,
    maxExpandedBytes: 4 * 1024 * 1024,
    tempRoot,
    ...limits,
  })
  staged.push(archive)
  return archive
}
afterEach(async () => {
  await Promise.all(staged.splice(0).map((archive) => archive.dispose()))
  vi.unstubAllEnvs()
})

describe("container archive upload validation", () => {
  it.each([false, true])(
    "imports a Docker-save archive without executing/extracting inner layer contents (gzip=%s)",
    async (gzip) => {
      const archive = await stage(await dockerArchive({ gzip }))
      const plan = await planImageImport(archive)
      expect(plan.format).toBe("docker")
      expect(plan.platforms).toEqual(["linux/arm64"])
      expect(plan.blobs).toHaveLength(2)
      expect(JSON.parse(plan.root.bytes.toString()).layers[0].mediaType).toBe(
        "application/vnd.oci.image.layer.v1.tar",
      )
      expect(archive.files.has("hello.txt")).toBe(false)
      expect((await readFile(plan.blobs[0].path)).length).toBeGreaterThan(0)
    },
  )
  it.each([false, true])("imports a digest-checked OCI image/index (multi=%s)", async (multi) => {
    const plan = await planImageImport(await stage(await ociArchive({ multi, gzip: true })))
    expect(plan.format).toBe("oci")
    expect(plan.platforms).toEqual(multi ? ["linux/amd64", "linux/arm64"] : ["linux/arm64"])
    expect(plan.root.mediaType).toBe(
      multi
        ? "application/vnd.oci.image.index.v1+json"
        : "application/vnd.oci.image.manifest.v1+json",
    )
    expect(plan.manifests).toHaveLength(multi ? 2 : 0)
  })
  it("rejects ambiguous Docker exports and corrupt Docker/OCI content before publication", async () => {
    await expect(
      planImageImport(await stage(await dockerArchive({ multiple: true }))),
    ).rejects.toThrow("supported Docker/OCI")
    await expect(
      planImageImport(await stage(await dockerArchive({ corruptLayer: true }))),
    ).rejects.toThrow("corrupt uncompressed layers")
    await expect(planImageImport(await stage(await ociArchive({ corrupt: true })))).rejects.toThrow(
      "corrupt content",
    )
    await expect(
      planImageImport(await stage(await ociArchive({ platformMismatch: true }))),
    ).rejects.toThrow("platform metadata")
  })
  it.each([
    "../outside",
    "/absolute",
    "nested/../outside",
    "C:\\outside",
    "nested\\file",
    "./../outside",
  ])("rejects archive traversal path %s", async (name) => {
    expect(() => archivePath(name)).toThrow("unsafe path")
    await expect(stage(await tarBytes([{ name, bytes: "bad" }]))).rejects.toThrow("unsafe path")
  })
  it("rejects links and duplicate normalized paths", async () => {
    await expect(
      stage(await tarBytes([{ name: "link", type: "symlink", linkname: "/outside" }])),
    ).rejects.toThrow("special files")
    await expect(
      stage(await tarBytes([{ name: "hard-link", type: "link", linkname: "outside" }])),
    ).rejects.toThrow("special files")
    await expect(
      stage(
        await tarBytes([
          { name: "file", bytes: "one" },
          { name: "./file", bytes: "two" },
        ]),
      ),
    ).rejects.toThrow("duplicate paths")
  })
  it("bounds transferred bytes, expanded bytes and file counts", async () => {
    const bytes = await dockerArchive({ gzip: true })
    await expect(stage(bytes, { maxBytes: 10 })).rejects.toThrow("size limit")
    await expect(stage(bytes, { maxExpandedBytes: 128 })).rejects.toThrow("size limit")
    await expect(stage(await dockerArchive(), { maxFiles: 1 })).rejects.toThrow("too many entries")
  })
  it("rejects ordinary files and filesystem archives rather than executing a build", async () => {
    await expect(stage(Buffer.from("not a tar archive"))).rejects.toThrow("Invalid or truncated")
    await expect(
      planImageImport(await stage(await tarBytes([{ name: "Dockerfile", bytes: "FROM alpine" }]))),
    ).rejects.toThrow("Docker-save or OCI-layout")
  })
  it("restricts registry upload redirects to the same origin and repository", () => {
    expect(
      registryUploadLocation(
        "/v2/team/app/blobs/uploads/abc-123?_state=opaque",
        "team/app",
        "http://registry:5000",
      ).origin,
    ).toBe("http://registry:5000")
    for (const location of [
      "https://evil.example/v2/team/app/blobs/uploads/abc",
      "/v2/other/app/blobs/uploads/abc",
      "/v2/team/app/blobs/uploads/abc/../../outside",
      "http://user:secret@registry:5000/v2/team/app/blobs/uploads/abc",
    ])
      expect(() => registryUploadLocation(location, "team/app", "http://registry:5000")).toThrow(
        "unsafe blob upload",
      )
  })
  it("validates destination tags independently of untrusted archive repository tags", () => {
    expect(
      imageUploadTargetSchema.parse({ name: "team/app", tag: "release-1.0" }).expectedDigest,
    ).toBeNull()
    expect(() => imageUploadTargetSchema.parse({ name: "team/app", tag: "../bad" })).toThrow()
  })
})

describe("description-only updates and upload limits", () => {
  it("permits multiline descriptions without changing visibility, including clearing", () => {
    expect(resourceSettingsSchema.parse({ description: "  line one\nline two  " })).toEqual({
      description: "line one\nline two",
    })
    expect(resourceSettingsSchema.parse({ description: "" })).toEqual({ description: "" })
    expect(
      resourceSettingsSchema.parse({ description: "a".repeat(5000) }).description,
    ).toHaveLength(5000)
    expect(() => resourceSettingsSchema.parse({ description: "a".repeat(5001) })).toThrow()
    expect(() => resourceSettingsSchema.parse({})).toThrow()
    expect(() => resourceSettingsSchema.parse({ deletedAt: null })).toThrow()
  })
  it("limits active uploads per instance and releases slots idempotently", () => {
    const first = acquireImageUpload()
    const second = acquireImageUpload()
    expect(() => acquireImageUpload()).toThrow("already running")
    first()
    first()
    const third = acquireImageUpload()
    second()
    third()
    expect(imageUploadLimits().maxBytes).toBe(1024 ** 3)
    vi.stubEnv("IMAGE_UPLOAD_MAX_BYTES", "0")
    expect(() => imageUploadLimits()).toThrow("misconfigured")
  })
})

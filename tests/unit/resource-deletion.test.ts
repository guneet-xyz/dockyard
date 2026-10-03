import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  deleteTaggedManifests,
  deleteImageRepository,
  deleteProject,
} from "@/lib/resource-deletion"
import type { DatabaseExecutor } from "@/lib/db"
import { HttpError } from "@/lib/http"
import type { SessionUser } from "@/lib/types"

const mocks = vi.hoisted(() => ({
  tags: vi.fn(),
  request: vi.fn(),
  deleteManifest: vi.fn(),
  listRepositories: vi.fn(),
  metadata: vi.fn(),
  transaction: vi.fn(),
  txInsert: vi.fn(),
  txExecute: vi.fn(),
  failureAudit: vi.fn(),
}))
vi.mock("@/lib/db", () => ({
  db: () => ({ transaction: mocks.transaction, insert: () => ({ values: mocks.failureAudit }) }),
}))
vi.mock("@/lib/registry", () => ({
  listTags: mocks.tags,
  registryRequest: mocks.request,
  deleteManifest: mocks.deleteManifest,
  repositoryPath: (name: string) => name,
  repositoryMetadata: mocks.metadata,
  repositoryExists: vi.fn(),
  listRepositories: mocks.listRepositories,
}))
const connection = {} as DatabaseExecutor
const first = `sha256:${"a".repeat(64)}`
const second = `sha256:${"b".repeat(64)}`
beforeEach(() => {
  vi.clearAllMocks()
  mocks.tags.mockReset()
  mocks.request.mockReset()
  mocks.deleteManifest.mockReset()
  mocks.deleteManifest.mockResolvedValue(undefined)
  mocks.listRepositories.mockReset()
  mocks.metadata.mockReset()
  mocks.transaction.mockReset()
  mocks.failureAudit.mockResolvedValue([])
})

describe("delete every tagged manifest in an image", () => {
  it("deletes shared alias digests once and resolves the complete plan before deleting", async () => {
    mocks.tags.mockResolvedValueOnce(["latest", "1.0", "2.0"]).mockResolvedValueOnce([])
    mocks.request.mockImplementation(
      async (path: string) =>
        new Response(null, {
          headers: { "Docker-Content-Digest": path.endsWith("2.0") ? second : first },
        }),
    )
    const removed = vi.fn()
    await deleteTaggedManifests("team/api", connection, removed)
    expect(mocks.request).toHaveBeenCalledTimes(3)
    expect(mocks.request).toHaveBeenCalledWith("/v2/team/api/manifests/latest", "team/api", "HEAD")
    expect(mocks.deleteManifest.mock.calls).toEqual([
      ["team/api", first],
      ["team/api", second],
    ])
    expect(removed).toHaveBeenCalledTimes(2)
    expect(Math.max(...mocks.request.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...mocks.deleteManifest.mock.invocationCallOrder),
    )
  })
  it("refuses an invalid digest or a failed plan without deleting anything", async () => {
    mocks.tags.mockResolvedValue(["latest"])
    mocks.request.mockResolvedValue(
      new Response(null, { headers: { "Docker-Content-Digest": "../../wrong" } }),
    )
    await expect(deleteTaggedManifests("team/api", connection, vi.fn())).rejects.toThrow(
      "invalid manifest digest",
    )
    expect(mocks.deleteManifest).not.toHaveBeenCalled()
    mocks.request.mockRejectedValue(new HttpError(503, "Unavailable"))
    await expect(deleteTaggedManifests("team/api", connection, vi.fn())).rejects.toThrow(
      "Unavailable",
    )
    expect(mocks.deleteManifest).not.toHaveBeenCalled()
  })
  it("handles empty reserved images and already-removed tags/manifests idempotently", async () => {
    mocks.tags.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await deleteTaggedManifests("team/empty", connection, vi.fn())
    expect(mocks.deleteManifest).not.toHaveBeenCalled()
    mocks.tags.mockResolvedValueOnce(["gone", "latest"]).mockResolvedValueOnce([])
    mocks.request.mockImplementation(async (path: string) => {
      if (path.endsWith("gone")) throw new HttpError(404, "Gone")
      return new Response(null, { headers: { "Docker-Content-Digest": first } })
    })
    mocks.deleteManifest.mockRejectedValue(new HttpError(404, "Gone"))
    const removed = vi.fn()
    await deleteTaggedManifests("team/api", connection, removed)
    expect(removed).not.toHaveBeenCalled()
  })
  it("detects pushes that race with deletion instead of claiming success", async () => {
    mocks.tags.mockResolvedValueOnce(["latest"]).mockResolvedValueOnce(["new-tag"])
    mocks.request.mockResolvedValue(
      new Response(null, { headers: { "Docker-Content-Digest": first } }),
    )
    await expect(deleteTaggedManifests("team/api", connection, vi.fn())).rejects.toThrow(
      "New tags appeared",
    )
  })
  it("does not hide a registry failure after a previous manifest was removed", async () => {
    mocks.tags.mockResolvedValueOnce(["one", "two"])
    mocks.request.mockImplementation(
      async (path: string) =>
        new Response(null, {
          headers: { "Docker-Content-Digest": path.endsWith("one") ? first : second },
        }),
    )
    mocks.deleteManifest
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new HttpError(503, "Unavailable"))
    const removed = vi.fn()
    await expect(deleteTaggedManifests("team/api", connection, removed)).rejects.toThrow(
      "Unavailable",
    )
    expect(removed).toHaveBeenCalledTimes(1)
  })
  it("rejects viewers and disabled actors before any privileged registry operation", async () => {
    const viewer: SessionUser = {
      id: "viewer",
      username: "viewer",
      name: "Viewer",
      role: "viewer",
      enabled: true,
    }
    await expect(deleteImageRepository("team/api", viewer)).rejects.toThrow("Maintainer")
    await expect(deleteProject("team", viewer)).rejects.toThrow("Maintainer")
    await expect(
      deleteProject("team", { ...viewer, role: "admin", enabled: false }),
    ).rejects.toThrow("Maintainer")
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it("retains private project/image metadata on a partial project failure and audits the removed manifests", async () => {
    const project = {
      name: "team",
      description: "Private project",
      visibility: "private",
      deletedAt: null,
    }
    const tx = {
      execute: mocks.txExecute,
      insert: mocks.txInsert,
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [project] }) }) }),
    }
    mocks.transaction.mockImplementation(async (callback) => callback(tx))
    mocks.txExecute.mockResolvedValue([])
    mocks.listRepositories.mockResolvedValue([
      { name: "team/a", projectName: "team" },
      { name: "team/b", projectName: "team" },
    ])
    mocks.tags
      .mockResolvedValueOnce(["latest"])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["latest"])
    mocks.request.mockImplementation(
      async (path: string) =>
        new Response(null, {
          headers: { "Docker-Content-Digest": path.includes("team/a/") ? first : second },
        }),
    )
    mocks.deleteManifest
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new HttpError(503, "Unavailable"))
    const actor: SessionUser = {
      id: "owner",
      username: "maintainer",
      name: "Maintainer",
      role: "maintainer",
      enabled: true,
    }
    await expect(deleteProject("team", actor)).rejects.toThrow(
      "metadata and visibility were retained",
    )
    expect(mocks.txInsert).not.toHaveBeenCalled()
    expect(mocks.listRepositories).toHaveBeenCalledWith(actor, tx, true, "team")
    expect(mocks.metadata).not.toHaveBeenCalled()
    expect(project).toMatchObject({ visibility: "private", deletedAt: null })
    expect(mocks.failureAudit).toHaveBeenCalledWith({
      actor: "maintainer",
      action: "project.delete_failed",
      target: "team",
      details: { deletedManifests: 1 },
    })
  })
})

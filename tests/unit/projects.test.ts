import { afterEach, describe, expect, it, vi } from "vitest"
import {
  effectiveVisibility,
  imageHref,
  repositoryIdentity,
  validImageRepository,
  validProjectName,
} from "@/lib/image-names"
import { summarizeProjects } from "@/lib/projects"
import type { Repository, SessionUser } from "@/lib/types"

afterEach(() => vi.unstubAllEnvs())

const user: SessionUser = {
  id: "test",
  username: "viewer",
  name: "Viewer",
  role: "viewer",
  enabled: true,
}
function image(name: string, tags = 1): Repository {
  return {
    name,
    ...repositoryIdentity(name),
    visibility: "public",
    projectVisibility: null,
    description: "",
    updatedAt: null,
    tagCount: tags,
    tags: [],
  }
}

describe("project and image names", () => {
  it.each(["dockyard/init", "my-project/my-image", "team/api.v1", "team/foo__bar"])(
    "accepts exactly project/image: %s",
    (name) => expect(validImageRepository(name)).toBe(true),
  )
  it.each([
    "alpine",
    "team/backend/api",
    "TEAM/api",
    "team/",
    "/api",
    "team//api",
    "host:5000/team/api",
    "team/api:latest",
    `team/${"a".repeat(251)}`,
  ])("rejects new unscoped, nested, or invalid names: %s", (name) =>
    expect(validImageRepository(name)).toBe(false),
  )
  it("keeps the first segment as project identity for legacy names", () => {
    expect(repositoryIdentity("dockyard/init")).toEqual({
      projectName: "dockyard",
      imageName: "init",
      legacy: false,
    })
    expect(repositoryIdentity("team/backend/api")).toEqual({
      projectName: "team",
      imageName: "backend/api",
      legacy: true,
    })
    expect(repositoryIdentity("alpine")).toEqual({
      projectName: null,
      imageName: "alpine",
      legacy: true,
    })
    expect(imageHref("dockyard/init")).toBe("/projects/dockyard/images/init")
    expect(imageHref("team/backend/api")).toBe("/repositories/team/backend/api")
  })
  it("requires a single valid project name", () => {
    expect(validProjectName("dockyard")).toBe(true)
    expect(validProjectName("team/backend")).toBe(false)
    expect(validProjectName("../secret")).toBe(false)
  })
})

describe("project visibility", () => {
  it("never rediscovers a deleted project from retained Distribution catalog paths", () => {
    const rows = [
      {
        name: "deleted",
        description: "Private metadata",
        visibility: "private" as const,
        updatedAt: new Date(),
        deletedAt: new Date(),
      },
    ]
    expect(
      summarizeProjects(rows, [image("deleted/api"), image("deleted/legacy/deep")], user),
    ).toEqual([])
    expect(summarizeProjects(rows, [image("deleted/api")], null)).toEqual([])
  })
  it("private projects override public images and newly pushed images inherit project defaults", () => {
    expect(effectiveVisibility("public", "private", "public")).toBe("private")
    expect(effectiveVisibility(undefined, "private", "public")).toBe("private")
    expect(effectiveVisibility("private", "public", "public")).toBe("private")
    expect(effectiveVisibility(undefined, "public", "private")).toBe("public")
    expect(effectiveVisibility(undefined, undefined, "private")).toBe("private")
  })
  it("does not disclose hidden project names or image counts to guests", () => {
    const rows = [
      {
        name: "public-team",
        description: "",
        visibility: "public" as const,
        updatedAt: new Date(0),
      },
      {
        name: "secret-team",
        description: "",
        visibility: "private" as const,
        updatedAt: new Date(0),
      },
    ]
    const grouped = summarizeProjects(
      rows,
      [image("public-team/api", 2), image("secret-team/private", 5)],
      null,
    )
    expect(grouped.map((project) => project.name)).toEqual(["public-team"])
    expect(grouped[0].imageCount).toBe(1)
    expect(grouped[0].tagCount).toBe(2)
    expect(
      summarizeProjects(rows, [image("secret-team/private", 5)], user).find(
        (project) => project.name === "secret-team",
      )?.imageCount,
    ).toBe(1)
  })
  it("groups only the visible image collection and retains empty configured projects", () => {
    vi.stubEnv("DEFAULT_REPOSITORY_VISIBILITY", "public")
    const grouped = summarizeProjects(
      [{ name: "empty", description: "Reserved", visibility: "public", updatedAt: new Date(0) }],
      [image("dockyard/init", 2), image("dockyard/web", 3), image("alpine")],
      null,
    )
    expect(grouped.find((project) => project.name === "dockyard")).toMatchObject({
      imageCount: 2,
      tagCount: 5,
    })
    expect(grouped.find((project) => project.name === "empty")).toMatchObject({
      imageCount: 0,
      description: "Reserved",
    })
    expect(grouped.find((project) => project.name === "alpine")).toBeUndefined()
  })
})

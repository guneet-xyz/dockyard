import { describe, expect, it } from "vitest"

import { repositoryIdentity } from "@/lib/image-names"
import { rankPopular } from "@/lib/popular"
import { summarizeProjects } from "@/lib/projects"
import type { Project, Repository } from "@/lib/types"

function image(
  name: string,
  pullCount: number,
  tagCount = 1,
  visibility: Repository["visibility"] = "public",
): Repository {
  return {
    name,
    ...repositoryIdentity(name),
    visibility,
    projectVisibility: null,
    description: "",
    logoUrl: null,
    updatedAt: null,
    tagCount,
    pullCount,
    tags: [],
  }
}

function project(
  name: string,
  pullCount: number,
  imageCount = 1,
  visibility: Project["visibility"] = "public",
): Project {
  return {
    name,
    description: "",
    logoUrl: null,
    visibility,
    imageCount,
    tagCount: imageCount,
    pullCount,
    updatedAt: null,
  }
}

describe("popular public projects and images", () => {
  it("ranks by pulls, then tags, then name", () => {
    const ranked = rankPopular(
      [project("beta", 5), project("alpha", 5), project("gamma", 20)],
      [
        image("a/low", 1),
        image("a/tie-b", 7, 1),
        image("a/tie-a", 7, 1),
        image("a/tags", 7, 3),
      ],
    )
    expect(ranked.projects.map((entry) => entry.name)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ])
    expect(ranked.images.map((entry) => entry.name)).toEqual([
      "a/tags",
      "a/tie-a",
      "a/tie-b",
      "a/low",
    ])
  })

  it("excludes private, empty, and never-pushed entries", () => {
    const ranked = rankPopular(
      [
        project("secret", 99, 1, "private"),
        project("empty", 0, 0),
        project("open", 1),
      ],
      [
        image("secret/app", 99, 1, "private"),
        image("open/reserved", 50, 0),
        image("open/app", 1),
      ],
    )
    expect(ranked.projects.map((entry) => entry.name)).toEqual(["open"])
    expect(ranked.images.map((entry) => entry.name)).toEqual(["open/app"])
    expect(ranked).toMatchObject({
      publicProjectCount: 1,
      publicImageCount: 1,
      publicPullCount: 1,
    })
  })

  it("limits each list while counting every public entry", () => {
    const images = Array.from({ length: 12 }, (_, i) =>
      image(`team/app-${i}`, i),
    )
    const ranked = rankPopular([], images, { projects: 2, images: 3 })
    expect(ranked.images.map((entry) => entry.pullCount)).toEqual([11, 10, 9])
    expect(ranked.publicImageCount).toBe(12)
    expect(ranked.publicPullCount).toBe(66)
  })

  it("aggregates only publicly visible image pulls into project totals", () => {
    const rows = [
      {
        name: "team",
        description: "",
        visibility: "public" as const,
        updatedAt: new Date(0),
      },
    ]
    const [summary] = summarizeProjects(
      rows,
      [image("team/api", 4), image("team/web", 6)],
      null,
    )
    expect(summary.pullCount).toBe(10)
    expect(rankPopular([summary], []).projects[0].pullCount).toBe(10)
  })
})

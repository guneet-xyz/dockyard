import { config } from "./config"
import { db } from "./db"
import { projects as projectTable } from "./db/schema"
import { logoReferences } from "./logo-references"
import { summarizeProjects } from "./projects"
import { listRepositories } from "./registry"
import type { PopularOverview, Project, Repository } from "./types"

export const POPULAR_PROJECT_LIMIT = 6
export const POPULAR_IMAGE_LIMIT = 8

function byPopularity(
  a: { name: string; pullCount: number; tagCount: number },
  b: { name: string; pullCount: number; tagCount: number },
) {
  return (
    b.pullCount - a.pullCount ||
    b.tagCount - a.tagCount ||
    a.name.localeCompare(b.name)
  )
}

// Inputs must come from the anonymous view so private images never contribute pulls.
export function rankPopular(
  projects: Project[],
  images: Repository[],
  limits = { projects: POPULAR_PROJECT_LIMIT, images: POPULAR_IMAGE_LIMIT },
) {
  const publicProjects = projects.filter(
    (project) => project.visibility === "public" && project.imageCount > 0,
  )
  const publicImages = images.filter(
    (image) => image.visibility === "public" && image.tagCount > 0,
  )
  return {
    projects: [...publicProjects].sort(byPopularity).slice(0, limits.projects),
    images: [...publicImages].sort(byPopularity).slice(0, limits.images),
    publicProjectCount: publicProjects.length,
    publicImageCount: publicImages.length,
    publicPullCount: publicImages.reduce(
      (sum, image) => sum + image.pullCount,
      0,
    ),
  }
}

export async function popularPublic(): Promise<PopularOverview> {
  const [rows, images, logos] = await Promise.all([
    db().select().from(projectTable),
    listRepositories(null),
    logoReferences(),
  ])
  return {
    ...rankPopular(summarizeProjects(rows, images, null, logos), images),
    registryHost: config.registryHost,
  }
}

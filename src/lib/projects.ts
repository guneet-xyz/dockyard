import { eq } from "drizzle-orm"
import { db } from "./db"
import { projects } from "./db/schema"
import { config } from "./config"
import { HttpError } from "./http"
import { canRead } from "./permissions"
import { validProjectName } from "./image-names"
import { listRepositories } from "./registry"
import type { Project, Repository, SessionUser } from "./types"

export async function projectMetadata(name: string) {
  if (!validProjectName(name)) throw new HttpError(400, "Invalid project name.")
  const [project] = await db().select().from(projects).where(eq(projects.name, name)).limit(1)
  return project
}

export function summarizeProjects(
  rows: { name: string; description: string; visibility: "public" | "private"; updatedAt: Date }[],
  images: Repository[],
  user: SessionUser | null,
) {
  const byName = new Map<string, Project>()
  const hidden = new Set(
    rows.filter((row) => !canRead(user, row.visibility)).map((row) => row.name),
  )
  for (const row of rows) {
    if (canRead(user, row.visibility))
      byName.set(row.name, {
        name: row.name,
        description: row.description,
        visibility: row.visibility,
        updatedAt: row.updatedAt.toISOString(),
        imageCount: 0,
        tagCount: 0,
      })
  }
  for (const image of images) {
    if (!image.projectName || hidden.has(image.projectName)) continue
    let project = byName.get(image.projectName)
    if (!project) {
      project = {
        name: image.projectName,
        description: "",
        visibility: image.projectVisibility ?? config.defaultVisibility,
        updatedAt: image.updatedAt,
        imageCount: 0,
        tagCount: 0,
      }
      if (!canRead(user, project.visibility)) continue
      byName.set(project.name, project)
    }
    project.imageCount++
    project.tagCount += image.tagCount
    if (image.updatedAt && (!project.updatedAt || image.updatedAt > project.updatedAt))
      project.updatedAt = image.updatedAt
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function listProjects(user: SessionUser | null) {
  const [rows, images] = await Promise.all([db().select().from(projects), listRepositories(user)])
  return {
    projects: summarizeProjects(rows, images, user),
    ungroupedCount: images.filter((image) => !image.projectName).length,
  }
}

export async function readableProject(name: string, user: SessionUser | null) {
  const metadata = await projectMetadata(name)
  if (metadata && !canRead(user, metadata.visibility))
    throw new HttpError(404, "Project not found.")
  const images = (await listRepositories(user)).filter((image) => image.projectName === name)
  const [project] = summarizeProjects(metadata ? [metadata] : [], images, user)
  if (!project) throw new HttpError(404, "Project not found.")
  return { project, images }
}

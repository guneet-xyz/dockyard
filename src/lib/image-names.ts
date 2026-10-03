import { validRepositoryName } from "./permissions"
import type { Visibility } from "./types"

export function validProjectName(name: string) {
  return name.length <= 253 && !name.includes("/") && validRepositoryName(name)
}

export function validImageRepository(name: string) {
  const parts = name.split("/")
  return (
    parts.length === 2 &&
    validProjectName(parts[0]) &&
    validRepositoryName(parts[1]) &&
    validRepositoryName(name)
  )
}

export function repositoryIdentity(name: string) {
  const parts = name.split("/")
  return {
    projectName: parts.length > 1 ? parts[0] : null,
    imageName: parts.length > 1 ? parts.slice(1).join("/") : name,
    legacy: !validImageRepository(name),
  }
}

export function imageHref(name: string) {
  const identity = repositoryIdentity(name)
  if (identity.legacy) return `/repositories/${name}`
  return `/projects/${identity.projectName}/images/${identity.imageName}`
}

export function effectiveVisibility(
  image: Visibility | undefined,
  project: Visibility | undefined,
  fallback: Visibility,
): Visibility {
  if (project === "private") return "private"
  return image ?? project ?? fallback
}

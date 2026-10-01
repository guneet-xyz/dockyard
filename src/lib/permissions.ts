import type { Role, SessionUser, Visibility } from "./types"

export function canWrite(user: Pick<SessionUser, "role"> | null) {
  return user?.role === "admin" || user?.role === "maintainer"
}

export function canRead(user: Pick<SessionUser, "role"> | null, visibility: Visibility) {
  return visibility === "public" || user !== null
}

export function allowedActions(role: Role | null, visibility: Visibility, requested: string[]) {
  return [...new Set(requested)].filter((action) => {
    if (action === "pull") return visibility === "public" || role !== null
    if (action === "push" || action === "delete") return role === "admin" || role === "maintainer"
    return false
  })
}

export const repositoryNamePattern =
  /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/
export function validRepositoryName(name: string) {
  return name.length <= 255 && repositoryNamePattern.test(name)
}

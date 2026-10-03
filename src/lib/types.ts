export type Role = "admin" | "maintainer" | "viewer"
export type SessionUser = {
  id: string
  username: string
  name: string
  role: Role
  enabled: boolean
}
export type UserInfo = SessionUser & { createdAt: string }
export type Visibility = "public" | "private"
export type Repository = {
  name: string
  projectName: string | null
  imageName: string
  legacy: boolean
  projectVisibility: Visibility | null
  tagCount: number
  tags: string[]
  visibility: Visibility
  description: string
  updatedAt: string | null
}
export type Project = {
  name: string
  description: string
  visibility: Visibility
  imageCount: number
  tagCount: number
  updatedAt: string | null
}
export type ProjectOverview = {
  projects: Project[]
  ungroupedCount: number
  registryHost: string
  defaultVisibility: Visibility
  canWrite: boolean
}
export type ImageTag = {
  name: string
  digest: string
  size: number
  created: string | null
  platforms: string[]
  mediaType: string
}
export type AuditEvent = {
  id: string
  actor: string
  action: string
  target: string
  createdAt: string
}
export type RegistryOverview = {
  repositories: Repository[]
  registryHost: string
  defaultVisibility: Visibility
  canWrite: boolean
}

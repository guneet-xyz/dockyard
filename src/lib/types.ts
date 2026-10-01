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
  tagCount: number
  tags: string[]
  visibility: Visibility
  description: string
  updatedAt: string | null
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

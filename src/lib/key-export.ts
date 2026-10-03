import type { KeyGrant } from "./types"

export type KeyCredentials = {
  id: string
  name: string
  registryHost: string
  username: string
  secret: string
  grants: KeyGrant[]
  expiresAt: string | null
}

export function keyExportFilename(id: string) {
  return `dockyard-key-${id.replace(/[^a-zA-Z0-9_-]/g, "") || "credentials"}.json`
}

export function serializeKeyCredentials(key: KeyCredentials) {
  // Export only the one-time credential DTO, never arbitrary response/internal fields.
  return `${JSON.stringify({ version: 1, id: key.id, name: key.name, registryHost: key.registryHost, username: key.username, secret: key.secret, grants: key.grants, expiresAt: key.expiresAt }, null, 2)}\n`
}

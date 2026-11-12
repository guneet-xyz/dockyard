import { createHmac } from "node:crypto"
import { z } from "zod"

import { validRepositoryName } from "./permissions"

export const INTERNAL_REGISTRY_USER_AGENT = "Dockyard/internal"
// Repeated tag lookups by one client within this window are one pull (e.g. HEAD then GET).
export const PULL_DEDUPLICATION_WINDOW_MS = 60_000
const manifestTypes = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
])

export const registryEventSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  actor: z.object({ name: z.string().optional() }).optional(),
  request: z
    .object({
      addr: z.string().optional(),
      method: z.string().optional(),
      useragent: z.string().optional(),
    })
    .optional(),
  target: z.object({
    repository: z.string().optional(),
    mediaType: z.string().optional(),
    digest: z.string().optional(),
    tag: z.string().optional(),
  }),
})
export type RegistryEvent = z.infer<typeof registryEventSchema>

// Docker and containerd resolve a tag with HEAD and then fetch by digest, so a
// pull is a tag lookup by either method. Digest-only fetches carry no tag.
export function countablePull(
  event: RegistryEvent,
): { repositoryName: string; tag: string } | null {
  const { repository, tag, digest, mediaType } = event.target
  const method = event.request?.method
  if (
    event.action !== "pull" ||
    (method !== "GET" && method !== "HEAD") ||
    event.request?.useragent === INTERNAL_REGISTRY_USER_AGENT ||
    !repository ||
    !validRepositoryName(repository) ||
    !tag ||
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag) ||
    !digest ||
    !/^sha256:[a-f0-9]{64}$/.test(digest) ||
    !manifestTypes.has(mediaType ?? "")
  )
    return null
  return { repositoryName: repository, tag }
}

// Distribution reports the forwarded client IP, or host:port without a proxy.
// Drop the ephemeral port so separate connections from one client match.
function clientHost(addr: string) {
  const value = addr.trim()
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value)
  if (bracketed) return bracketed[1].toLowerCase()
  const hostPort = /^([^:]+):\d+$/.exec(value)
  return (hostPort ? hostPort[1] : value).toLowerCase()
}

// A keyed hash, so raw client addresses, user agents, and accounts are never stored.
// Events without a client address cannot be attributed and are never merged.
export function pullClientKey(
  event: RegistryEvent,
  target: { repositoryName: string; tag: string },
  secret: string,
) {
  const addr = event.request?.addr
  if (!addr?.trim()) return null
  return createHmac("sha256", `dockyard-pull-dedup:${secret}`)
    .update(
      JSON.stringify([
        clientHost(addr),
        event.request?.useragent ?? "",
        event.actor?.name ?? "",
        target.repositoryName,
        target.tag,
      ]),
    )
    .digest("hex")
}

export function pullAfterReset(
  timestamp: string,
  ...resets: (Date | null | undefined)[]
) {
  const time = new Date(timestamp).getTime()
  return (
    Number.isFinite(time) &&
    resets.every((reset) => !reset || time >= reset.getTime())
  )
}

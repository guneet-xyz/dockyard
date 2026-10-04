import { z } from "zod"
import { validRepositoryName } from "./permissions"

export const INTERNAL_REGISTRY_USER_AGENT = "Dockyard/internal"
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
  request: z.object({ method: z.string().optional(), useragent: z.string().optional() }).optional(),
  target: z.object({
    repository: z.string().optional(),
    mediaType: z.string().optional(),
    digest: z.string().optional(),
    tag: z.string().optional(),
  }),
})
export type RegistryEvent = z.infer<typeof registryEventSchema>

export function countablePull(
  event: RegistryEvent,
): { repositoryName: string; tag: string } | null {
  const { repository, tag, digest, mediaType } = event.target
  if (
    event.action !== "pull" ||
    event.request?.method !== "GET" ||
    event.request.useragent === INTERNAL_REGISTRY_USER_AGENT ||
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

export function pullAfterReset(timestamp: string, ...resets: (Date | null | undefined)[]) {
  const time = new Date(timestamp).getTime()
  return Number.isFinite(time) && resets.every((reset) => !reset || time >= reset.getTime())
}

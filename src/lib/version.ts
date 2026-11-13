import packageJson from "../../package.json"
import { config } from "./config"
import type { LatestRelease, UpdateStatus } from "./types"

export const RELEASES_REPOSITORY = "guneet-xyz/dockyard"
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASES_REPOSITORY}/releases/latest`
export const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000
export const UPDATE_CHECK_RETRY_MS = 60 * 60 * 1000
const UPDATE_CHECK_TIMEOUT_MS = 5000

export const currentVersion: string = packageJson.version

type ParsedVersion = [number, number, number]

// Only stable releases are considered; release-please tags them vMAJOR.MINOR.PATCH.
export function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
    value.trim(),
  )
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function isNewerVersion(candidate: string, current: string) {
  const next = parseVersion(candidate)
  const running = parseVersion(current)
  if (!next || !running) return false
  for (let index = 0; index < 3; index++)
    if (next[index] !== running[index]) return next[index] > running[index]
  return false
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `dockyard/${currentVersion}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`GitHub responded with ${response.status}`)
  const body: unknown = await response.json()
  const tag =
    body && typeof body === "object" && "tag_name" in body
      ? body.tag_name
      : undefined
  const name = typeof tag === "string" ? tag.trim() : ""
  const parsed = parseVersion(name)
  if (!parsed) throw new Error("the latest release has no stable version tag")
  return {
    version: parsed.join("."),
    url: `https://github.com/${RELEASES_REPOSITORY}/releases/tag/${name}`,
  }
}

let cached: { release: LatestRelease | null; expiresAt: number } | null = null
let pending: Promise<LatestRelease | null> | null = null

export function resetUpdateCheck() {
  cached = null
  pending = null
}

// Cached per process so GitHub's unauthenticated rate limit is never a concern;
// concurrent callers share one request and failures are retried after an hour.
export async function latestRelease(): Promise<LatestRelease | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.release
  pending ??= fetchLatestRelease()
    .then((release) => {
      cached = { release, expiresAt: Date.now() + UPDATE_CHECK_TTL_MS }
      return release
    })
    .catch((error: unknown) => {
      console.warn(
        `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      const release = cached?.release ?? null
      cached = { release, expiresAt: Date.now() + UPDATE_CHECK_RETRY_MS }
      return release
    })
    .finally(() => {
      pending = null
    })
  return pending
}

export async function updateStatus(): Promise<UpdateStatus> {
  if (!config.updateCheck)
    return {
      current: currentVersion,
      enabled: false,
      latest: null,
      available: false,
    }
  const latest = await latestRelease()
  return {
    current: currentVersion,
    enabled: true,
    latest,
    available: latest ? isNewerVersion(latest.version, currentVersion) : false,
  }
}

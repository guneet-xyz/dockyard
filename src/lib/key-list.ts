import type { AccessKeyInfo } from "./types"

export const KEY_PAGE_SIZE = 25
export const EXPIRY_WARNING_DAYS = 14

export type KeyStatusFilter = "all" | AccessKeyInfo["status"]
export type KeySort = "newest" | "name" | "last-used" | "expiry"
export type KeyListOptions = {
  search: string
  status: KeyStatusFilter
  // "all", "mine", or an owner username
  owner: string
  sort: KeySort
  viewerId: string | undefined
}

function time(value: string | null) {
  return value ? new Date(value).getTime() : null
}

function matches(key: AccessKeyInfo, search: string) {
  const term = search.trim().toLowerCase()
  if (!term) return true
  return [
    key.name,
    key.username,
    key.ownerUsername,
    ...key.grants.map((grant) => grant.target),
  ].some((value) => value.toLowerCase().includes(term))
}

// Missing values (never used, never expires) sort after every dated key.
function compareTimes(
  a: number | null,
  b: number | null,
  newestFirst: boolean,
) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return newestFirst ? b - a : a - b
}

export function filterKeys(keys: AccessKeyInfo[], options: KeyListOptions) {
  return keys
    .filter(
      (key) =>
        matches(key, options.search) &&
        (options.status === "all" || key.status === options.status) &&
        (options.owner === "all" ||
          (options.owner === "mine"
            ? key.ownerId === options.viewerId
            : key.ownerUsername === options.owner)),
    )
    .sort(
      (a, b) =>
        (options.sort === "name"
          ? a.name.localeCompare(b.name, undefined, { numeric: true })
          : options.sort === "last-used"
            ? compareTimes(time(a.lastUsedAt), time(b.lastUsedAt), true)
            : options.sort === "expiry"
              ? compareTimes(
                  a.status === "Active" ? time(a.expiresAt) : null,
                  b.status === "Active" ? time(b.expiresAt) : null,
                  false,
                )
              : 0) || compareTimes(time(a.createdAt), time(b.createdAt), true),
    )
}

export function paginate<T>(items: T[], page: number, size = KEY_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages)
  const start = (current - 1) * size
  return {
    items: items.slice(start, start + size),
    page: current,
    pages,
    first: items.length ? start + 1 : 0,
    last: Math.min(start + size, items.length),
  }
}

// Active keys only: expired and revoked keys no longer need attention.
export function expiresSoon(key: AccessKeyInfo, now = Date.now()) {
  const expiry = time(key.expiresAt)
  return (
    key.status === "Active" &&
    expiry !== null &&
    expiry - now <= EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000
  )
}

export function owners(keys: AccessKeyInfo[]) {
  return [...new Set(keys.map((key) => key.ownerUsername))].sort((a, b) =>
    a.localeCompare(b),
  )
}

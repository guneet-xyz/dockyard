export const MAX_LOGO_BYTES = 5 * 1024 ** 2
export const MAX_LOGO_PIXELS = 16 * 1024 ** 2
export const LOGO_SIZE = 512
export type LogoKind = "image" | "project"

export function logoUrl(kind: LogoKind, name: string, digest: string) {
  return `/api/logos?${new URLSearchParams({ kind, name, v: digest }).toString()}`
}

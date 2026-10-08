import { HttpError } from "./http"

export const DEFAULT_UPLOAD_BYTES = 1024 ** 3
export const DEFAULT_EXPANDED_BYTES = 4 * 1024 ** 3
export function imageUploadLimits() {
  function value(name: string, fallback: number) {
    const parsed = process.env[name] === undefined ? fallback : Number(process.env[name])
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
      throw new HttpError(503, "Image upload size limits are misconfigured.")
    return parsed
  }
  return {
    maxBytes: value("IMAGE_UPLOAD_MAX_BYTES", DEFAULT_UPLOAD_BYTES),
    maxExpandedBytes: value("IMAGE_UPLOAD_MAX_EXPANDED_BYTES", DEFAULT_EXPANDED_BYTES),
  }
}

const shared = globalThis as unknown as { dockyardImageUploads?: number }
export function acquireImageUpload() {
  if ((shared.dockyardImageUploads ?? 0) >= 2)
    throw new HttpError(
      429,
      "Two image uploads are already running on this web instance. Try again shortly.",
    )
  shared.dockyardImageUploads = (shared.dockyardImageUploads ?? 0) + 1
  let released = false
  return () => {
    if (!released) {
      released = true
      shared.dockyardImageUploads!--
    }
  }
}

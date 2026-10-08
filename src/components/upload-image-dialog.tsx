"use client"
import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { useSession } from "@/hooks/use-session"
import { formatBytes } from "@/lib/utils"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog"

export function UploadImageDialog({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [tag, setTag] = useState("latest")
  const [replace, setReplace] = useState(false)
  const [phase, setPhase] = useState<"idle" | "checking" | "uploading" | "publishing">("idle")
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState("")
  const request = useRef<XMLHttpRequest | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      abort.current?.abort()
      request.current?.abort()
    },
    [],
  )
  const client = useQueryClient()
  const session = useSession()
  const maxBytes = session.data?.imageUploadLimits?.maxBytes ?? 1024 ** 3
  const busy = phase !== "idle"
  function reset() {
    setFile(null)
    setTag("latest")
    setReplace(false)
    setProgress(0)
    setError("")
  }
  function cancel() {
    abort.current?.abort()
    request.current?.abort()
    setOpen(false)
    reset()
  }
  async function upload() {
    if (!file || busy) return
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
      setError("Enter a valid Docker tag, up to 128 characters.")
      return
    }
    if (file.size === 0 || file.size > maxBytes) {
      setError(`Choose a non-empty archive no larger than ${formatBytes(maxBytes)}.`)
      return
    }
    setError("")
    setProgress(0)
    setPhase("checking")
    const controller = new AbortController()
    abort.current = controller
    try {
      const url = new URL("/api/registry/upload", window.location.origin)
      url.searchParams.set("name", name)
      url.searchParams.set("tag", tag)
      const statusResponse = await fetch(url, { signal: controller.signal })
      const status = await statusResponse.json()
      if (!statusResponse.ok) throw new Error(status.error ?? "Cannot upload to this image.")
      if (file.size > status.maxBytes)
        throw new Error(`Archive exceeds the server limit of ${formatBytes(status.maxBytes)}.`)
      if (status.currentDigest && !replace)
        throw new Error(
          "This tag already exists. Select Replace existing tag to confirm overwriting it.",
        )
      if (status.currentDigest) url.searchParams.set("expectedDigest", status.currentDigest)
      setPhase("uploading")
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        request.current = xhr
        xhr.open("POST", url)
        xhr.setRequestHeader("Content-Type", "application/octet-stream")
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.min(100, Math.round((event.loaded / event.total) * 100))
            setProgress(percent)
            if (percent === 100) setPhase("publishing")
          }
        }
        xhr.upload.onload = () => {
          setProgress(100)
          setPhase("publishing")
        }
        xhr.onerror = () =>
          reject(new Error("Upload connection failed. Check the image tags before retrying."))
        xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"))
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText)
            if (xhr.status < 200 || xhr.status >= 300)
              reject(new Error(data.error ?? "Archive upload failed."))
            else resolve()
          } catch {
            reject(
              new Error(
                "The upload proxy returned an invalid response. Check its request-size/time limits and the image tags before retrying.",
              ),
            )
          }
        }
        xhr.send(file)
      })
      setOpen(false)
      reset()
      for (const key of ["repository", "repositories", "project", "projects", "activity"])
        void client.invalidateQueries({ queryKey: [key] })
      toast.success(`Image uploaded as ${tag}.`)
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message)
    } finally {
      setPhase("idle")
      request.current = null
      abort.current = null
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value)
          if (!value) reset()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Upload />
          Upload image
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload an image archive</DialogTitle>
          <DialogDescription className="break-all">
            Publish a Docker-save or OCI-layout archive into {name}. The archive must contain one
            image or a multi-platform OCI index; its original repository names are not used.
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void upload()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="image-archive">Image archive</Label>
            <Input
              id="image-archive"
              type="file"
              accept=".tar,.tar.gz,.tgz"
              className="min-w-0 text-xs"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setError("")
              }}
            />
            <p className="break-all text-xs text-muted-foreground">
              {file
                ? `${file.name} · ${formatBytes(file.size)}`
                : `Docker save / OCI export · .tar or .tar.gz · maximum ${formatBytes(maxBytes)}`}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="upload-tag">Destination tag</Label>
            <Input
              id="upload-tag"
              value={tag}
              maxLength={128}
              disabled={busy}
              onChange={(event) => setTag(event.target.value)}
              className="font-mono"
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--primary)]"
              checked={replace}
              disabled={busy}
              onChange={(event) => setReplace(event.target.checked)}
            />
            Replace existing tag if present (explicit overwrite confirmation)
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Export with <code>docker save -o image.tar your-image:tag</code>. Do not upload a
            Dockerfile, source-code ZIP, photo, or <code>docker export</code> filesystem archive. No
            image code is executed on Dockyard.
          </p>
          {busy && (
            <div className="space-y-2">
              <div
                role="progressbar"
                aria-label="Image upload progress"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 overflow-hidden rounded bg-muted"
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {phase === "checking"
                  ? "Checking permissions and tag…"
                  : phase === "publishing"
                    ? "Archive received. Validating and publishing to the registry…"
                    : `Uploading archive: ${progress}%`}
              </p>
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="break-words rounded-md border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-400"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={
                busy
                  ? cancel
                  : () => {
                      setOpen(false)
                      reset()
                    }
              }
            >
              {busy ? "Cancel upload" : "Cancel"}
            </Button>
            <Button type="submit" disabled={busy || !file || !tag}>
              {busy ? <Loader2 className="animate-spin" /> : <Upload />}
              {busy ? "Uploading…" : "Upload archive"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

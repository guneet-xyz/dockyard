"use client"
import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { ImagePlus, Loader2, Trash2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { MAX_LOGO_BYTES, type LogoKind } from "@/lib/logo-constants"
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
import { ResourceIcon } from "./resource-icon"

export function LogoEditor({
  kind,
  name,
  logoUrl,
}: {
  kind: LogoKind
  name: string
  logoUrl: string | null
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const client = useQueryClient()
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    },
    [],
  )
  function chooseFile(value: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    const url = value ? URL.createObjectURL(value) : null
    previewRef.current = url
    setPreview(url)
    setFile(value)
  }
  async function save(remove = false) {
    if (pending || (!remove && !file)) return
    if (!remove && file && (!file.size || file.size > MAX_LOGO_BYTES)) {
      setError("Choose a non-empty photo/logo no larger than 5 MiB.")
      return
    }
    setPending(true)
    setError("")
    try {
      const url = `/api/logos?${new URLSearchParams({ kind, name })}`
      const response = await fetch(url, {
        method: remove ? "DELETE" : "POST",
        ...(remove ? {} : { headers: { "Content-Type": "application/octet-stream" }, body: file }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "Could not update the photo/logo.")
      setOpen(false)
      chooseFile(null)
      for (const key of ["repository", "repositories", "project", "projects", "activity"])
        void client.invalidateQueries({ queryKey: [key] })
      toast.success(
        `${kind === "project" ? "Project" : "Image"} logo ${remove ? "removed" : "saved"}.`,
      )
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value)
          chooseFile(null)
          setError("")
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ImagePlus />
          {logoUrl ? "Change photo/logo" : "Upload photo/logo"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{kind === "project" ? "Project" : "Image"} photo/logo</DialogTitle>
          <DialogDescription className="break-all">
            Choose a picture for {name}. This is a photo/logo, not a container archive. Container
            tags and visibility are unchanged.
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="flex justify-center">
            <div className="flex size-32 items-center justify-center overflow-hidden rounded-xl border bg-muted">
              {preview ? (
                <Image
                  src={preview}
                  alt="Selected photo/logo preview"
                  width={512}
                  height={512}
                  unoptimized
                  className="h-full w-full object-contain"
                />
              ) : (
                <ResourceIcon
                  kind={kind}
                  name={name}
                  logoUrl={logoUrl}
                  className="size-full rounded-none border-0"
                />
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`logo-${kind}-file`}>Photo/logo file</Label>
            <Input
              id={`logo-${kind}-file`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={pending}
              className="min-w-0 text-xs"
              onChange={(event) => {
                setError("")
                chooseFile(event.target.files?.[0] ?? null)
              }}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              PNG, JPEG, or WebP · up to 5 MiB · static images only. Stored as a metadata-free WebP
              up to 512 × 512 pixels, preserving aspect ratio.
            </p>
          </div>
          {error && (
            <p
              role="alert"
              className="break-words rounded-md border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-400"
            >
              {error}
            </p>
          )}
          <DialogFooter className="flex-wrap">
            {logoUrl && (
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => void save(true)}
              >
                <Trash2 />
                Remove logo
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setOpen(false)
                chooseFile(null)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !file}>
              {pending ? <Loader2 className="animate-spin" /> : <ImagePlus />}Save photo/logo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

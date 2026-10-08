"use client"
import { useState } from "react"
import Image from "next/image"
import { Box, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LogoKind } from "@/lib/logo-constants"

export function ResourceIcon({
  kind,
  name,
  logoUrl,
  className,
}: {
  kind: LogoKind
  name: string
  logoUrl: string | null
  className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const Icon = kind === "project" ? FolderOpen : Box
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground",
        className,
      )}
    >
      {logoUrl && logoUrl !== failedUrl ? (
        <Image
          src={logoUrl}
          alt={`${name} logo`}
          width={512}
          height={512}
          unoptimized
          className="h-full w-full object-contain"
          onError={() => setFailedUrl(logoUrl)}
        />
      ) : (
        <Icon className="size-[45%] text-primary" aria-hidden="true" />
      )}
    </div>
  )
}

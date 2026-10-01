"use client"
import { useState } from "react"
import { AlertCircle, Check, Copy, Globe2, Lock, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Skeleton } from "./ui/skeleton"
import type { Visibility } from "@/lib/types"

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Clipboard unavailable. Select and copy the command manually.")
    }
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
    >
      {copied ? <Check className="text-primary" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

export function CommandBlock({ command }: { command: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border bg-[#0b1117] py-1 pl-3">
      <span className="select-none font-mono text-xs text-primary/60">$</span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre py-2 font-mono text-[11px] text-slate-300">
        {command}
      </code>
      <CopyButton value={command} className="mr-1 shrink-0 text-muted-foreground" />
    </div>
  )
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  return (
    <Badge variant={visibility === "public" ? "default" : "secondary"}>
      {visibility === "public" ? <Globe2 className="size-3" /> : <Lock className="size-3" />}
      {visibility === "public" ? "Public" : "Private"}
    </Badge>
  )
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-xl border border-red-400/15 bg-red-400/5 px-6 py-12 text-center"
    >
      <AlertCircle className="mb-4 size-7 text-red-400" />
      <h3 className="font-medium">Unable to load this view</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
      {retry && (
        <Button onClick={retry} variant="outline" className="mt-5">
          <RefreshCw />
          Try again
        </Button>
      )}
    </div>
  )
}

export function TableSkeleton() {
  return (
    <div className="space-y-5 p-5" aria-label="Loading">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="size-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  )
}

import { Download } from "lucide-react"
import { cn } from "@/lib/utils"

export const PULL_COUNT_DESCRIPTION =
  "External tagged-manifest fetch notifications since tracking was enabled; not verified completed downloads. Excludes UI reads, HEAD checks, blobs, and digest-only/multi-platform child fetches."

export function PullCount({
  count,
  label,
  className,
}: {
  count: number
  label?: string
  className?: string
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
      title={PULL_COUNT_DESCRIPTION}
      aria-label={label}
    >
      <Download className="size-3 shrink-0" aria-hidden="true" />
      {count.toLocaleString("en-US")} {count === 1 ? "pull" : "pulls"}
    </span>
  )
}

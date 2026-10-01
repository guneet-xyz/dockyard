import { Container } from "lucide-react"
import { cn } from "@/lib/utils"

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex size-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-[0_0_20px_#6ce9ba08]">
        <Container className="size-5" strokeWidth={1.8} />
      </div>
      {!compact && (
        <div>
          <span className="text-lg font-semibold tracking-tight">
            dockyard<span className="text-primary">.</span>
          </span>
          <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Container registry
          </p>
        </div>
      )}
    </div>
  )
}

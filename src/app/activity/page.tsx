"use client"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Activity, RefreshCw, Search, ShieldCheck } from "lucide-react"
import { api } from "@/lib/api-client"
import type { AuditEvent } from "@/lib/types"
import { timeAgo } from "@/lib/utils"
import { AdminGate } from "@/components/admin-gate"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ErrorState, TableSkeleton } from "@/components/shared"

const labels: Record<string, string> = {
  "user.login": "Signed in",
  "user.create": "Created user",
  "user.update": "Updated user",
  "repository.create": "Created repository",
  "repository.update": "Updated repository",
  "image.delete": "Deleted image",
  "image.push": "Pushed image",
  "project.create": "Created project",
  "project.update": "Updated project",
  "project.delete": "Deleted project",
  "project.delete_failed": "Project deletion incomplete",
  "repository.delete": "Deleted image repository",
  "repository.delete_failed": "Image deletion incomplete",
  "key.create": "Created automation key",
  "key.revoke": "Revoked automation key",
  "key.rotate": "Rotated automation key",
}

function ActivityView() {
  const [search, setSearch] = useState("")
  const query = useQuery({
    queryKey: ["activity"],
    queryFn: () => api<{ events: AuditEvent[] }>("/api/activity"),
    refetchInterval: 30000,
  })
  const events = (query.data?.events ?? []).filter((event) =>
    `${event.actor} ${event.action} ${event.target}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <div className="page-enter space-y-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity log</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A clear trail of who changed what in your registry.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          aria-label="Refresh activity"
        >
          <RefreshCw className={query.isFetching ? "animate-spin" : ""} />
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Filter by actor, action, or repository…"
            aria-label="Search activity"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">Most recent 100 events</p>
      </div>
      {query.isError ? (
        <ErrorState message={query.error.message} retry={() => query.refetch()} />
      ) : (
        <Card className="overflow-hidden">
          {query.isPending ? (
            <TableSkeleton />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <span className="flex items-center gap-2 text-xs">
                        <span className="flex size-7 items-center justify-center rounded-full border bg-muted text-muted-foreground">
                          {event.actor[0]?.toUpperCase()}
                        </span>
                        {event.actor}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={event.action.includes("delete") ? "destructive" : "secondary"}
                      >
                        {labels[event.action] ?? event.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {event.target}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-xs text-muted-foreground"
                      title={new Date(event.createdAt).toLocaleString()}
                    >
                      {timeAgo(event.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
                {!events.length && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <div className="flex flex-col items-center py-12">
                        <Activity className="mb-3 size-6 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          {search
                            ? "No matching activity."
                            : "Activity will appear as your team uses the registry."}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-primary" />
        Records UI administration and registry manifest pushes. Pulls and blob transfers are not
        logged here.
      </p>
    </div>
  )
}

export default function ActivityPage() {
  return (
    <AdminGate>
      <ActivityView />
    </AdminGate>
  )
}

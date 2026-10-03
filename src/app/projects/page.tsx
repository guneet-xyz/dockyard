"use client"
import { useState } from "react"
import Link from "next/link"
import { ArrowUpRight, Box, FolderOpen, RefreshCw, Search, Tag } from "lucide-react"
import { useProjects } from "@/hooks/use-projects"
import { NewProjectDialog } from "@/components/new-project-dialog"
import { ErrorState, TableSkeleton, VisibilityBadge } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default function ProjectsPage() {
  const query = useProjects()
  const [search, setSearch] = useState("")
  const projects = (query.data?.projects ?? []).filter((project) =>
    `${project.name} ${project.description}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <div className="page-enter space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
            Namespaces for everything you ship
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Group related images. One project, a clear home for every build.
          </p>
        </div>
        {query.data?.canWrite && (
          <NewProjectDialog defaultVisibility={query.data.defaultVisibility} />
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Search projects"
            className="pl-9"
            placeholder="Search projects…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
          aria-label="Refresh projects"
        >
          <RefreshCw className={query.isFetching ? "animate-spin" : ""} />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {projects.length} {projects.length === 1 ? "project" : "projects"} · image paths use
        project/image
      </p>
      {query.isError ? (
        <ErrorState message={query.error.message} retry={() => query.refetch()} />
      ) : query.isPending ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : !projects.length ? (
        <Card>
          <div className="flex flex-col items-center py-16 text-center">
            <FolderOpen className="mb-5 size-10 text-primary/70" />
            <h2 className="font-medium">
              {search ? "No matching projects" : "A namespace for your next great build"}
            </h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {search
                ? "Try another project name."
                : "Create a project, then add images such as dockyard/init, dockyard/web, and dockyard/ingress."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.name} href={`/projects/${project.name}`} className="group">
              <Card className="h-full p-5 transition-colors hover:border-primary/40">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
                    <FolderOpen className="size-5 text-primary" />
                  </div>
                  <VisibilityBadge visibility={project.visibility} />
                </div>
                <div className="flex items-center justify-between">
                  <h2 className="truncate text-base font-semibold group-hover:text-primary">
                    {project.name}
                  </h2>
                  <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary" />
                </div>
                <p className="mt-2 line-clamp-2 min-h-9 text-xs leading-relaxed text-muted-foreground">
                  {project.description || `Images published under ${project.name}/…`}
                </p>
                <div className="mt-5 flex items-center gap-4 border-t pt-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Box className="size-3.5" />
                    {project.imageCount} images
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Tag className="size-3.5" />
                    {project.tagCount} tags
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {Boolean(query.data?.ungroupedCount) && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <Badge variant="secondary">Legacy</Badge>
            <p className="text-xs text-muted-foreground">
              {query.data?.ungroupedCount} unscoped images retain their existing paths.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/repositories">
              View all images
              <ArrowUpRight />
            </Link>
          </Button>
        </Card>
      )}
    </div>
  )
}

"use client"
import Link from "next/link"
import { ArrowUpRight, Box, ChevronRight, PackageOpen, Tag } from "lucide-react"
import type { Repository } from "@/lib/types"
import { imageHref } from "@/lib/image-names"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { VisibilityBadge } from "./shared"
import { PullCount } from "./pull-count"

export function RepositoryTable({
  repositories,
  withinProject = false,
}: {
  repositories: Repository[]
  withinProject?: boolean
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Image</TableHead>
          <TableHead>Visibility</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead>Pulls</TableHead>
          <TableHead>Latest tag</TableHead>
          <TableHead className="w-10">
            <span className="sr-only">Open</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {repositories.map((repo) => (
          <TableRow key={repo.name}>
            <TableCell>
              <Link href={imageHref(repo.name)} className="group flex min-w-44 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground transition-colors group-hover:border-primary/25 group-hover:text-primary">
                  <Box className="size-[18px]" />
                </div>
                <div>
                  <p className="font-medium transition-colors group-hover:text-primary">
                    {withinProject ? repo.imageName : repo.name}
                    {repo.legacy && (
                      <Badge variant="secondary" className="ml-2">
                        Legacy path
                      </Badge>
                    )}
                  </p>
                  <p className="mt-1 max-w-64 truncate text-[11px] text-muted-foreground">
                    {repo.description ||
                      (repo.tagCount ? "Container image repository" : "Ready for your first push")}
                  </p>
                </div>
              </Link>
            </TableCell>
            <TableCell>
              <VisibilityBadge visibility={repo.visibility} />
            </TableCell>
            <TableCell>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Tag className="size-3" />
                {repo.tagCount}
              </span>
            </TableCell>
            <TableCell>
              <PullCount count={repo.pullCount} label={`Pulls for image ${repo.name}`} />
            </TableCell>
            <TableCell>
              {repo.tags.length ? (
                <Badge variant="secondary" className="font-mono">
                  {repo.tags.includes("latest")
                    ? "latest"
                    : [...repo.tags].sort((a, b) =>
                        b.localeCompare(a, undefined, { numeric: true }),
                      )[0]}
                </Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              <Button asChild variant="ghost" size="icon" className="size-7 text-muted-foreground">
                <Link href={imageHref(repo.name)} aria-label={`Open ${repo.name}`}>
                  <ChevronRight className="size-4" />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function EmptyRepositories({ filtered = false }: { filtered?: boolean }) {
  return (
    <div className="flex flex-col items-center px-5 py-14 text-center">
      <div className="relative mb-6 flex size-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/5">
        <PackageOpen className="size-7 text-primary" />
        <div className="absolute -right-1 -top-1 size-3 rounded-full border-4 border-card bg-primary" />
      </div>
      <h3 className="text-base font-medium">
        {filtered ? "No matching images" : "Your next great build starts here"}
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {filtered
          ? "Try a different search or clear your filters."
          : "No images yet. Push your first container image and it will appear right here."}
      </p>
      {!filtered && (
        <Button asChild variant="outline" size="sm" className="mt-5">
          <Link href="/guide">
            Learn how to push an image
            <ArrowUpRight />
          </Link>
        </Button>
      )}
    </div>
  )
}

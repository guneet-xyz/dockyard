"use client"
import Link from "next/link"
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  ChevronRight,
  Download,
  FolderOpen,
  Globe2,
  Tag,
  TrendingUp,
} from "lucide-react"
import { usePopular } from "@/hooks/use-popular"
import { useSession } from "@/hooks/use-session"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CommandBlock, ErrorState, TableSkeleton } from "@/components/shared"
import { RepositoryTable } from "@/components/repository-table"
import { PullCount } from "@/components/pull-count"
import { ResourceIcon } from "@/components/resource-icon"
import type { Repository } from "@/lib/types"

function preferredTag(image: Repository) {
  if (image.tags.includes("latest")) return "latest"
  return [...image.tags].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
}

export default function ExplorePage() {
  const popular = usePopular()
  const { data: session } = useSession()
  const host = popular.data?.registryHost ?? session?.registryHost ?? "localhost:3000"
  const guest = !session?.user
  const topImage = popular.data?.images[0]
  const stats = [
    {
      label: "Public projects",
      value: popular.data?.publicProjectCount,
      icon: FolderOpen,
      color: "text-primary",
    },
    {
      label: "Public images",
      value: popular.data?.publicImageCount,
      icon: Box,
      color: "text-sky-400",
    },
    {
      label: "Public pulls",
      value: popular.data?.publicPullCount,
      icon: Download,
      color: "text-amber-300",
    },
  ]
  return (
    <div className="page-enter space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
            <span className="size-1 rounded-full bg-primary" />
            Discover public images
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[29px]">
            Popular on Dockyard
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The most-pulled public projects and images, ready for anyone to use.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/repositories">
              Browse images
              <ArrowUpRight />
            </Link>
          </Button>
          <Button asChild variant={guest ? "outline" : "default"}>
            <Link href="/projects">
              {guest ? "Browse projects" : "Your projects"}
              <ArrowUpRight />
            </Link>
          </Button>
        </div>
      </div>
      {guest && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/15 bg-primary/[0.035] px-4 py-3">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Globe2 className="size-4" />
          </div>
          <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Welcome aboard.</span> Public images can
            be pulled without an account. Sign in to manage your projects and images.
          </p>
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-xs font-medium text-primary"
          >
            Sign in
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <Icon className={`size-4 ${color}`} />
              </div>
              {popular.isPending ? (
                <Skeleton className="mt-5 h-8 w-16" />
              ) : (
                <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight">
                  {value === undefined ? "—" : value.toLocaleString("en-US")}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {popular.isError ? (
        <ErrorState message={popular.error.message} retry={() => popular.refetch()} />
      ) : (
        <>
          <section aria-labelledby="popular-projects" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2
                id="popular-projects"
                className="flex items-center gap-2 text-sm font-semibold tracking-tight"
              >
                <TrendingUp className="size-4 text-primary" />
                Popular projects
              </h2>
              <Link
                href="/projects"
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary"
              >
                All projects
                <ChevronRight className="size-3" />
              </Link>
            </div>
            {popular.isPending ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-40" />
                ))}
              </div>
            ) : popular.data.projects.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {popular.data.projects.map((project, index) => (
                  <Link key={project.name} href={`/projects/${project.name}`} className="group">
                    <Card className="h-full p-5 transition-colors hover:border-primary/40">
                      <div className="mb-5 flex items-center justify-between">
                        <ResourceIcon
                          kind="project"
                          name={project.name}
                          logoUrl={project.logoUrl}
                          className="size-11 rounded-xl border-primary/20 bg-primary/5"
                        />
                        <Badge variant="secondary" aria-label={`Rank ${index + 1}`}>
                          #{index + 1}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <h3 className="truncate text-base font-semibold group-hover:text-primary">
                          {project.name}
                        </h3>
                        <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary" />
                      </div>
                      <p className="mt-2 line-clamp-2 min-h-9 text-xs leading-relaxed text-muted-foreground">
                        {project.description || `Images published under ${project.name}/…`}
                      </p>
                      <div className="mt-5 flex flex-wrap items-center gap-4 border-t pt-4 text-xs text-muted-foreground">
                        <PullCount
                          count={project.pullCount}
                          label={`Public pulls for project ${project.name}`}
                        />
                        <span className="flex items-center gap-1.5">
                          <Box className="size-3.5" />
                          {project.imageCount} {project.imageCount === 1 ? "image" : "images"}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Tag className="size-3.5" />
                          {project.tagCount} {project.tagCount === 1 ? "tag" : "tags"}
                        </span>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <Card className="px-5 py-10 text-center text-sm text-muted-foreground">
                No public projects have published images yet.
              </Card>
            )}
          </section>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="min-w-0 overflow-hidden">
              <CardHeader className="flex-row items-center justify-between border-b">
                <div className="flex items-center gap-2.5">
                  <Box className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm">Popular images</CardTitle>
                </div>
                <Link
                  href="/repositories"
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary"
                >
                  All images
                  <ChevronRight className="size-3" />
                </Link>
              </CardHeader>
              {popular.isPending ? (
                <TableSkeleton />
              ) : popular.data.images.length ? (
                <RepositoryTable repositories={popular.data.images} />
              ) : (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No public images have been pushed yet.
                </p>
              )}
            </Card>
            <Card className="h-fit min-w-0">
              <CardHeader className="border-b">
                <CardTitle className="text-sm">Pull without an account</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-5">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Public images support anonymous pulls straight from the registry.
                </p>
                {popular.isPending ? (
                  <Skeleton className="h-10" />
                ) : (
                  <CommandBlock
                    command={
                      topImage
                        ? `docker pull ${host}/${topImage.name}:${preferredTag(topImage)}`
                        : `docker pull ${host}/project/image:latest`
                    }
                  />
                )}
                <Link
                  href="/guide"
                  className="flex items-center gap-1 text-[11px] font-medium text-primary"
                >
                  Full quick start
                  <ArrowUpRight className="size-3" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

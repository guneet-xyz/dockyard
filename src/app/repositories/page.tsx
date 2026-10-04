"use client"
import { useState } from "react"
import Link from "next/link"
import { ArrowUpRight, Box, LayoutGrid, List, RefreshCw, Search, Tag, X } from "lucide-react"
import { useRepositories } from "@/hooks/use-repositories"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyRepositories, RepositoryTable } from "@/components/repository-table"
import { ErrorState, TableSkeleton, VisibilityBadge } from "@/components/shared"
import { NewRepositoryDialog } from "@/components/new-repository-dialog"
import { cn } from "@/lib/utils"
import { imageHref } from "@/lib/image-names"
import { PullCount } from "@/components/pull-count"

export default function RepositoriesPage() {
  const query = useRepositories()
  const [search, setSearch] = useState("")
  const [visibility, setVisibility] = useState("all")
  const [sort, setSort] = useState("name")
  const [view, setView] = useState("list")
  const all = query.data?.repositories ?? []
  const filtered = all
    .filter(
      (repo) =>
        (repo.name.includes(search.toLowerCase()) ||
          repo.description.toLowerCase().includes(search.toLowerCase())) &&
        (visibility === "all" || repo.visibility === visibility),
    )
    .sort((a, b) =>
      sort === "tags"
        ? b.tagCount - a.tagCount
        : sort === "pulls"
          ? b.pullCount - a.pullCount
          : a.name.localeCompare(b.name),
    )
  return (
    <div className="page-enter space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Images</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Explore your images and find exactly what you need to ship.
          </p>
        </div>
        {query.data?.canWrite && (
          <NewRepositoryDialog defaultVisibility={query.data.defaultVisibility} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Search images"
            className="pl-9 pr-9"
            placeholder="Search images…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              className="absolute right-3 top-2.5 text-muted-foreground"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Select value={visibility} onValueChange={setVisibility}>
          <SelectTrigger aria-label="Filter by visibility" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All visibility</SelectItem>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="private">Private</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger aria-label="Sort images" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name A–Z</SelectItem>
            <SelectItem value="tags">Most tags</SelectItem>
            <SelectItem value="pulls">Most pulls</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex rounded-md border p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-7 text-muted-foreground",
              view === "list" && "bg-accent text-foreground",
            )}
            onClick={() => setView("list")}
            aria-label="List view"
            aria-pressed={view === "list"}
          >
            <List />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-7 text-muted-foreground",
              view === "grid" && "bg-accent text-foreground",
            )}
            onClick={() => setView("grid")}
            aria-label="Grid view"
            aria-pressed={view === "grid"}
          >
            <LayoutGrid />
          </Button>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => query.refetch()}
          aria-label="Refresh images"
          disabled={query.isFetching}
        >
          <RefreshCw className={query.isFetching ? "animate-spin" : ""} />
        </Button>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {query.isPending
            ? "Loading images…"
            : `${filtered.length} ${filtered.length === 1 ? "image" : "images"}${search || visibility !== "all" ? ` of ${all.length}` : ""}`}
        </span>
        <span className="hidden sm:inline">Synced with your registry · refreshes every minute</span>
      </div>
      {query.isError ? (
        <ErrorState message={query.error.message} retry={() => query.refetch()} />
      ) : query.isPending ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : !filtered.length ? (
        <Card>
          <EmptyRepositories filtered={Boolean(search || visibility !== "all")} />
        </Card>
      ) : view === "list" ? (
        <Card className="overflow-hidden">
          <RepositoryTable repositories={filtered} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((repo) => (
            <Link key={repo.name} href={imageHref(repo.name)} className="group">
              <Card className="h-full p-5 transition-colors hover:border-primary/40">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-lg border bg-muted">
                    <Box className="size-5 text-primary" />
                  </div>
                  <VisibilityBadge visibility={repo.visibility} />
                </div>
                <h2 className="truncate font-medium group-hover:text-primary">{repo.name}</h2>
                <p className="mt-2 line-clamp-2 min-h-9 text-xs leading-relaxed text-muted-foreground">
                  {repo.description || "Container image repository"}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Tag className="size-3" />
                    {repo.tagCount} tags
                  </span>
                  <PullCount count={repo.pullCount} label={`Pulls for image ${repo.name}`} />
                  <ArrowUpRight className="size-4 group-hover:text-primary" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

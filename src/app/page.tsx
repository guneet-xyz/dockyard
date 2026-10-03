"use client"
import Link from "next/link"
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  Globe2,
  Layers3,
  Lock,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react"
import { useRepositories } from "@/hooks/use-repositories"
import { useSession } from "@/hooks/use-session"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CommandBlock, ErrorState, TableSkeleton } from "@/components/shared"
import { EmptyRepositories, RepositoryTable } from "@/components/repository-table"
import { NewRepositoryDialog } from "@/components/new-repository-dialog"
import { NewProjectDialog } from "@/components/new-project-dialog"
import { useProjects } from "@/hooks/use-projects"

export default function OverviewPage() {
  const registry = useRepositories()
  const projects = useProjects()
  const { data: session } = useSession()
  const repos = registry.data?.repositories ?? []
  const host = registry.data?.registryHost ?? session?.registryHost ?? "localhost:3000"
  const guest = !session?.user
  const stats = [
    {
      label: "Images",
      value: repos.length,
      icon: Box,
      color: "text-primary",
      note: "Your container collection",
    },
    {
      label: "Image tags",
      value: repos.reduce((sum, repo) => sum + repo.tagCount, 0),
      icon: Layers3,
      color: "text-sky-400",
      note: "Versions ready to deploy",
    },
    {
      label: "Public images",
      value: repos.filter((repo) => repo.visibility === "public").length,
      icon: Globe2,
      color: "text-amber-300",
      note: "Available to everyone",
    },
    {
      label: "Private images",
      value: guest ? "—" : repos.filter((repo) => repo.visibility === "private").length,
      icon: Lock,
      color: "text-violet-400",
      note: guest ? "Sign in to see private images" : "Visible to signed-in users",
    },
  ]
  return (
    <div className="page-enter space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
            <span className="size-1 rounded-full bg-primary" />
            Your image workspace
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[29px]">
            A home for your containers.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Store, discover, and ship. Everything you build, in one place.
          </p>
        </div>
        {registry.data?.canWrite ? (
          <div className="flex gap-2">
            <NewProjectDialog defaultVisibility={registry.data.defaultVisibility} />
            <NewRepositoryDialog defaultVisibility={registry.data.defaultVisibility} />
          </div>
        ) : (
          <Button asChild variant="outline">
            <Link href="/projects">
              Browse projects
              <ArrowUpRight />
            </Link>
          </Button>
        )}
      </div>
      {projects.isSuccess && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Link href="/projects" className="font-medium text-primary hover:underline">
            {projects.data.projects.length} projects
          </Link>
          <span>Group images as project/image, such as dockyard/init.</span>
        </div>
      )}
      {guest && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/15 bg-primary/[0.035] px-4 py-3">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Globe2 className="size-4" />
          </div>
          <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Welcome aboard.</span> You’re browsing
            public images as a guest. Sign in to access your workspace.
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, color, note }) => (
          <Card key={label} className="relative overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <Icon className={`size-4 ${color}`} />
              </div>
              {registry.isPending ? (
                <Skeleton className="mt-5 h-8 w-16" />
              ) : (
                <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight">
                  {registry.isError ? "—" : value}
                </p>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground/75">{note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between border-b">
              <div className="flex items-center gap-2.5">
                <Box className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm">Your repositories</CardTitle>
                {registry.isSuccess && <Badge variant="secondary">{repos.length}</Badge>}
              </div>
              <Link
                href="/repositories"
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary"
              >
                View all
                <ChevronRight className="size-3" />
              </Link>
            </CardHeader>
            {registry.isPending ? (
              <TableSkeleton />
            ) : registry.isError ? (
              <div className="p-4">
                <ErrorState message={registry.error.message} retry={() => registry.refetch()} />
              </div>
            ) : repos.length ? (
              <RepositoryTable repositories={repos.slice(0, 5)} />
            ) : (
              <EmptyRepositories />
            )}
          </Card>
          <Card className="relative overflow-hidden border-primary/15 bg-gradient-to-br from-[#152720] via-card to-card">
            <div className="grid-pattern pointer-events-none absolute inset-0 opacity-40" />
            <CardContent className="relative p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.15em] text-primary">
                <Sparkles className="size-3.5" />
                From local build to live deployment
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    Your first push, in three commands.
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Connect your Docker CLI and give your images a place to land.
                  </p>
                </div>
                <Terminal className="hidden size-8 text-primary/40 sm:block" />
              </div>
              <div className="mt-5 space-y-2">
                <CommandBlock command={`docker login ${host}`} />
                <CommandBlock
                  command={`docker tag my-app:latest ${host}/my-project/my-app:latest`}
                />
                <CommandBlock command={`docker push ${host}/my-project/my-app:latest`} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <ShieldCheck className="size-3.5 text-primary" />
                  Pushing requires a maintainer or admin account.
                </span>
                <Link
                  href="/guide"
                  className="flex items-center gap-1 text-[11px] font-medium text-primary"
                >
                  Full quick start
                  <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-sm">Registry at a glance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Connection</span>
                <span
                  className={`flex items-center gap-1.5 ${registry.isSuccess ? "text-primary" : "text-muted-foreground"}`}
                >
                  <span
                    className={`size-1.5 rounded-full ${registry.isSuccess ? "bg-primary" : registry.isError ? "bg-red-400" : "bg-amber-400"}`}
                  />
                  {registry.isSuccess
                    ? "Operational"
                    : registry.isError
                      ? "Unavailable"
                      : "Connecting"}
                </span>
              </div>
              <div>
                <p className="mb-2 text-xs text-muted-foreground">Registry endpoint</p>
                <p className="rounded-md border bg-background/60 px-3 py-2.5 font-mono text-[11px]">
                  {host}
                </p>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">API version</span>
                <span>Distribution V2</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Default visibility</span>
                <span className="capitalize">{registry.data?.defaultVisibility ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-4 text-xs">
                <span className="text-muted-foreground">Your role</span>
                <Badge variant="secondary" className="capitalize">
                  {session?.user?.role ?? "Guest"}
                </Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="mb-2 flex size-8 items-center justify-center rounded-lg border bg-muted">
                <ShieldCheck className="size-4 text-primary" />
              </div>
              <CardTitle className="text-sm">Open to browse. Safe to build.</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Public images are discoverable by default. Write access stays with your team.
              </p>
              <ul className="mt-4 space-y-3">
                {[
                  "Anonymous public pulls",
                  "Role-based write access",
                  "Private image visibility",
                ].map((text) => (
                  <li
                    key={text}
                    className="flex items-center gap-2 text-[11px] text-muted-foreground"
                  >
                    <Check className="size-3 text-primary" />
                    {text}
                  </li>
                ))}
              </ul>
              <Link
                href="/guide#permissions"
                className="mt-5 flex items-center gap-1 text-[11px] font-medium text-primary"
              >
                Understand permissions
                <ArrowUpRight className="size-3" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

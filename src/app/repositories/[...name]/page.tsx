"use client"
import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowRight,
  Box,
  ChevronLeft,
  ChevronRight,
  Download,
  HardDrive,
  Layers3,
  Loader2,
  PackageOpen,
  Search,
  Settings2,
  ShieldCheck,
  Tag,
  Terminal,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api-client"
import type { ImageTag, Repository, Visibility } from "@/lib/types"
import { formatBytes, timeAgo } from "@/lib/utils"
import { useSession } from "@/hooks/use-session"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  CommandBlock,
  CopyButton,
  ErrorState,
  TableSkeleton,
  VisibilityBadge,
} from "@/components/shared"

type Detail = {
  repository: Repository
  images: ImageTag[]
  total: number
  page: number
  canWrite: boolean
}

function RepositorySettings({ repository }: { repository: Repository }) {
  const [description, setDescription] = useState(repository.description)
  const [visibility, setVisibility] = useState<Visibility>(repository.visibility)
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: () =>
      api(`/api/repositories/${repository.name}`, {
        method: "PATCH",
        body: JSON.stringify({ description, visibility }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["repository", repository.name] })
      client.invalidateQueries({ queryKey: ["repositories"] })
      toast.success("Repository settings saved.")
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Repository settings</CardTitle>
        <p className="text-xs text-muted-foreground">
          Control how this repository appears and who can pull it.
        </p>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              placeholder="Describe your image…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="visibility">Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as Visibility)}
            >
              <SelectTrigger id="visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public — anyone can browse and pull</SelectItem>
                <SelectItem value="private">Private — signed-in users only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Changing to private prevents new guest tokens. Previously issued pull tokens expire
              within 5 minutes. Already downloaded images cannot be revoked.
            </p>
          </div>
          <Button disabled={mutation.isPending} type="submit">
            {mutation.isPending && <Loader2 className="animate-spin" />}Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export default function RepositoryPage() {
  const { name: segments } = useParams<{ name: string[] }>()
  const name = segments.join("/")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [deleting, setDeleting] = useState<ImageTag | null>(null)
  const client = useQueryClient()
  const { data: session } = useSession()
  const query = useQuery({
    queryKey: ["repository", name, page, search],
    queryFn: () =>
      api<Detail>(`/api/repositories/${name}?page=${page}&search=${encodeURIComponent(search)}`),
  })
  const remove = useMutation({
    mutationFn: () =>
      api(`/api/repositories/${name}`, {
        method: "DELETE",
        body: JSON.stringify({ digest: deleting?.digest }),
      }),
    onSuccess: () => {
      setDeleting(null)
      client.invalidateQueries({ queryKey: ["repository", name] })
      client.invalidateQueries({ queryKey: ["repositories"] })
      toast.success("Image manifest deleted.")
    },
    onError: (error) => toast.error(error.message),
  })
  const host = session?.registryHost ?? "localhost:5000"
  if (query.isPending)
    return (
      <Card>
        <TableSkeleton />
      </Card>
    )
  if (query.isError)
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost">
          <Link href="/repositories">
            <ArrowLeft />
            Back to repositories
          </Link>
        </Button>
        <ErrorState message={query.error.message} retry={() => query.refetch()} />
      </div>
    )
  const { repository, images, total, canWrite } = query.data
  return (
    <div className="page-enter space-y-6">
      <Link
        href="/repositories"
        className="flex w-fit items-center gap-2 text-xs text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-3.5" />
        All repositories
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
          <Box className="size-6 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="break-all text-2xl font-semibold tracking-tight">{name}</h1>
            <VisibilityBadge visibility={repository.visibility} />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {repository.description || "A home for your container image."}
          </p>
        </div>
        <Badge variant="secondary">
          <Tag className="size-3" />
          {repository.tagCount} tags
        </Badge>
      </div>
      <Tabs defaultValue="tags">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="tags">
            <Tag className="size-3.5" />
            Image tags
          </TabsTrigger>
          <TabsTrigger value="pull">
            <Terminal className="size-3.5" />
            Usage
          </TabsTrigger>
          {canWrite && (
            <TabsTrigger value="settings">
              <Settings2 className="size-3.5" />
              Settings
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="tags">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Find a tag…"
                  aria-label="Search image tags"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
              {images.length ? (
                images.map((image) => (
                  <Card key={image.name} className="overflow-hidden">
                    <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <Tag className="size-4 text-primary" />
                        <span className="font-mono text-sm font-medium">{image.name}</span>
                        {image.name === "latest" && <Badge>Latest</Badge>}
                      </div>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-red-400"
                          aria-label={`Delete ${image.name}`}
                          onClick={() => setDeleting(image)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                    <CardContent className="space-y-4 pt-4">
                      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <HardDrive className="size-3.5" />
                          {formatBytes(image.size)} compressed
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Layers3 className="size-3.5" />
                          {image.platforms.length
                            ? image.platforms.join(", ")
                            : "Platform not specified"}
                        </span>
                        {image.created && (
                          <span title={new Date(image.created).toLocaleString()}>
                            Built {timeAgo(image.created)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">DIGEST</span>
                        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                          {image.digest}
                        </code>
                        <CopyButton
                          value={image.digest}
                          className="size-6 text-muted-foreground [&_svg]:size-3"
                        />
                      </div>
                      <CommandBlock command={`docker pull ${host}/${name}:${image.name}`} />
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <div className="flex flex-col items-center px-6 py-12 text-center">
                    <PackageOpen className="mb-4 size-9 text-primary/70" />
                    <h2 className="font-medium">
                      {search ? "No matching tags" : "Ready for your first image"}
                    </h2>
                    <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                      {search
                        ? "Try another search term."
                        : "Your repository is configured. Push an image from your Docker CLI to see it here."}
                    </p>
                    {!search && (
                      <div className="mt-5 w-full max-w-lg">
                        <CommandBlock command={`docker push ${host}/${name}:latest`} />
                      </div>
                    )}
                  </div>
                </Card>
              )}
              {total > 10 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-muted-foreground">
                    Page {page} of {Math.ceil(total / 10)} · {total} tags
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page * 10 >= total}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                      <ChevronRight />
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Download className="size-4 text-primary" />
                    Pull this image
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                    {repository.visibility === "public"
                      ? "This repository is public. No sign-in required to pull."
                      : "Sign in to Docker with your Dockyard account before pulling."}
                  </p>
                  {repository.visibility === "private" && (
                    <div className="mb-2">
                      <CommandBlock command={`docker login ${host}`} />
                    </div>
                  )}
                  <CommandBlock
                    command={`docker pull ${host}/${name}:${repository.tags.includes("latest") ? "latest" : (repository.tags[0] ?? "latest")}`}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Repository information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Visibility</span>
                    <span className="capitalize">{repository.visibility}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Image tags</span>
                    <span>{repository.tagCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Format</span>
                    <span>Docker / OCI</span>
                  </div>
                  <div className="border-t pt-4">
                    <p className="flex items-center gap-1.5 leading-relaxed text-muted-foreground">
                      <ShieldCheck className="size-3.5 shrink-0 text-primary" />
                      {canWrite ? "You have read and write access." : "You have read-only access."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="pull">
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle className="text-base">Use this repository</CardTitle>
              <p className="text-xs text-muted-foreground">
                Compatible with Docker, Podman, containerd, and other OCI clients.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="mb-3 text-sm font-medium">
                  1. Authenticate{" "}
                  {repository.visibility === "public" && (
                    <span className="font-normal text-muted-foreground">
                      (optional for public pulls)
                    </span>
                  )}
                </h3>
                <CommandBlock command={`docker login ${host}`} />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium">2. Pull an image</h3>
                <CommandBlock command={`docker pull ${host}/${name}:latest`} />
              </div>
              {canWrite && (
                <>
                  <div>
                    <h3 className="mb-3 text-sm font-medium">3. Tag your local image</h3>
                    <CommandBlock command={`docker tag my-app:latest ${host}/${name}:latest`} />
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-medium">4. Push to Dockyard</h3>
                    <CommandBlock command={`docker push ${host}/${name}:latest`} />
                  </div>
                </>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/guide">
                  Open the full guide
                  <ArrowRight />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        {canWrite && (
          <TabsContent value="settings">
            <RepositorySettings
              key={`${repository.description}:${repository.visibility}`}
              repository={repository}
            />
          </TabsContent>
        )}
      </Tabs>
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this image?</DialogTitle>
            <DialogDescription>
              This deletes the manifest for{" "}
              <strong className="text-foreground">{deleting?.name}</strong>. Every tag pointing to
              the same digest will be removed. Already downloaded images are unaffected, and layers
              remain on disk until garbage collection.
            </DialogDescription>
          </DialogHeader>
          <code className="break-all rounded-md border bg-background p-3 font-mono text-[11px] text-muted-foreground">
            {deleting?.digest}
          </code>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete manifest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

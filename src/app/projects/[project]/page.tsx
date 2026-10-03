"use client"
import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Box, FolderOpen, Loader2, Search, Settings2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api-client"
import { DeleteResourceDialog } from "@/components/delete-resource-dialog"
import type { Project, Repository, Visibility } from "@/lib/types"
import { NewRepositoryDialog } from "@/components/new-repository-dialog"
import { RepositoryTable, EmptyRepositories } from "@/components/repository-table"
import { CommandBlock, ErrorState, TableSkeleton, VisibilityBadge } from "@/components/shared"
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

type Detail = { project: Project; images: Repository[]; registryHost: string; canWrite: boolean }

function ProjectSettings({ project }: { project: Project }) {
  const [description, setDescription] = useState(project.description)
  const [visibility, setVisibility] = useState<Visibility>(project.visibility)
  const client = useQueryClient()
  const update = useMutation({
    mutationFn: () =>
      api(`/api/projects/${project.name}`, {
        method: "PATCH",
        body: JSON.stringify({ description, visibility }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["project", project.name] })
      client.invalidateQueries({ queryKey: ["projects"] })
      client.invalidateQueries({ queryKey: ["repositories"] })
      client.invalidateQueries({ queryKey: ["repository"] })
      toast.success("Project settings saved.")
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Project settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            update.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="project-description">Description</Label>
            <Input
              id="project-description"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-visibility">Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as Visibility)}
            >
              <SelectTrigger id="project-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public — guests can read public images</SelectItem>
                <SelectItem value="private">Private — sign-in required for every image</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Private projects hide all their images from guests, including images previously marked
              public. Returning a project to public restores each image’s own visibility. Already
              issued Docker tokens expire within five minutes.
            </p>
          </div>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending && <Loader2 className="animate-spin" />}Save project
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export default function ProjectPage() {
  const { project: name } = useParams<{ project: string }>()
  const [search, setSearch] = useState("")
  const query = useQuery({
    queryKey: ["project", name],
    queryFn: () => api<Detail>(`/api/projects/${name}`),
    refetchInterval: 60000,
  })
  if (query.isPending)
    return (
      <Card>
        <TableSkeleton />
      </Card>
    )
  if (query.isError)
    return <ErrorState message={query.error.message} retry={() => query.refetch()} />
  const { project, images, canWrite, registryHost } = query.data
  const filtered = images.filter((image) =>
    `${image.imageName} ${image.description}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <div className="page-enter space-y-6">
      <Link
        href="/projects"
        className="flex w-fit items-center gap-2 text-xs text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-3.5" />
        All projects
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
            <FolderOpen className="size-6 text-primary" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <VisibilityBadge visibility={project.visibility} />
              <Badge variant="secondary">{images.length} images</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {project.description || `Container images under ${project.name}/…`}
            </p>
          </div>
        </div>
        {canWrite && (
          <NewRepositoryDialog
            projectName={project.name}
            projectVisibility={project.visibility}
            defaultVisibility={project.visibility}
          />
        )}
      </div>
      <Tabs defaultValue="images">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="images">
            <Box className="size-3.5" />
            Images
          </TabsTrigger>
          {canWrite && (
            <TabsTrigger value="settings">
              <Settings2 className="size-3.5" />
              Project settings
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="images">
          <div className="space-y-5">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="Search project images"
                placeholder="Search images in this project…"
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Card className="overflow-hidden">
              {filtered.length ? (
                <RepositoryTable repositories={filtered} withinProject />
              ) : (
                <EmptyRepositories filtered={Boolean(search)} />
              )}
            </Card>
            <Card>
              <CardContent className="space-y-3 pt-5">
                <p className="text-xs text-muted-foreground">
                  Publish an image using exactly project/image:
                </p>
                <CommandBlock
                  command={`docker tag my-app:latest ${registryHost}/${project.name}/my-app:latest`}
                />
                <CommandBlock
                  command={`docker push ${registryHost}/${project.name}/my-app:latest`}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        {canWrite && (
          <TabsContent value="settings">
            <div className="space-y-5">
              <ProjectSettings
                key={`${project.description}:${project.visibility}`}
                project={project}
              />
              <DeleteResourceDialog
                kind="project"
                name={project.name}
                imageCount={project.imageCount}
                tagCount={project.tagCount}
              />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

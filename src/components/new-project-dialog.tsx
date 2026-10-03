"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FolderPlus, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api-client"
import type { Visibility } from "@/lib/types"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"

export function NewProjectDialog({
  defaultVisibility = "public",
}: {
  defaultVisibility?: Visibility
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility)
  const router = useRouter()
  const client = useQueryClient()
  const create = useMutation({
    mutationFn: () =>
      api("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name, description, visibility }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["projects"] })
      setOpen(false)
      toast.success("Project created. Add your first image.")
      router.push(`/projects/${name}`)
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FolderPlus />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a project</DialogTitle>
          <DialogDescription>
            A namespace for related images, such as dockyard/init and dockyard/web.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-project-name">Project name</Label>
            <Input
              id="new-project-name"
              placeholder="dockyard"
              required
              maxLength={253}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              One lowercase name. No slashes, registry hostname, or tag.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-project-description">Description</Label>
            <Input
              id="new-project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What does this project contain?"
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-project-visibility">Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as Visibility)}
            >
              <SelectTrigger id="new-project-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  Public — public images can be browsed by guests
                </SelectItem>
                <SelectItem value="private">Private — all images require sign-in</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <FolderPlus />}Create
              project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

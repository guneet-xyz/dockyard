"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api-client"
import { imageHref } from "@/lib/image-names"
import type { Visibility } from "@/lib/types"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"
import { MAX_DESCRIPTION_LENGTH } from "@/lib/description"
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

export function NewRepositoryDialog({
  defaultVisibility = "public",
  projectName,
  projectVisibility,
}: {
  defaultVisibility?: Visibility
  projectName?: string
  projectVisibility?: Visibility
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [visibility, setVisibility] = useState<Visibility>(
    projectVisibility === "private" ? "private" : defaultVisibility,
  )
  const router = useRouter()
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: () =>
      api("/api/repositories", {
        method: "POST",
        body: JSON.stringify({
          name: projectName ? `${projectName}/${name}` : name,
          description,
          visibility,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["repositories"] })
      client.invalidateQueries({ queryKey: ["projects"] })
      client.invalidateQueries({ queryKey: ["project"] })
      setOpen(false)
      toast.success("Image created. Ready for your first push.")
      router.push(imageHref(projectName ? `${projectName}/${name}` : name))
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New image
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create an image</DialogTitle>
          <DialogDescription>
            Reserve a name and set its visibility before pushing your first image.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="repository-name">{projectName ? "Image name" : "Image path"}</Label>
            <Input
              id="repository-name"
              placeholder={projectName ? "init" : "dockyard/init"}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={projectName ? 254 - projectName.length : 255}
            />
            <p className="text-xs text-muted-foreground">
              {projectName
                ? `Stored as ${projectName}/${name || "image"}. Image names cannot contain slashes.`
                : "Use exactly project/image. An unconfigured project is created with the registry’s default visibility."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="repository-description">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="repository-description"
              placeholder="What’s inside this image?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={MAX_DESCRIPTION_LENGTH}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repository-visibility">Visibility</Label>
            <Select
              value={visibility}
              disabled={projectVisibility === "private"}
              onValueChange={(value) => setVisibility(value as Visibility)}
            >
              <SelectTrigger id="repository-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public — anyone can browse and pull</SelectItem>
                <SelectItem value="private">Private — signed-in users only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />}Create
              image
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

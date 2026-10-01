"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Loader2, Plus } from "lucide-react"
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

export function NewRepositoryDialog({
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
  const mutation = useMutation({
    mutationFn: () =>
      api("/api/repositories", {
        method: "POST",
        body: JSON.stringify({ name, description, visibility }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["repositories"] })
      setOpen(false)
      toast.success("Repository created. Ready for your first push.")
      router.push(`/repositories/${name}`)
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New repository
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a repository</DialogTitle>
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
            <Label htmlFor="repository-name">Repository name</Label>
            <Input
              id="repository-name"
              placeholder="team/my-app"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={255}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers and separators. Namespaces are welcome.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="repository-description">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="repository-description"
              placeholder="What’s inside this image?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repository-visibility">Visibility</Label>
            <Select
              value={visibility}
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
              repository
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

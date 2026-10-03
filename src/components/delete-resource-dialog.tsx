"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api-client"
import { repositoryIdentity } from "@/lib/image-names"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
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

export function DeleteResourceDialog({
  kind,
  name,
  tagCount,
  imageCount,
}: {
  kind: "image" | "project"
  name: string
  tagCount: number
  imageCount?: number
}) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const client = useQueryClient()
  const router = useRouter()
  const deletion = useMutation({
    mutationFn: () =>
      api(`/api/${kind === "project" ? "projects" : "repositories"}/${name}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmName: confirmation }),
      }),
    onSuccess: async () => {
      setOpen(false)
      setConfirmation("")
      // Drop stale detail data before a resource name can be reused.
      await Promise.all(
        ["repository", "project"].map((key) => client.cancelQueries({ queryKey: [key] })),
      )
      client.removeQueries({ queryKey: ["repository"] })
      client.removeQueries({ queryKey: ["project"] })
      for (const key of ["repositories", "projects", "activity"])
        void client.invalidateQueries({ queryKey: [key] })
      toast.success(
        kind === "project" ? "Project and its images deleted." : "Image and all its tags deleted.",
      )
      const project = kind === "image" ? repositoryIdentity(name).projectName : null
      router.push(
        project ? `/projects/${project}` : kind === "project" ? "/projects" : "/repositories",
      )
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Card className="max-w-2xl border-red-400/20">
      <CardHeader>
        <CardTitle className="text-base">Delete {kind}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {kind === "project"
            ? "Delete this project and every image and tag inside it, including legacy nested images."
            : "Delete this image repository and every tag, not just a single manifest."}{" "}
          This cannot be undone.
        </p>
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!deletion.isPending) {
              setOpen(value)
              if (!value) setConfirmation("")
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="destructive">
              <Trash2 />
              Delete {kind}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Delete this {kind}?</DialogTitle>
              <DialogDescription>
                This permanently removes{" "}
                {kind === "project" ? `${imageCount ?? 0} images and ` : ""}
                {tagCount} tags from Dockyard. Pause publishers before deleting. Already-issued
                Docker tokens can remain valid for up to five minutes, and stored layers/untagged
                manifests require registry garbage collection to reclaim space.
              </DialogDescription>
            </DialogHeader>
            <p className="min-w-0 break-all text-sm">
              Type <strong className="font-mono">{name}</strong> to confirm. Reusing a deleted name
              requires explicitly creating it again.
            </p>
            <form
              className="min-w-0 space-y-5"
              onSubmit={(event) => {
                event.preventDefault()
                if (confirmation === name && !deletion.isPending) deletion.mutate()
              }}
            >
              <div className="min-w-0 space-y-2">
                <Label htmlFor={`delete-${kind}-confirmation`}>Confirm {kind} name</Label>
                <Input
                  id={`delete-${kind}-confirmation`}
                  className="min-w-0 font-mono text-xs"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={deletion.isPending}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={deletion.isPending}
                  onClick={() => {
                    setOpen(false)
                    setConfirmation("")
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={deletion.isPending || confirmation !== name}
                >
                  {deletion.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete{" "}
                  {kind}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

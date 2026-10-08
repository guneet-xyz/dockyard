"use client"
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FilePenLine, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api-client"
import { MAX_DESCRIPTION_LENGTH } from "@/lib/description"
import { Button } from "./ui/button"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog"

export function DescriptionEditor({
  kind,
  name,
  description,
}: {
  kind: "image" | "project"
  name: string
  description: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(description)
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: () =>
      api(`/api/${kind === "project" ? "projects" : "repositories"}/${name}`, {
        method: "PATCH",
        body: JSON.stringify({ description: text }),
      }),
    onSuccess: () => {
      setOpen(false)
      for (const key of ["repository", "repositories", "project", "projects", "activity"])
        void client.invalidateQueries({ queryKey: [key] })
      toast.success(`${kind === "image" ? "Image" : "Project"} description saved.`)
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!save.isPending) {
          setOpen(value)
          if (value) setText(description)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FilePenLine />
          {description ? "Edit description" : "Add description"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{kind === "image" ? "Image" : "Project"} description</DialogTitle>
          <DialogDescription className="break-all">
            Describe {name}. This changes only its description, not its visibility or image content.
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${kind}-description-editor`}>Description</Label>
            <Textarea
              id={`${kind}-description-editor`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={MAX_DESCRIPTION_LENGTH}
              rows={6}
              disabled={save.isPending}
              placeholder="Purpose, usage notes, links, or release information…"
            />
            <p className="text-xs text-muted-foreground">
              {text.length.toLocaleString("en-US")} /{" "}
              {MAX_DESCRIPTION_LENGTH.toLocaleString("en-US")} characters · plain text
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}Save description
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

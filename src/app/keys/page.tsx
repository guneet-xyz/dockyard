"use client"
import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useSession } from "@/hooks/use-session"
import { useProjects } from "@/hooks/use-projects"
import { useRepositories } from "@/hooks/use-repositories"
import { api } from "@/lib/api-client"
import type { KeyCredentials } from "@/lib/key-export"
import { KeyCredentialsDialog } from "@/components/key-credentials-dialog"
import type { AccessKeyInfo, KeyAction, KeyGrant } from "@/lib/types"
import { timeAgo } from "@/lib/utils"
import { ErrorState, TableSkeleton } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type KeysResponse = {
  keys: AccessKeyInfo[]
  registryHost: string
  canWrite: boolean
  isAdmin: boolean
}

function CreateKey({ canWrite }: { canWrite: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [name, setName] = useState("")
  const [days, setDays] = useState("90")
  const [grants, setGrants] = useState<KeyGrant[]>([
    { type: "image", target: "", actions: ["pull"] },
  ])
  const [credentials, setCredentials] = useState<KeyCredentials | null>(null)
  const client = useQueryClient()
  const projects = useProjects(open)
  const images = useRepositories(open)
  function targets(type: KeyGrant["type"]) {
    return type === "project"
      ? (projects.data?.projects ?? []).map((project) => project.name)
      : (images.data?.repositories ?? []).map((image) => image.name)
  }
  const validSelections = grants.every(
    (grant) =>
      (grant.type === "project" ? projects.isSuccess : images.isSuccess) &&
      targets(grant.type).includes(grant.target) &&
      grant.actions.length > 0,
  )
  function updateGrant(index: number, change: Partial<KeyGrant>) {
    setGrants((current) =>
      current.map((grant, i) => (i === index ? { ...grant, ...change } : grant)),
    )
  }
  async function create() {
    if (!validSelections) {
      toast.error("Select an available project or image for every grant.")
      return
    }
    setPending(true)
    try {
      // Never store the one-time secret in query/mutation caches or local storage.
      const created = await api<KeyCredentials>("/api/keys", {
        method: "POST",
        body: JSON.stringify({
          name,
          grants,
          expiresAt:
            days === "never"
              ? null
              : new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString(),
        }),
      })
      setOpen(false)
      setCredentials(created)
      setName("")
      setGrants([{ type: "image", target: "", actions: ["pull"] }])
      client.invalidateQueries({ queryKey: ["keys"] })
      toast.success("Automation key created. Save its secret now.")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value)
        }}
      >
        <DialogTrigger asChild>
          <Button>
            <Plus />
            Create key
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create an automation key</DialogTitle>
            <DialogDescription>
              Grant only the projects, images, and operations your pipeline needs. Keys never grant
              browser or administration access.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="key-name">Key name</Label>
              <Input
                id="key-name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="GitHub Actions — release"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-expiry">Expiration</Label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger id="key-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days (recommended)</SelectItem>
                  <SelectItem value="365">1 year</SelectItem>
                  <SelectItem value="never">No expiration</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Resource grants</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={grants.length >= 50}
                  onClick={() =>
                    setGrants([...grants, { type: "image", target: "", actions: ["pull"] }])
                  }
                >
                  <Plus />
                  Add grant
                </Button>
              </div>
              {grants.map((grant, index) => (
                <div key={index} className="space-y-3 rounded-lg border bg-background/40 p-3">
                  <div className="flex items-center gap-2">
                    <Select
                      value={grant.type}
                      onValueChange={(type) =>
                        updateGrant(index, { type: type as KeyGrant["type"], target: "" })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Grant ${index + 1} type`}
                        className="w-28 shrink-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="image">Image</SelectItem>
                        <SelectItem value="project">Project</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={grant.target}
                      onValueChange={(target) => updateGrant(index, { target })}
                      disabled={
                        pending ||
                        (grant.type === "project"
                          ? projects.isPending || projects.isError
                          : images.isPending || images.isError) ||
                        !targets(grant.type).length
                      }
                    >
                      <SelectTrigger
                        aria-label={`Grant ${index + 1} target`}
                        className="min-w-0 flex-1 [&_span]:truncate"
                      >
                        <SelectValue
                          placeholder={
                            (grant.type === "project" ? projects.isPending : images.isPending)
                              ? "Loading resources…"
                              : `Select ${grant.type}`
                          }
                        />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 overflow-y-auto">
                        {targets(grant.type).map((target) => (
                          <SelectItem key={target} value={target}>
                            {target}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {grants.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove grant ${index + 1}`}
                        onClick={() => setGrants(grants.filter((_, i) => i !== index))}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {(["pull", "push", "delete"] as KeyAction[]).map((action) => (
                      <label key={action} className="flex items-center gap-2 text-xs capitalize">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-[var(--primary)]"
                          checked={grant.actions.includes(action)}
                          disabled={!canWrite && action !== "pull"}
                          onChange={(event) =>
                            updateGrant(index, {
                              actions: event.target.checked
                                ? [...grant.actions, action]
                                : grant.actions.filter((value) => value !== action),
                            })
                          }
                        />
                        {action[0].toUpperCase() + action.slice(1)}
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {grant.type === "project"
                      ? "Applies to every image under this project, including future images."
                      : "Applies only to this exact image, including future tags."}
                  </p>
                  {(grant.type === "project" ? projects.isSuccess : images.isSuccess) &&
                    !targets(grant.type).length && (
                      <p className="text-xs text-muted-foreground">
                        {grant.type === "project"
                          ? "No projects available. Create a project first."
                          : "No images available. Create or reserve an image, or choose a project grant for future images."}
                      </p>
                    )}
                </div>
              ))}
            </div>
            {(projects.isError || images.isError) && (
              <div
                role="alert"
                className="space-y-2 rounded-md border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-400"
              >
                <p>
                  Unable to load{" "}
                  {projects.isError && images.isError
                    ? "projects and images"
                    : projects.isError
                      ? "projects"
                      : "images"}
                  . Please retry.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (projects.isError) void projects.refetch()
                    if (images.isError) void images.refetch()
                  }}
                >
                  Retry resources
                </Button>
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Select an existing project or configured image. Reserve an image first for an
              exact-image first push, or use a project grant for future images. Include pull with
              push for typical Docker workflows.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name || !validSelections}>
                {pending && <Loader2 className="animate-spin" />}Create key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {credentials && (
        <KeyCredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
      )}
    </>
  )
}

function KeysView() {
  const session = useSession()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["keys"],
    queryFn: () => api<KeysResponse>("/api/keys"),
    refetchInterval: 30000,
  })
  const [revoking, setRevoking] = useState<AccessKeyInfo | null>(null)
  const [rotating, setRotating] = useState<AccessKeyInfo | null>(null)
  const [rotationPending, setRotationPending] = useState(false)
  const [rotatedCredentials, setRotatedCredentials] = useState<KeyCredentials | null>(null)
  async function rotate() {
    if (!rotating || rotationPending) return
    setRotationPending(true)
    try {
      // As with creation, keep one-time secrets out of React Query caches/storage.
      const credentials = await api<KeyCredentials>(`/api/keys/${rotating.id}/rotate`, {
        method: "POST",
      })
      setRotating(null)
      setRotatedCredentials(credentials)
      client.invalidateQueries({ queryKey: ["keys"] })
      toast.success("Key rotated. Update your CI secret now.")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRotationPending(false)
    }
  }
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["keys"] })
      setRevoking(null)
      toast.success("Key revoked. New token requests are blocked.")
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <div className="page-enter space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automation keys</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Scoped credentials for CI/CD and other automated registry flows.
          </p>
        </div>
        {query.data && <CreateKey canWrite={query.data.canWrite} />}
      </div>
      <Card>
        <CardContent className="flex items-start gap-3 pt-5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Each key has its own project/image grants and is capped by its owner’s current role.
            Disabling the owner blocks their keys. Registry tokens already issued can remain valid
            for up to five minutes after rotation or revocation; expiration can shorten that window.
          </p>
        </CardContent>
      </Card>
      {query.isPending ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => query.refetch()} />
      ) : !query.data.keys.length ? (
        <Card>
          <div className="flex flex-col items-center py-14 text-center">
            <KeyRound className="mb-4 size-8 text-primary" />
            <h2 className="font-medium">Give your pipeline just enough access.</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Create a pull-only deploy key, an image-specific build key, or a project release key.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {query.data.keys.map((key) => {
            const status = key.status
            return (
              <Card key={key.id}>
                <CardHeader className="items-start justify-between gap-3 sm:flex-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <CardTitle className="break-all text-sm">{key.name}</CardTitle>
                      <Badge variant={status === "Active" ? "default" : "secondary"}>
                        {status}
                      </Badge>
                      {key.ownerId !== session.data?.user?.id && (
                        <Badge variant="outline" className="max-w-full break-all whitespace-normal">
                          {key.ownerUsername}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                      {key.username}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {status === "Active" && (
                      <Button variant="outline" size="sm" onClick={() => setRotating(key)}>
                        <RefreshCw />
                        Rotate
                      </Button>
                    )}
                    {!key.revokedAt && (
                      <Button variant="destructive" size="sm" onClick={() => setRevoking(key)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {key.grants.map((grant, index) => (
                      <Badge
                        key={index}
                        variant="outline"
                        className="max-w-full flex-wrap whitespace-normal py-1.5"
                      >
                        <span className="capitalize">{grant.type}</span>
                        <span className="min-w-0 break-all font-mono">{grant.target}</span>
                        <span className="text-primary">{grant.actions.join(", ")}</span>
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-muted-foreground">
                    <span>Created {timeAgo(key.createdAt)}</span>
                    <span>Last authenticated {timeAgo(key.lastUsedAt)}</span>
                    {key.rotatedAt && <span>Last rotated {timeAgo(key.rotatedAt)}</span>}
                    <span>
                      {key.expiresAt
                        ? `Expires ${new Date(key.expiresAt).toLocaleDateString()}`
                        : "No expiration"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      <Dialog
        open={Boolean(rotating)}
        onOpenChange={(value) => {
          if (!value && !rotationPending) setRotating(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate this key?</DialogTitle>
            <DialogDescription>
              Replace the secret for {rotating?.name}. The username, owner, grants, and expiration
              stay unchanged. The old secret stops authenticating immediately, so update your CI
              secret manager after saving the replacement. Previously issued registry tokens may
              remain valid for up to five minutes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={rotationPending} onClick={() => setRotating(null)}>
              Cancel
            </Button>
            <Button disabled={rotationPending} onClick={() => void rotate()}>
              {rotationPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}Rotate key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {rotatedCredentials && (
        <KeyCredentialsDialog
          credentials={rotatedCredentials}
          onClose={() => setRotatedCredentials(null)}
        />
      )}
      <Dialog
        open={Boolean(revoking)}
        onOpenChange={(value) => {
          if (!value && !revoke.isPending) setRevoking(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this key?</DialogTitle>
            <DialogDescription>
              New Docker authentication for {revoking?.name} will stop immediately. Previously
              issued registry tokens can remain valid for up to five minutes. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={revoke.isPending} onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => revoking && revoke.mutate(revoking.id)}
            >
              {revoke.isPending && <Loader2 className="animate-spin" />}Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function KeysPage() {
  const session = useSession()
  if (session.isPending)
    return (
      <Card>
        <TableSkeleton />
      </Card>
    )
  if (session.isError)
    return <ErrorState message={session.error.message} retry={() => session.refetch()} />
  if (!session.data.user)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <KeyRound className="mb-5 size-9 text-primary" />
        <h1 className="text-xl font-semibold">Sign in to manage automation keys</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Keys provide scoped registry access without sharing your account password.
        </p>
        <Button asChild className="mt-6">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    )
  return <KeysView />
}

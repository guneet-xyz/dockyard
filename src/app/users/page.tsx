"use client"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api-client"
import type { Role, UserInfo } from "@/lib/types"
import { useSession } from "@/hooks/use-session"
import { AdminGate } from "@/components/admin-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ErrorState, TableSkeleton } from "@/components/shared"

function AddUser() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>("viewer")
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: () =>
      api("/api/users", {
        method: "POST",
        body: JSON.stringify({ name, username, password, role }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["users"] })
      setOpen(false)
      setName("")
      setUsername("")
      setPassword("")
      setRole("viewer")
      toast.success("User created. They can sign in to the UI and Docker CLI.")
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a team member</DialogTitle>
          <DialogDescription>
            Create an account for both the web UI and Docker CLI. Share credentials securely.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="new-name">Display name</Label>
            <Input
              id="new-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Alex Morgan"
              required
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-username">Username</Label>
            <Input
              id="new-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="alex"
              autoComplete="off"
              required
              minLength={3}
              maxLength={64}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 12 characters"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={72}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-role">Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as Role)}>
              <SelectTrigger id="new-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer — browse and pull</SelectItem>
                <SelectItem value="maintainer">Maintainer — push and manage images</SelectItem>
                <SelectItem value="admin">Admin — full registry administration</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function UsersView() {
  const [search, setSearch] = useState("")
  const [resetUser, setResetUser] = useState<UserInfo | null>(null)
  const [password, setPassword] = useState("")
  const session = useSession()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ users: UserInfo[] }>("/api/users"),
  })
  const update = useMutation({
    mutationFn: ({
      id,
      ...changes
    }: {
      id: string
      role?: Role
      enabled?: boolean
      password?: string
    }) => api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["users"] })
      client.invalidateQueries({ queryKey: ["session"] })
      setResetUser(null)
      setPassword("")
      toast.success("Account updated. Existing web sessions have been revoked.")
    },
    onError: (error) => toast.error(error.message),
  })
  const filtered = (query.data?.users ?? []).filter((user) =>
    `${user.name} ${user.username}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <div className="page-enter space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Access control</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The right people. The right permissions.
          </p>
        </div>
        <AddUser />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            role: "Viewer",
            description: "Browse and pull all images, including private repositories.",
            icon: UserRound,
            color: "text-sky-400",
          },
          {
            role: "Maintainer",
            description:
              "Everything viewers can do, plus push, delete, and configure repositories.",
            icon: KeyRound,
            color: "text-primary",
          },
          {
            role: "Admin",
            description: "Full access, including user management and registry audit history.",
            icon: ShieldCheck,
            color: "text-violet-400",
          },
        ].map(({ role, description, icon: Icon, color }) => (
          <Card className="p-5" key={role}>
            <div className="mb-3 flex items-center gap-2">
              <Icon className={`size-4 ${color}`} />
              <h2 className="text-sm font-medium">{role}</h2>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          </Card>
        ))}
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search team members…"
          aria-label="Search team members"
          className="pl-9"
        />
      </div>
      {query.isError ? (
        <ErrorState message={query.error.message} retry={() => query.refetch()} />
      ) : (
        <Card className="overflow-hidden">
          {query.isPending ? (
            <TableSkeleton />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-full border bg-muted text-sm text-muted-foreground">
                          {user.name[0].toUpperCase()}
                        </span>
                        <div>
                          <p className="text-sm font-medium">
                            {user.name}
                            {user.id === session.data?.user?.id && (
                              <span className="ml-2 text-[10px] text-muted-foreground">you</span>
                            )}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {user.username}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(role) => update.mutate({ id: user.id, role: role as Role })}
                        disabled={user.id === session.data?.user?.id || update.isPending}
                      >
                        <SelectTrigger
                          aria-label={`Role for ${user.username}`}
                          className="h-8 w-32 text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="maintainer">Maintainer</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.enabled ? "default" : "secondary"}>
                        {user.enabled ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Actions for ${user.username}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setResetUser(user)
                              setPassword("")
                            }}
                          >
                            <KeyRound />
                            Reset password
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={user.id === session.data?.user?.id || update.isPending}
                            onSelect={() => update.mutate({ id: user.id, enabled: !user.enabled })}
                          >
                            {user.enabled ? <UserRoundX /> : <UserRoundCheck />}
                            {user.enabled ? "Disable account" : "Enable account"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                      No matching team members.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-primary" />
        Role and password changes revoke web sessions. Registry tokens expire within 5 minutes.
      </p>
      <Dialog
        open={Boolean(resetUser)}
        onOpenChange={(open) => {
          if (!open) setResetUser(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for {resetUser?.username}. Their existing web sessions will be
              signed out.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (resetUser) update.mutate({ id: resetUser.id, password })
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="reset-password">New password</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={72}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending && <Loader2 className="animate-spin" />}Reset password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function UsersPage() {
  return (
    <AdminGate>
      <UsersView />
    </AdminGate>
  )
}

"use client"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowRight,
  Container,
  Eye,
  EyeOff,
  Globe2,
  Layers3,
  Loader2,
  ShieldCheck,
} from "lucide-react"
import { api } from "@/lib/api-client"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const router = useRouter()
  const client = useQueryClient()
  const login = useMutation({
    mutationFn: () =>
      api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
    onSuccess: () => {
      client.clear()
      router.push("/")
      router.refresh()
    },
  })
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r bg-[#0b1412] p-12 lg:flex">
        <div className="grid-pattern absolute inset-0 opacity-50" />
        <div className="pointer-events-none absolute left-[-20%] top-1/3 size-[600px] rounded-full bg-primary/5 blur-[100px]" />
        <Link href="/" className="relative">
          <Logo />
        </Link>
        <div className="relative mx-auto max-w-md">
          <div className="relative mx-auto mb-12 flex size-40 items-center justify-center rounded-[30px] border border-primary/20 bg-primary/5 shadow-[0_0_90px_#6ce9ba08]">
            <div className="absolute -inset-5 rounded-[40px] border border-primary/5" />
            <Container className="size-20 text-primary" strokeWidth={1} />
            <span className="absolute -bottom-3 -right-3 flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-[#12271e]">
              <ShieldCheck className="size-6 text-primary" />
            </span>
          </div>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Built by you.
            <br />
            <span className="text-primary">Hosted by you.</span>
          </h2>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
            A secure home for your container images, without giving up control of your
            infrastructure.
          </p>
          <div className="mt-8 flex gap-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <Layers3 className="size-4 text-primary" />
              OCI compatible
            </span>
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              Role-based access
            </span>
          </div>
        </div>
        <p className="relative text-[11px] text-muted-foreground/60">
          Your images. Your infrastructure. Dockyard.
        </p>
      </div>
      <div className="flex flex-col px-6 py-8">
        <Link
          href="/"
          className="flex w-fit items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to registry
        </Link>
        <div className="mx-auto my-auto w-full max-w-sm py-12">
          <Logo className="mb-10 lg:hidden" />
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
            Welcome back
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Sign in to Dockyard</h1>
          <p className="mt-3 text-sm text-muted-foreground">Your workspace is one login away.</p>
          <form
            className="mt-8 space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              login.mutate()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                placeholder="Your username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                maxLength={64}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  maxLength={72}
                  className="h-11 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-3 top-3.5 text-muted-foreground"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {login.isError && (
              <p
                role="alert"
                className="rounded-md border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-400"
              >
                {login.error.message}
              </p>
            )}
            <Button className="h-11 w-full" disabled={login.isPending} type="submit">
              {login.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />}Sign in
            </Button>
          </form>
          <div className="my-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] text-muted-foreground">JUST LOOKING AROUND?</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <Button asChild variant="outline" className="h-11 w-full">
            <Link href="/">
              <Globe2 />
              Continue as guest
            </Link>
          </Button>
          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            Need an account? Contact your registry administrator.
            <br />
            Public images are always available to guests.
          </p>
        </div>
        <p className="text-center text-[10px] text-muted-foreground/50">
          Protected with server-side sessions and role-based permissions.
        </p>
      </div>
    </div>
  )
}

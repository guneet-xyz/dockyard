"use client"
import Link from "next/link"
import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  ExternalLink,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  ShieldCheck,
  Terminal,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { useSession } from "@/hooks/use-session"
import { api } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { Logo } from "./logo"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"

const navigation = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Repositories", href: "/repositories", icon: Box },
  { label: "Quick start", href: "/guide", icon: Terminal },
]

function Sidebar({ close }: { close?: () => void }) {
  const pathname = usePathname()
  const { data } = useSession()
  const isAdmin = data?.user?.role === "admin"
  return (
    <div className="flex h-full flex-col bg-[#0b1016] px-4 py-6">
      <Link href="/" onClick={close} className="mb-8 px-2">
        <Logo />
      </Link>
      <div className="mb-7 rounded-lg border bg-card/60 p-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="size-1.5 rounded-full bg-primary" />
          Self-hosted registry
          <Badge variant="outline" className="ml-auto text-[9px]">
            V2
          </Badge>
        </div>
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
          {data?.registryHost ?? "Connecting…"}
        </p>
      </div>
      <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
        Workspace
      </p>
      <nav aria-label="Main navigation" className="space-y-1">
        {navigation.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={close}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] transition-colors",
              (href === "/" ? pathname === "/" : pathname.startsWith(href))
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-[17px]" />
            {label}
            {(href === "/" ? pathname === "/" : pathname.startsWith(href)) && (
              <span className="ml-auto size-1.5 rounded-full bg-primary" />
            )}
          </Link>
        ))}
      </nav>
      <p className="mb-2 mt-7 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
        Administration
      </p>
      <nav aria-label="Administration" className="space-y-1">
        {[
          { label: "Access control", href: "/users", icon: Users },
          { label: "Activity log", href: "/activity", icon: Activity },
        ].map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={isAdmin ? href : "/guide#permissions"}
            onClick={close}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] transition-colors",
              pathname === href
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-[17px]" />
            {label}
            {!isAdmin && <ShieldCheck className="ml-auto size-3.5 opacity-40" />}
          </Link>
        ))}
      </nav>
      <div className="mt-auto pt-10">
        <div className="rounded-lg border border-primary/15 bg-gradient-to-br from-primary/5 to-transparent p-4">
          <ShieldCheck className="mb-3 size-5 text-primary" />
          <p className="text-xs font-medium">Your images. Your infrastructure.</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            A private home for everything you build.
          </p>
          <Link
            href="/guide"
            onClick={close}
            className="mt-3 flex items-center gap-1 text-[11px] font-medium text-primary"
          >
            Explore the guide <ArrowUpRight className="size-3" />
          </Link>
        </div>
        <a
          href="https://distribution.github.io/distribution/"
          target="_blank"
          rel="noreferrer"
          className="mt-5 flex items-center gap-2 px-3 text-xs text-muted-foreground hover:text-foreground"
        >
          <BookOpen className="size-3.5" />
          Registry documentation
          <ExternalLink className="ml-auto size-3" />
        </a>
        <div className="mt-5 flex items-center justify-between border-t px-3 pt-4 text-[10px] text-muted-foreground/60">
          <span>Dockyard v1.0</span>
          <span className="flex items-center gap-1.5">
            <Command className="size-3" />
            Built for builders
          </span>
        </div>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const client = useQueryClient()
  const { data } = useSession()
  const user = data?.user
  const title =
    pathname === "/"
      ? "Overview"
      : pathname.startsWith("/repositories")
        ? "Repositories"
        : pathname === "/users"
          ? "Access control"
          : pathname === "/activity"
            ? "Activity log"
            : "Quick start"
  if (pathname === "/login") return <>{children}</>
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" })
      client.clear()
      router.push("/")
      router.refresh()
      toast.success("Signed out. You’re now browsing as a guest.")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[230px] border-r lg:block">
        <Sidebar />
      </aside>
      <div className="lg:ml-[230px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-background/90 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu />
                </Button>
              </DialogTrigger>
              <DialogContent
                className="inset-y-0 left-0 top-0 h-full w-[280px] max-w-[90vw] translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 p-0"
                aria-describedby={undefined}
              >
                <DialogTitle className="sr-only">Navigation</DialogTitle>
                <Sidebar close={() => setMobileOpen(false)} />
              </DialogContent>
            </Dialog>
            <span className="hidden text-xs text-muted-foreground sm:inline">Workspace</span>
            <ChevronRight className="hidden size-3 text-muted-foreground/50 sm:block" />
            <span className="text-xs font-medium">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/guide"
              aria-label="Help and quick start"
              className="hidden text-muted-foreground hover:text-foreground sm:block"
            >
              <CircleHelp className="size-4" />
            </Link>
            <span className="hidden h-5 w-px bg-border sm:block" />
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 px-2">
                    <span className="flex size-7 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs text-primary">
                      {user.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="hidden text-xs sm:inline">{user.name}</span>
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <div className="px-2 py-2">
                    <p className="text-xs font-medium">{user.username}</p>
                    <p className="mt-1 text-[11px] capitalize text-muted-foreground">{user.role}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={logout}>
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  Guest access
                </Badge>
                <Button asChild size="sm">
                  <Link href="/login">
                    <LogIn className="size-3.5" />
                    Sign in
                  </Link>
                </Button>
              </>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-5 py-8 sm:px-8 lg:px-10">{children}</main>
        <footer className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-2 border-t py-5 text-[11px] text-muted-foreground/60 sm:mx-8 lg:mx-10">
          <span>Dockyard · Your container images, organized.</span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3" />
            Powered by CNCF Distribution
          </span>
        </footer>
      </div>
    </div>
  )
}

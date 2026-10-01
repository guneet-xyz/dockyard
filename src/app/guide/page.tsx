"use client"
import Link from "next/link"
import { ArrowUpRight, BookOpen, Check, Globe2, Info, ShieldCheck, Terminal } from "lucide-react"
import { useSession } from "@/hooks/use-session"
import { CommandBlock } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function GuidePage() {
  const { data } = useSession()
  const host = data?.registryHost ?? "localhost:5000"
  const steps = [
    {
      title: "Connect to your registry",
      description:
        "Use the same username and password you use to sign in to Dockyard. Pushing requires a maintainer or admin account.",
      command: `docker login ${host}`,
    },
    {
      title: "Build an image",
      description:
        "Run this from a project with a Dockerfile, or use an image you’ve already built.",
      command: "docker build -t my-app:latest .",
    },
    {
      title: "Give it a registry address",
      description: "Tag your local image with your registry hostname and repository name.",
      command: `docker tag my-app:latest ${host}/my-app:latest`,
    },
    {
      title: "Push it to Dockyard",
      description: "Your image and tags will appear in the repository browser automatically.",
      command: `docker push ${host}/my-app:latest`,
    },
  ]
  return (
    <div className="page-enter max-w-5xl space-y-8">
      <div>
        <Badge variant="secondary" className="mb-4">
          <Terminal className="size-3" />
          Quick start
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">A small guide to shipping.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your Docker CLI already knows the way. Here’s how to get connected.
        </p>
      </div>
      <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4">
        <div className="flex gap-3">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div>
            <h2 className="text-xs font-medium text-amber-200">Local HTTP vs. production HTTPS</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              The default Compose setup uses HTTP on localhost for development. For a remote HTTP
              registry, Docker must trust it via the{" "}
              <code className="text-slate-300">insecure-registries</code> setting. In production,
              terminate TLS for both the UI and registry using a reverse proxy. Never send passwords
              over untrusted HTTP.
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        {steps.map((step, index) => (
          <Card key={step.title}>
            <CardContent className="flex gap-4 p-5 sm:gap-5 sm:p-6">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/5 font-mono text-xs text-primary">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium">{step.title}</h2>
                <p className="mb-4 mt-2 text-xs leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
                <CommandBlock command={step.command} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe2 className="size-4 text-primary" />
            Pulling public images
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            No account needed. Guests can browse and pull any public repository.
          </p>
          <CommandBlock command={`docker pull ${host}/my-app:latest`} />
          <p className="mt-3 text-xs text-muted-foreground">
            For a private image, run <code>docker login</code> first.
          </p>
        </CardContent>
      </Card>
      <Card id="permissions" className="scroll-mt-24 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" />
            Permissions, at a glance
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The same roles apply in the browser and Docker CLI. All active signed-in users can read
            private repositories.
          </p>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Capability</TableHead>
              <TableHead>Guest</TableHead>
              <TableHead>Viewer</TableHead>
              <TableHead>Maintainer</TableHead>
              <TableHead>Admin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              { label: "Browse & pull public images", values: [true, true, true, true] },
              { label: "Browse & pull private images", values: [false, true, true, true] },
              { label: "Push & delete images", values: [false, false, true, true] },
              { label: "Configure repositories", values: [false, false, true, true] },
              { label: "Manage users & view audit history", values: [false, false, false, true] },
            ].map((row) => (
              <TableRow key={row.label}>
                <TableCell className="whitespace-nowrap text-xs">{row.label}</TableCell>
                {row.values.map((value, i) => (
                  <TableCell key={i}>
                    {value ? (
                      <>
                        <Check className="size-4 text-primary" />
                        <span className="sr-only">Allowed</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground/40" aria-label="Not allowed">
                        —
                      </span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="border-t p-5 text-xs leading-relaxed text-muted-foreground">
          New repositories are public unless configured otherwise. To push a private image safely,
          create a private repository in the UI{" "}
          <strong className="font-medium text-foreground">before</strong> the first push.
          Administrators can also change the default in their deployment environment.
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button asChild variant="outline">
          <a href="https://distribution.github.io/distribution/" target="_blank" rel="noreferrer">
            <BookOpen />
            Distribution documentation
            <ArrowUpRight />
          </a>
        </Button>
        <Button asChild>
          <Link href="/repositories">
            Explore repositories
            <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </div>
  )
}

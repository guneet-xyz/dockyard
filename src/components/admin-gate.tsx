"use client"
import Link from "next/link"
import { LockKeyhole } from "lucide-react"
import { useSession } from "@/hooks/use-session"
import { Button } from "./ui/button"
import { Card } from "./ui/card"
import { ErrorState, TableSkeleton } from "./shared"

export function AdminGate({ children }: { children: React.ReactNode }) {
  const session = useSession()
  if (session.isPending)
    return (
      <Card>
        <TableSkeleton />
      </Card>
    )
  if (session.isError)
    return <ErrorState message={session.error.message} retry={() => session.refetch()} />
  if (session.data.user?.role !== "admin")
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <div className="mb-5 flex size-14 items-center justify-center rounded-xl border bg-card">
          <LockKeyhole className="size-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">Administrator access required</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          User management and audit history are available to registry administrators.
        </p>
        <Button asChild className="mt-6">
          <Link href={session.data.user ? "/" : "/login"}>
            {session.data.user ? "Back to overview" : "Sign in"}
          </Link>
        </Button>
      </div>
    )
  return <>{children}</>
}

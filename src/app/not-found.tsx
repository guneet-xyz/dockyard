import Link from "next/link"
import { PackageSearch } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <PackageSearch className="mb-5 size-10 text-primary" />
      <h1 className="text-2xl font-semibold">Nothing docked here.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This page doesn’t exist. Let’s get you back to your images.
      </p>
      <Button asChild className="mt-6">
        <Link href="/repositories">Browse repositories</Link>
      </Button>
    </div>
  )
}

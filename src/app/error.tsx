"use client"
import { ErrorState } from "@/components/shared"

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState message="An unexpected error occurred. Please try again." retry={reset} />
}

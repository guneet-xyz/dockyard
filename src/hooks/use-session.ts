"use client"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { SessionUser } from "@/lib/types"

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ user: SessionUser | null; registryHost: string }>("/api/auth/me"),
  })
}

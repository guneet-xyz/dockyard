"use client"

import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api-client"
import type { VersionInfo } from "@/lib/types"

// Wait for the session so the role-specific response is fetched only once.
export function useVersion(role: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["version", role ?? "guest"],
    queryFn: () => api<VersionInfo>("/api/version"),
    staleTime: 60 * 60 * 1000,
    enabled,
  })
}

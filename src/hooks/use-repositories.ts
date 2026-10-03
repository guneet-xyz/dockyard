"use client"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { RegistryOverview } from "@/lib/types"

export function useRepositories(enabled = true) {
  return useQuery({
    queryKey: ["repositories"],
    enabled,
    queryFn: () => api<RegistryOverview>("/api/repositories"),
    refetchInterval: 60000,
  })
}

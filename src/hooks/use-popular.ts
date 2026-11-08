"use client"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { PopularOverview } from "@/lib/types"

export function usePopular() {
  return useQuery({
    queryKey: ["popular"],
    queryFn: () => api<PopularOverview>("/api/popular"),
    refetchInterval: 60000,
  })
}

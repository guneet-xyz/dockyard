"use client"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import type { ProjectOverview } from "@/lib/types"

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ProjectOverview>("/api/projects"),
    refetchInterval: 60000,
  })
}

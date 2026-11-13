"use client"

import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api-client"
import type { UpdateStatus } from "@/lib/types"

export function useUpdateStatus(isAdmin: boolean) {
  return useQuery({
    queryKey: ["update-status"],
    queryFn: () => api<UpdateStatus>("/api/version"),
    staleTime: 60 * 60 * 1000,
    enabled: isAdmin,
  })
}

"use client"
import { useParams } from "next/navigation"
import ImageDetail from "@/components/image-detail"

export default function RepositoryPage() {
  const { name } = useParams<{ name: string[] }>()
  return <ImageDetail name={name.join("/")} />
}

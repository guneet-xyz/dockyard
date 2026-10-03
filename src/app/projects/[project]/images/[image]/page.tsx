"use client"
import { useParams } from "next/navigation"
import ImageDetail from "@/components/image-detail"

export default function ProjectImagePage() {
  const { project, image } = useParams<{ project: string; image: string }>()
  return <ImageDetail name={`${project}/${image}`} />
}

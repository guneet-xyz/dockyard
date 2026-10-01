import type { Metadata } from "next"
import { Providers } from "@/components/providers"
import { AppShell } from "@/components/app-shell"
import "./globals.css"

export const metadata: Metadata = {
  title: { default: "Dockyard · Container registry", template: "%s · Dockyard" },
  description: "A beautiful, self-hosted container registry. Your images. Your infrastructure.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}

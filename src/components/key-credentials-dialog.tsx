"use client"
import { useState } from "react"
import { Download, Eye, EyeOff } from "lucide-react"
import { keyExportFilename, serializeKeyCredentials, type KeyCredentials } from "@/lib/key-export"
import { CommandBlock, CopyButton } from "./shared"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"

export function KeyCredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: KeyCredentials
  onClose: () => void
}) {
  const [showSecret, setShowSecret] = useState(false)
  function download() {
    const url = URL.createObjectURL(
      new Blob([serializeKeyCredentials(credentials)], { type: "application/json;charset=utf-8" }),
    )
    const anchor = document.createElement("a")
    try {
      anchor.href = url
      anchor.download = keyExportFilename(credentials.id)
      document.body.appendChild(anchor)
      anchor.click()
    } finally {
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Save your key secret</DialogTitle>
          <DialogDescription>
            This is the only time Dockyard will show the secret. Store it in your CI secret manager;
            it cannot be retrieved later.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="key-username">Docker username</Label>
            <div className="flex min-w-0 items-center gap-2">
              <Input
                id="key-username"
                value={credentials.username}
                readOnly
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <CopyButton value={credentials.username} className="shrink-0" />
            </div>
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="key-secret">Key secret</Label>
            <div className="flex min-w-0 items-center gap-2">
              <Input
                id="key-secret"
                value={credentials.secret}
                type={showSecret ? "text" : "password"}
                readOnly
                className="min-w-0 flex-1 font-mono text-xs"
                autoComplete="off"
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setShowSecret(!showSecret)}
                aria-label={showSecret ? "Hide key secret" : "Show key secret"}
              >
                {showSecret ? <EyeOff /> : <Eye />}
              </Button>
              <CopyButton value={credentials.secret} className="shrink-0" />
            </div>
          </div>
          <CommandBlock
            command={`printf '%s' "$DOCKYARD_KEY" | docker login ${credentials.registryHost} --username ${credentials.username} --password-stdin`}
          />
          <p className="text-xs text-muted-foreground">
            Set DOCKYARD_KEY to the secret in your CI environment. Do not put the secret directly in
            a command or commit it to your repository.
          </p>
          <p className="text-xs text-amber-300">
            Downloaded JSON includes the unencrypted key secret. Keep it private and out of Git.
          </p>
          <DialogFooter className="flex-col sm:flex-row">
            <Button variant="outline" className="w-full sm:w-auto" onClick={download}>
              <Download />
              Download JSON
            </Button>
            <Button className="w-full sm:w-auto" onClick={onClose}>
              I saved the secret
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

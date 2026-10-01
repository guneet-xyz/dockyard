import { cp } from "node:fs/promises"

await cp(".next/static", ".next/standalone/.next/static", { recursive: true })
process.env.HOSTNAME ??= "0.0.0.0"
await import("../.next/standalone/server.js")

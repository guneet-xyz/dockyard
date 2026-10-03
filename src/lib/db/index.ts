import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> }

function client() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.")
  return (globalForDb.pg ??= postgres(process.env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  }))
}

// Lazy initialization lets Next.js build without a live database.
export function db() {
  return drizzle(client(), { schema })
}

export type DatabaseExecutor = Pick<
  ReturnType<typeof db>,
  "select" | "insert" | "update" | "delete" | "execute"
>

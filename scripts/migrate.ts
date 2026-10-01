import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { users } from "../src/lib/db/schema"
import { newPasswordSchema } from "../src/lib/password"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is required.")
  const client = postgres(url, { max: 1 })
  const database = drizzle(client)

  try {
    await client`SELECT pg_advisory_lock(713920)`
    await migrate(database, { migrationsFolder: "./drizzle" })
    const existing = await database.select({ id: users.id }).from(users).limit(1)
    if (existing.length === 0) {
      const username = z
        .string()
        .min(3)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9._-]+$/)
        .parse(process.env.ADMIN_USERNAME ?? "admin")
      const password = newPasswordSchema.parse(process.env.ADMIN_PASSWORD)
      await database.insert(users).values({
        username,
        name: "Registry administrator",
        role: "admin",
        passwordHash: await bcrypt.hash(password, 12),
      })
      console.log(`Created initial administrator: ${username}`)
    }
    console.log("Database migrations complete.")
  } finally {
    await client`SELECT pg_advisory_unlock(713920)`
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

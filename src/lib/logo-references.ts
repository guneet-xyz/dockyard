import { db, type DatabaseExecutor } from "./db"
import { resourceLogos } from "./db/schema"
import { logoUrl } from "./logo-constants"

export async function logoReferences(connection: DatabaseExecutor = db()) {
  const rows = await connection
    .select({ kind: resourceLogos.kind, name: resourceLogos.name, digest: resourceLogos.digest })
    .from(resourceLogos)
  return new Map(
    rows.map((row) => [`${row.kind}:${row.name}`, logoUrl(row.kind, row.name, row.digest)]),
  )
}

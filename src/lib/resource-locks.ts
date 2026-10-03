import { sql } from "drizzle-orm"
import { db, type DatabaseExecutor } from "./db"
import { HttpError } from "./http"
import { repositoryIdentity, validProjectName } from "./image-names"
import { validRepositoryName } from "./permissions"

export async function lockImageNamespace(connection: DatabaseExecutor, name: string, write = true) {
  if (!validRepositoryName(name)) throw new HttpError(400, "Invalid repository name.")
  const project = repositoryIdentity(name).projectName
  await lockNamespace(connection, project ? `project:${project}` : `image:${name}`, write)
}

async function lockNamespace(connection: DatabaseExecutor, name: string, write: boolean) {
  // Database-wide transaction locks also coordinate multiple web replicas.
  await connection.execute(
    write
      ? sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dockyard:${name}`}, 0))`
      : sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`dockyard:${name}`}, 0))`,
  )
}

export async function withImageResource<T>(
  name: string,
  callback: (tx: DatabaseExecutor) => Promise<T>,
  write = true,
) {
  return db().transaction(async (tx) => {
    await lockImageNamespace(tx, name, write)
    return callback(tx)
  })
}

export async function withProjectResource<T>(
  name: string,
  callback: (tx: DatabaseExecutor) => Promise<T>,
) {
  if (!validProjectName(name)) throw new HttpError(400, "Invalid project name.")
  return db().transaction(async (tx) => {
    await lockNamespace(tx, `project:${name}`, true)
    return callback(tx)
  })
}

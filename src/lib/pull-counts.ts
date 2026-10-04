import { eq, sql } from "drizzle-orm"
import { db, type DatabaseExecutor } from "./db"
import { imageTagPulls, registryPullEvents, repositories, projects } from "./db/schema"
import { repositoryIdentity } from "./image-names"
import { countablePull, pullAfterReset, type RegistryEvent } from "./registry-events"
import { withImageResource } from "./resource-locks"

export async function recordPull(event: RegistryEvent) {
  const target = countablePull(event)
  if (!target) return
  await withImageResource(
    target.repositoryName,
    async (tx) => {
      const receipt = await tx
        .insert(registryPullEvents)
        .values({ id: event.id })
        .onConflictDoNothing()
        .returning({ id: registryPullEvents.id })
      if (!receipt.length) return
      const projectName = repositoryIdentity(target.repositoryName).projectName
      const [image, project] = await Promise.all([
        tx
          .select({ deletedAt: repositories.deletedAt, resetAt: repositories.pullCountsResetAt })
          .from(repositories)
          .where(eq(repositories.name, target.repositoryName))
          .limit(1)
          .then((rows) => rows[0]),
        projectName
          ? tx
              .select({ deletedAt: projects.deletedAt, resetAt: projects.pullCountsResetAt })
              .from(projects)
              .where(eq(projects.name, projectName))
              .limit(1)
              .then((rows) => rows[0])
          : Promise.resolve(undefined),
      ])
      if (
        image?.deletedAt ||
        project?.deletedAt ||
        !pullAfterReset(event.timestamp, image?.resetAt, project?.resetAt)
      )
        return
      await tx
        .insert(imageTagPulls)
        .values({ ...target, pullCount: 1 })
        .onConflictDoUpdate({
          target: [imageTagPulls.repositoryName, imageTagPulls.tag],
          set: { pullCount: sql`${imageTagPulls.pullCount} + 1` },
        })
    },
    false,
  )
}

export async function repositoryPullTotals(connection: DatabaseExecutor = db()) {
  const rows = await connection
    .select({
      name: imageTagPulls.repositoryName,
      count: sql<number>`sum(${imageTagPulls.pullCount})`.mapWith(Number),
    })
    .from(imageTagPulls)
    .groupBy(imageTagPulls.repositoryName)
  return new Map(rows.map((row) => [row.name, row.count]))
}

export async function imagePullCounts(name: string, connection: DatabaseExecutor = db()) {
  const rows = await connection
    .select({ tag: imageTagPulls.tag, count: imageTagPulls.pullCount })
    .from(imageTagPulls)
    .where(eq(imageTagPulls.repositoryName, name))
  return {
    total: rows.reduce((sum, row) => sum + row.count, 0),
    byTag: new Map(rows.map((row) => [row.tag, row.count])),
  }
}

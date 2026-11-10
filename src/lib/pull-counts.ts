import { eq, lt, lte, sql } from "drizzle-orm"
import { db, type DatabaseExecutor } from "./db"
import {
  imageTagPulls,
  registryPullEvents,
  registryPullWindows,
  repositories,
  projects,
} from "./db/schema"
import { repositoryIdentity } from "./image-names"
import {
  countablePull,
  pullAfterReset,
  pullClientKey,
  PULL_DEDUPLICATION_WINDOW_MS,
  type RegistryEvent,
} from "./registry-events"
import { withImageResource } from "./resource-locks"

export async function recordPull(event: RegistryEvent) {
  const target = countablePull(event)
  if (!target) return
  const clientKey = pullClientKey(event, target, process.env.REGISTRY_WEBHOOK_SECRET ?? "")
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
      if (clientKey) {
        // Atomic per-client window: the conflicting row only advances (and counts)
        // once the previous counted lookup is older than the window.
        const countedAt = new Date(event.timestamp)
        const windowStart = new Date(countedAt.getTime() - PULL_DEDUPLICATION_WINDOW_MS)
        const opened = await tx
          .insert(registryPullWindows)
          .values({ key: clientKey, countedAt })
          .onConflictDoUpdate({
            target: registryPullWindows.key,
            set: { countedAt },
            setWhere: lte(registryPullWindows.countedAt, windowStart),
          })
          .returning({ key: registryPullWindows.key })
        if (!opened.length) return
      }
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

// Closed windows no longer affect counting; keep a margin for delayed notifications.
export async function pruneRecentPulls(connection: DatabaseExecutor = db()) {
  await connection
    .delete(registryPullWindows)
    .where(
      lt(registryPullWindows.countedAt, new Date(Date.now() - 10 * PULL_DEDUPLICATION_WINDOW_MS)),
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

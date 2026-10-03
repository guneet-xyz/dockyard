import { NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { z } from "zod"
import { audit, requireUser } from "@/lib/auth"
import { generateKeyCredentials, keyUsername } from "@/lib/access-keys"
import { config } from "@/lib/config"
import { db } from "@/lib/db"
import { accessKeys, users } from "@/lib/db/schema"
import { apiError, assertSameOrigin, HttpError, jsonBody } from "@/lib/http"
import { validImageRepository, validProjectName, repositoryIdentity } from "@/lib/image-names"
import { canWrite, validRepositoryName } from "@/lib/permissions"
import { readableProject } from "@/lib/projects"
import { repositoryExists, repositoryMetadata } from "@/lib/registry"

export const dynamic = "force-dynamic"
const action = z.enum(["pull", "push", "delete"])
const grantSchema = z.object({
  type: z.enum(["project", "image"]),
  target: z.string().min(1).max(255),
  actions: z
    .array(action)
    .min(1)
    .max(3)
    .transform((actions) => [...new Set(actions)]),
})

export async function GET() {
  try {
    const user = await requireUser()
    const keys = await db()
      .select({
        id: accessKeys.id,
        name: accessKeys.name,
        ownerId: accessKeys.ownerId,
        ownerUsername: users.username,
        ownerEnabled: users.enabled,
        grants: accessKeys.grants,
        createdAt: accessKeys.createdAt,
        expiresAt: accessKeys.expiresAt,
        revokedAt: accessKeys.revokedAt,
        lastUsedAt: accessKeys.lastUsedAt,
        rotatedAt: accessKeys.rotatedAt,
      })
      .from(accessKeys)
      .innerJoin(users, eq(users.id, accessKeys.ownerId))
      .where(user.role === "admin" ? undefined : eq(accessKeys.ownerId, user.id))
      .orderBy(desc(accessKeys.createdAt))
    return NextResponse.json(
      {
        keys: keys.map((key) => ({
          ...key,
          username: keyUsername(key.id),
          status: key.revokedAt
            ? "Revoked"
            : key.expiresAt && key.expiresAt.getTime() <= Date.now()
              ? "Expired"
              : !key.ownerEnabled
                ? "Owner disabled"
                : "Active",
        })),
        registryHost: config.registryHost,
        canWrite: canWrite(user),
        isAdmin: user.role === "admin",
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const input = z
      .object({
        name: z.string().trim().min(1).max(100),
        grants: z.array(grantSchema).min(1).max(50),
        expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
      })
      .parse(await jsonBody(request))
    if (
      !canWrite(user) &&
      input.grants.some((grant) => grant.actions.some((action) => action !== "pull"))
    )
      throw new HttpError(403, "Your role permits pull-only keys.")
    for (const grant of input.grants) {
      if (grant.type === "project") {
        if (!validProjectName(grant.target)) throw new HttpError(400, "Invalid project scope.")
        await readableProject(grant.target, user)
      } else {
        if (!validRepositoryName(grant.target)) throw new HttpError(400, "Invalid image scope.")
        const metadata = await repositoryMetadata(grant.target)
        if (validImageRepository(grant.target)) {
          await readableProject(repositoryIdentity(grant.target).projectName!, user)
        } else if (!metadata.configured && !(await repositoryExists(grant.target))) {
          throw new HttpError(400, "Legacy image scopes must refer to an existing repository.")
        }
      }
    }
    const expiresAt =
      input.expiresAt === undefined
        ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        : input.expiresAt
          ? new Date(input.expiresAt)
          : null
    if (
      expiresAt &&
      (expiresAt.getTime() <= Date.now() + 1000 ||
        expiresAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000)
    )
      throw new HttpError(400, "Expiry must be in the future and within one year.")
    const credentials = generateKeyCredentials()
    await db().insert(accessKeys).values({
      id: credentials.id,
      ownerId: user.id,
      name: input.name,
      secretHash: credentials.secretHash,
      grants: input.grants,
      expiresAt,
    })
    await audit(user.username, "key.create", input.name, {
      keyId: credentials.id,
      grants: input.grants,
      expiresAt: expiresAt?.toISOString() ?? null,
    })
    return NextResponse.json(
      {
        id: credentials.id,
        username: credentials.username,
        secret: credentials.secret,
        name: input.name,
        grants: input.grants,
        expiresAt,
        registryHost: config.registryHost,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return apiError(error)
  }
}

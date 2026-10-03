import { NextResponse } from "next/server"
import { checkCredentials } from "@/lib/auth"
import { authenticateAccessKey, type AuthenticatedKey } from "@/lib/access-keys"
import { allowedKeyActions } from "@/lib/key-permissions"
import { config } from "@/lib/config"
import { apiError, HttpError } from "@/lib/http"
import { allowedActions, validRepositoryName } from "@/lib/permissions"
import { repositoryExists, repositoryMetadata } from "@/lib/registry"
import { validImageRepository } from "@/lib/image-names"
import { type RegistryAccess, signRegistryToken, registryTokenExpiry } from "@/lib/registry-token"
import type { SessionUser } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    if (url.searchParams.get("service") !== config.service)
      throw new HttpError(400, "Unknown registry service.")
    let user: SessionUser | null = null
    let key: AuthenticatedKey | null = null
    const authorization = request.headers.get("authorization")
    if (authorization) {
      if (!authorization.startsWith("Basic ") || authorization.length > 2048)
        throw new HttpError(401, "Invalid credentials.")
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8")
      const separator = decoded.indexOf(":")
      if (separator < 0) throw new HttpError(401, "Invalid credentials.")
      const username = decoded.slice(0, separator)
      const password = decoded.slice(separator + 1)
      if (username.startsWith("_key_")) {
        key = await authenticateAccessKey(username, password)
        user = key?.user ?? null
      } else {
        user = await checkCredentials(username, password)
      }
      if (!user) throw new HttpError(401, "Invalid credentials.")
    }
    const scopes = url.searchParams
      .getAll("scope")
      .flatMap((scope) => scope.split(" "))
      .filter(Boolean)
    if (scopes.length > 50) throw new HttpError(400, "Too many requested scopes.")
    const access: RegistryAccess[] = []
    for (const scope of scopes) {
      const [type, name, rawActions, extra] = scope.split(":")
      if (!name || !rawActions || extra) throw new HttpError(400, "Invalid scope.")
      if (type === "repository" && validRepositoryName(name)) {
        const metadata = await repositoryMetadata(name)
        let actions = key
          ? allowedKeyActions(
              key.grants,
              user!.role,
              metadata.visibility,
              name,
              rawActions.split(","),
            )
          : allowedActions(user?.role ?? null, metadata.visibility, rawActions.split(","))
        if (
          actions.includes("push") &&
          !validImageRepository(name) &&
          !metadata.configured &&
          !(await repositoryExists(name))
        ) {
          actions = actions.filter((action) => action !== "push" && action !== "delete")
        }
        access.push({
          type,
          name,
          actions,
        })
      } else if (type === "registry" && name === "catalog") {
        access.push({
          type,
          name,
          actions:
            !key && user?.role === "admin" && rawActions.split(",").includes("*") ? ["*"] : [],
        })
      }
    }
    const token = await signRegistryToken(
      key?.subject ?? user?.username ?? "",
      access,
      key?.expiresAt ?? null,
    )
    return NextResponse.json(
      {
        token,
        access_token: token,
        expires_in: Math.max(
          0,
          registryTokenExpiry(key?.expiresAt ?? null) - Math.floor(Date.now() / 1000),
        ),
        issued_at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    const response = apiError(error)
    if (response.status === 401) response.headers.set("WWW-Authenticate", 'Basic realm="Dockyard"')
    return response
  }
}

import { createHash } from "node:crypto"
import sharp from "sharp"
import { and, eq } from "drizzle-orm"
import type { DatabaseExecutor } from "./db"
import { projects, repositories, resourceLogos, auditEvents, users } from "./db/schema"
import { canRead, canWrite } from "./permissions"
import { projectMetadata, readableProject } from "./projects"
import { repositoryMetadata, repositoryExists } from "./registry"
import { HttpError } from "./http"
import { withImageResource, withProjectResource } from "./resource-locks"
import {
  LOGO_SIZE,
  MAX_LOGO_BYTES,
  MAX_LOGO_PIXELS,
  logoUrl,
  type LogoKind,
} from "./logo-constants"
import type { SessionUser } from "./types"

export async function normalizeLogo(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES)
    throw new HttpError(413, "Choose a photo/logo no larger than 5 MiB.")
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp =
    bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
  if (!png && !jpeg && !webp)
    throw new HttpError(
      400,
      "Choose a PNG, JPEG, or WebP photo/logo. SVG, GIF, archives, and other files are not supported.",
    )
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_LOGO_PIXELS, failOn: "warning" })
    const meta = await image.metadata()
    if (
      !meta.width ||
      !meta.height ||
      meta.width > 8192 ||
      meta.height > 8192 ||
      (meta.pages ?? 1) !== 1 ||
      !["png", "jpeg", "webp"].includes(meta.format ?? "")
    )
      throw new Error("Invalid dimensions or animated image")
    // Default output strips EXIF/other metadata; auto-orient before resizing.
    const data = await image
      .rotate()
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()
    if (data.length > 1024 ** 2) throw new Error("Oversized normalized picture")
    return { data, digest: createHash("sha256").update(data).digest("hex") }
  } catch {
    throw new HttpError(
      400,
      "The photo/logo could not be decoded. Use a static PNG, JPEG, or WebP under 16 megapixels.",
    )
  }
}

async function assertReadable(
  kind: LogoKind,
  name: string,
  user: SessionUser | null,
  connection: DatabaseExecutor,
) {
  if (kind === "project") {
    const project = await projectMetadata(name, connection)
    if (!project || project.deletedAt || !canRead(user, project.visibility))
      throw new HttpError(404, "Logo not found.")
  } else {
    const image = await repositoryMetadata(name, connection)
    if (image.deleted || !canRead(user, image.visibility))
      throw new HttpError(404, "Logo not found.")
  }
}

export async function readLogo(kind: LogoKind, name: string, user: SessionUser | null) {
  const read = async (tx: DatabaseExecutor) => {
    await assertReadable(kind, name, user, tx)
    const [logo] = await tx
      .select({ data: resourceLogos.data, digest: resourceLogos.digest })
      .from(resourceLogos)
      .where(and(eq(resourceLogos.kind, kind), eq(resourceLogos.name, name)))
      .limit(1)
    if (!logo) throw new HttpError(404, "Logo not found.")
    return logo
  }
  return kind === "project"
    ? withProjectResource(name, read, false)
    : withImageResource(name, read, false)
}

export async function changeLogo(
  kind: LogoKind,
  name: string,
  user: SessionUser,
  logo: Awaited<ReturnType<typeof normalizeLogo>> | null,
) {
  if (!user.enabled || !canWrite(user))
    throw new HttpError(403, "Maintainer or administrator access is required.")
  const change = async (tx: DatabaseExecutor) => {
    const [actor] = await tx
      .select({ enabled: users.enabled, role: users.role })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
    if (!actor?.enabled || !canWrite(actor))
      throw new HttpError(403, "Maintainer or administrator access is required.")
    if (kind === "project") {
      const metadata = await projectMetadata(name, tx)
      if (metadata?.deletedAt) throw new HttpError(404, "Project not found.")
      if (!metadata) {
        const current = await readableProject(name, user, tx)
        await tx
          .insert(projects)
          .values({
            name,
            description: current.project.description,
            visibility: current.project.visibility,
          })
          .onConflictDoNothing()
      }
    } else {
      const current = await repositoryMetadata(name, tx)
      if (current.deleted || (!current.configured && !(await repositoryExists(name))))
        throw new HttpError(404, "Image not found.")
      await tx
        .insert(repositories)
        .values({ name, description: current.description, visibility: current.visibility })
        .onConflictDoNothing()
    }
    if (logo) {
      await tx
        .insert(resourceLogos)
        .values({ kind, name, ...logo })
        .onConflictDoUpdate({
          target: [resourceLogos.kind, resourceLogos.name],
          set: { ...logo, updatedAt: new Date() },
        })
    } else
      await tx
        .delete(resourceLogos)
        .where(and(eq(resourceLogos.kind, kind), eq(resourceLogos.name, name)))
    await tx.insert(auditEvents).values({
      actor: user.username,
      action: `${kind}.logo.${logo ? "update" : "remove"}`,
      target: name,
    })
    return { ok: true, logoUrl: logo ? logoUrl(kind, name, logo.digest) : null }
  }
  return kind === "project" ? withProjectResource(name, change) : withImageResource(name, change)
}

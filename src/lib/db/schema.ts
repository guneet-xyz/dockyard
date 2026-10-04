import {
  boolean,
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import type { KeyGrant } from "../types"

export const roleEnum = pgEnum("role", ["admin", "maintainer", "viewer"])
export const visibilityEnum = pgEnum("visibility", ["public", "private"])

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("viewer"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
)

export const projects = pgTable("projects", {
  name: text("name").primaryKey(),
  description: text("description").notNull().default(""),
  visibility: visibilityEnum("visibility").notNull().default("public"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  pullCountsResetAt: timestamp("pull_counts_reset_at", { withTimezone: true }),
})

export const accessKeys = pgTable(
  "access_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    secretHash: text("secret_hash").notNull(),
    grants: jsonb("grants").$type<KeyGrant[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (table) => [index("access_keys_owner_idx").on(table.ownerId)],
)

// Distribution stores images as repository names; project membership is their first path segment.
export const repositories = pgTable("repositories", {
  name: text("name").primaryKey(),
  visibility: visibilityEnum("visibility").notNull().default("public"),
  description: text("description").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  pullCountsResetAt: timestamp("pull_counts_reset_at", { withTimezone: true }),
})

// Counts belong to named tags, not digests (aliases must remain independent).
// No FK is needed: Distribution can contain images not yet configured in Dockyard.
export const imageTagPulls = pgTable(
  "image_tag_pulls",
  {
    repositoryName: text("repository_name").notNull(),
    tag: text("tag").notNull(),
    pullCount: bigint("pull_count", { mode: "number" }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.repositoryName, table.tag] })],
)

// A retry must not increment a counter twice. Do not retain client identities/IPs.
export const registryPullEvents = pgTable("registry_pull_events", {
  id: uuid("id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
})

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_created_idx").on(table.createdAt)],
)

// Shared between app instances; failed credential checks never reset on a restart.
export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
})

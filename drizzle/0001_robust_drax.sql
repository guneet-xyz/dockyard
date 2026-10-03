CREATE TABLE "projects" (
	"name" text PRIMARY KEY NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Preserve existing repository paths and privacy when introducing project namespaces.
INSERT INTO "projects" ("name", "visibility", "updated_at")
SELECT split_part("name", '/', 1),
       CASE WHEN bool_or("visibility" = 'public') THEN 'public'::"visibility" ELSE 'private'::"visibility" END,
       max("updated_at")
FROM "repositories"
WHERE strpos("name", '/') > 0
GROUP BY split_part("name", '/', 1)
ON CONFLICT ("name") DO NOTHING;

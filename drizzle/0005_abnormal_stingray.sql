CREATE TABLE "image_tag_pulls" (
	"repository_name" text NOT NULL,
	"tag" text NOT NULL,
	"pull_count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "image_tag_pulls_repository_name_tag_pk" PRIMARY KEY("repository_name","tag")
);
--> statement-breakpoint
CREATE TABLE "registry_pull_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pull_counts_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "pull_counts_reset_at" timestamp with time zone;
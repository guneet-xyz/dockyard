CREATE TABLE "registry_pull_windows" (
	"key" text PRIMARY KEY NOT NULL,
	"counted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "registry_pull_windows_counted_idx" ON "registry_pull_windows" USING btree ("counted_at");
CREATE TABLE "resource_logos" (
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"data" "bytea" NOT NULL,
	"digest" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_logos_kind_name_pk" PRIMARY KEY("kind","name")
);

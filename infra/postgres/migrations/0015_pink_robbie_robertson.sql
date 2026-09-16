CREATE TABLE "runtime_heartbeats" (
	"service" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

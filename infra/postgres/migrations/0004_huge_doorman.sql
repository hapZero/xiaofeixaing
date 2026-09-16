CREATE TABLE "service_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text,
	"secret_ciphertext" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "workflow_bindings_owner_source_uidx";--> statement-breakpoint
ALTER TABLE "character_forms" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_connections" ADD CONSTRAINT "service_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_connections_owner_kind_uidx" ON "service_connections" USING btree ("owner_id","kind");--> statement-breakpoint
CREATE INDEX "service_connections_owner_idx" ON "service_connections" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "workflow_bindings_owner_source_idx" ON "workflow_bindings" USING btree ("owner_id","source_workflow_id");
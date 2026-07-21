CREATE TYPE "public"."generation_status" AS ENUM('waiting', 'active', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_source_type" AS ENUM('upload', 'ai_script', 'canvas');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'scripting', 'assets', 'storyboarding', 'rendering', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "generation_status" DEFAULT 'waiting' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_type" "project_source_type" NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"style_preset" text DEFAULT '写实电影风格' NOT NULL,
	"aspect_ratio" text DEFAULT '16:9' NOT NULL,
	"synopsis" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"name" text NOT NULL,
	"workflow_storage_key" text NOT NULL,
	"input_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_bindings" ADD CONSTRAINT "workflow_bindings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_idempotency_uidx" ON "generation_jobs" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "generation_jobs_project_created_idx" ON "generation_jobs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_owner_updated_idx" ON "projects" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uidx" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_bindings_owner_capability_name_uidx" ON "workflow_bindings" USING btree ("owner_id","capability","name");--> statement-breakpoint
CREATE INDEX "workflow_bindings_capability_enabled_idx" ON "workflow_bindings" USING btree ("capability","enabled");
CREATE TABLE "workflow_execution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"execution_type" text NOT NULL,
	"execution_id" uuid NOT NULL,
	"prompt_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"node_id" text,
	"node_title" text,
	"node_value" integer,
	"node_max" integer,
	"overall_progress" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"workflow_binding_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"status" "generation_status" DEFAULT 'waiting' NOT NULL,
	"comfy_prompt_id" text,
	"input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"bridge_workflow_id" text NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"workflow_storage_key" text NOT NULL,
	"node_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_bindings" ADD COLUMN "source_type" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_bindings" ADD COLUMN "source_workflow_id" text;--> statement-breakpoint
ALTER TABLE "workflow_bindings" ADD COLUMN "source_version" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_events" ADD CONSTRAINT "workflow_execution_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_test_runs" ADD CONSTRAINT "workflow_test_runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_test_runs" ADD CONSTRAINT "workflow_test_runs_workflow_binding_id_workflow_bindings_id_fk" FOREIGN KEY ("workflow_binding_id") REFERENCES "public"."workflow_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_execution_events_execution_sequence_uidx" ON "workflow_execution_events" USING btree ("execution_type","execution_id","sequence");--> statement-breakpoint
CREATE INDEX "workflow_execution_events_prompt_idx" ON "workflow_execution_events" USING btree ("prompt_id","sequence");--> statement-breakpoint
CREATE INDEX "workflow_test_runs_owner_created_idx" ON "workflow_test_runs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_test_runs_status_idx" ON "workflow_test_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_owner_bridge_version_uidx" ON "workflow_versions" USING btree ("owner_id","bridge_workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_versions_owner_updated_idx" ON "workflow_versions" USING btree ("owner_id","updated_at");
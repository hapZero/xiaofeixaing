ALTER TYPE "public"."project_status" ADD VALUE 'script_generating' BEFORE 'scripting';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'script_generation_failed' BEFORE 'scripting';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'script_analysis_failed' BEFORE 'scripting';
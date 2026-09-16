ALTER TYPE "public"."project_status" ADD VALUE 'asset_extraction' BEFORE 'storyboarding';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'asset_review' BEFORE 'storyboarding';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'production' BEFORE 'rendering';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'rendered' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'delivered' BEFORE 'failed';
ALTER TYPE "public"."auth_token_kind" ADD VALUE 'change_email';--> statement-breakpoint
ALTER TYPE "public"."nanny_status" ADD VALUE 'draft';--> statement-breakpoint
ALTER TYPE "public"."nanny_status" ADD VALUE 'pending_approval';--> statement-breakpoint
CREATE TABLE "nanny_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nanny_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"sent_by" uuid,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nanny_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"due_on" date,
	"assignee_id" uuid,
	"booking_id" uuid,
	"nanny_id" uuid,
	"family_id" uuid,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "weekdays" smallint[];--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "nanny_response" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "nanny_responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "scan_status" text DEFAULT 'not_scanned' NOT NULL;--> statement-breakpoint
ALTER TABLE "nannies" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "nannies" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "nannies" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "nannies" ADD COLUMN "import_source" text;--> statement-breakpoint
ALTER TABLE "nannies" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "nannies" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "nannies" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nannies" ADD COLUMN "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "nannies" ADD COLUMN "submitted_for_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nanny_invitations" ADD CONSTRAINT "nanny_invitations_nanny_id_nannies_id_fk" FOREIGN KEY ("nanny_id") REFERENCES "public"."nannies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nanny_invitations" ADD CONSTRAINT "nanny_invitations_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nanny_invitations" ADD CONSTRAINT "nanny_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nanny_invitations" ADD CONSTRAINT "nanny_invitations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_nanny_id_nannies_id_fk" FOREIGN KEY ("nanny_id") REFERENCES "public"."nannies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nanny_invitations_nanny_idx" ON "nanny_invitations" USING btree ("nanny_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nanny_invitations_one_open" ON "nanny_invitations" USING btree ("nanny_id") WHERE status = 'sent';--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "nannies_source_uq" ON "nannies" USING btree ("import_source","source_ref");
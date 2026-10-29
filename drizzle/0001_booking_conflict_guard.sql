-- Database-level guarantee that a nanny can never hold two overlapping blocking sessions.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "booking_sessions" ADD COLUMN "period" tstzrange GENERATED ALWAYS AS (tstzrange("starts_at", "ends_at", '[)')) STORED;
--> statement-breakpoint
ALTER TABLE "booking_sessions" ADD CONSTRAINT "booking_sessions_no_overlap" EXCLUDE USING gist ("nanny_id" WITH =, "period" WITH &&) WHERE ("blocking");
--> statement-breakpoint
ALTER TABLE "booking_sessions" ADD CONSTRAINT "booking_sessions_valid_period" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_amounts_nonneg" CHECK ("total_minor" >= 0 AND "deposit_minor" >= 0 AND "deposit_minor" <= "total_minor");
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_pos" CHECK ("amount_minor" > 0);

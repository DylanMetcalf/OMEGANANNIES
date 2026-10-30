ALTER TABLE "calendar_event_links" ADD COLUMN "session_start" timestamp with time zone;--> statement-breakpoint
DROP INDEX "calendar_event_links_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_links_uq" ON "calendar_event_links" ("connection_id", "booking_id", "session_start");

/**
 * Configuration problems that make a deployment unsafe. Checked at server start (instrumentation.ts) and shown on
 * the Administration page. Returns messages only — never secret values.
 */
export function configProblems(e: NodeJS.ProcessEnv = process.env): { fatal: string[]; warnings: string[] } {
  const fatal: string[] = [], warnings: string[] = [];
  const demo = e.DEMO_MODE === "true" || e.DEMO_MODE === "1";
  const live = e.NODE_ENV === "production" && !demo;
  if (!e.APP_SECRET || e.APP_SECRET.length < 32) fatal.push("APP_SECRET must be set to 32+ random characters.");
  // Demo mode simulates payments; combined with live merchant credentials a family could "pay" without paying.
  if (demo && e.PAYFAST_MERCHANT_ID && e.PAYFAST_SANDBOX === "false") fatal.push("DEMO_MODE is on while live PayFast credentials are configured. Turn one off.");
  if (live) {
    if (!e.APP_URL?.startsWith("https://")) fatal.push("APP_URL must be the public https:// address.");
    if (e.REQUIRE_STAFF_MFA === "false") warnings.push("Staff two-step verification is switched off.");
    if ((e.STORAGE_DRIVER ?? "local") === "local") warnings.push("Documents are stored on the server's local disk; use durable storage (STORAGE_DRIVER=supabase) on hosts with ephemeral disks.");
    if (!e.RESEND_API_KEY) warnings.push("No email provider configured: invitations and notifications are captured, not sent.");
    if (!e.CLAMAV_HOST) warnings.push("No malware scanner configured: uploaded documents are marked “not scanned”.");
    if (!e.CRON_SECRET) warnings.push("CRON_SECRET not set: reminders, expiry and retention jobs cannot run.");
    if (e.PAYFAST_MERCHANT_ID && e.PAYFAST_SANDBOX !== "false") warnings.push("PayFast is in sandbox mode.");
    if ((e.GOOGLE_CLIENT_ID || e.MICROSOFT_CLIENT_ID) && !e.CALENDAR_TOKEN_KEY) warnings.push("Set CALENDAR_TOKEN_KEY so calendar tokens survive an APP_SECRET rotation.");
    if (e.RESEND_API_KEY && !e.RESEND_WEBHOOK_SECRET) warnings.push("RESEND_WEBHOOK_SECRET not set: emails can be sent but never confirmed as delivered.");
    if (e.TWILIO_ACCOUNT_SID && !e.TWILIO_AUTH_TOKEN) fatal.push("TWILIO_AUTH_TOKEN is required to verify SMS/WhatsApp delivery callbacks.");
  }
  return { fatal, warnings };
}

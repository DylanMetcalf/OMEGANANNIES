/** Central, typed access to configuration. Secrets are read server-side only and never sent to the client. */
const flag = (v?: string) => v === "true" || v === "1";
export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  secret: () => {
    const s = process.env.APP_SECRET;
    if (!s || s.length < 32) throw new Error("APP_SECRET must be set (32+ chars)");
    return s;
  },
  demo: flag(process.env.DEMO_MODE),
  storageDriver: (process.env.STORAGE_DRIVER ?? "local") as "local" | "supabase",
  resendKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM ?? "Omega Nannies <bookings@omeganannies.com>",
  payfast: {
    merchantId: process.env.PAYFAST_MERCHANT_ID || "",
    merchantKey: process.env.PAYFAST_MERCHANT_KEY || "",
    passphrase: process.env.PAYFAST_PASSPHRASE || "",
    sandbox: process.env.PAYFAST_SANDBOX !== "false",
  },
  websiteSecret: process.env.WEBSITE_WEBHOOK_SECRET || "",
  calendlyToken: process.env.CALENDLY_TOKEN || "",
  calendlySigningKey: process.env.CALENDLY_WEBHOOK_SIGNING_KEY || "",
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
};

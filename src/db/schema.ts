import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, jsonb, date, index, uniqueIndex, primaryKey, smallint,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (n: string) => timestamp(n, { withTimezone: true });

// ---------- Identity & access ----------
export const roleEnum = pgEnum("role", ["family", "nanny", "ops", "manager", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["pending", "active", "suspended", "closed"]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  status: userStatusEnum("status").notNull().default("pending"),
  emailVerifiedAt: ts("email_verified_at"),
  mfaSecret: text("mfa_secret"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  /** Granular permissions for ops staff, e.g. "bookings.manage". Managers/admins get role defaults. */
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  phone: text("phone"),
  isDemo: boolean("is_demo").notNull().default(false),
  lastLoginAt: ts("last_login_at"),
  createdAt: created(), updatedAt: updated(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  grantedBy: uuid("granted_by").references(() => users.id),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.userId, t.role] })]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  mfaPassed: boolean("mfa_passed").notNull().default(false),
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  userAgent: text("user_agent"),
  createdAt: created(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const authTokenKind = pgEnum("auth_token_kind", ["verify_email", "reset_password", "invite"]);
export const authTokens = pgTable("auth_tokens", {
  id: id(),
  kind: authTokenKind("kind").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  email: text("email"),
  role: roleEnum("role"),
  subjectId: uuid("subject_id"), // e.g. the nanny record an invitation links to
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

// ---------- Families & children ----------
export const families = pgTable("families", {
  id: id(),
  displayName: text("display_name").notNull(),
  audience: text("audience").notNull().default("visiting"), // visiting | resident — drives price book
  countryOfResidence: text("country_of_residence"),
  preferredLanguage: text("preferred_language").default("English"),
  preferredChannel: text("preferred_channel").default("email"), // email | whatsapp | phone
  billingName: text("billing_name"),
  billingEmail: text("billing_email"),
  billingAddress: text("billing_address"),
  bookingPreferences: text("booking_preferences"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  restricted: boolean("restricted").notNull().default(false),
  internalNotes: text("internal_notes"), // management only
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: created(), updatedAt: updated(),
});

export const familyMembers = pgTable("family_members", {
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  relationship: text("relationship").notNull().default("Parent"),
  isPrimary: boolean("is_primary").notNull().default(false),
  canBook: boolean("can_book").notNull().default(true),
  canPay: boolean("can_pay").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.familyId, t.userId] })]);

export const serviceLocations = pgTable("service_locations", {
  id: id(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  area: text("area").notNull(), // e.g. Atlantic Seaboard — shareable before confirmation
  addressLine: text("address_line"), // precise — shared with nanny only once confirmed
  accessNotes: text("access_notes"),
  createdAt: created(),
});

export const children = pgTable("children", {
  id: id(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  preferredName: text("preferred_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  careRequirements: text("care_requirements"),
  allergies: text("allergies"),
  dietaryNeeds: text("dietary_needs"),
  routines: text("routines"),
  interests: text("interests"),
  additionalNeeds: text("additional_needs"),
  emergencyInstructions: text("emergency_instructions"),
  consentRecordedAt: ts("consent_recorded_at"),
  createdAt: created(), updatedAt: updated(),
});

export const favourites = pgTable("favourites", {
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  nannyId: uuid("nanny_id").notNull().references(() => nannies.id, { onDelete: "cascade" }),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.familyId, t.nannyId] })]);

// ---------- Nannies, vetting & documents ----------
export const nannyStatusEnum = pgEnum("nanny_status", ["invited", "onboarding", "approved", "suspended", "archived"]);
export const nannies = pgTable("nannies", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }).unique(),
  displayName: text("display_name").notNull(),
  slug: text("slug").notNull().unique(),
  status: nannyStatusEnum("status").notNull().default("onboarding"),
  /** Profile visible to families only when approved AND published. */
  published: boolean("published").notNull().default(false),
  headline: text("headline"),
  bio: text("bio"),
  yearsExperience: smallint("years_experience").notNull().default(0),
  services: text("services").array().notNull().default(sql`'{}'::text[]`), // service_categories.code
  skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
  languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
  ageGroups: text("age_groups").array().notNull().default(sql`'{}'::text[]`), // newborn|toddler|preschool|school|teen
  areas: text("areas").array().notNull().default(sql`'{}'::text[]`),
  canDrive: boolean("can_drive").notNull().default(false),
  hasOwnCar: boolean("has_own_car").notNull().default(false),
  specialistExperience: text("specialist_experience"),
  photoUrl: text("photo_url"),
  internalNotes: text("internal_notes"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: created(), updatedAt: updated(),
});

export const qualifications = pgTable("qualifications", {
  id: id(),
  nannyId: uuid("nanny_id").notNull().references(() => nannies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  issuer: text("issuer"),
  public: boolean("public").notNull().default(true),
  verified: boolean("verified").notNull().default(false),
  expiresOn: date("expires_on"),
});

export const checkKindEnum = pgEnum("check_kind", ["interview", "reference", "identity", "police_clearance", "first_aid"]);
export const checkStatusEnum = pgEnum("check_status", ["pending", "passed", "failed", "expired"]);
export const verificationChecks = pgTable("verification_checks", {
  id: id(),
  nannyId: uuid("nanny_id").notNull().references(() => nannies.id, { onDelete: "cascade" }),
  kind: checkKindEnum("kind").notNull(),
  status: checkStatusEnum("status").notNull().default("pending"),
  notes: text("notes"), // restricted
  completedOn: date("completed_on"),
  expiresOn: date("expires_on"),
  recordedBy: uuid("recorded_by").references(() => users.id),
  createdAt: created(),
}, (t) => [index("checks_nanny_idx").on(t.nannyId)]);

export const docStatusEnum = pgEnum("doc_status", ["pending_review", "approved", "rejected", "expired"]);
export const documents = pgTable("documents", {
  id: id(),
  ownerNannyId: uuid("owner_nanny_id").references(() => nannies.id, { onDelete: "cascade" }),
  ownerFamilyId: uuid("owner_family_id").references(() => families.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(), // id_document | police_clearance | first_aid | reference | qualification | other
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  sha256: text("sha256").notNull(),
  status: docStatusEnum("status").notNull().default("pending_review"),
  expiresOn: date("expires_on"),
  reviewNote: text("review_note"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: ts("reviewed_at"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: created(),
});

export const profileChangeRequests = pgTable("profile_change_requests", {
  id: id(),
  nannyId: uuid("nanny_id").notNull().references(() => nannies.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | applied
  autoApplied: boolean("auto_applied").notNull().default(false),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: ts("decided_at"),
  createdAt: created(),
});

// ---------- Availability ----------
export const availabilityRules = pgTable("availability_rules", {
  id: id(),
  nannyId: uuid("nanny_id").notNull().references(() => nannies.id, { onDelete: "cascade" }),
  weekday: smallint("weekday").notNull(), // 0 = Sunday
  startMinute: smallint("start_minute").notNull(),
  endMinute: smallint("end_minute").notNull(),
});

export const availabilityExceptions = pgTable("availability_exceptions", {
  id: id(),
  nannyId: uuid("nanny_id").notNull().references(() => nannies.id, { onDelete: "cascade" }),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  kind: text("kind").notNull().default("unavailable"), // unavailable | leave | available (extra) | override
  reason: text("reason"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
});

// ---------- Services & pricing ----------
export const serviceCategories = pgTable("service_categories", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  sortOrder: smallint("sort_order").notNull().default(0),
});

/** A versioned, effective-dated price book. Quotations snapshot the version they were priced against. */
export const priceBooks = pgTable("price_books", {
  id: id(),
  version: integer("version").notNull().unique(),
  label: text("label").notNull(),
  status: text("status").notNull().default("draft"), // draft | published | retired
  currency: text("currency").notNull().default("ZAR"),
  effectiveFrom: ts("effective_from"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  publishedBy: uuid("published_by").references(() => users.id),
  createdAt: created(),
});

/** unit: hour | day | week | month | flat | bps (basis points modifier) | hours (minimum) */
export const priceItems = pgTable("price_items", {
  id: id(),
  priceBookId: uuid("price_book_id").notNull().references(() => priceBooks.id, { onDelete: "cascade" }),
  code: text("code").notNull(), // e.g. hourly, daily, livein_daily, livein_weekly, livein_monthly, min_hours, specialist_premium, travel_fee, overnight_fee, public_holiday_premium, deposit, cancellation_fee, day_hours
  audience: text("audience").notNull().default("visiting"),
  serviceCode: text("service_code"), // null = applies to all services
  unit: text("unit").notNull(),
  amount: integer("amount").notNull(), // minor units (cents) or bps or hours
  label: text("label").notNull(),
}, (t) => [uniqueIndex("price_items_uq").on(t.priceBookId, t.code, t.audience, sql`coalesce(${t.serviceCode}, '')`)]);

export const publicHolidays = pgTable("public_holidays", {
  day: date("day").primaryKey(),
  name: text("name").notNull(),
});

// ---------- Bookings ----------
export const bookingStatusEnum = pgEnum("booking_status", [
  "enquiry", "matching", "introduction", "quotation", "awaiting_approval", "awaiting_payment",
  "confirmed", "in_progress", "completed", "declined", "cancelled", "refund_pending", "refunded", "disputed",
]);

export const bookings = pgTable("bookings", {
  id: id(),
  reference: text("reference").notNull().unique(),
  familyId: uuid("family_id").references(() => families.id),
  nannyId: uuid("nanny_id").references(() => nannies.id),
  requestedNannyId: uuid("requested_nanny_id").references(() => nannies.id),
  serviceCode: text("service_code").notNull(),
  status: bookingStatusEnum("status").notNull().default("enquiry"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  dailyStartMinute: smallint("daily_start_minute").notNull(),
  dailyEndMinute: smallint("daily_end_minute").notNull(), // may be < start for overnight
  timeZone: text("time_zone").notNull().default("Africa/Johannesburg"),
  serviceLocationId: uuid("service_location_id").references(() => serviceLocations.id),
  areaText: text("area_text"), // for enquiries without a family account
  liveIn: boolean("live_in").notNull().default(false),
  overnight: boolean("overnight").notNull().default(false),
  needsDriver: boolean("needs_driver").notNull().default(false),
  requiredLanguages: text("required_languages").array().notNull().default(sql`'{}'::text[]`),
  specialistCare: boolean("specialist_care").notNull().default(false),
  budgetMaxMinor: integer("budget_max_minor"),
  specialRequests: text("special_requests"),
  responsibilities: text("responsibilities"),
  // Enquiry handoff from the public website (no account yet)
  enquiryName: text("enquiry_name"),
  enquiryEmail: text("enquiry_email"),
  enquiryPhone: text("enquiry_phone"),
  enquiryChildren: text("enquiry_children"),
  source: text("source").notNull().default("portal"), // portal | website | manual
  idempotencyKey: text("idempotency_key").unique(),
  termsAcceptedAt: ts("terms_accepted_at"),
  termsVersion: text("terms_version"),
  acceptedQuotationId: uuid("accepted_quotation_id"),
  createdBy: uuid("created_by").references(() => users.id),
  lockVersion: integer("lock_version").notNull().default(0),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: created(), updatedAt: updated(),
}, (t) => [index("bookings_family_idx").on(t.familyId), index("bookings_nanny_idx").on(t.nannyId), index("bookings_status_idx").on(t.status)]);

export const bookingChildren = pgTable("booking_children", {
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  childId: uuid("child_id").notNull().references(() => children.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.bookingId, t.childId] })]);

/**
 * One row per care session (usually per day). `blocking` rows hold the nanny's time and are protected by a
 * Postgres exclusion constraint (see migration 0001) so two confirmed bookings can never overlap.
 * `period` is a tstzrange column added in SQL; start/end are kept for convenient querying.
 */
export const bookingSessions = pgTable("booking_sessions", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  nannyId: uuid("nanny_id").references(() => nannies.id),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  blocking: boolean("blocking").notNull().default(false),
}, (t) => [index("sessions_booking_idx").on(t.bookingId), index("sessions_nanny_idx").on(t.nannyId, t.startsAt)]);

export const bookingEvents = pgTable("booking_events", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  fromStatus: bookingStatusEnum("from_status"),
  toStatus: bookingStatusEnum("to_status"),
  kind: text("kind").notNull(), // status | note | assignment | quote | payment | match_override | message
  note: text("note"),
  data: jsonb("data"),
  internal: boolean("internal").notNull().default(false),
  actorId: uuid("actor_id").references(() => users.id),
  createdAt: created(),
}, (t) => [index("booking_events_idx").on(t.bookingId, t.createdAt)]);

export const matchResults = pgTable("match_results", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  nannyId: uuid("nanny_id").notNull().references(() => nannies.id, { onDelete: "cascade" }),
  eligible: boolean("eligible").notNull(),
  score: integer("score").notNull(),
  reasons: jsonb("reasons").notNull(),
  createdAt: created(),
});

// ---------- Quotations, invoices, payments ----------
export const quotations = pgTable("quotations", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  priceBookId: uuid("price_book_id").references(() => priceBooks.id),
  currency: text("currency").notNull().default("ZAR"),
  lines: jsonb("lines").notNull(), // [{label, qty, unitMinor, totalMinor}]
  subtotalMinor: integer("subtotal_minor").notNull(),
  adjustmentMinor: integer("adjustment_minor").notNull().default(0),
  adjustmentReason: text("adjustment_reason"),
  totalMinor: integer("total_minor").notNull(),
  depositMinor: integer("deposit_minor").notNull(),
  status: text("status").notNull().default("draft"), // draft | sent | accepted | superseded | expired | withdrawn
  validUntil: ts("valid_until"),
  sentAt: ts("sent_at"),
  acceptedAt: ts("accepted_at"),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [uniqueIndex("quotations_booking_version_uq").on(t.bookingId, t.version)]);

export const invoices = pgTable("invoices", {
  id: id(),
  number: text("number").notNull().unique(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  quotationId: uuid("quotation_id").notNull().references(() => quotations.id),
  kind: text("kind").notNull(), // deposit | balance | full | cancellation
  currency: text("currency").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  paidMinor: integer("paid_minor").notNull().default(0),
  status: text("status").notNull().default("open"), // open | paid | void | refunded | partially_refunded
  dueAt: ts("due_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("invoices_quote_kind_uq").on(t.quotationId, t.kind)]);

export const payments = pgTable("payments", {
  id: id(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  provider: text("provider").notNull(), // payfast | demo | manual
  providerRef: text("provider_ref"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("initiated"), // initiated | pending | succeeded | failed | cancelled
  failureReason: text("failure_reason"),
  initiatedBy: uuid("initiated_by").references(() => users.id),
  confirmedAt: ts("confirmed_at"),
  createdAt: created(), updatedAt: updated(),
}, (t) => [uniqueIndex("payments_provider_ref_uq").on(t.provider, t.providerRef)]);

/** Raw verified provider notifications; unique event id gives webhook idempotency. */
export const paymentEvents = pgTable("payment_events", {
  id: id(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  paymentId: uuid("payment_id").references(() => payments.id),
  signatureValid: boolean("signature_valid").notNull(),
  payload: jsonb("payload").notNull(),
  outcome: text("outcome").notNull(),
  receivedAt: created(),
}, (t) => [uniqueIndex("payment_events_uq").on(t.provider, t.eventId)]);

export const refunds = pgTable("refunds", {
  id: id(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  amountMinor: integer("amount_minor").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // pending | completed | rejected
  requestedBy: uuid("requested_by").references(() => users.id),
  completedAt: ts("completed_at"),
  createdAt: created(),
});

// ---------- Messaging ----------
export const conversations = pgTable("conversations", {
  id: id(),
  kind: text("kind").notNull(), // family_management | nanny_management | booking
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  familyId: uuid("family_id").references(() => families.id, { onDelete: "cascade" }),
  nannyId: uuid("nanny_id").references(() => nannies.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  locked: boolean("locked").notNull().default(false),
  lastMessageAt: ts("last_message_at"),
  createdAt: created(),
});

export const conversationParticipants = pgTable("conversation_participants", {
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: ts("last_read_at"),
  revokedAt: ts("revoked_at"),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] })]);

export const messages = pgTable("messages", {
  id: id(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  attachmentDocumentId: uuid("attachment_document_id").references(() => documents.id),
  flaggedAt: ts("flagged_at"),
  flagReason: text("flag_reason"),
  createdAt: created(),
}, (t) => [index("messages_conv_idx").on(t.conversationId, t.createdAt)]);

// ---------- Meetings, location, reviews ----------
export const meetings = pgTable("meetings", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  startsAt: ts("starts_at").notNull(),
  durationMinutes: smallint("duration_minutes").notNull().default(30),
  provider: text("provider").notNull(), // zoom | google_meet | teams | whatsapp | in_person | other
  joinUrl: text("join_url"),
  status: text("status").notNull().default("proposed"), // proposed | scheduled | held | no_show | cancelled
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(), updatedAt: updated(),
});

export const locationShares = pgTable("location_shares", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  sharerId: uuid("sharer_id").notNull().references(() => users.id),
  startedAt: ts("started_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  // Only the latest point is retained — no location history.
  lat: text("lat"), lng: text("lng"), accuracyM: integer("accuracy_m"),
  pointAt: ts("point_at"),
  checkInNote: text("check_in_note"),
});

export const reviews = pgTable("reviews", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id).unique(),
  familyId: uuid("family_id").notNull().references(() => families.id),
  nannyId: uuid("nanny_id").notNull().references(() => nannies.id),
  rating: smallint("rating").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"), // pending | published | rejected | removed
  moderationNote: text("moderation_note"),
  nannyResponse: text("nanny_response"),
  reportedAt: ts("reported_at"),
  createdAt: created(),
});

// ---------- Notifications ----------
export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dedupeKey: text("dedupe_key").notNull(),
  channel: text("channel").notNull(), // in_app | email
  template: text("template").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  link: text("link"),
  status: text("status").notNull().default("pending"), // pending | sent | failed | captured (demo) | skipped
  attempts: smallint("attempts").notNull().default(0),
  lastError: text("last_error"),
  readAt: ts("read_at"),
  sentAt: ts("sent_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("notifications_dedupe_uq").on(t.userId, t.channel, t.dedupeKey), index("notifications_user_idx").on(t.userId, t.createdAt)]);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  emailBookings: boolean("email_bookings").notNull().default(true),
  emailMessages: boolean("email_messages").notNull().default(true),
  emailReminders: boolean("email_reminders").notNull().default(true),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
});

// ---------- Knowledge base & support ----------
export const faqArticles = pgTable("faq_articles", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull(),
  audience: text("audience").notNull().default("public"), // public | family | nanny | internal
  published: boolean("published").notNull().default(true),
  aiApproved: boolean("ai_approved").notNull().default(true),
  sourceUrl: text("source_url"),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: created(), updatedAt: updated(),
});

export const supportRequests = pgTable("support_requests", {
  id: id(),
  userId: uuid("user_id").references(() => users.id),
  bookingId: uuid("booking_id").references(() => bookings.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull().default("general"), // general | complaint | safeguarding | billing | assistant_escalation
  status: text("status").notNull().default("open"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  createdAt: created(), updatedAt: updated(),
});

// ---------- Audit, consent, integrations ----------
export const auditEvents = pgTable("audit_events", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  detail: jsonb("detail"),
  ip: text("ip"),
  createdAt: created(),
}, (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_created_idx").on(t.createdAt)]);

export const consents = pgTable("consents", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  email: text("email"),
  policy: text("policy").notNull(), // privacy | terms | child_data | location | marketing
  version: text("version").notNull(),
  granted: boolean("granted").notNull(),
  createdAt: created(),
});

export const integrationConfigs = pgTable("integration_configs", {
  key: text("key").primaryKey(), // payfast | resend | calendly | website | anthropic | storage
  enabled: boolean("enabled").notNull().default(false),
  settings: jsonb("settings").notNull().default({}), // never secrets — those live in env
  lastSuccessAt: ts("last_success_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  updatedAt: updated(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: updated(),
});

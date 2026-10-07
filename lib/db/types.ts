// Hand-written row types matching supabase/migrations/0001_schema.sql.
// TODO: regenerate from Supabase (`npx supabase gen types typescript`) once the
// remote project is connected; keep the exported names working for callers.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Person = {
  id: string;
  auth_user_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  birthday: string | null;
  how_heard: string | null;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  notes: string | null;
  created_at: string;
  imported_from: "squarespace" | null;
};

export type HealthProfile = {
  person_id: string;
  conditions: string | null;
  injuries: string | null;
  pregnancy: boolean;
  allergies: string | null;
  dietary: string | null;
  consent_at: string | null;
  updated_at: string;
};

export type Waiver = {
  id: string;
  person_id: string;
  version: string;
  accepted_at: string;
};

export type ExperienceType = "event" | "retreat";
export type ExperienceStatus = "draft" | "on_sale" | "interest" | "sold_out" | "past";
export type BaseCurrency = "AED" | "EUR";

export type Experience = {
  id: string;
  slug: string;
  type: ExperienceType;
  title: string;
  start_at: string | null;
  end_at: string | null;
  venue: string | null;
  pillars: string[];
  status: ExperienceStatus;
  base_currency: BaseCurrency;
  policy_template: string | null;
  deposit_pct: number | null;
  balance_due_days: number;
  timezone: string;
  total_price_minor: number | null;
};

export type TicketType = {
  id: string;
  experience_id: string;
  key: string;
  name: string;
  price_minor: number;
  capacity: number;
};

export type Hold = {
  id: string;
  ticket_type_id: string;
  qty: number;
  checkout_session_id: string | null;
  expires_at: string;
  released_at: string | null;
  created_at: string;
};

export type BookingStatus = "paid" | "deposit_paid" | "refunded" | "cancelled" | "credited";

export type Booking = {
  id: string;
  booker_person_id: string;
  experience_id: string;
  status: BookingStatus;
  amount_paid_minor: number | null;
  presentment_currency: string | null;
  amount_aed_minor: number | null;
  amount_paid_base_minor: number | null;
  base_currency: string | null;
  stripe_payment_intent: string | null;
  policy_snapshot: Json | null;
  cancelled_by: "guest" | "efzin" | null;
  imported: boolean;
  created_at: string;
};

export type BookingGuest = {
  id: string;
  booking_id: string;
  person_id: string;
  ticket_type_id: string;
  is_booker: boolean;
  details_complete: boolean;
  checked_in_at: string | null;
  transfer_token: string | null;
};

export type Credit = {
  id: string;
  person_id: string;
  code: string | null;
  amount_aed_minor: number;
  source_booking_id: string | null;
  expires_at: string;
  redeemed_booking_id: string | null;
  created_at: string;
};

export type WaitlistEntry = {
  id: string;
  ticket_type_id: string;
  person_id: string | null;
  email: string | null;
  position: number;
  notified_at: string | null;
  created_at: string;
};

export type RequestType = "private" | "corporate" | "coaching" | "retreat_interest" | "deletion";

export type Request = {
  id: string;
  type: RequestType;
  payload: Json;
  person_id: string | null;
  status: string;
  created_at: string;
};

export type StripeEvent = {
  id: string;
  processed_at: string;
};

"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/app/account/actions";
import { getAuthAdmin } from "@/lib/auth/provision";
import { requirePerson } from "@/lib/auth/session";
import { CancelError, cancelBooking, type CancelChoice } from "@/lib/booking/cancel";
import { transferSpot, TransferError } from "@/lib/booking/transfer";
import { withDbClient } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import { requestOrigin } from "@/lib/requests/origin";
import { getStripe } from "@/lib/stripe/client";

/**
 * Self-service cancel and transfer. The signed-in person must be the booker (checked in SQL by
 * the library under the row lock); the policy is re-checked with the server's clock; nothing
 * happens without the explicit confirmation field, and a cancellation only goes ahead with the
 * exact amounts the guest was shown (preview fingerprint).
 */

const UNAVAILABLE: FormState = { kind: "error", message: "This is not available right now. Please try again later." };
const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

const CANCEL_MESSAGES: Record<string, string> = {
  not_found: "We couldn't find this booking.",
  not_active: "This booking is already cancelled.",
  not_allowed: "This option isn't available under your booking's policy any more.",
  changed: "The amounts have changed since you opened this page (the policy depends on the time). Please review them again.",
  stripe_unavailable: "Refunds are not available right now. Please try again later.",
};

export async function cancelBookingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requirePerson();
  const bookingId = str(form, "bookingId");
  const choice = str(form, "choice");
  if (choice !== "refund" && choice !== "credit") return { kind: "error", message: "Please choose how to cancel." };
  if (str(form, "confirm") !== "yes") return { kind: "error", message: "Please tick the box to confirm the cancellation." };
  const origin = await requestOrigin();
  try {
    const done = await withDbClient(async (db) => {
      await cancelBooking(db, getStripe(), bookingId, choice as CancelChoice, "guest", new Date(), {
        byPersonId: me.personId,
        expectedFingerprint: str(form, "fingerprint"),
        sendEmail,
        origin,
      });
      return true;
    });
    if (!done) return UNAVAILABLE;
  } catch (err) {
    if (err instanceof CancelError) return { kind: "error", message: CANCEL_MESSAGES[err.code] };
    console.error("[account] cancellation failed", err);
    return { kind: "error", message: "Something went wrong. Please try again." };
  }
  redirect(`/account/bookings/${bookingId}?cancelled=1`);
}

const TRANSFER_MESSAGES: Record<string, string> = {
  not_found: "We couldn't find that place on your booking.",
  not_allowed: "This place can no longer be transferred under your booking's policy.",
  invalid: "Please enter the new guest's name and a valid email address.",
  duplicate: "That person is already on this booking.",
  limit: "Places on this booking have been transferred 3 times already. Please message Tanya for any further change.",
};

export async function transferAction(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requirePerson();
  if (str(form, "confirm") !== "yes") return { kind: "error", message: "Please tick the box to confirm the transfer." };
  const name = str(form, "name");
  const origin = await requestOrigin();
  try {
    const done = await withDbClient((db) =>
      transferSpot(db, str(form, "guestId"), { name, email: str(form, "email") }, new Date(), {
        byPersonId: me.personId,
        sendEmail,
        auth: getAuthAdmin(),
        origin,
      }),
    );
    if (!done) return UNAVAILABLE;
  } catch (err) {
    if (err instanceof TransferError) return { kind: "error", message: TRANSFER_MESSAGES[err.code] };
    console.error("[account] transfer failed", err);
    return { kind: "error", message: "Something went wrong. Please try again." };
  }
  return { kind: "ok", message: `Done. ${name.trim()} has been emailed to complete their details.` };
}

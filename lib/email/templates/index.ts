import type { EmailKind } from "../send";
import type { EmailTemplate } from "./helpers";
import { abandonedCheckout } from "./abandonedCheckout";
import { adminError } from "./adminError";
import { adminNewBooking } from "./adminNewBooking";
import { adminPaymentFailed } from "./adminPaymentFailed";
import { balanceReminder } from "./balanceReminder";
import { bookingCancelled } from "./bookingCancelled";
import { bookingCancelledUnpaid } from "./bookingCancelledUnpaid";
import { bookingTransferred } from "./bookingTransferred";
import { bookingConfirmed } from "./bookingConfirmed";
import { creditExpiring } from "./creditExpiring";
import { dayAfter } from "./dayAfter";
import { dayBefore } from "./dayBefore";
import { detailsReminder } from "./detailsReminder";
import { giftCardBought } from "./giftCardBought";
import { giftCardDelivered } from "./giftCardDelivered";
import { giftCardDeliveredBuyer } from "./giftCardDeliveredBuyer";
import { giftCardExpiring } from "./giftCardExpiring";
import { giftCardUsed } from "./giftCardUsed";
import { guestAdded } from "./guestAdded";
import { requestReceived } from "./requestReceived";
import { scheduledPaymentFailed } from "./scheduledPaymentFailed";
import { scheduledPaymentReceipt } from "./scheduledPaymentReceipt";
import { scheduledPaymentUpcoming } from "./scheduledPaymentUpcoming";
import { waitlistOpen } from "./waitlistOpen";

/** One branded template per email kind (the Record type makes a missing kind a compile error). */
export const TEMPLATES: Record<EmailKind, EmailTemplate> = {
  booking_confirmed: bookingConfirmed,
  guest_added: guestAdded,
  details_reminder: detailsReminder,
  day_before: dayBefore,
  day_after: dayAfter,
  abandoned_checkout: abandonedCheckout,
  waitlist_open: waitlistOpen,
  balance_reminder: balanceReminder,
  credit_expiring: creditExpiring,
  admin_new_booking: adminNewBooking,
  request_received: requestReceived,
  admin_error: adminError,
  scheduled_payment_upcoming: scheduledPaymentUpcoming,
  scheduled_payment_receipt: scheduledPaymentReceipt,
  scheduled_payment_failed: scheduledPaymentFailed,
  admin_payment_failed: adminPaymentFailed,
  gift_card_bought: giftCardBought,
  gift_card_delivered: giftCardDelivered,
  gift_card_delivered_buyer: giftCardDeliveredBuyer,
  gift_card_used: giftCardUsed,
  gift_card_expiring: giftCardExpiring,
  booking_cancelled_unpaid: bookingCancelledUnpaid,
  booking_cancelled: bookingCancelled,
  booking_transferred: bookingTransferred,
};

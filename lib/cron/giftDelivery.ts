import type { SqlClient } from "../content/sync";
import { reportError } from "../errors/report";
import { deliverDueGiftCards, type DeliverDeps } from "../giftcards/deliver";

/** The 08:00 Dubai job: emails the gift cards whose delivery date is today. Returns how many. */
export async function runGiftDelivery(db: SqlClient, now: Date, deps: DeliverDeps): Promise<number> {
  try {
    return await deliverDueGiftCards(db, now, deps);
  } catch (err) {
    await reportError(err, "gift_delivery", { db, now, sendEmail: deps.sendEmail });
    return 0;
  }
}

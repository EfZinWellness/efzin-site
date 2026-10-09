-- Signed-in members read their gift cards (buyer or recipient, by the row policy) but never the
-- card code or the payment details through the API: a buyer must not read a friend's code before
-- it is delivered. The site reads these columns server side (service role), so nothing changes there.
-- A column revoke has no effect while a table-wide grant exists, so the table grant is replaced by
-- a column list.
revoke select on gift_cards from authenticated;
grant select (id, initial_aed_minor, balance_aed_minor, status, buyer_person_id, recipient_name, recipient_email,
              recipient_person_id, message, suggested_experience_id, deliver_on, delivered_at, expires_at,
              purchase_batch_id, created_at, buyer_receipt_sent_at)
  on gift_cards to authenticated;

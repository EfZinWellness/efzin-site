-- The "Gift card bought" receipt goes to the buyer at most once per card.
-- Also set when a send-to-me gift is delivered, whose email doubles as the receipt.
alter table gift_cards add column buyer_receipt_sent_at timestamptz;

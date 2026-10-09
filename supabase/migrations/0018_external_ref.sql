-- Id of the booking in the system it was imported from (Squarespace: "sqsp:<orderId>:<lineIndex>").
-- Unique, so re-running an import never creates a booking twice.
alter table bookings add column external_ref text unique;

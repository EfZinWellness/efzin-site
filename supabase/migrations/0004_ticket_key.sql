-- Stable key per ticket type so content files can reference and upsert tickets.
alter table ticket_types add column key text not null;
alter table ticket_types add constraint ticket_types_experience_key_key unique (experience_id, key);

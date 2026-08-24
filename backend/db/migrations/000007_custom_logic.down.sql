ALTER TABLE raw_messages DROP CONSTRAINT raw_messages_parse_status_check;
ALTER TABLE raw_messages ADD CONSTRAINT raw_messages_parse_status_check
    CHECK (parse_status IN ('pending','parsed','unmatched','error'));
ALTER TABLE transactions DROP COLUMN meta;
ALTER TABLE transactions DROP COLUMN effective_amount;
ALTER TABLE providers DROP COLUMN script;

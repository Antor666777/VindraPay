ALTER TABLE providers ADD COLUMN script TEXT;
ALTER TABLE transactions ADD COLUMN effective_amount NUMERIC(12,2) CHECK (effective_amount IS NULL OR effective_amount > 0);
ALTER TABLE transactions ADD COLUMN meta JSONB;
ALTER TABLE raw_messages DROP CONSTRAINT raw_messages_parse_status_check;
ALTER TABLE raw_messages ADD CONSTRAINT raw_messages_parse_status_check
    CHECK (parse_status IN ('pending','parsed','unmatched','error','skipped'));

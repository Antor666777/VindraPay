ALTER TABLE providers
    ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'template'
    CHECK (match_mode IN ('template', 'regex'));

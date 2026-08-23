CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE businesses (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    owner_email TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_businesses_email ON businesses (owner_email);

CREATE TABLE api_keys (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id  UUID        NOT NULL REFERENCES businesses(id),
    label        TEXT        NOT NULL DEFAULT 'default',
    key_prefix   TEXT        NOT NULL,
    key_hash     TEXT        NOT NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_prefix ON api_keys (key_prefix);
CREATE INDEX idx_api_keys_business ON api_keys (business_id);

CREATE TABLE devices (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID        NOT NULL REFERENCES businesses(id),
    name           TEXT        NOT NULL,
    token_hash     TEXT        NOT NULL,
    token_prefix   TEXT        NOT NULL,
    app_version    TEXT,
    os_version     TEXT,
    last_ping_at   TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_business ON devices (business_id);

CREATE TABLE providers (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID        REFERENCES businesses(id),
    name             TEXT        NOT NULL,
    sender_id        TEXT,
    sms_template     TEXT        NOT NULL,
    compiled_pattern TEXT        NOT NULL,
    priority         INT         NOT NULL DEFAULT 100,
    is_active        BOOLEAN     NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_providers_matching ON providers (business_id, is_active, priority);

CREATE TABLE raw_messages (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_msg_id      UUID        NOT NULL,
    device_id          UUID        NOT NULL REFERENCES devices(id),
    business_id        UUID        NOT NULL REFERENCES businesses(id),
    sender_id          TEXT,
    body               TEXT        NOT NULL,
    device_received_at TIMESTAMPTZ,
    ingested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    parse_status       TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (parse_status IN ('pending', 'parsed', 'unmatched', 'error')),
    error_code         TEXT,
    error_detail       TEXT,
    provider_id        UUID        REFERENCES providers(id),
    matched_pattern    TEXT,
    transaction_id     UUID,
    CONSTRAINT uq_raw_messages_device_msg UNIQUE (device_id, client_msg_id)
);

CREATE INDEX idx_raw_messages_inbox ON raw_messages (business_id, parse_status, ingested_at DESC);

CREATE TABLE transactions (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id    UUID        NOT NULL REFERENCES providers(id),
    trx_id         TEXT        NOT NULL,
    business_id    UUID        NOT NULL REFERENCES businesses(id),
    device_id      UUID        NOT NULL REFERENCES devices(id),
    raw_message_id UUID        NOT NULL REFERENCES raw_messages(id),
    amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    sender_msisdn  TEXT,
    balance_after  NUMERIC(12,2),
    received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_transactions_provider_trx UNIQUE (provider_id, trx_id)
);

CREATE INDEX idx_transactions_device_time ON transactions (device_id, received_at DESC);
CREATE INDEX idx_transactions_business_trx ON transactions (business_id, trx_id);

CREATE TABLE orders (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id            UUID        NOT NULL REFERENCES businesses(id),
    external_order_id      TEXT        NOT NULL,
    expected_amount        NUMERIC(12,2) NOT NULL CHECK (expected_amount > 0),
    status                 TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
    matched_transaction_id UUID        REFERENCES transactions(id),
    expires_at             TIMESTAMPTZ,
    paid_at                TIMESTAMPTZ,
    metadata               JSONB,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_orders_external UNIQUE (business_id, external_order_id)
);

CREATE INDEX idx_orders_status ON orders (status, expires_at);

CREATE TABLE verification_attempts (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id            UUID        NOT NULL REFERENCES businesses(id),
    order_id               UUID        REFERENCES orders(id),
    submitted_trx_id       TEXT        NOT NULL,
    result                 TEXT        NOT NULL
                           CHECK (result IN (
                               'success', 'not_found', 'already_used',
                               'amount_mismatch', 'order_expired', 'order_not_pending'
                           )),
    matched_transaction_id UUID        REFERENCES transactions(id),
    submitted_amount       NUMERIC(12,2),
    balance_consistent     BOOLEAN,
    source_ip              INET,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_attempts_order ON verification_attempts (order_id, created_at);
CREATE INDEX idx_verification_attempts_bruteforce ON verification_attempts (business_id, submitted_trx_id, created_at);

ALTER TABLE raw_messages
    ADD CONSTRAINT fk_raw_messages_transaction
    FOREIGN KEY (transaction_id) REFERENCES transactions(id);

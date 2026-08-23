DROP TABLE IF EXISTS balance_calibrations;

CREATE TABLE balance_calibrations (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID        NOT NULL REFERENCES businesses(id),
    device_id     UUID        NOT NULL REFERENCES devices(id),
    provider_id   UUID        NOT NULL REFERENCES providers(id),
    balance       NUMERIC(12,2) NOT NULL CHECK (balance >= 0),
    note          TEXT,
    calibrated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_balance_calibrations_device_provider
    ON balance_calibrations (device_id, provider_id, calibrated_at DESC);

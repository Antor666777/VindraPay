CREATE TABLE balance_calibrations (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID        NOT NULL REFERENCES businesses(id),
    device_id     UUID        NOT NULL REFERENCES devices(id),
    balance       NUMERIC(12,2) NOT NULL CHECK (balance >= 0),
    note          TEXT,
    calibrated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_balance_calibrations_device
    ON balance_calibrations (device_id, calibrated_at DESC);

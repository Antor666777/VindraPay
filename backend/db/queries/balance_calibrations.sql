-- name: CreateBalanceCalibration :one
INSERT INTO balance_calibrations (business_id, device_id, provider_id, balance, note)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: InsertTransaction :one
INSERT INTO transactions (provider_id, trx_id, business_id, device_id, raw_message_id, amount, sender_msisdn, balance_after, direction)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (provider_id, trx_id) DO NOTHING
RETURNING *;

-- name: GetTransactionByID :one
SELECT * FROM transactions
WHERE id = $1 AND business_id = $2;

-- name: FindTransactionByTrxIDForBusiness :one
SELECT * FROM transactions
WHERE trx_id = $1 AND business_id = $2
ORDER BY received_at DESC
LIMIT 1;

-- name: GetTransactionByProviderAndTrxID :one
SELECT * FROM transactions
WHERE provider_id = $1 AND trx_id = $2;

-- name: GetPreviousBalance :one
SELECT balance
FROM (
    SELECT t.balance_after AS balance, t.received_at AS point_at
    FROM transactions t
    WHERE t.device_id = $1
      AND t.provider_id = $4
      AND t.balance_after IS NOT NULL
      AND t.id <> $2
      AND t.received_at < $3
    UNION ALL
    SELECT c.balance, c.calibrated_at AS point_at
    FROM balance_calibrations c
    WHERE c.device_id = $1
      AND c.provider_id = $4
      AND c.calibrated_at < $3
) points
ORDER BY point_at DESC
LIMIT 1;

-- name: GetLatestCalibrationAfter :one
SELECT balance
FROM balance_calibrations
WHERE device_id = $1
  AND provider_id = $3
  AND calibrated_at >= $2
ORDER BY calibrated_at DESC
LIMIT 1;

-- name: CountTransactionsAfter :one
SELECT COUNT(*) AS tx_count
FROM transactions
WHERE device_id = $1
  AND provider_id = $4
  AND id <> $2
  AND received_at >= $3;

-- name: GetLatestBalancePoint :one
SELECT balance, point_at, source
FROM (
    SELECT t.balance_after AS balance, t.received_at AS point_at, 'transaction'::text AS source
    FROM transactions t
    WHERE t.device_id = $1 AND t.provider_id = $2 AND t.balance_after IS NOT NULL
    UNION ALL
    SELECT c.balance, c.calibrated_at AS point_at, 'calibration'::text AS source
    FROM balance_calibrations c
    WHERE c.device_id = $1 AND c.provider_id = $2
) points
ORDER BY point_at DESC
LIMIT 1;

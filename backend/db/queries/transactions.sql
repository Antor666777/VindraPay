-- name: InsertTransaction :one
INSERT INTO transactions (provider_id, trx_id, business_id, device_id, raw_message_id, amount, sender_msisdn, balance_after)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

-- name: GetPreviousBalance :one
SELECT balance_after
FROM transactions
WHERE device_id = $1
  AND balance_after IS NOT NULL
  AND id <> $2
  AND received_at < $3
ORDER BY received_at DESC, created_at DESC
LIMIT 1;

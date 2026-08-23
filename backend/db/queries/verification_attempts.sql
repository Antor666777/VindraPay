-- name: InsertVerificationAttempt :exec
INSERT INTO verification_attempts (
    business_id, order_id, submitted_trx_id, result,
    matched_transaction_id, submitted_amount, balance_consistent, source_ip
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: CountRecentAttemptsByBusiness :one
SELECT COUNT(*) AS attempt_count
FROM verification_attempts
WHERE business_id = $1
  AND created_at > now() - (sqlc.arg('window_seconds')::int * INTERVAL '1 second');

-- name: ListAttemptsByTrxID :many
SELECT * FROM verification_attempts
WHERE business_id = $1 AND submitted_trx_id = $2
ORDER BY created_at DESC
LIMIT $3;

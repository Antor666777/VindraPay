-- name: InsertRawMessage :one
INSERT INTO raw_messages (client_msg_id, device_id, business_id, sender_id, body, device_received_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (device_id, client_msg_id) DO NOTHING
RETURNING *;

-- name: GetRawMessage :one
SELECT * FROM raw_messages
WHERE id = $1;

-- name: MarkRawMessageParsed :exec
UPDATE raw_messages
SET parse_status = 'parsed', provider_id = $2, matched_pattern = $3, transaction_id = $4
WHERE id = $1;

-- name: MarkRawMessageUnmatched :exec
UPDATE raw_messages
SET parse_status = 'unmatched'
WHERE id = $1;

-- name: MarkRawMessageError :exec
UPDATE raw_messages
SET parse_status = 'error', error_code = $2, error_detail = $3
WHERE id = $1;

-- name: MarkRawMessageSkipped :exec
UPDATE raw_messages
SET parse_status = 'skipped', error_code = 'REJECTED', error_detail = $2
WHERE id = $1;

-- name: ListPendingRawMessages :many
SELECT * FROM raw_messages
WHERE parse_status = 'pending'
ORDER BY ingested_at ASC
LIMIT $1;

-- name: ListProblemMessagesByBusiness :many
SELECT * FROM raw_messages
WHERE business_id = $1 AND parse_status IN ('unmatched', 'error')
ORDER BY ingested_at DESC
LIMIT $2 OFFSET $3;

-- name: CountRawMessagesByStatus :many
SELECT parse_status, COUNT(*) AS message_count
FROM raw_messages
WHERE business_id = $1
GROUP BY parse_status;

-- name: ListBusinessesPaged :many
SELECT * FROM businesses
WHERE
    (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status')::text)
    AND (
        sqlc.narg('search')::text IS NULL
        OR name ILIKE '%' || sqlc.narg('search')::text || '%'
        OR owner_email ILIKE '%' || sqlc.narg('search')::text || '%'
    )
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountBusinesses :one
SELECT COUNT(*) AS total FROM businesses
WHERE
    (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status')::text)
    AND (
        sqlc.narg('search')::text IS NULL
        OR name ILIKE '%' || sqlc.narg('search')::text || '%'
        OR owner_email ILIKE '%' || sqlc.narg('search')::text || '%'
    );

-- name: GetApiKeyByID :one
SELECT * FROM api_keys
WHERE id = $1;

-- name: ListDevicesPaged :many
SELECT d.*,
    COALESCE(
        d.deactivated_at IS NULL AND d.last_ping_at IS NOT NULL
        AND d.last_ping_at > now() - INTERVAL '5 minutes',
    false)::boolean AS online,
    b.name AS business_name
FROM devices d
JOIN businesses b ON b.id = d.business_id
WHERE (sqlc.narg('business_id')::uuid IS NULL OR d.business_id = sqlc.narg('business_id')::uuid)
ORDER BY d.created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountDevices :one
SELECT COUNT(*) AS total
FROM devices
WHERE (sqlc.narg('business_id')::uuid IS NULL OR business_id = sqlc.narg('business_id')::uuid);

-- name: GetDeviceByID :one
SELECT * FROM devices
WHERE id = $1;

-- name: ListOrdersPaged :many
SELECT o.*, b.name AS business_name
FROM orders o
JOIN businesses b ON b.id = o.business_id
WHERE
    (sqlc.narg('status')::text IS NULL OR o.status = sqlc.narg('status')::text)
    AND (sqlc.narg('business_id')::uuid IS NULL OR o.business_id = sqlc.narg('business_id')::uuid)
ORDER BY o.created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountOrders :one
SELECT COUNT(*) AS total
FROM orders
WHERE
    (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status')::text)
    AND (sqlc.narg('business_id')::uuid IS NULL OR business_id = sqlc.narg('business_id')::uuid);

-- name: ListTransactionsPaged :many
SELECT t.*, b.name AS business_name, p.name AS provider_name
FROM transactions t
JOIN businesses b ON b.id = t.business_id
JOIN providers p ON p.id = t.provider_id
WHERE
    (sqlc.narg('business_id')::uuid IS NULL OR t.business_id = sqlc.narg('business_id')::uuid)
    AND (sqlc.narg('provider_id')::uuid IS NULL OR t.provider_id = sqlc.narg('provider_id')::uuid)
    AND (sqlc.narg('direction')::text IS NULL OR t.direction = sqlc.narg('direction')::text)
ORDER BY t.created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountTransactions :one
SELECT COUNT(*) AS total
FROM transactions
WHERE
    (sqlc.narg('business_id')::uuid IS NULL OR business_id = sqlc.narg('business_id')::uuid)
    AND (sqlc.narg('provider_id')::uuid IS NULL OR provider_id = sqlc.narg('provider_id')::uuid)
    AND (sqlc.narg('direction')::text IS NULL OR direction = sqlc.narg('direction')::text);

-- name: ListAttemptsPaged :many
SELECT va.*, b.name AS business_name
FROM verification_attempts va
JOIN businesses b ON b.id = va.business_id
WHERE
    (sqlc.narg('business_id')::uuid IS NULL OR va.business_id = sqlc.narg('business_id')::uuid)
    AND (sqlc.narg('result')::text IS NULL OR va.result = sqlc.narg('result')::text)
    AND (sqlc.narg('trx_id')::text IS NULL OR va.submitted_trx_id = sqlc.narg('trx_id')::text)
ORDER BY va.created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountAttempts :one
SELECT COUNT(*) AS total
FROM verification_attempts
WHERE
    (sqlc.narg('business_id')::uuid IS NULL OR business_id = sqlc.narg('business_id')::uuid)
    AND (sqlc.narg('result')::text IS NULL OR result = sqlc.narg('result')::text)
    AND (sqlc.narg('trx_id')::text IS NULL OR submitted_trx_id = sqlc.narg('trx_id')::text);

-- name: ListMessagesPaged :many
SELECT rm.*, b.name AS business_name
FROM raw_messages rm
JOIN businesses b ON b.id = rm.business_id
WHERE
    (sqlc.narg('business_id')::uuid IS NULL OR rm.business_id = sqlc.narg('business_id')::uuid)
    AND (sqlc.narg('parse_status')::text IS NULL OR rm.parse_status = sqlc.narg('parse_status')::text)
ORDER BY rm.ingested_at DESC
LIMIT $1 OFFSET $2;

-- name: CountMessages :one
SELECT COUNT(*) AS total
FROM raw_messages
WHERE
    (sqlc.narg('business_id')::uuid IS NULL OR business_id = sqlc.narg('business_id')::uuid)
    AND (sqlc.narg('parse_status')::text IS NULL OR parse_status = sqlc.narg('parse_status')::text);

-- name: ListProvidersPaged :many
SELECT p.*, b.name AS business_name
FROM providers p
LEFT JOIN businesses b ON b.id = p.business_id
WHERE
    p.is_active = true
    AND (p.business_id IS NULL OR p.business_id = sqlc.narg('business_id')::uuid)
    AND (sqlc.narg('direction')::text IS NULL OR p.direction = sqlc.narg('direction')::text)
    AND (sqlc.narg('match_mode')::text IS NULL OR p.match_mode = sqlc.narg('match_mode')::text)
ORDER BY p.created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountProviders :one
SELECT COUNT(*) AS total
FROM providers p
WHERE
    p.is_active = true
    AND (p.business_id IS NULL OR p.business_id = sqlc.narg('business_id')::uuid)
    AND (sqlc.narg('direction')::text IS NULL OR p.direction = sqlc.narg('direction')::text)
    AND (sqlc.narg('match_mode')::text IS NULL OR p.match_mode = sqlc.narg('match_mode')::text);

-- name: UpdateProviderTemplateGlobal :one
UPDATE providers
SET sms_template = $2, compiled_pattern = $3, direction = $4, script = $5, match_mode = $6, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeactivateProviderGlobal :one
UPDATE providers
SET is_active = false, updated_at = now()
WHERE id = $1 AND is_active = true
RETURNING *;

-- name: GetStudioStats :one
SELECT
    (SELECT COUNT(*) FROM businesses) AS businesses_total,
    (
        SELECT COUNT(*)
        FROM devices
        WHERE COALESCE(
            deactivated_at IS NULL AND last_ping_at IS NOT NULL
            AND last_ping_at > now() - INTERVAL '5 minutes',
        false)::boolean
    ) AS devices_online,
    (SELECT COUNT(*) FROM transactions) AS transactions_total,
    (SELECT COUNT(*) FROM transactions WHERE created_at >= now() - INTERVAL '24 hours') AS transactions_today,
    (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS orders_pending,
    (SELECT COUNT(*) FROM orders WHERE status = 'paid') AS orders_paid,
    (SELECT COUNT(*) FROM verification_attempts WHERE created_at >= now() - INTERVAL '24 hours') AS attempts_today,
    (SELECT COUNT(*) FROM raw_messages WHERE parse_status IN ('unmatched', 'error')) AS messages_unparsed;

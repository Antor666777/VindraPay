-- name: CreateApiKey :one
INSERT INTO api_keys (business_id, label, key_prefix, key_hash)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetApiKeyByPrefix :one
SELECT * FROM api_keys
WHERE key_prefix = $1;

-- name: ListApiKeysByPrefix :many
SELECT id, business_id, key_hash, revoked_at
FROM api_keys
WHERE key_prefix = $1;

-- name: ListApiKeysByBusiness :many
SELECT * FROM api_keys
WHERE business_id = $1
ORDER BY created_at DESC;

-- name: TouchApiKeyLastUsed :exec
UPDATE api_keys
SET last_used_at = now()
WHERE id = $1;

-- name: RevokeApiKey :one
UPDATE api_keys
SET revoked_at = now()
WHERE id = $1 AND business_id = $2 AND revoked_at IS NULL
RETURNING *;

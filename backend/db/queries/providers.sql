-- name: CreateProvider :one
INSERT INTO providers (business_id, name, sender_id, sms_template, compiled_pattern, priority)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetProvider :one
SELECT * FROM providers
WHERE id = $1;

-- name: ListActiveProvidersForMatching :many
SELECT * FROM providers
WHERE is_active = true
  AND (business_id IS NULL OR business_id = $1)
ORDER BY priority ASC, business_id IS NULL ASC, created_at ASC;

-- name: ListProvidersForBusiness :many
SELECT * FROM providers
WHERE business_id IS NULL OR business_id = $1
ORDER BY priority ASC, created_at ASC;

-- name: UpdateProviderTemplate :one
UPDATE providers
SET sms_template = $2, compiled_pattern = $3, updated_at = now()
WHERE id = $1 AND business_id = $4
RETURNING *;

-- name: SetProviderPriority :one
UPDATE providers
SET priority = $2, updated_at = now()
WHERE id = $1 AND business_id = $3
RETURNING *;

-- name: DeactivateProvider :one
UPDATE providers
SET is_active = false, updated_at = now()
WHERE id = $1 AND business_id = $2
RETURNING *;

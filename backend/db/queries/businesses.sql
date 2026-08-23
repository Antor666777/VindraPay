-- name: CreateBusiness :one
INSERT INTO businesses (name, owner_email)
VALUES ($1, $2)
RETURNING *;

-- name: GetBusiness :one
SELECT * FROM businesses
WHERE id = $1;

-- name: GetBusinessByEmail :one
SELECT * FROM businesses
WHERE owner_email = $1
LIMIT 1;

-- name: ListBusinesses :many
SELECT * FROM businesses
ORDER BY created_at DESC;

-- name: SetBusinessStatus :one
UPDATE businesses
SET status = $2, updated_at = now()
WHERE id = $1
RETURNING *;

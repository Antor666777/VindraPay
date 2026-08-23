-- name: CreateDevice :one
INSERT INTO devices (business_id, name, token_hash, token_prefix, app_version, os_version)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetDeviceByTokenPrefix :many
SELECT * FROM devices
WHERE token_prefix = $1 AND deactivated_at IS NULL;

-- name: ListDevicesByBusiness :many
SELECT *,
    COALESCE(
        deactivated_at IS NULL AND last_ping_at IS NOT NULL
        AND last_ping_at > now() - INTERVAL '5 minutes',
    false)::boolean AS online
FROM devices
WHERE business_id = $1
ORDER BY created_at DESC;

-- name: DeviceHeartbeat :exec
UPDATE devices
SET last_ping_at = now()
WHERE id = $1 AND deactivated_at IS NULL;

-- name: UpdateDeviceMeta :exec
UPDATE devices
SET app_version = COALESCE($2, app_version), os_version = COALESCE($3, os_version)
WHERE id = $1;

-- name: DeactivateDevice :one
UPDATE devices
SET deactivated_at = now()
WHERE id = $1 AND business_id = $2 AND deactivated_at IS NULL
RETURNING *;

-- name: InsertOrder :one
INSERT INTO orders (business_id, external_order_id, expected_amount, expires_at, metadata)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetOrder :one
SELECT * FROM orders
WHERE id = $1 AND business_id = $2;

-- name: GetOrderByExternalID :one
SELECT * FROM orders
WHERE business_id = $1 AND external_order_id = $2;

-- name: ListOrdersByBusiness :many
SELECT * FROM orders
WHERE business_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ClaimTransactionForOrder :one
UPDATE orders
SET matched_transaction_id = $2,
    status = 'paid',
    paid_at = now(),
    updated_at = now()
WHERE id = $1
  AND business_id = $3
  AND status = 'pending'
  AND matched_transaction_id IS NULL
RETURNING *;

-- name: CancelOrder :one
UPDATE orders
SET status = 'cancelled', updated_at = now()
WHERE id = $1 AND business_id = $2 AND status = 'pending'
RETURNING *;

-- name: ExpireStaleOrders :execrows
UPDATE orders
SET status = 'expired', updated_at = now()
WHERE status = 'pending'
  AND expires_at IS NOT NULL
  AND expires_at < now();

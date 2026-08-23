CREATE UNIQUE INDEX uq_orders_claimed_transaction
    ON orders (matched_transaction_id)
    WHERE matched_transaction_id IS NOT NULL;

ALTER TABLE verification_attempts
    DROP CONSTRAINT verification_attempts_result_check;

ALTER TABLE verification_attempts
    ADD CONSTRAINT verification_attempts_result_check
    CHECK (result IN (
        'success', 'not_found', 'already_used',
        'amount_mismatch', 'order_expired', 'order_not_pending',
        'balance_mismatch'
    ));

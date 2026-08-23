ALTER TABLE transactions DROP COLUMN direction;
ALTER TABLE providers DROP COLUMN direction;

ALTER TABLE verification_attempts DROP CONSTRAINT verification_attempts_result_check;
ALTER TABLE verification_attempts ADD CONSTRAINT verification_attempts_result_check
    CHECK (result IN (
        'success', 'not_found', 'already_used', 'amount_mismatch',
        'order_expired', 'order_not_pending', 'balance_mismatch'
    ));

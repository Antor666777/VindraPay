ALTER TABLE providers
    ADD COLUMN direction TEXT NOT NULL DEFAULT 'credit'
    CHECK (direction IN ('credit', 'debit'));

ALTER TABLE transactions
    ADD COLUMN direction TEXT NOT NULL DEFAULT 'credit'
    CHECK (direction IN ('credit', 'debit'));

ALTER TABLE verification_attempts DROP CONSTRAINT verification_attempts_result_check;
ALTER TABLE verification_attempts ADD CONSTRAINT verification_attempts_result_check
    CHECK (result IN (
        'success', 'not_found', 'already_used', 'amount_mismatch',
        'order_expired', 'order_not_pending', 'balance_mismatch', 'wrong_direction'
    ));

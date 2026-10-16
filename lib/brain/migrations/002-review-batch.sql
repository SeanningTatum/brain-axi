-- 002-review-batch.sql — at-least-once review feedback delivery.
-- The review server re-delivers a polled batch until the CLI acks it, so the
-- CLI records each round with the server's batch id and skips a batch it has
-- already recorded: one batch, one round, however often it is delivered.

ALTER TABLE review_rounds ADD COLUMN batch_id TEXT;
CREATE UNIQUE INDEX review_rounds_batch ON review_rounds (plan_id, batch_id) WHERE batch_id IS NOT NULL;

-- issues.completed_at was never written; closed (completed/cancelled group) issues have NULL.
-- Backfill with updated_at as the best available close time.
UPDATE issues
SET completed_at = updated_at
WHERE completed_at IS NULL
  AND state_id IN (SELECT id FROM states WHERE group_name IN ('completed', 'cancelled'));

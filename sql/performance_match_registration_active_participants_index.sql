-- Used by GET /api/user/match-registration-summary.
-- The participant list only displays active registrations, so cancelled rows
-- are excluded from this small covering index.
CREATE INDEX IF NOT EXISTS idx_match_participants_active_schedule
  ON public.match_participants (match_schedule_id)
  INCLUDE (id, user_id, status, registered_at)
  WHERE status IN ('registered', 'attended', 'waitlisted');

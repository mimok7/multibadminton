-- Used by GET /api/user/notifications?summary=1.
-- Keep the unread-count query small without indexing already-read rows.
CREATE INDEX IF NOT EXISTS idx_notifications_club_user_unread
  ON public.notifications (club_id, user_id)
  WHERE is_read = false;

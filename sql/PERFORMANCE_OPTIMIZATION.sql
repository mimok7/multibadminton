-- 멀티클럽 주요 조회/저장 경로 성능 최적화
-- 전체 실행이 가능하도록 일반 인덱스를 사용합니다. 이용자가 적은 시간에 실행합니다.
BEGIN;

-- RLS 가입 여부 조회: user_id + club_id + status 조건을 한 번에 처리합니다.
CREATE INDEX IF NOT EXISTS idx_club_members_active_user_club
ON public.club_members (user_id, club_id)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_profiles_user_id
ON public.profiles (user_id)
WHERE user_id IS NOT NULL;

-- 일정 화면의 클럽/날짜/시간 조회 및 정기 일정 중복 확인을 최적화합니다.
CREATE INDEX IF NOT EXISTS idx_match_schedules_club_match_date_time
ON public.match_schedules (club_id, match_date, scheduled_time, court_number);

CREATE INDEX IF NOT EXISTS idx_match_schedules_club_scheduled_date_time
ON public.match_schedules (club_id, scheduled_date, scheduled_time, court_number);

CREATE INDEX IF NOT EXISTS idx_match_schedules_recurring_slot
ON public.match_schedules (club_id, match_date, start_time, end_time, location);

CREATE INDEX IF NOT EXISTS idx_match_schedules_generated_match
ON public.match_schedules (club_id, generated_match_id)
WHERE generated_match_id IS NOT NULL;

-- 참가자 등록/확인, 세션별 대진표 및 상태 조회를 최적화합니다.
CREATE INDEX IF NOT EXISTS idx_match_participants_club_schedule_user
ON public.match_participants (club_id, match_schedule_id, user_id);

CREATE INDEX IF NOT EXISTS idx_generated_matches_club_session_status_number
ON public.generated_matches (club_id, session_id, status, match_number);

-- 사용자 알림 목록 및 중복 발송 검사에 사용합니다.
CREATE INDEX IF NOT EXISTS idx_notifications_club_user_created
ON public.notifications (club_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_preparation_lookup
ON public.notifications (club_id, user_id, related_match_id, created_at DESC)
WHERE type = 'match_preparation';

-- 출석 및 대회 화면의 빈번한 클럽별 날짜/상태 조회를 최적화합니다.
CREATE INDEX IF NOT EXISTS idx_attendances_club_attended_user
ON public.attendances (club_id, attended_at DESC, user_id);

ALTER TABLE public.attendances
DROP CONSTRAINT IF EXISTS attendances_user_id_attended_at_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendances_club_user_date
ON public.attendances (club_id, user_id, attended_at);

CREATE INDEX IF NOT EXISTS idx_tournament_matches_club_tournament_status
ON public.tournament_matches (club_id, tournament_id, status);

COMMIT;

ANALYZE public.club_members;
ANALYZE public.match_schedules;
ANALYZE public.match_participants;
ANALYZE public.generated_matches;
ANALYZE public.notifications;
ANALYZE public.attendances;
ANALYZE public.tournament_matches;

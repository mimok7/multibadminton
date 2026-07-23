-- 주요 사용자/매니저 화면의 반복 조회 경로를 위한 복합 인덱스입니다.
-- 배포 시 한 번 실행하며, 모든 구문은 재실행해도 안전합니다.

CREATE INDEX IF NOT EXISTS idx_match_schedules_active_club_date_time
  ON public.match_schedules (club_id, match_date, start_time)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_match_participants_active_schedule_user
  ON public.match_participants (match_schedule_id, user_id)
  INCLUDE (id, status, registered_at, partner_user_id)
  WHERE status IN ('registered', 'attended', 'waitlisted');

CREATE INDEX IF NOT EXISTS idx_club_members_active_club_user
  ON public.club_members (club_id, user_id)
  INCLUDE (role, coin_balance, coin_wins, coin_losses)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_member_level_votes_club_voter
  ON public.member_level_votes (club_id, voter_id, subject_id);

-- 내 경기 조회의 네 선수 슬롯 OR 조건이 전체 generated_matches를 훑지 않도록 합니다.
CREATE INDEX IF NOT EXISTS idx_generated_matches_club_team1_player1
  ON public.generated_matches (club_id, team1_player1_id)
  WHERE team1_player1_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generated_matches_club_team1_player2
  ON public.generated_matches (club_id, team1_player2_id)
  WHERE team1_player2_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generated_matches_club_team2_player1
  ON public.generated_matches (club_id, team2_player1_id)
  WHERE team2_player1_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generated_matches_club_team2_player2
  ON public.generated_matches (club_id, team2_player2_id)
  WHERE team2_player2_id IS NOT NULL;

ANALYZE public.match_schedules;
ANALYZE public.match_participants;
ANALYZE public.club_members;
ANALYZE public.member_level_votes;
ANALYZE public.generated_matches;

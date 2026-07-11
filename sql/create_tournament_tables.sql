-- 대회(토너먼트) 테이블
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  tournament_date DATE NOT NULL, -- 대회 날짜
  round_number INTEGER NOT NULL DEFAULT 1, -- 회차 (1회차, 2회차...)
  match_type TEXT NOT NULL DEFAULT 'random', -- 경기 타입: 'level_based'(레벨별), 'random'(랜덤), 'mixed_doubles'(혼복)
  team_assignment_id UUID NOT NULL REFERENCES team_assignments(id) ON DELETE CASCADE,
  team_type TEXT NOT NULL, -- '2teams', '3teams', '4teams', 'pairs'
  total_teams INTEGER NOT NULL,
  matches_per_player INTEGER NOT NULL DEFAULT 3, -- 1인당 경기수
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 대회 경기 테이블
CREATE TABLE IF NOT EXISTS tournament_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INTEGER NOT NULL, -- 대진 내부 라운드 (1, 2, 3...)
  match_number INTEGER NOT NULL, -- 경기 번호
  team1 TEXT[] NOT NULL, -- 팀1 선수 목록
  team2 TEXT[] NOT NULL, -- 팀2 선수 목록
  court TEXT NOT NULL, -- 코트 번호
  scheduled_time TIMESTAMPTZ, -- 예정 시간
  status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'completed'
  score_team1 INTEGER, -- 팀1 점수
  score_team2 INTEGER, -- 팀2 점수
  winner TEXT, -- 'team1', 'team2', 'draw'
  next_match_id UUID REFERENCES tournament_matches(id) ON DELETE SET NULL,
  next_match_slot SMALLINT CHECK (next_match_slot IN (1, 2)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_tournaments_assignment ON tournaments(team_assignment_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament ON tournament_matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_status ON tournament_matches(status);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_next_match ON tournament_matches(next_match_id) WHERE next_match_id IS NOT NULL;

-- 코멘트 추가
COMMENT ON TABLE tournaments IS '대회(토너먼트) 정보';
COMMENT ON TABLE tournament_matches IS '대회 경기 일정 및 결과';

COMMENT ON COLUMN tournaments.title IS '대회명';
COMMENT ON COLUMN tournaments.tournament_date IS '대회 날짜';
COMMENT ON COLUMN tournaments.round_number IS '회차 번호 (1, 2, 3...)';
COMMENT ON COLUMN tournaments.match_type IS '경기 타입 (level_based: 레벨별, random: 랜덤, mixed_doubles: 혼복)';
COMMENT ON COLUMN tournaments.team_assignment_id IS '팀 구성 ID (team_assignments 참조)';
COMMENT ON COLUMN tournaments.team_type IS '팀 타입 (2teams/3teams/4teams/pairs)';
COMMENT ON COLUMN tournaments.total_teams IS '총 참가 팀 수';
COMMENT ON COLUMN tournaments.matches_per_player IS '1인당 경기수';

COMMENT ON COLUMN tournament_matches.tournament_id IS '대회 ID';
COMMENT ON COLUMN tournament_matches.round IS '대진 내부 라운드 번호 (대회 회차와 별개)';
COMMENT ON COLUMN tournament_matches.match_number IS '대회 내 경기 순번';
COMMENT ON COLUMN tournament_matches.team1 IS '팀1 선수 목록';
COMMENT ON COLUMN tournament_matches.team2 IS '팀2 선수 목록';
COMMENT ON COLUMN tournament_matches.court IS '코트 번호';
COMMENT ON COLUMN tournament_matches.status IS '경기 상태 (pending/in_progress/completed)';
COMMENT ON COLUMN tournament_matches.score_team1 IS '팀1 점수';
COMMENT ON COLUMN tournament_matches.score_team2 IS '팀2 점수';
COMMENT ON COLUMN tournament_matches.winner IS '승자 (team1/team2/draw)';
COMMENT ON COLUMN tournament_matches.next_match_id IS '다음 토너먼트 라운드 경기';
COMMENT ON COLUMN tournament_matches.next_match_slot IS '다음 경기의 팀 슬롯 (1 또는 2)';

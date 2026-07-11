-- Single-elimination bracket progression
-- Run this once in the Supabase SQL editor before creating a new knockout bracket.

ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS next_match_id UUID
    REFERENCES public.tournament_matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_match_slot SMALLINT
    CHECK (next_match_slot IN (1, 2)),
  ADD COLUMN IF NOT EXISTS competition_phase TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS competition_group_key TEXT,
  ADD COLUMN IF NOT EXISTS team1_source_match_id UUID
    REFERENCES public.tournament_matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team2_source_match_id UUID
    REFERENCES public.tournament_matches(id) ON DELETE SET NULL;

-- Repair legacy child rows so manager updates remain inside the parent tournament's club.
UPDATE public.tournament_matches AS tm
SET club_id = t.club_id
FROM public.tournaments AS t
WHERE t.id = tm.tournament_id
  AND tm.club_id IS NULL
  AND t.club_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_matches_next_match
  ON public.tournament_matches(next_match_id)
  WHERE next_match_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_matches_competition_phase
  ON public.tournament_matches(tournament_id, competition_group_key, competition_phase);

CREATE INDEX IF NOT EXISTS idx_tournament_matches_team_sources
  ON public.tournament_matches(team1_source_match_id, team2_source_match_id);

COMMENT ON COLUMN public.tournament_matches.next_match_id
  IS 'Next single-elimination bracket match that receives this match winner';
COMMENT ON COLUMN public.tournament_matches.next_match_slot
  IS 'Target team slot in next_match_id: 1 for team1, 2 for team2';
COMMENT ON COLUMN public.tournament_matches.competition_phase
  IS 'Tournament progression phase such as preliminary, ranking_league, or ranking_final';
COMMENT ON COLUMN public.tournament_matches.competition_group_key
  IS 'Logical pair group used to calculate league standings and promotion';

export const CLUB_SCOPED_TABLES = new Set([
  'match_schedules', 'generated_matches', 'attendances', 'team_assignments',
  'match_coin_bets', 'club_members', 'notifications', 'tournament_matches',
  'profile_coin_transactions', 'club_level_aliases', 'match_sessions',
  'match_participants', 'match_results', 'match_player_status',
  'recurring_match_templates', 'tournaments', 'courts', 'products',
  'product_purchases', 'surveys', 'survey_responses', 'challenge_requests',
  'member_level_votes', 'member_rating_settings', 'match_wager_proposals',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeClubId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = decodeURIComponent(value).replace(/"/g, '').trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

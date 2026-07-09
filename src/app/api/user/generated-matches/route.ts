import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

export async function POST(request: Request) {
  try {
    const serverSupabase = await getSupabaseServerClient();
    const { data: { user }, error: authError } = await serverSupabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ matches: [] });
    }

    const adminSupabase = await getFilteredAdminClient();
    const { participantIds, status } = await request.json();

    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return NextResponse.json({ error: 'Invalid participant IDs' }, { status: 400 });
    }

    const participantMatchFilter = participantIds
      .map((participantId) =>
        [
          `team1_player1_id.eq.${participantId}`,
          `team1_player2_id.eq.${participantId}`,
          `team2_player1_id.eq.${participantId}`,
          `team2_player2_id.eq.${participantId}`,
        ].join(',')
      )
      .join(',');

    let query = adminSupabase
      .from('generated_matches')
      .select(`
        *,
        team1_player1:profiles!team1_player1_id(
          id, user_id, username, full_name, coin_balance, skill_level,
          level_info:level_info!skill_level(name)
        ),
        team1_player2:profiles!team1_player2_id(
          id, user_id, username, full_name, coin_balance, skill_level,
          level_info:level_info!skill_level(name)
        ),
        team2_player1:profiles!team2_player1_id(
          id, user_id, username, full_name, coin_balance, skill_level,
          level_info:level_info!skill_level(name)
        ),
        team2_player2:profiles!team2_player2_id(
          id, user_id, username, full_name, coin_balance, skill_level,
          level_info:level_info!skill_level(name)
        ),
        match_sessions(
          id,
          session_name,
          session_date
        )
      `)
      .or(participantMatchFilter)
      .eq('club_id', clubId)
      .order('match_number', { ascending: false });

    if (status) {
      if (status === 'upcoming') {
        query = query.neq('status', 'completed');
      } else if (status === 'completed') {
        query = query.eq('status', 'completed');
      } else {
        query = query.eq('status', status);
      }
    }

    const { data: matches, error } = await query;

    if (error) {
      console.error('Failed to fetch generated_matches via API:', error);
      return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 });
    }

    return NextResponse.json({ matches: matches || [] });
  } catch (err: any) {
    console.error('Error in generated-matches route:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

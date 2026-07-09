import { NextResponse } from 'next/server';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getUserRole, getProfileByUserId } from '@/lib/auth';
import { getActiveClubId } from '@/lib/club';
import { syncSessionMatchFlow } from '@/lib/match-session-flow';
import { notifyWaitingMatchesForSession } from '@/lib/match-preparation-notifications';

type RouteContext = { params: Promise<{ matchId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { matchId } = await context.params;

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ error: 'No active club selected' }, { status: 400 });
    }

    const adminSupabase = getSupabaseAdminClient();

    // 1. Fetch match_schedules (club_id filtered)
    const { data: scheduleMatch, error } = await adminSupabase
      .from('match_schedules')
      .select('*')
      .eq('id', matchId)
      .eq('club_id', clubId)
      .single();

    if (error || !scheduleMatch) {
      return NextResponse.json({ error: 'Match not found', details: error?.message }, { status: 404 });
    }

    if (!scheduleMatch.generated_match_id) {
      return NextResponse.json({ error: 'Generated Match ID is missing' }, { status: 400 });
    }

    // 2. Fetch generated_matches
    const { data: generatedMatch } = await adminSupabase
      .from('generated_matches')
      .select('*')
      .eq('id', scheduleMatch.generated_match_id)
      .single();

    if (!generatedMatch) {
      return NextResponse.json({ error: 'Generated Match not found' }, { status: 404 });
    }

    // 3. Fetch player profiles to get names
    const playerIds = [
      generatedMatch.team1_player1_id, generatedMatch.team1_player2_id,
      generatedMatch.team2_player1_id, generatedMatch.team2_player2_id
    ].filter(Boolean) as string[];

    const { data: profiles } = await adminSupabase
      .from('profiles')
      .select('id, full_name')
      .in('id', playerIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p.full_name]) || []);

    const team1 = [
      generatedMatch.team1_player1_id ? profileMap.get(generatedMatch.team1_player1_id) || 'Unknown' : 'Unknown',
      generatedMatch.team1_player2_id ? profileMap.get(generatedMatch.team1_player2_id) || 'Unknown' : ''
    ].filter(Boolean);

    const team2 = [
      generatedMatch.team2_player1_id ? profileMap.get(generatedMatch.team2_player1_id) || 'Unknown' : 'Unknown',
      generatedMatch.team2_player2_id ? profileMap.get(generatedMatch.team2_player2_id) || 'Unknown' : ''
    ].filter(Boolean);

    // Current login user
    let currentProfileId: string | null = null;
    let currentUserRole: string | null = null;
    let currentUserName: string | null = null;

    try {
      const serverSupabase = await getSupabaseServerClient();
      const { data: { user } } = await serverSupabase.auth.getUser();

      if (user) {
        currentUserRole = await getUserRole(serverSupabase, user);
        const profile = await getProfileByUserId(serverSupabase, user.id);
        if (profile) {
          currentProfileId = profile.id;
          currentUserName = profile.full_name || null;
        }
      }
    } catch {
      // non-logged in user
    }

    // Referee logic for today-matches is simple: match_schedules.referee_id
    const refereeId = scheduleMatch.referee_id;
    let refereeName = null;
    let isReferee = false;

    if (refereeId) {
      if (refereeId === currentProfileId) {
        isReferee = true;
        refereeName = currentUserName;
      } else {
        const { data: refProfile } = await adminSupabase.from('profiles').select('full_name').eq('id', refereeId).single();
        if (refProfile) {
          refereeName = refProfile.full_name;
        }
      }
    }

    const isAdmin = currentUserRole === 'admin' || currentUserRole === 'manager';
    const canEdit = isReferee || isAdmin;

    const matchResult = (scheduleMatch.match_result as any) || {};

    return NextResponse.json({
      match: {
        id: scheduleMatch.id,
        tournament_id: null,
        round: 1,
        match_number: generatedMatch.match_number,
        team1,
        team2,
        court: String(scheduleMatch.court_number || 1),
        status: scheduleMatch.status,
        score_team1: matchResult.team1_score ?? 0,
        score_team2: matchResult.team2_score ?? 0,
        winner: matchResult.winner ?? null,
        referee_id: refereeId,
        referee_name: refereeName,
      },
      canEdit,
      isReferee,
      isAdmin,
      currentUserName,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { matchId } = await context.params;

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ error: 'No active club selected' }, { status: 400 });
    }

    const adminSupabase = getSupabaseAdminClient();
    const { data: scheduleMatch, error: matchError } = await adminSupabase
      .from('match_schedules')
      .select('*')
      .eq('id', matchId)
      .eq('club_id', clubId)
      .single();

    if (matchError || !scheduleMatch) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    const body = await request.json();
    const { action, team, value, score1, score2, winner, isCompleted, referee_id, referee_name } = body;

    // We only support absolute score updates from scoreboard UI or completion
    if (score1 !== undefined || score2 !== undefined || winner !== undefined) {
      const matchResult = (scheduleMatch.match_result as any) || {};
      const newResult = {
        ...matchResult,
        team1_score: score1 !== undefined ? score1 : matchResult.team1_score,
        team2_score: score2 !== undefined ? score2 : matchResult.team2_score,
        winner: winner !== undefined ? winner : matchResult.winner,
      };

      const updateData: any = { match_result: newResult };

      if (isCompleted !== undefined) {
        updateData.status = isCompleted ? 'completed' : 'in_progress';
      } else if (scheduleMatch.status === 'scheduled') {
        updateData.status = 'in_progress';
      }

      // Check if we need to release referee_id
      if (action === 'release_referee') {
        updateData.referee_id = null;
      }

      const { error: updateError } = await adminSupabase
        .from('match_schedules')
        .update(updateData)
        .eq('id', matchId)
        .eq('club_id', clubId);

      if (updateError) {
        throw updateError;
      }

      // If the match was completed, we MUST also update generated_matches and trigger the flow!
      if (isCompleted && scheduleMatch.generated_match_id) {
        const { error: genError } = await adminSupabase
          .from('generated_matches')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            match_result: newResult,
            updated_at: new Date().toISOString()
          })
          .eq('id', scheduleMatch.generated_match_id);

        if (genError) {
          throw genError;
        }

        // Fetch session_id to trigger flow
        const { data: genMatch } = await adminSupabase
          .from('generated_matches')
          .select('session_id')
          .eq('id', scheduleMatch.generated_match_id)
          .single();

        if (genMatch?.session_id) {
          await syncSessionMatchFlow(adminSupabase, genMatch.session_id, {
            completedMatchId: scheduleMatch.generated_match_id
          });
          await notifyWaitingMatchesForSession(adminSupabase, genMatch.session_id);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

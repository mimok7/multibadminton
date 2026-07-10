import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getUserRole, isAdminRole } from '@/lib/auth';
import { getClubRole } from '@/lib/club-auth';
import { getActiveClubId } from '@/lib/club';
import { getKoreaDate } from '@/lib/date';
import { decorateDescriptionForScheduleSource } from '@/lib/match-schedule-source';

function addMinutesToTimeString(time: string | null | undefined, minutesToAdd: number) {
  if (!time) {
    return null;
  }

  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return time;
  }

  const totalMinutes = hour * 60 + minute + minutesToAdd;
  const normalizedMinutes = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const nextHour = Math.floor(normalizedMinutes / 60);
  const nextMinute = normalizedMinutes % 60;

  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}:00`;
}

function getTimeValue(time: string | null | undefined) {
  if (!time) {
    return -1;
  }

  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return -1;
  }

  return hour * 60 + minute;
}

function buildGeneratedMatchLabel(sessionDate: string, batchNumber: number, matchNumber: number) {
  return `${sessionDate}_${batchNumber}-${matchNumber}`;
}

async function requireAdmin() {
  const clubId = await getActiveClubId();
  if (!clubId) {
    return { error: NextResponse.json({ error: 'Club not selected' }, { status: 400 }) };
  }

  const supabase = await getSupabaseServerClient();
  const adminSupabase = await getFilteredAdminClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const [userRole, clubRole] = await Promise.all([
    getUserRole(supabase, user),
    getClubRole(adminSupabase, user.id, clubId),
  ]);
  const canManageClub = isAdminRole(userRole) || ['owner', 'admin', 'manager'].includes(clubRole || '');

  if (!canManageClub) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { adminSupabase, clubId };
}

export async function GET(request: Request) {
  try {
    const adminContext = await requireAdmin();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const requestUrl = new URL(request.url);
    const dateParam = requestUrl.searchParams.get('date');
    const targetDate = dateParam === 'today' || !dateParam ? getKoreaDate() : dateParam;

    const { data, error } = await adminContext.adminSupabase
      .from('match_sessions')
      .select('*')
      .eq('session_date', targetDate)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Admin match sessions GET error:', error);
      return NextResponse.json({ error: 'Failed to load match sessions' }, { status: 500 });
    }

    const directSessions = data || [];
    if (directSessions.length > 0) {
      return NextResponse.json({ sessions: directSessions });
    }

    const { data: todaySchedules, error: schedulesError } = await adminContext.adminSupabase
      .from('match_schedules')
      .select('generated_match_id')
      .eq('match_date', targetDate)
      .not('generated_match_id', 'is', null);

    if (schedulesError) {
      console.error('Admin match schedules fallback GET error:', schedulesError);
      return NextResponse.json({ error: 'Failed to load scheduled matches' }, { status: 500 });
    }

    const generatedMatchIds = Array.from(
      new Set(
        (todaySchedules || [])
          .map((schedule) => schedule.generated_match_id)
          .filter((id): id is number => typeof id === 'number')
      )
    );

    if (generatedMatchIds.length === 0) {
      return NextResponse.json({ sessions: [] });
    }

    const { data: generatedMatches, error: generatedMatchesError } = await adminContext.adminSupabase
      .from('generated_matches')
      .select('id, session_id')
      .in('id', generatedMatchIds);

    if (generatedMatchesError) {
      console.error('Admin generated matches fallback GET error:', generatedMatchesError);
      return NextResponse.json({ error: 'Failed to load generated matches' }, { status: 500 });
    }

    const sessionIds = Array.from(
      new Set(
        (generatedMatches || [])
          .map((match) => match.session_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    if (sessionIds.length === 0) {
      return NextResponse.json({ sessions: [] });
    }

    const { data: fallbackSessions, error: fallbackSessionsError } = await adminContext.adminSupabase
      .from('match_sessions')
      .select('*')
      .in('id', sessionIds)
      .order('created_at', { ascending: false });

    if (fallbackSessionsError) {
      console.error('Admin fallback match sessions GET error:', fallbackSessionsError);
      return NextResponse.json({ error: 'Failed to load fallback match sessions' }, { status: 500 });
    }

    return NextResponse.json({ sessions: fallbackSessions || [] });
  } catch (error) {
    console.error('Admin match sessions GET unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminContext = await requireAdmin();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const body = await request.json().catch(() => null);
    const matches = Array.isArray(body?.matches) ? body.matches : [];
    const sessionDate = typeof body?.session_date === 'string' && body.session_date ? body.session_date : getKoreaDate();
    const mode = typeof body?.mode === 'string' && body.mode.trim() ? body.mode.trim() : '레벨';

    if (matches.length === 0) {
      return NextResponse.json({ error: 'Matches are required' }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      return NextResponse.json({ error: 'Invalid session date' }, { status: 400 });
    }

    const matchPlayerIds: unknown[][] = matches.map((match: any) => [
      match?.team1?.player1?.id,
      match?.team1?.player2?.id,
      match?.team2?.player1?.id,
      match?.team2?.player2?.id,
    ]);
    const hasInvalidMatch = matchPlayerIds.some((ids: unknown[]) =>
      ids.some((id: unknown) => typeof id !== 'string' || !id) || new Set(ids).size !== 4
    );

    if (hasInvalidMatch) {
      return NextResponse.json(
        { error: 'Each match must contain four different players' },
        { status: 400 }
      );
    }

    const uniquePlayerIds = Array.from(new Set(matchPlayerIds.flat())) as string[];
    const { data: activeMembers, error: membersError } = await adminContext.adminSupabase
      .from('club_members')
      .select('user_id')
      .eq('status', 'active')
      .in('user_id', uniquePlayerIds);

    if (membersError) {
      console.error('Admin match session member validation error:', membersError);
      return NextResponse.json({ error: 'Failed to validate match players' }, { status: 500 });
    }

    const activeMemberIds = new Set((activeMembers || []).map((member) => member.user_id));
    if (uniquePlayerIds.some((playerId) => !activeMemberIds.has(playerId))) {
      return NextResponse.json(
        { error: 'One or more players are not active members of this club' },
        { status: 400 }
      );
    }

    const { count, error: countError } = await adminContext.adminSupabase
      .from('match_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('session_date', sessionDate);

    if (countError) {
      console.error('Admin match sessions count error:', countError);
      return NextResponse.json({ error: 'Failed to count existing sessions' }, { status: 500 });
    }

    const sessionBatchNumber = (count ?? 0) + 1;
    const sessionName = `${sessionDate} ${sessionBatchNumber}회차 ${mode}`;

    const { data: sessionData, error: sessionError } = await adminContext.adminSupabase
      .from('match_sessions')
      .insert({
        session_name: sessionName,
        total_matches: matches.length,
        assigned_matches: 0,
        session_date: sessionDate,
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Admin match sessions insert error:', sessionError);
      return NextResponse.json({ error: 'Failed to create match session' }, { status: 500 });
    }

    const generatedMatchesPayload = matches.map((match: any, index: number) => ({
      session_id: sessionData.id,
      match_number: index + 1,
      team1_player1_id: match?.team1?.player1?.id,
      team1_player2_id: match?.team1?.player2?.id,
      team2_player1_id: match?.team2?.player1?.id,
      team2_player2_id: match?.team2?.player2?.id,
      status: 'scheduled',
      created_at: new Date().toISOString(),
    }));

    const { error: generatedMatchesError } = await adminContext.adminSupabase
      .from('generated_matches')
      .insert(generatedMatchesPayload);

    if (generatedMatchesError) {
      console.error('Admin generated matches insert error:', generatedMatchesError);
      await adminContext.adminSupabase.from('match_sessions').delete().eq('id', sessionData.id);
      return NextResponse.json({ error: 'Failed to save generated matches' }, { status: 500 });
    }

    const { data: createdGeneratedMatches, error: createdGeneratedMatchesError } = await adminContext.adminSupabase
      .from('generated_matches')
      .select('id, match_number')
      .eq('session_id', sessionData.id)
      .order('match_number', { ascending: true });

    if (createdGeneratedMatchesError) {
      console.error('Admin generated matches readback error:', createdGeneratedMatchesError);
      return NextResponse.json({
        success: true,
        session: sessionData,
        session_name: sessionName,
        match_count: matches.length,
        scheduled_count: 0,
      });
    }

    const { data: activeCourts, error: activeCourtsError } = await adminContext.adminSupabase
      .from('courts')
      .select('id, name, location, order_index')
      .eq('is_active', true)
      .order('order_index', { ascending: true, nullsFirst: true })
      .order('name', { ascending: true });

    if (activeCourtsError) {
      console.error('Admin active courts query error:', activeCourtsError);
    }

    const { data: baseSchedules, error: baseSchedulesError } = await adminContext.adminSupabase
      .from('match_schedules')
      .select('match_date, scheduled_date, start_time, end_time, scheduled_time, court_number, location')
      .eq('match_date', sessionDate)
      .is('generated_match_id', null)
      .order('start_time', { ascending: true });

    const { data: existingGeneratedSchedules, error: existingGeneratedSchedulesError } = await adminContext.adminSupabase
      .from('match_schedules')
      .select('scheduled_time, start_time')
      .eq('match_date', sessionDate)
      .eq('schedule_source', 'generated');

    if (baseSchedulesError) {
      console.error('Admin base schedules query error:', baseSchedulesError);
      return NextResponse.json({
        success: true,
        session: sessionData,
        session_name: sessionName,
        match_count: matches.length,
        scheduled_count: 0,
      });
    }

    if (existingGeneratedSchedulesError) {
      console.error('Admin existing generated schedules query error:', existingGeneratedSchedulesError);
    }

    const scheduleTemplates = (baseSchedules || []).length > 0
      ? baseSchedules || []
      : [{
          match_date: sessionDate,
          scheduled_date: sessionDate,
          start_time: null,
          end_time: null,
          scheduled_time: null,
          court_number: null,
          location: '클럽 코트',
        }];

    const configuredCourts = (activeCourts || []).map((court, index) => ({
      court_number: index + 1,
      location: court.location || court.name || '클럽 코트',
    }));
    const latestExistingGeneratedTime = (existingGeneratedSchedules || []).reduce<string | null>((latest, schedule) => {
      const candidate = schedule.scheduled_time || schedule.start_time || null;
      if (!candidate) {
        return latest;
      }

      return getTimeValue(candidate) > getTimeValue(latest) ? candidate : latest;
    }, null);

    const baseDisplayTime = latestExistingGeneratedTime
      ? addMinutesToTimeString(latestExistingGeneratedTime, 10)
      : (scheduleTemplates[0]?.scheduled_time || scheduleTemplates[0]?.start_time || null);

    const schedulePayload = (createdGeneratedMatches || []).map((generatedMatch, index) => {
      const template = scheduleTemplates[index % scheduleTemplates.length];
      const displayTime = addMinutesToTimeString(baseDisplayTime || template.scheduled_time || template.start_time, index * 10);
      const configuredCourt = configuredCourts.length > 0
        ? configuredCourts[index % configuredCourts.length]
        : null;

      return {
        generated_match_id: generatedMatch.id,
        schedule_source: 'generated' as const,
        match_date: template.match_date || sessionDate,
        scheduled_date: template.scheduled_date || template.match_date || sessionDate,
        // Generated schedules can share the same venue and session window.
        // Keep the display time, but avoid reusing the recurring slot's
        // start/end pair because match_schedules has a unique slot constraint.
        start_time: null,
        end_time: null,
        scheduled_time: displayTime,
        court_number:
          configuredCourt?.court_number
          ?? template.court_number
          ?? ((index % Math.max(1, configuredCourts.length || scheduleTemplates.length)) + 1),
        location: configuredCourt?.location || template.location || '클럽 코트',
        max_participants: 4,
        current_participants: 0,
        status: 'scheduled',
        description: decorateDescriptionForScheduleSource(
          buildGeneratedMatchLabel(sessionDate, sessionBatchNumber, generatedMatch.match_number),
          'generated'
        ),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    let scheduledCount = 0;

    if (schedulePayload.length > 0) {
      const { data: insertedSchedules, error: scheduleInsertError } = await adminContext.adminSupabase
        .from('match_schedules')
        .insert(schedulePayload)
        .select('id');

      if (scheduleInsertError) {
        console.error('Admin generated schedule insert error:', scheduleInsertError);
        await adminContext.adminSupabase.from('generated_matches').delete().eq('session_id', sessionData.id);
        await adminContext.adminSupabase.from('match_sessions').delete().eq('id', sessionData.id);
        return NextResponse.json({ error: 'Failed to create generated schedules' }, { status: 500 });
      }

      const insertedCount = insertedSchedules?.length || 0;
      scheduledCount = insertedCount;
      const { error: sessionUpdateError } = await adminContext.adminSupabase
        .from('match_sessions')
        .update({ assigned_matches: insertedCount })
        .eq('id', sessionData.id);

      if (sessionUpdateError) {
        console.error('Admin match session assigned count update error:', sessionUpdateError);
      }
    }

    return NextResponse.json({
      success: true,
      session: sessionData,
      session_name: sessionName,
      match_count: matches.length,
      scheduled_count: scheduledCount,
    });
  } catch (error) {
    console.error('Admin match sessions POST unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const adminContext = await requireAdmin();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const body = await request.json().catch(() => null);
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';

    if (!sessionId) {
      return NextResponse.json({ error: 'Session id is required' }, { status: 400 });
    }

    const { data: matches, error: matchesError } = await adminContext.adminSupabase
      .from('generated_matches')
      .select('id')
      .eq('session_id', sessionId);

    if (matchesError) {
      console.error('Admin match session delete lookup error:', matchesError);
      return NextResponse.json({ error: 'Failed to load session matches' }, { status: 500 });
    }

    const generatedMatchIds = (matches || []).map((match) => match.id);

    if (generatedMatchIds.length > 0) {
      const { error: scheduleDeleteError } = await adminContext.adminSupabase
        .from('match_schedules')
        .delete()
        .in('generated_match_id', generatedMatchIds);

      if (scheduleDeleteError) {
        console.error('Admin match session schedule delete error:', scheduleDeleteError);
        return NextResponse.json({ error: 'Failed to delete linked schedules' }, { status: 500 });
      }

      const { error: matchDeleteError } = await adminContext.adminSupabase
        .from('generated_matches')
        .delete()
        .eq('session_id', sessionId);

      if (matchDeleteError) {
        console.error('Admin match session generated match delete error:', matchDeleteError);
        return NextResponse.json({ error: 'Failed to delete generated matches' }, { status: 500 });
      }
    }

    const { error: sessionDeleteError } = await adminContext.adminSupabase
      .from('match_sessions')
      .delete()
      .eq('id', sessionId);

    if (sessionDeleteError) {
      console.error('Admin match session delete error:', sessionDeleteError);
      return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin match sessions DELETE unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

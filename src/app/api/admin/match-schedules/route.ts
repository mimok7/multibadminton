import { NextResponse } from 'next/server';
import {
  getFilteredAdminClient,
  getUnfilteredSupabaseServerClient,
  getUnfilteredGlobalAdminClient,
} from '@/lib/supabase-server';
import { isSuperadminProfile, isUserAdmin } from '@/lib/auth';
import { getClubRole } from '@/lib/club-auth';
import { getActiveClubId } from '@/lib/club';
import { getKoreaDate } from '@/lib/date';
import {
  decorateDescriptionForScheduleSource,
  inferScheduleSource,
  normalizeScheduleSource,
} from '@/lib/match-schedule-source';
import { ensureFiveMatches } from '@/lib/match-generator';

type ParticipantProfile = {
  id?: string | null;
  user_id?: string | null;
  username?: string | null;
  full_name?: string | null;
  skill_level?: string | null;
};

async function requireScheduleManager() {
  const supabase = await getUnfilteredSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const globalAdmin = getUnfilteredGlobalAdminClient();
  const { data: profile } = await globalAdmin
    .from('profiles')
    .select('role, username')
    .or(`user_id.eq.${user.id},id.eq.${user.id}`)
    .limit(1)
    .maybeSingle();
  const isSuperadmin = isSuperadminProfile(profile as any);
  const adminSupabase = isSuperadmin
    ? globalAdmin
    : await getFilteredAdminClient();

  const isGlobalManager = await isUserAdmin(supabase, user);
  const activeClubId = await getActiveClubId();
  const clubRole = activeClubId
    ? await getClubRole(getUnfilteredGlobalAdminClient(), user.id, activeClubId)
    : null;
  const canManageSchedules = isSuperadmin || isGlobalManager || ['owner', 'admin', 'manager'].includes(clubRole || '');

  if (!canManageSchedules) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { supabase, adminSupabase, user, activeClubId };
}

export async function GET(request: Request) {
  try {
    const adminContext = await requireScheduleManager();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const { adminSupabase } = adminContext;

    const requestUrl = new URL(request.url);
    const dateParam = requestUrl.searchParams.get('date');
    const fromDateParam = requestUrl.searchParams.get('from_date');
    const statusParam = requestUrl.searchParams.get('status');
    const scheduleSourceParam = requestUrl.searchParams.get('schedule_source');
    const profilesQueryParam = requestUrl.searchParams.get('profiles_query');
    const profilesAllParam = requestUrl.searchParams.get('profiles_all');

    const todayDate = getKoreaDate();
    const exactDate = dateParam === 'today' ? todayDate : dateParam;
    const fromDate = fromDateParam === 'today' || !fromDateParam ? todayDate : fromDateParam;
    const shouldFetchAllProfiles = profilesAllParam === '1' || profilesAllParam === 'true';

    const scheduleSource = scheduleSourceParam ? normalizeScheduleSource(scheduleSourceParam) : null;

    if (profilesQueryParam !== null) {
      const normalizedQuery = profilesQueryParam.trim();

      let profilesQuery = adminSupabase
        .from('club_members')
        .select('user_id, status, profiles!inner(id, user_id, username, full_name)')
        .eq('status', 'active')
        .not('user_id', 'is', null)
        .limit(shouldFetchAllProfiles ? 500 : 20);

      if (normalizedQuery.length > 0) {
        const escapedQuery = normalizedQuery.replace(/[%_,]/g, (value) => `\\${value}`);
        profilesQuery = profilesQuery.or(
          `username.ilike.%${escapedQuery}%,full_name.ilike.%${escapedQuery}%`,
          { referencedTable: 'profiles' }
        );
      }

      // Note: We can't easily order by related table via standard query builder without raw SQL,
      // but we can sort the results in JavaScript below since it's limited to 500 max.
      
      const { data: membersData, error: profilesError } = await profilesQuery;

      if (profilesError) {
        console.error('Admin profiles search error:', profilesError);
        return NextResponse.json({ error: 'Failed to search profiles' }, { status: 500 });
      }

      const profiles = (membersData || [])
        .map((row: any) => ({
          id: row.profiles.id,
          user_id: row.profiles.user_id,
          username: row.profiles.username,
          full_name: row.profiles.full_name,
        }));
        
      // Sort alphabetically
      if (normalizedQuery.length === 0) {
        profiles.sort((a, b) => {
          const aName = a.full_name || a.username || '';
          const bName = b.full_name || b.username || '';
          return aName.localeCompare(bName, 'ko-KR');
        });
      }

      return NextResponse.json({ profiles });
    }

    const buildSchedulesQuery = (includeScheduleSourceFilter: boolean) => {
      let query = adminSupabase
        .from('match_schedules')
        .select('*')
        .order('match_date', { ascending: true })
        .order('start_time', { ascending: true });

      const cookieHeader = request.headers.get('cookie') || '';
      const activeClubIdMatch = cookieHeader.match(/(?:^|;\s*)active_club_id=([^;]*)/);
      const activeClubId = activeClubIdMatch ? decodeURIComponent(activeClubIdMatch[1]) : null;

      if (activeClubId) {
        query = query.eq('club_id', activeClubId);
      }

      if (exactDate) {
        query = query.eq('match_date', exactDate);
      } else {
        query = query.gte('match_date', fromDate);
      }

      if (statusParam) {
        query = query.eq('status', statusParam);
      }

      if (includeScheduleSourceFilter && scheduleSource) {
        query = query.eq('schedule_source', scheduleSource);
      }

      return query;
    };

    let { data: schedulesData, error: schedulesError } = await buildSchedulesQuery(true);

    if (schedulesError?.code === '42703') {
      const fallback = await buildSchedulesQuery(false);
      schedulesData = fallback.data;
      schedulesError = fallback.error;
    }

    if (schedulesError) {
      console.error('Admin match schedules query error:', schedulesError);
      return NextResponse.json({ error: 'Failed to load match schedules' }, { status: 500 });
    }

    const filteredSchedules = (schedulesData || [])
      .map((schedule) => ({
        ...schedule,
        schedule_source: inferScheduleSource(schedule),
      }))
      .filter((schedule) => !scheduleSource || schedule.schedule_source === scheduleSource);

    if (filteredSchedules.length === 0) {
      return NextResponse.json({ schedules: [] });
    }

    const scheduleIds = filteredSchedules.map((schedule) => schedule.id);

    const { data: participantsData, error: participantsError } = await adminSupabase
      .from('match_participants')
      .select('id, match_schedule_id, user_id, registered_at, status')
      .in('match_schedule_id', scheduleIds)
      .in('status', ['registered', 'attended']);

    if (participantsError) {
      console.error('Admin match participants query error:', participantsError);
      return NextResponse.json({ error: 'Failed to load match participants' }, { status: 500 });
    }

    const participantUserIds = Array.from(
      new Set((participantsData || []).map((participant) => participant.user_id).filter(Boolean))
    );

    let profilesMap: Record<string, ParticipantProfile> = {};

    if (participantUserIds.length > 0) {
      const [byUserId, byId] = await Promise.all([
        adminSupabase.from('profiles').select('id, user_id, username, full_name, skill_level').in('user_id', participantUserIds),
        adminSupabase.from('profiles').select('id, user_id, username, full_name, skill_level').in('id', participantUserIds)
      ]);

      const profilesError = byUserId.error || byId.error;
      const profilesData = [
        ...(byUserId.data || []),
        ...(byId.data || [])
      ].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);

      if (profilesError) {
        console.warn('Admin participant profiles query error:', profilesError);
      } else {
        profilesMap = (profilesData || []).reduce<Record<string, ParticipantProfile>>((acc, profile) => {
          const mappedProfile = {
            id: profile.id,
            user_id: profile.user_id,
            username: profile.username,
            full_name: profile.full_name,
            skill_level: profile.skill_level,
          };
          if (profile.id) acc[profile.id] = mappedProfile;
          if (profile.user_id) acc[profile.user_id] = mappedProfile;
          return acc;
        }, {});
      }
    }

    const participantsBySchedule = (participantsData || []).reduce<Record<string, Array<Record<string, unknown>>>>(
      (acc, participant) => {
        const scheduleId = participant.match_schedule_id;
        if (!acc[scheduleId]) {
          acc[scheduleId] = [];
        }

        acc[scheduleId].push({
          ...participant,
          profiles: profilesMap[participant.user_id]
            ? {
                username: profilesMap[participant.user_id].username ?? undefined,
                full_name: profilesMap[participant.user_id].full_name ?? undefined,
                skill_level: profilesMap[participant.user_id].skill_level ?? undefined,
              }
            : undefined,
        });

        return acc;
      },
      {}
    );

    const schedules = filteredSchedules.map((schedule) => {
      const participants = participantsBySchedule[schedule.id] || [];

      return {
        ...schedule,
        participants,
        current_participants: participants.length,
      };
    });

    return NextResponse.json({ schedules });
  } catch (error) {
    console.error('Admin match schedules API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const adminContext = await requireScheduleManager();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const { adminSupabase, user } = adminContext;
    const body = await request.json();

    const scheduleId = typeof body?.id === 'string' ? body.id : '';

    if (!scheduleId) {
      return NextResponse.json({ error: 'Schedule id is required' }, { status: 400 });
    }

    const basePayload = {
      match_date: typeof body?.match_date === 'string' ? body.match_date : null,
      start_time: typeof body?.start_time === 'string' ? body.start_time : null,
      end_time: typeof body?.end_time === 'string' ? body.end_time : null,
      location: typeof body?.location === 'string' ? body.location : null,
      max_participants: typeof body?.max_participants === 'number' ? body.max_participants : null,
      description: typeof body?.description === 'string' ? body.description : null,
      updated_by: user.id,
    };

      const cookieHeader = request.headers.get('cookie') || '';
      const activeClubIdMatch = cookieHeader.match(/(?:^|;\s*)active_club_id=([^;]*)/);
      const activeClubId = activeClubIdMatch ? decodeURIComponent(activeClubIdMatch[1]) : null;

      let updateQuery = adminSupabase
        .from('match_schedules')
        .update({
          ...basePayload,
          schedule_source: normalizeScheduleSource(body?.schedule_source),
        })
        .eq('id', scheduleId);
        
      if (activeClubId) {
        updateQuery = updateQuery.eq('club_id', activeClubId);
      }
      
      let updateResult = await updateQuery.select('*').single();

    if ((updateResult.error as { code?: string } | null)?.code === '42703') {
      let fallbackQuery = adminSupabase
        .from('match_schedules')
        .update(basePayload)
        .eq('id', scheduleId);
        
      if (activeClubId) {
        fallbackQuery = fallbackQuery.eq('club_id', activeClubId);
      }
      
      updateResult = await fallbackQuery.select('*').single();
    }

    const { data, error } = updateResult;

    if (error) {
      console.error('Admin match schedule update error:', error);
      return NextResponse.json({ error: 'Failed to update match schedule' }, { status: 500 });
    }

    return NextResponse.json({
      schedule: {
        ...data,
        schedule_source: inferScheduleSource(data),
      },
    });
  } catch (error) {
    console.error('Admin match schedule PATCH API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminContext = await requireScheduleManager();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const { adminSupabase, user, activeClubId } = adminContext;
    const body = await request.json().catch(() => null);
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'auto_generate') {
      try {
        const result = await ensureFiveMatches(user.id);
        return NextResponse.json({
          success: true,
          ...result
        });
      } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Failed to auto generate matches' }, { status: 400 });
      }
    }

    if (action === 'create_schedule') {
      const matchDate = typeof body?.match_date === 'string' ? body.match_date : '';
      const startTime = typeof body?.start_time === 'string' ? body.start_time : '';
      const endTime = typeof body?.end_time === 'string' ? body.end_time : '';
      const location = typeof body?.location === 'string' ? body.location.trim() : '';
      const maxParticipants =
        typeof body?.max_participants === 'number' && Number.isFinite(body.max_participants)
          ? Math.max(1, Math.floor(body.max_participants))
          : 20;
      const scheduleSource = normalizeScheduleSource(body?.schedule_source);
      const rawDescription = typeof body?.description === 'string' ? body.description : '';

      if (!matchDate || !startTime || !endTime || !location) {
        return NextResponse.json({ error: 'Required fields are missing' }, { status: 400 });
      }

      const { data: existingSlot, error: existingSlotError } = await adminSupabase
        .from('match_schedules')
        .select('id')
        .eq('match_date', matchDate)
        .eq('start_time', startTime)
        .eq('end_time', endTime)
        .eq('location', location)
        .limit(1)
        .maybeSingle();

      if (existingSlotError) {
        console.error('Admin schedule duplicate check error:', existingSlotError);
        return NextResponse.json({ error: 'Failed to validate duplicate schedule' }, { status: 500 });
      }

      if (existingSlot) {
        return NextResponse.json({ error: 'Duplicate slot already exists' }, { status: 409 });
      }

      const cookieHeader = request.headers.get('cookie') || '';
      const activeClubIdMatch = cookieHeader.match(/(?:^|;\s*)active_club_id=([^;]*)/);
      const activeClubId = activeClubIdMatch ? decodeURIComponent(activeClubIdMatch[1]) : null;

      const basePayload = {
        club_id: activeClubId || undefined,
        match_date: matchDate,
        start_time: startTime,
        end_time: endTime,
        location,
        max_participants: maxParticipants,
        current_participants: 0,
        status: 'scheduled',
        description: decorateDescriptionForScheduleSource(rawDescription, scheduleSource),
        created_by: user.id,
        updated_by: user.id,
      };

      let insertResult = await adminSupabase
        .from('match_schedules')
        .insert({
          ...basePayload,
          schedule_source: scheduleSource,
        })
        .select('*')
        .single();

      if ((insertResult.error as { code?: string } | null)?.code === '42703') {
        insertResult = await adminSupabase
          .from('match_schedules')
          .insert(basePayload)
          .select('*')
          .single();
      }

      if (insertResult.error) {
        const insertError = insertResult.error as { code?: string; message?: string };

        if (insertError.code === '23505') {
          return NextResponse.json({ error: 'Duplicate slot already exists' }, { status: 409 });
        }

        console.error('Admin schedule create error:', insertResult.error);
        return NextResponse.json({ error: 'Failed to create match schedule' }, { status: 500 });
      }

      return NextResponse.json({
        schedule: {
          ...insertResult.data,
          schedule_source: inferScheduleSource(insertResult.data),
        },
      });
    }

    const scheduleId = typeof body?.scheduleId === 'string' ? body.scheduleId : '';
    const targetUserId = typeof body?.targetUserId === 'string' ? body.targetUserId : user.id;

    if (!['join', 'add_participant', 'add_participants'].includes(action) || !scheduleId) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (action === 'add_participants') {
      const rawTargetUserIds: unknown[] = Array.isArray(body?.targetUserIds) ? body.targetUserIds : [];
      const requestedUserIds: string[] = Array.from(
        new Set(rawTargetUserIds.filter((value): value is string => typeof value === 'string' && value.length > 0))
      );
      if (requestedUserIds.length === 0) {
        return NextResponse.json({ error: 'No target users specified' }, { status: 400 });
      }

      // Superadmins use an unfiltered service client, so club_id is not injected
      // by withClubFilter. Participants must always inherit their schedule's club.
      const { data: schedule, error: scheduleError } = await getUnfilteredGlobalAdminClient()
        .from('match_schedules')
        .select('id, club_id')
        .eq('id', scheduleId)
        .maybeSingle();

      if (scheduleError) {
        console.error('Admin batch schedule lookup error:', scheduleError);
        return NextResponse.json({ error: 'Failed to validate match schedule' }, { status: 500 });
      }

      if (!schedule?.club_id) {
        return NextResponse.json({ error: 'Match schedule has no club assigned' }, { status: 400 });
      }

      if (activeClubId && schedule.club_id !== activeClubId) {
        return NextResponse.json({ error: 'Match schedule is outside the active club' }, { status: 403 });
      }

      const [byUserId, byId] = await Promise.all([
        adminSupabase.from('profiles').select('id, user_id, username, full_name').in('user_id', requestedUserIds),
        adminSupabase.from('profiles').select('id, user_id, username, full_name').in('id', requestedUserIds)
      ]);

      const profilesError = byUserId.error || byId.error;
      const profilesData = [
        ...(byUserId.data || []),
        ...(byId.data || [])
      ].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);

      if (profilesError) {
        console.error('Admin batch profiles query error:', profilesError);
        return NextResponse.json({ error: 'Failed to validate participants' }, { status: 500 });
      }

      // Some older callers send auth.users IDs while match_participants stores
      // profiles.id. Resolve both forms to profiles.id before writing.
      const targetUserIds = Array.from(
        new Set(profilesData.map((profile) => profile.id).filter((id): id is string => typeof id === 'string' && id.length > 0))
      );
      if (targetUserIds.length === 0) {
        return NextResponse.json({ error: 'No matching member profiles found' }, { status: 400 });
      }

      const { data: existingParticipants, error: existingParticipantsError } = await adminSupabase
        .from('match_participants')
        .select('id, user_id')
        .eq('match_schedule_id', scheduleId)
        .in('user_id', targetUserIds);

      if (existingParticipantsError) {
        console.error('Admin batch participant lookup error:', existingParticipantsError);
        return NextResponse.json({ error: 'Failed to check existing participants' }, { status: 500 });
      }

      const existingUserIds = new Set((existingParticipants || []).map((participant) => participant.user_id));
      const newUserIds = targetUserIds.filter((userId) => !existingUserIds.has(userId));
      const registeredAt = new Date().toISOString();

      if (existingUserIds.size > 0) {
        const { error: restoreError } = await adminSupabase
          .from('match_participants')
          .update({ status: 'registered', registered_at: registeredAt })
          .eq('match_schedule_id', scheduleId)
          .in('user_id', Array.from(existingUserIds));

        if (restoreError) {
          console.error('Admin batch participant restore error:', restoreError);
          return NextResponse.json({ error: 'Failed to restore participants' }, { status: 500 });
        }
      }

      let insertedParticipants: Array<{ id: string; match_schedule_id: string; user_id: string; registered_at: string; status: string }> = [];
      if (newUserIds.length > 0) {
        const { data, error: insertError } = await adminSupabase
          .from('match_participants')
          .insert(newUserIds.map((userId) => ({
            match_schedule_id: scheduleId,
            user_id: userId,
            club_id: schedule.club_id,
            status: 'registered',
            registered_at: registeredAt,
          })))
          .select('id, match_schedule_id, user_id, registered_at, status');

        if (insertError) {
          console.error('Admin match participants batch insert error:', insertError);
          return NextResponse.json(
            {
              error: 'Failed to add participants',
              detail: insertError.message,
              code: insertError.code,
            },
            { status: 500 }
          );
        }

        insertedParticipants = data || [];
      }

      const profilesMap = (profilesData || []).reduce<Record<string, any>>((acc, profile) => {
        const mappedProfile = {
          username: profile.username ?? undefined,
          full_name: profile.full_name ?? undefined,
        };
        if (profile.id) acc[profile.id] = mappedProfile;
        if (profile.user_id) acc[profile.user_id] = mappedProfile;
        return acc;
      }, {});

      const { count, error: countError } = await adminSupabase
        .from('match_participants')
        .select('*', { count: 'exact', head: true })
        .eq('match_schedule_id', scheduleId)
        .in('status', ['registered', 'attended']);

      if (countError) {
        console.error('Admin match participant count error:', countError);
        return NextResponse.json({ error: 'Failed to update participant count' }, { status: 500 });
      }

      await adminSupabase
        .from('match_schedules')
        .update({ current_participants: count || 0 })
        .eq('id', scheduleId);

      const restoredParticipants = (existingParticipants || []).map((participant) => ({
        ...participant,
        match_schedule_id: scheduleId,
        registered_at: registeredAt,
        status: 'registered',
      }));

      const participantsWithProfiles = [...restoredParticipants, ...insertedParticipants].map((participant) => ({
        ...participant,
        profiles: profilesMap[participant.user_id] || profilesMap[participant.id] || undefined,
      }));

      return NextResponse.json({
        participants: participantsWithProfiles,
        currentParticipants: count || 0,
      });
    }

    if (!targetUserId) {
      return NextResponse.json({ error: 'Target user id is required' }, { status: 400 });
    }

    const { data: existingParticipant, error: existingParticipantError } = await adminSupabase
      .from('match_participants')
      .select('id, status, registered_at')
      .eq('match_schedule_id', scheduleId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (existingParticipantError) {
      console.error('Admin match participant lookup error:', existingParticipantError);
      return NextResponse.json({ error: 'Failed to check participation' }, { status: 500 });
    }

    if (existingParticipant?.status === 'registered') {
      return NextResponse.json({ error: 'Already registered' }, { status: 409 });
    }

    let participant;

    if (existingParticipant) {
      const { data, error } = await adminSupabase
        .from('match_participants')
        .update({
          status: 'registered',
          registered_at: new Date().toISOString(),
        })
        .eq('id', existingParticipant.id)
        .select('id, match_schedule_id, user_id, registered_at, status')
        .single();

      if (error) {
        console.error('Admin match participant re-register error:', error);
        return NextResponse.json({ error: 'Failed to register for match' }, { status: 500 });
      }

      participant = data;
    } else {
      const { data, error } = await adminSupabase
        .from('match_participants')
        .insert({
          match_schedule_id: scheduleId,
          user_id: targetUserId,
          status: 'registered',
        })
        .select('id, match_schedule_id, user_id, registered_at, status')
        .single();

      if (error) {
        console.error('Admin match participant insert error:', error);
        return NextResponse.json({ error: 'Failed to register for match' }, { status: 500 });
      }

      participant = data;
    }

    const { data: participantProfile } = await adminSupabase
      .from('profiles')
      .select('id, user_id, username, full_name')
      .or(`id.eq.${targetUserId},user_id.eq.${targetUserId}`)
      .limit(1)
      .maybeSingle();

    const { count, error: countError } = await adminSupabase
      .from('match_participants')
      .select('*', { count: 'exact', head: true })
      .eq('match_schedule_id', scheduleId)
      .in('status', ['registered', 'attended']);

    if (countError) {
      console.error('Admin match participant count error:', countError);
      return NextResponse.json({ error: 'Failed to update participant count' }, { status: 500 });
    }

    await adminSupabase
      .from('match_schedules')
      .update({ current_participants: count || 0 })
      .eq('id', scheduleId);

    return NextResponse.json({
      participant: {
        ...participant,
        profiles: participantProfile
          ? {
              username: participantProfile.username ?? undefined,
              full_name: participantProfile.full_name ?? undefined,
            }
          : undefined,
      },
      currentParticipants: count || 0,
    });
  } catch (error) {
    console.error('Admin match schedules POST API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const adminContext = await requireScheduleManager();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const { adminSupabase, user } = adminContext;
    const body = await request.json().catch(() => null);
    const scheduleId = typeof body?.scheduleId === 'string' ? body.scheduleId : '';
    const targetUserId = typeof body?.targetUserId === 'string' ? body.targetUserId : user.id;
    const targetUserIds = Array.isArray(body?.targetUserIds)
      ? body.targetUserIds.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const resetAll = body?.resetAll === true;

    if (!scheduleId) {
      return NextResponse.json({ error: 'Schedule id is required' }, { status: 400 });
    }

    let participantMutation = adminSupabase
      .from('match_participants')
      .update({ status: 'cancelled' })
      .eq('match_schedule_id', scheduleId)
      .in('status', ['registered', 'attended']);

    if (resetAll) {
      // no additional filter
    } else if (targetUserIds.length > 0) {
      participantMutation = participantMutation.in('user_id', targetUserIds);
    } else if (targetUserId) {
      participantMutation = participantMutation.eq('user_id', targetUserId);
    } else {
      return NextResponse.json({ error: 'Target user id is required' }, { status: 400 });
    }

    const { error } = await participantMutation;

    if (error) {
      console.error('Admin match participant cancel error:', error);
      return NextResponse.json({ error: 'Failed to cancel participation' }, { status: 500 });
    }

    const { count, error: countError } = await adminSupabase
      .from('match_participants')
      .select('*', { count: 'exact', head: true })
      .eq('match_schedule_id', scheduleId)
      .in('status', ['registered', 'attended']);

    if (countError) {
      console.error('Admin match participant recount error:', countError);
      return NextResponse.json({ error: 'Failed to update participant count' }, { status: 500 });
    }

    await adminSupabase
      .from('match_schedules')
      .update({ current_participants: count || 0 })
      .eq('id', scheduleId);

    return NextResponse.json({ currentParticipants: count || 0 });
  } catch (error) {
    console.error('Admin match schedules DELETE API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

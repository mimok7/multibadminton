import { NextResponse } from 'next/server';
import { getProfileByUserId, getUserRole } from '@/lib/auth';
import { getKoreaDate } from '@/lib/date';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

type ProfileLite = {
  id: string;
  user_id: string | null;
  username: string | null;
  full_name: string | null;
  coin_balance: number | null;
  skill_level: string;
};

type ChallengeRow = {
  id: string;
  challenge_date: string;
  challenger_id: string;
  partner_id: string;
  opponent1_id: string;
  opponent2_id: string;
  status: string;
  partner_response: string;
  opponent1_response: string;
  opponent2_response: string;
  note: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

type PlayerEligibility = {
  id: string;
  name: string;
  coin_balance: number | null;
  skill_level: string;
  today_match_count: number;
};

function getProfileName(profile?: ProfileLite | null) {
  return profile?.full_name || profile?.username || '선수';
}

async function getTodayChallengePool(adminSupabase: ReturnType<typeof getSupabaseAdminClient>, today: string, clubId: string) {
  const { data: attendanceRows, error: attendanceError } = await adminSupabase
    .from('attendances')
    .select('user_id')
    .eq('attended_at', today)
    .eq('status', 'present')
    .eq('club_id', clubId);

  if (attendanceError) {
    throw new Error(attendanceError.message);
  }

  const presentUserIds = Array.from(
    new Set((attendanceRows || []).map((row) => row.user_id).filter((value): value is string => Boolean(value))),
  );

  if (presentUserIds.length === 0) {
    return {
      eligibilityMap: new Map<string, PlayerEligibility>(),
      profilesById: new Map<string, ProfileLite>(),
    };
  }

  const { data: assignedSchedules, error: assignedSchedulesError } = await adminSupabase
    .from('match_schedules')
    .select('id, generated_match_id, status')
    .eq('match_date', today)
    .eq('club_id', clubId)
    .in('status', ['scheduled', 'in_progress']);

  if (assignedSchedulesError) {
    throw new Error(assignedSchedulesError.message);
  }

  const assignedScheduleIds = (assignedSchedules || [])
    .map((schedule) => schedule.id)
    .filter((value): value is string => Boolean(value));
  const assignedGeneratedMatchIds = Array.from(
    new Set(
      (assignedSchedules || [])
        .map((schedule) => schedule.generated_match_id)
        .filter((value): value is number => typeof value === 'number'),
    ),
  );

  let blockedUserIds = new Set<string>();

  // 1. 일반 경기(generated_matches) 중 현재 대기/진행 중인 경기에 배정된 선수들 차단
  if (assignedGeneratedMatchIds.length > 0) {
    const { data: generatedMatches, error: generatedMatchesError } = await adminSupabase
      .from('generated_matches')
      .select('team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id')
      .in('id', assignedGeneratedMatchIds);

    if (generatedMatchesError) {
      throw new Error(generatedMatchesError.message);
    }

    (generatedMatches || []).forEach((match) => {
      [
        match.team1_player1_id,
        match.team1_player2_id,
        match.team2_player1_id,
        match.team2_player2_id,
      ]
        .filter((value): value is string => Boolean(value))
        .forEach((value) => blockedUserIds.add(value));
    });
  }

  // 2. 오늘 날짜의 대회 경기(tournament_matches) 중 대기(pending) 또는 진행 중(in_progress)인 경기에 배정된 선수들 차단
  const { data: todayTournaments, error: tournamentsError } = await adminSupabase
    .from('tournaments')
    .select('id')
    .eq('tournament_date', today);

  if (tournamentsError) {
    throw new Error(tournamentsError.message);
  }

  if (todayTournaments && todayTournaments.length > 0) {
    const tournamentIds = todayTournaments.map((t) => t.id);
    const { data: activeTournamentMatches, error: activeMatchesError } = await adminSupabase
      .from('tournament_matches')
      .select('team1, team2')
      .in('tournament_id', tournamentIds)
      .in('status', ['pending', 'in_progress']);

    if (activeMatchesError) {
      throw new Error(activeMatchesError.message);
    }

    if (activeTournamentMatches && activeTournamentMatches.length > 0) {
      const activePlayerNames = new Set<string>();
      activeTournamentMatches.forEach((m) => {
        (m.team1 || []).forEach((name) => activePlayerNames.add(name.trim()));
        (m.team2 || []).forEach((name) => activePlayerNames.add(name.trim()));
      });

      if (activePlayerNames.size > 0) {
        const { data: playerProfiles, error: profilesLookupError } = await adminSupabase
          .from('profiles')
          .select('id')
          .in('full_name', Array.from(activePlayerNames));

        if (profilesLookupError) {
          throw new Error(profilesLookupError.message);
        }

        if (playerProfiles) {
          playerProfiles.forEach((p) => blockedUserIds.add(p.id));
        }
      }
    }
  }

  const { data: challengeRows, error: challengeRowsError } = await adminSupabase
    .from('challenge_requests')
    .select('challenger_id, partner_id, opponent1_id, opponent2_id, status')
    .eq('challenge_date', today)
    .eq('club_id', clubId)
    .in('status', ['pending', 'accepted']);

  if (challengeRowsError) {
    throw new Error(challengeRowsError.message);
  }

  const challengeBlockedUserIds = new Set<string>();
  (challengeRows || []).forEach((row) => {
    [row.challenger_id, row.partner_id, row.opponent1_id, row.opponent2_id]
      .filter((value): value is string => Boolean(value))
      .forEach((value) => challengeBlockedUserIds.add(value));
  });

  const eligibleUserIds = presentUserIds.filter(
    (userId) => !blockedUserIds.has(userId) && !challengeBlockedUserIds.has(userId),
  );

  const profileIdsForLookup = presentUserIds;

  if (profileIdsForLookup.length === 0) {
    return {
      eligibilityMap: new Map<string, PlayerEligibility>(),
      profilesById: new Map<string, ProfileLite>(),
    };
  }

  if (eligibleUserIds.length === 0) {
    const { data: profiles, error: profilesError } = await adminSupabase
      .from('profiles')
      .select('id, user_id, username, full_name, coin_balance, skill_level')
      .in('id', profileIdsForLookup);

    if (profilesError) {
      throw new Error(profilesError.message);
    }

    const profilesById = new Map<string, ProfileLite>();
    (profiles || []).forEach((profile) => {
      profilesById.set(profile.id, profile);
    });

    return {
      eligibilityMap: new Map<string, PlayerEligibility>(),
      profilesById,
    };
  }

  const { data: profiles, error: profilesError } = await adminSupabase
    .from('profiles')
    .select('id, user_id, username, full_name, coin_balance, skill_level')
    .in('id', profileIdsForLookup);

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const profilesById = new Map<string, ProfileLite>();
  (profiles || []).forEach((profile) => {
    profilesById.set(profile.id, profile);
  });

  const eligibilityMap = new Map<string, PlayerEligibility>();

  eligibleUserIds.forEach((profileId) => {
    const profile = profilesById.get(profileId);
    if (!profile) {
      return;
    }

    eligibilityMap.set(profileId, {
      id: profile.id,
      name: getProfileName(profile),
      coin_balance: profile.coin_balance ?? null,
      skill_level: profile.skill_level,
      today_match_count: 0,
    });
  });

  return {
    eligibilityMap,
    profilesById,
    blockedByMatchUserIds: blockedUserIds,
    blockedByChallengeUserIds: challengeBlockedUserIds,
  };
}

function serializeChallenge(
  challenge: ChallengeRow,
  profilesById: Map<string, ProfileLite>,
  currentProfileId: string,
) {
  const challenger = profilesById.get(challenge.challenger_id) || null;
  const partner = profilesById.get(challenge.partner_id) || null;
  const opponent1 = profilesById.get(challenge.opponent1_id) || null;
  const opponent2 = profilesById.get(challenge.opponent2_id) || null;

  const myResponse =
    currentProfileId === challenge.partner_id
      ? challenge.partner_response
      : currentProfileId === challenge.opponent1_id
        ? challenge.opponent1_response
        : currentProfileId === challenge.opponent2_id
          ? challenge.opponent2_response
          : null;

  return {
    id: challenge.id,
    challenge_date: challenge.challenge_date,
    status: challenge.status,
    note: challenge.note,
    created_at: challenge.created_at,
    responded_at: challenge.responded_at,
    challenger: challenger
      ? { id: challenger.id, name: getProfileName(challenger), coin_balance: challenger.coin_balance ?? null }
      : null,
    partner: partner
      ? { id: partner.id, name: getProfileName(partner), coin_balance: partner.coin_balance ?? null, response: challenge.partner_response }
      : null,
    opponents: [opponent1, opponent2]
      .map((profile, index) =>
        profile
          ? {
              id: profile.id,
              name: getProfileName(profile),
              coin_balance: profile.coin_balance ?? null,
              response: index === 0 ? challenge.opponent1_response : challenge.opponent2_response,
            }
          : null,
      )
      .filter(Boolean),
    my_response: myResponse,
    can_respond: Boolean(myResponse && myResponse === 'pending'),
  };
}

export async function GET() {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = getSupabaseAdminClient();

  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clubId = await getActiveClubId();
  if (!clubId) {
    return NextResponse.json({
      currentProfile: { id: '', name: '', coin_balance: 0, eligible: false, ineligible_reason: null, isAdmin: false },
      eligiblePlayers: [],
      incomingChallenges: [],
      outgoingChallenges: [],
    });
  }

  const currentProfile = await getProfileByUserId(serverSupabase, user.id);

  if (!currentProfile) {
    return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
  }

  const userRole = await getUserRole(serverSupabase, user);
  const isAdmin = ['admin', 'manager'].includes(userRole || '');

  try {
    const today = getKoreaDate();
    const {
      eligibilityMap,
      profilesById,
      blockedByMatchUserIds = new Set<string>(),
      blockedByChallengeUserIds = new Set<string>(),
    } = await getTodayChallengePool(adminSupabase, today, clubId);

    const eligiblePlayers = Array.from(eligibilityMap.values())
      .filter((player) => player.id !== currentProfile.id)
      .sort((left, right) => left.name.localeCompare(right.name, 'ko'));

    const { data: challengeRows, error: challengesError } = await adminSupabase
      .from('challenge_requests')
      .select('*')
      .eq('challenge_date', today)
      .eq('club_id', clubId)
      .or(
        [
          `challenger_id.eq.${currentProfile.id}`,
          `partner_id.eq.${currentProfile.id}`,
          `opponent1_id.eq.${currentProfile.id}`,
          `opponent2_id.eq.${currentProfile.id}`,
        ].join(','),
      )
      .order('created_at', { ascending: false });

    if (challengesError) {
      throw new Error(challengesError.message);
    }

    const serializedChallenges = (challengeRows || []).map((challenge) =>
      serializeChallenge(challenge as ChallengeRow, profilesById, currentProfile.id),
    );

    const currentBlockedByChallenge = blockedByChallengeUserIds.has(currentProfile.id);
    const currentBlockedByMatch = blockedByMatchUserIds.has(currentProfile.id);

    return NextResponse.json({
      currentProfile: {
        id: currentProfile.id,
        name: currentProfile.full_name || currentProfile.username || '회원',
        coin_balance: currentProfile.coin_balance ?? 0,
        eligible: eligibilityMap.has(currentProfile.id),
        ineligible_reason: currentBlockedByChallenge
          ? 'challenge_pending_or_accepted'
          : currentBlockedByMatch
            ? 'in_progress_match'
            : null,
        isAdmin,
      },
      eligiblePlayers,
      incomingChallenges: serializedChallenges.filter((challenge) => challenge.challenger?.id !== currentProfile.id),
      outgoingChallenges: serializedChallenges.filter((challenge) => challenge.challenger?.id === currentProfile.id),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '게임 제안 데이터를 불러오지 못했습니다.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = getSupabaseAdminClient();

  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clubId = await getActiveClubId();
  if (!clubId) {
    return NextResponse.json({ error: '선택된 클럽이 없습니다.' }, { status: 400 });
  }

  const currentProfile = await getProfileByUserId(serverSupabase, user.id);

  if (!currentProfile) {
    return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const partnerId = String(body?.partner_id || '').trim();
  const opponent1Id = String(body?.opponent1_id || '').trim();
  const opponent2Id = String(body?.opponent2_id || '').trim();
  const note = typeof body?.note === 'string' ? body.note.trim() : null;

  if (!partnerId || !opponent1Id || !opponent2Id) {
    return NextResponse.json({ error: '파트너와 상대 2명을 모두 선택해주세요.' }, { status: 400 });
  }

  const selectedIds = [partnerId, opponent1Id, opponent2Id];
  const uniqueIds = new Set([currentProfile.id, ...selectedIds]);

  if (uniqueIds.size !== 4) {
    return NextResponse.json({ error: '도전 멤버는 모두 다른 선수여야 합니다.' }, { status: 400 });
  }

  try {
    const today = getKoreaDate();
    const { eligibilityMap, profilesById } = await getTodayChallengePool(adminSupabase, today, clubId);

    if (!eligibilityMap.has(currentProfile.id)) {
      return NextResponse.json(
        { error: '현재 회원님은 아직 대기/진행중 게임이 있어 게임 제안을 할 수 없습니다.' },
        { status: 400 },
      );
    }

    if (!eligibilityMap.has(partnerId)) {
      return NextResponse.json({ error: '선택하신 파트너는 아직 대기/진행중 게임이 있습니다.' }, { status: 400 });
    }

    if (!eligibilityMap.has(opponent1Id) || !eligibilityMap.has(opponent2Id)) {
      return NextResponse.json({ error: '선택하신 상대 선수 중 아직 대기/진행중 게임이 있는 분이 있습니다.' }, { status: 400 });
    }

    const { data: existingChallenge } = await adminSupabase
      .from('challenge_requests')
      .select('id')
      .eq('challenge_date', today)
      .eq('challenger_id', currentProfile.id)
      .eq('partner_id', partnerId)
      .eq('opponent1_id', opponent1Id)
      .eq('opponent2_id', opponent2Id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingChallenge) {
      return NextResponse.json({ error: '같은 구성의 대기 중인 게임 제안이 이미 있습니다.' }, { status: 400 });
    }

    const { data: insertedChallenge, error: insertError } = await adminSupabase
      .from('challenge_requests')
      .insert({
        challenge_date: today,
        challenger_id: currentProfile.id,
        partner_id: partnerId,
        opponent1_id: opponent1Id,
        opponent2_id: opponent2Id,
        note,
        club_id: clubId,
      })
      .select('*')
      .single();

    if (insertError || !insertedChallenge) {
      throw new Error(insertError?.message || '게임 제안 생성에 실패했습니다.');
    }

    const challengerName = currentProfile.full_name || currentProfile.username || '회원';
    const partnerName = getProfileName(profilesById.get(partnerId) || null);
    const opponentNames = [opponent1Id, opponent2Id]
      .map((profileId) => getProfileName(profilesById.get(profileId) || null))
      .join(', ');

    await adminSupabase.from('notifications').insert(
      [partnerId, opponent1Id, opponent2Id].map((profileId) => ({
        user_id: profileId,
        title: '새 게임 제안',
        message: `${challengerName}님이 ${partnerName}님과 함께 ${opponentNames}님에게 게임 제안을 보냈습니다. 게임 제안 페이지에서 수락 또는 보류를 선택해주세요.`,
        type: 'general',
        is_read: false,
        club_id: clubId,
      })),
    );

    return NextResponse.json({
      challenge: serializeChallenge(insertedChallenge as ChallengeRow, profilesById, currentProfile.id),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '게임 제안 생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}

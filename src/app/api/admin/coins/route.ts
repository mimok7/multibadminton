import { NextResponse } from 'next/server';
import { getProfileByUserId, getUserRole, isAdminRole } from '@/lib/auth';
import { getClubRole } from '@/lib/club-auth';
import { DEFAULT_COIN_SETTINGS, INITIAL_COIN_BALANCE, type CoinSettlementMode } from '@/lib/coins';
import { readCoinSettings, writeCoinSettings } from '@/lib/coin-settings';
import { getActiveClubId } from '@/lib/club';
import { getFilteredAdminClient, getSupabaseServerClient, getUnfilteredGlobalAdminClient } from '@/lib/supabase-server';

async function requireAdmin() {
  const clubId = await getActiveClubId();
  if (!clubId) {
    return { error: NextResponse.json({ error: 'Club not selected' }, { status: 400 }) };
  }

  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = await getFilteredAdminClient();
  const roleLookupClient = getUnfilteredGlobalAdminClient();
  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const [currentProfile, globalRole, clubRole] = await Promise.all([
    getProfileByUserId(roleLookupClient, user.id),
    getUserRole(roleLookupClient, user),
    getClubRole(roleLookupClient, user.id, clubId),
  ]);
  const canManageClub = isAdminRole(globalRole) || ['owner', 'admin'].includes(clubRole || '');

  if (!currentProfile || !canManageClub) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { adminSupabase, currentProfile, clubId };
}

export async function GET() {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase, currentProfile, clubId } = context;
  const coinSettings = await readCoinSettings();

  const { data: members, error: membersError } = await adminSupabase
    .from('club_members')
    .select('user_id, role, coin_balance, coin_wins, coin_losses')
    .eq('club_id', clubId)
    .eq('status', 'active');

  const profileIds = (members || []).map((member) => member.user_id).filter(Boolean);
  const [{ data: profileRows, error: profilesError }, { data: transactions, error: transactionsError }] = await Promise.all([
    profileIds.length > 0
      ? adminSupabase
        .from('profiles')
        .select('id, user_id, username, full_name, email, role, coin_updated_at')
        .in('id', profileIds)
      : Promise.resolve({ data: [], error: null }),
    adminSupabase
      .from('profile_coin_transactions')
      .select('id, profile_id, match_id, transaction_type, delta, wager_amount, team_side, team1_score, team2_score, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (membersError || profilesError || transactionsError) {
    return NextResponse.json(
      { error: membersError?.message || profilesError?.message || transactionsError?.message || '코인 데이터를 불러오지 못했습니다.' },
      { status: 500 }
    );
  }

  const profileById = new Map((profileRows || []).map((profile) => [profile.id, profile]));
  const profiles = (members || [])
    .map((member) => {
      const profile = profileById.get(member.user_id);
      if (!profile) return null;
      return {
        ...profile,
        role: member.role,
        coin_balance: member.coin_balance ?? 0,
        coin_wins: member.coin_wins ?? 0,
        coin_losses: member.coin_losses ?? 0,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (right?.coin_balance ?? 0) - (left?.coin_balance ?? 0) || (left?.full_name || '').localeCompare(right?.full_name || ''));

  return NextResponse.json({
    initialCoinBalance: INITIAL_COIN_BALANCE,
    coinSettings,
    profiles: profiles || [],
    transactions: transactions || [],
    currentUser: currentProfile,
  });
}

export async function POST(request: Request) {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase, clubId } = context;
  const body = await request.json().catch(() => null);
  const action = String(body?.action || '');

  if (action === 'adjust') {
    const profileId = String(body?.profile_id || '');
    const delta = Number(body?.delta);

    if (!profileId || !Number.isFinite(delta) || !Number.isInteger(delta)) {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    const { data: member, error: memberError } = await adminSupabase
      .from('club_members')
      .select('coin_balance')
      .eq('club_id', clubId)
      .eq('user_id', profileId)
      .eq('status', 'active')
      .single();

    if (memberError || !member) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    const nextBalance = Math.max(0, (member.coin_balance ?? 0) + delta);

    const { error } = await adminSupabase
      .from('club_members')
      .update({
        coin_balance: nextBalance,
      })
      .eq('club_id', clubId)
      .eq('user_id', profileId)
      .eq('status', 'active');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile_id: profileId, coin_balance: nextBalance });
  }

  if (action === 'set') {
    const profileId = String(body?.profile_id || '');
    const coinBalance = Number(body?.coin_balance);

    if (!profileId || !Number.isFinite(coinBalance) || !Number.isInteger(coinBalance) || coinBalance < 0) {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    const { error } = await adminSupabase
      .from('club_members')
      .update({ coin_balance: coinBalance })
      .eq('club_id', clubId)
      .eq('user_id', profileId)
      .eq('status', 'active');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile_id: profileId, coin_balance: coinBalance });
  }

  if (action === 'reset_all') {
    const coinSettings = await readCoinSettings();
    const coinBalance = Number(body?.coin_balance ?? coinSettings.initialCoinBalance);

    if (!Number.isFinite(coinBalance) || !Number.isInteger(coinBalance) || coinBalance < 0) {
      return NextResponse.json({ error: '잘못된 코인 값입니다.' }, { status: 400 });
    }

    const { error } = await adminSupabase
      .from('club_members')
      .update({ coin_balance: coinBalance })
      .eq('club_id', clubId)
      .eq('status', 'active');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ coin_balance: coinBalance });
  }

  if (action === 'update_settings') {
    const initialCoinBalance = Number(body?.initialCoinBalance ?? DEFAULT_COIN_SETTINGS.initialCoinBalance);
    const fixedWinnerReward = Number(body?.fixedWinnerReward ?? DEFAULT_COIN_SETTINGS.fixedWinnerReward);
    const attendanceReward = Number(body?.attendanceReward ?? DEFAULT_COIN_SETTINGS.attendanceReward);
    const guestInitialCoin = Number(body?.guestInitialCoin ?? DEFAULT_COIN_SETTINGS.guestInitialCoin);
    const guestAttendanceReward = Number(body?.guestAttendanceReward ?? DEFAULT_COIN_SETTINGS.guestAttendanceReward);
    const settlementModeValue = String(body?.settlementMode || DEFAULT_COIN_SETTINGS.settlementMode);
    const isCoinEnabled = typeof body?.isCoinEnabled === 'boolean' ? body.isCoinEnabled : DEFAULT_COIN_SETTINGS.isCoinEnabled;

    if (!Number.isFinite(initialCoinBalance) || !Number.isInteger(initialCoinBalance) || initialCoinBalance < 0) {
      return NextResponse.json({ error: '시작 코인은 0 이상의 정수여야 합니다.' }, { status: 400 });
    }

    if (!Number.isFinite(fixedWinnerReward) || !Number.isInteger(fixedWinnerReward) || fixedWinnerReward < 0) {
      return NextResponse.json({ error: '승자 보상 코인은 0 이상의 정수여야 합니다.' }, { status: 400 });
    }

    if (!Number.isFinite(attendanceReward) || !Number.isInteger(attendanceReward) || attendanceReward < 0) {
      return NextResponse.json({ error: '출석 보상 코인은 0 이상의 정수여야 합니다.' }, { status: 400 });
    }

    if (!Number.isFinite(guestInitialCoin) || !Number.isInteger(guestInitialCoin) || guestInitialCoin < 0) {
      return NextResponse.json({ error: '게스트 시작 코인은 0 이상의 정수여야 합니다.' }, { status: 400 });
    }

    if (!Number.isFinite(guestAttendanceReward) || !Number.isInteger(guestAttendanceReward) || guestAttendanceReward < 0) {
      return NextResponse.json({ error: '게스트 출석 보상 코인은 0 이상의 정수여야 합니다.' }, { status: 400 });
    }

    if (!['zero_sum', 'winner_only_pool', 'winner_only_fixed'].includes(settlementModeValue)) {
      return NextResponse.json({ error: '지원하지 않는 코인 정산 모드입니다.' }, { status: 400 });
    }

    const settlementMode = settlementModeValue as CoinSettlementMode;

    const coinSettings = await writeCoinSettings({
      initialCoinBalance,
      settlementMode,
      fixedWinnerReward,
      attendanceReward,
      guestInitialCoin,
      guestAttendanceReward,
      isCoinEnabled,
    });

    return NextResponse.json({ coinSettings });
  }

  if (action === 'clear_transactions') {
    const { data, error } = await adminSupabase
      .from('profile_coin_transactions')
      .delete()
      .not('id', 'is', null)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ clearedCount: data?.length || 0 });
  }

  return NextResponse.json({ error: '지원하지 않는 작업입니다.' }, { status: 400 });
}

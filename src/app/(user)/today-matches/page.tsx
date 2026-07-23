'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { formatKSTDate, formatTimeHHmm, getKoreaDate } from '@/lib/date';
import { formatNameWithCoins } from '@/lib/player-display';
import { fetchScheduledMatchesForDate, type ScheduledMatchView } from '@/lib/scheduled-matches';
import { getSupabaseClient } from '@/lib/supabase';
import { getFriendlyErrorMessage } from '@/lib/utils';
import { useClub } from '@/hooks/useClub';

function getMatchStatusMeta(status?: string | null) {
  if (status === 'completed') {
    return {
      label: '완료',
      chipClass: 'bg-emerald-100 text-emerald-700',
    };
  }

  if (status === 'in_progress') {
    return {
      label: '진행중',
      chipClass: 'bg-amber-100 text-amber-700',
    };
  }

  if (status === 'cancelled') {
    return {
      label: '취소',
      chipClass: 'bg-rose-100 text-rose-700',
    };
  }

  return {
    label: '대기',
    chipClass: 'bg-slate-100 text-slate-700',
  };
}

function getMatchOutcomeMeta(
  status?: string | null,
  winner?: 'team1' | 'team2' | null,
  team: 'team1' | 'team2' = 'team1',
) {
  if (status !== 'completed' || !winner) {
    return null;
  }

  const isWinner = winner === team;

  return isWinner
    ? { label: '승', icon: '🏆', chipClass: 'bg-emerald-100 text-emerald-700' }
    : { label: '패', icon: '✕', chipClass: 'bg-slate-100 text-slate-600' };
}

function getDisplayMatchLabel(match: ScheduledMatchView, fallbackOrder: number) {
  const description = match.description?.trim();
  if (description) {
    return description.replace(/^\[일반 경기\]\s*/u, '');
  }

  return `게임 #${fallbackOrder}`;
}




export default function TodayMatches() {
  const { user, profile, loading: userLoading, isAdmin } = useUser();
  const { clubRole } = useClub();
  const [matches, setMatches] = useState<ScheduledMatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [startSaving, setStartSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const canManageActiveClub = ['owner', 'admin', 'manager', '관리자', '매니저', '운영자']
    .includes(String(clubRole || '').trim().toLowerCase());
  const [activeTab, setActiveTab] = useState<'schedule' | 'ranking'>('schedule');
  const [watchModalUrl, setWatchModalUrl] = useState<string | null>(null);
  const router = useRouter();
  const supabase = getSupabaseClient();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadTodayMatches();
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };

  const loadTodayMatches = async () => {
    if (!user) {
      setMatches([]);
      return;
    }

    const today = getKoreaDate();
    const todayMatches = await fetchScheduledMatchesForDate(supabase, today);
    setMatches(todayMatches);
  };

  useEffect(() => {
    if (userLoading) return;

    if (!user) {
      setMatches([]);
      setLoading(false);
      return;
    }

    const fetchTodayMatches = async () => {
      try {
        await loadTodayMatches();
      } catch (error) {
        console.error('데이터 조회 중 오류:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTodayMatches();
  }, [userLoading, user?.id, supabase]);

  const rankings = useMemo(() => {
    interface PlayerStats {
      id: string;
      name: string;
      gender: string | null;
      coin_balance: number | null;
      wins: number;
      losses: number;
      draws: number;
      played: number;
      winRate: number;
    }

    const statsMap = new Map<string, PlayerStats>();

    const ensurePlayer = (id: string, name: string, gender: string | null | undefined, coin_balance: number | null | undefined) => {
      if (!statsMap.has(id)) {
        statsMap.set(id, { id, name, gender: gender ?? null, coin_balance: coin_balance ?? null, wins: 0, losses: 0, draws: 0, played: 0, winRate: 0 });
      }
      return statsMap.get(id)!;
    };

    matches.forEach(match => {
      if (match.status === 'completed' && match.match_result?.winner) {
        const winner = match.match_result.winner;
        
        const team1 = [
          { id: match.team1_player1, name: match.team1_player1_name, gender: match.team1_player1_gender, coin: match.team1_player1_coin_balance },
          { id: match.team1_player2, name: match.team1_player2_name, gender: match.team1_player2_gender, coin: match.team1_player2_coin_balance }
        ].filter(p => p.id);

        const team2 = [
          { id: match.team2_player1, name: match.team2_player1_name, gender: match.team2_player1_gender, coin: match.team2_player1_coin_balance },
          { id: match.team2_player2, name: match.team2_player2_name, gender: match.team2_player2_gender, coin: match.team2_player2_coin_balance }
        ].filter(p => p.id);

        team1.forEach(p => {
          const stats = ensurePlayer(p.id!, p.name!, p.gender, p.coin);
          stats.played += 1;
          if (winner === 'team1') stats.wins += 1;
          else if (winner === 'team2') stats.losses += 1;
          else stats.draws += 1;
        });

        team2.forEach(p => {
          const stats = ensurePlayer(p.id!, p.name!, p.gender, p.coin);
          stats.played += 1;
          if (winner === 'team2') stats.wins += 1;
          else if (winner === 'team1') stats.losses += 1;
          else stats.draws += 1;
        });
      }
    });

    const rankingsList = Array.from(statsMap.values()).map(s => {
      s.winRate = s.played > 0 ? (s.wins / s.played) * 100 : 0;
      return s;
    });

    rankingsList.sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.played - a.played;
    });

    return rankingsList;
  }, [matches]);

  if (userLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4">
        <div className="rounded-full bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          사용자 정보를 확인하는 중입니다
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 py-6 text-center">
          <section className="w-full rounded-[24px] bg-white px-5 py-8 shadow-sm">
            <div className="text-5xl">🔐</div>
            <h1 className="mt-4 text-xl font-semibold text-slate-900">로그인이 필요합니다</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              오늘 배정된 게임을 보려면 먼저 로그인해 주세요.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="flex-1 rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                로그인
              </button>
              <Link
                href="/dashboard"
                className="flex-1 rounded-full border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                홈
              </Link>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const canManageMatches = isAdmin || canManageActiveClub;

  const myParticipantIds = new Set(
    [user?.id, profile?.id, profile?.user_id].filter((value): value is string => Boolean(value))
  );

  const isPlayerInMatch = (match: ScheduledMatchView) => {
    return [
      match.team1_player1,
      match.team1_player2,
      match.team2_player1,
      match.team2_player2,
    ].some((participantId) => participantId ? myParticipantIds.has(participantId) : false);
  };

  const primaryMatch = matches.find((match) => match.status === 'in_progress')
    || matches.find((match) => match.status === 'scheduled')
    || null;

  const canStartPrimaryMatch = Boolean(
    primaryMatch?.generated_match_id &&
    primaryMatch.status === 'scheduled' &&
    canManageMatches
  );

  const handlePrimaryMatchStart = async () => {
    if (!primaryMatch?.generated_match_id || !canStartPrimaryMatch) return;

    try {
      setStartSaving(true);

      const response = await fetch('/api/match-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          match_id: primaryMatch.generated_match_id,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '게임 시작에 실패했습니다.');
      }

      await loadTodayMatches();
      alert(`게임을 시작했습니다. ${payload?.data?.waiting_match_ids?.length
        ? '다음 게임은 순서에 따라 자동으로 시작됩니다.'
        : ''}`.trim());
    } catch (error) {
      console.error('오늘 게임 시작 오류:', error);
      alert(getFriendlyErrorMessage(error));
    } finally {
      setStartSaving(false);
    }
  };

  const handleOptimizeOrder = async () => {
    if (!canManageMatches) return;
    try {
      setOptimizing(true);
      const response = await fetch('/api/admin/match-optimize-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          date: getKoreaDate(),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '순서 정렬에 실패했습니다.');
      }

      await loadTodayMatches();
      alert('출석자를 우선으로 순서가 정렬되었습니다.');
    } catch (error) {
      console.error('게임 순서 정렬 오류:', error);
      alert(getFriendlyErrorMessage(error));
    } finally {
      setOptimizing(false);
    }
  };

  const normalizeGender = (value?: string | null) => String(value || '').trim().toUpperCase();

  const getPlayerIcon = (gender?: string | null) => {
    const normalized = normalizeGender(gender);

    if (['M', 'MALE', 'MAN', '남', '남성'].includes(normalized)) {
      return '👨';
    }

    if (['F', 'FEMALE', 'WOMAN', 'W', '여', '여성'].includes(normalized)) {
      return '👩';
    }

    return '👤';
  };

  const processedMatches = matches.map((match, index) => {
    const matchOrder = match.match_number ?? index + 1;
    const displayMatchLabel = getDisplayMatchLabel(match, matchOrder);
    const displayMatchSequence = String(index + 1);

    return {
      ...match,
      displayMatchLabel,
      displayMatchSequence,
    };
  });

  const filteredMatches = processedMatches;

  const renderMatchCard = (match: typeof filteredMatches[0]) => {
    const inMatch = isPlayerInMatch(match);
    const statusMeta = getMatchStatusMeta(match.status);
    const team1Outcome = getMatchOutcomeMeta(match.status, match.match_result?.winner ?? null, 'team1');
    const team2Outcome = getMatchOutcomeMeta(match.status, match.match_result?.winner ?? null, 'team2');

    const displayMatchLabel = match.displayMatchLabel;
    const displayMatchSequence = match.displayMatchSequence;

    const sbTeam1 = match.match_result?.team1_score !== undefined ? String(match.match_result.team1_score) : '-';
    const sbTeam2 = match.match_result?.team2_score !== undefined ? String(match.match_result.team2_score) : '-';

    return (
      <article
        key={match.id}
        className={`rounded-[24px] border p-4 shadow-sm transition-all ${inMatch ? 'border-amber-200 bg-amber-50/80' : 'border-slate-200 bg-white'
          }`}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`flex min-w-[3rem] items-center justify-center rounded-full px-2 text-xs font-bold text-white ${inMatch ? 'bg-amber-500' : 'bg-slate-400'} h-9`}>
              {displayMatchSequence}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {displayMatchLabel}
                {inMatch && (
                  <span className="ml-2 rounded-full bg-amber-200 px-2 py-1 text-[11px] font-medium text-amber-800">
                    내 게임
                  </span>
                )}
              </h3>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>⏰ {formatTimeHHmm(match.match_time) || '시간 미정'}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusMeta.chipClass}`}>
              {statusMeta.label}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const url = `${window.location.origin}/today-scoreboard/${match.id}`;
                  setWatchModalUrl(url);
                }}
                className="flex items-center justify-center rounded-full bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
                title="워치에서 열기 안내"
              >
                ⌚
              </button>
              <Link
                href={`/today-scoreboard/${match.id}`}
                className="flex items-center justify-center rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
              >
                판
              </Link>
            </div>
          </div>
        </div>

        {/* Scoreboard — always visible */}
        <div className="mt-3 rounded-[18px] bg-slate-50 px-3 py-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {/* Team 1 */}
            <div className="text-left">
              <div className="truncate text-sm font-medium text-slate-900">
                {getPlayerIcon(match.team1_player1_gender)} {formatNameWithCoins(match.team1_player1_name, match.team1_player1_coin_balance)}
              </div>
              <div className="truncate text-sm font-medium text-slate-900">
                {getPlayerIcon(match.team1_player2_gender)} {formatNameWithCoins(match.team1_player2_name, match.team1_player2_coin_balance)}
              </div>
              {team1Outcome && (
                <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${team1Outcome.chipClass}`}>
                  <span>{team1Outcome.icon}</span><span>{team1Outcome.label}</span>
                </div>
              )}
            </div>

            {/* Score display */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg font-bold ${match.match_result?.winner === 'team1' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                  {sbTeam1}
                </div>
                <span className="text-sm font-bold text-slate-400">:</span>
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg font-bold ${match.match_result?.winner === 'team2' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                  {sbTeam2}
                </div>
              </div>
            </div>

            {/* Team 2 */}
            <div className="text-right">
              <div className="truncate text-sm font-medium text-slate-900">
                {formatNameWithCoins(match.team2_player1_name, match.team2_player1_coin_balance)} {getPlayerIcon(match.team2_player1_gender)}
              </div>
              <div className="truncate text-sm font-medium text-slate-900">
                {formatNameWithCoins(match.team2_player2_name, match.team2_player2_coin_balance)} {getPlayerIcon(match.team2_player2_gender)}
              </div>
              {team2Outcome && (
                <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${team2Outcome.chipClass}`}>
                  <span>{team2Outcome.icon}</span><span>{team2Outcome.label}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <div className="w-full">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-2.5 pt-0 pb-3 sm:gap-5 sm:px-5 sm:pt-0 sm:pb-5">
          <section className="rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] sm:px-5">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3">
              <div className="flex flex-col md:flex-row md:items-baseline gap-x-3 gap-y-1 pl-2">
                <h1 className="text-lg font-semibold whitespace-nowrap">🏸 전체 게임</h1>
              </div>
              <div className="flex gap-2 self-end sm:self-auto">
                <Link
                  href="/my-schedule"
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/15"
                >
                  내게임
                </Link>
                <Link
                  href="/dashboard"
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/15"
                >
                  홈
                </Link>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] px-2">
              <span className="text-slate-300 font-medium">
                {formatKSTDate(new Date())}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-md bg-white/10 px-2 py-1">
                  <span className="text-slate-300">총 게임 : </span>
                  <span className="font-semibold text-white">{matches.length}</span>
                </div>
                <div className="rounded-md bg-white/10 px-2 py-1">
                  <span className="text-slate-300">내 게임 : </span>
                  <span className="font-semibold text-white">{matches.filter(isPlayerInMatch).length}</span>
                </div>
              </div>
            </div>

            {primaryMatch && (
              <div className="mt-4">
                {primaryMatch.status === 'scheduled' && (
                  <div className="mb-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3.5 py-2.5 text-[13px] font-medium text-amber-400 flex items-center gap-2">
                    <span>⚠️</span>
                    <span>대기 중인 게임은 앞선 경기가 끝나면 배정된 순서대로 자동 시작됩니다.</span>
                  </div>
                )}
                <div className="rounded-[22px] bg-white/8 px-3 py-3">
                  <div className="flex items-center justify-between gap-3 w-full">
                    {/* Left side: Refresh button */}
                    <button
                      type="button"
                      onClick={() => { void handleRefresh(); }}
                      disabled={refreshing}
                      className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-60 shrink-0"
                    >
                      <span className={refreshing ? 'inline-block animate-spin' : ''}>🔄</span>
                      {refreshing ? '로딩...' : '새로고침'}
                    </button>

                    {/* Right side: Admin actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {canManageMatches && (
                        <button
                          type="button"
                          onClick={() => {
                            void handleOptimizeOrder();
                          }}
                          disabled={optimizing}
                          className="flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60 shrink-0"
                        >
                          <span>⏳</span>
                          {optimizing ? '정렬 중...' : '순서 정렬'}
                        </button>
                      )}
                      {canStartPrimaryMatch ? (
                        <button
                          type="button"
                          onClick={() => {
                            void handlePrimaryMatchStart();
                          }}
                          disabled={startSaving}
                          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:opacity-60 shrink-0"
                        >
                          {startSaving
                            ? '처리 중...'
                            : primaryMatch.status === 'in_progress'
                              ? '진행중'
                              : '게임 시작'}
                        </button>
                      ) : (
                        <span className="rounded-full bg-white/10 px-3 py-2 text-xs font-medium text-slate-200 shrink-0">
                          {primaryMatch.status === 'in_progress' ? '진행 중' : '다음 경기 대기'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="flex border-b border-slate-200 mt-2 gap-6 px-2">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`pb-2 text-sm font-semibold transition ${
                activeTab === 'schedule'
                  ? 'border-b-[3px] border-slate-800 text-slate-900'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              경기 일정
            </button>
            <button
              onClick={() => setActiveTab('ranking')}
              className={`pb-2 text-sm font-semibold transition ${
                activeTab === 'ranking'
                  ? 'border-b-[3px] border-slate-800 text-slate-900'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              결과 및 순위
            </button>
          </div>

          {activeTab === 'schedule' ? (
            loading ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-500">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800 mb-4"></div>
                <p className="text-sm font-medium">오늘 게임 일정을 불러오는 중입니다...</p>
              </div>
            ) : matches.length === 0 ? (
              <section className="rounded-[24px] bg-white px-4 py-10 text-center shadow-sm">
                <div className="text-5xl">🏸</div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">오늘 배정된 게임이 없습니다</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">관리자가 게임을 배정하면 여기에 표시됩니다.</p>
              </section>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
                {filteredMatches.map(renderMatchCard)}
              </div>
            )
          ) : (
            loading ? (
              <div className="mt-2 rounded-[24px] bg-white p-10 flex flex-col items-center justify-center text-slate-500 shadow-sm">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800 mb-4"></div>
                <p className="text-sm font-medium">결과를 불러오는 중입니다...</p>
              </div>
            ) : (
              <div className="mt-2 rounded-[24px] bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">개인별 순위 (승률순)</h2>
                {rankings.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">완료된 경기가 없습니다.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-600">
                      <thead className="border-b border-slate-100 bg-slate-50/50 text-xs font-semibold uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-3 whitespace-nowrap">순위</th>
                          <th className="px-4 py-3 whitespace-nowrap">이름</th>
                          <th className="px-4 py-3 text-center whitespace-nowrap">전적</th>
                          <th className="px-4 py-3 text-right whitespace-nowrap">승률</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rankings.map((p, idx) => (
                          <tr key={p.id} className="hover:bg-slate-50 transition">
                            <td className="px-4 py-3 font-medium text-slate-900">{idx + 1}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {getPlayerIcon(p.gender)} {formatNameWithCoins(p.name, p.coin_balance)}
                            </td>
                            <td className="px-4 py-3 text-center whitespace-nowrap">
                              {p.played}전 {p.wins}승 {p.losses}패
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900 whitespace-nowrap">
                              {p.winRate.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* Watch Instruction Modal */}
      {watchModalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl relative animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
              <span>⌚</span> 워치에서 점수판 열기
            </h3>
            <div className="text-sm text-slate-600 space-y-3 mb-6">
              <p>1. 스마트폰에서 <strong>삼성 인터넷 브라우저</strong>를 엽니다.</p>
              <p>2. 우측 하단의 <strong>메뉴(≡)</strong>를 누릅니다.</p>
              <p>3. <strong>[워치에서 열기]</strong>를 선택하면 워치 화면이 켜지며 점수판이 나타납니다.</p>
              <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-500 leading-relaxed">
                * 만약 메뉴에 보이지 않으면 삼성 인터넷 설정에서 추가할 수 있습니다.<br/>
                * 타사 브라우저나 워치를 사용 중이시라면 아래 버튼으로 링크를 복사하여 전송해 주세요.
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(watchModalUrl);
                  alert('점수판 링크가 복사되었습니다.');
                }}
                className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                링크 복사
              </button>
              <button
                onClick={() => setWatchModalUrl(null)}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { useClub } from '@/hooks/useClub';
import { getSupabaseClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { DEFAULT_MATCH_WAGER, MAX_MATCH_WAGER } from '@/lib/coins';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { NotificationService } from '@/utils/notification-service';
import { getProfileByUserId, isAdminRole, isManagerRole } from '@/lib/auth';
import { formatCurrentUserNameWithCoins, formatNameWithCoins } from '@/lib/player-display';
import { fetchScheduledMatchesForDate, type ScheduledMatchView } from '@/lib/scheduled-matches';
import type { CoinSettlementMode } from '@/lib/coins';
import { useLevelInfoMap } from '@/hooks/useLevelInfoMap';
import { getLevelNameFromCode } from '@/lib/level-info';
import { formatKSTDate, formatKSTDateTime, formatTimeHHmm } from '@/lib/date';
import {
  fetchMyTournamentMatches,
  normalizeTournamentPlayerName,
  type MyTournamentMatchView,
} from '@/lib/tournament-matches';

const tournamentNamesMatch = (candidate: string, teamMember: string) =>
  Boolean(candidate && teamMember) &&
  (candidate === teamMember || candidate.includes(teamMember) || teamMember.includes(candidate));

// 경기 결과 표시 컴포넌트
function MatchResultDisplay({ selectedMatch, user, supabase }: {
  selectedMatch: MatchSchedule;
  user: any;
  supabase: any;
}) {
  const [matchResult, setMatchResult] = useState<any>(null);
  
  useEffect(() => {
    const fetchMatchResult = async () => {
      if (!selectedMatch?.id.startsWith('generated_')) return;
      
      const generatedMatchId = selectedMatch.id.replace('generated_', '');
       const { data, error } = await supabase
        .from('generated_matches')
        .select('match_result, status')
        .eq('id', generatedMatchId)
        .maybeSingle();
        
      if (error) {
        console.error('Match result fetch error:', error);
        setMatchResult({ error: true });
        return;
      }

      if (!data || !data.match_result) {
        setMatchResult({ empty: true });
        return;
      }

      setMatchResult(data.match_result);
    };
    
    fetchMatchResult();
  }, [selectedMatch?.id]);
  
  if (!matchResult) {
    return (
      <div className="text-center text-gray-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500 mx-auto mb-2"></div>
        결과 조회 중...
      </div>
    );
  }

  if (matchResult.error || matchResult.empty) {
    return (
      <div className="text-center text-gray-500 text-sm">
        등록된 결과 정보가 없습니다.
      </div>
    );
  }
  
  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between items-center">
        <span className="font-medium">승부 결과:</span>
        <span className="font-bold text-green-700">
          {matchResult.winner === 'team1' ? '🏆 라켓팀 승리' : '🏆 셔틀팀 승리'}
        </span>
      </div>
      <div className="flex justify-between items-center">
        <span className="font-medium">점수:</span>
        <span className="font-mono text-green-700 font-bold">
          {matchResult.score}
        </span>
      </div>
      <div className="flex justify-between items-center">
        <span className="font-medium">완료 시간:</span>
        <span className="text-green-600 text-xs">
          {formatKSTDateTime(matchResult.completed_at)}
        </span>
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1.5">
        {matchResult.created_by_name && (
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>최초 입력자:</span>
            <span className="font-medium text-slate-700">{matchResult.created_by_name}</span>
          </div>
        )}
        {matchResult.updated_by_name && matchResult.updated_by_name !== matchResult.created_by_name && (
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>최종 수정자:</span>
            <span className="font-medium text-slate-700">{matchResult.updated_by_name}</span>
          </div>
        )}
        {!matchResult.created_by_name && matchResult.recorded_by && (
          <div className="text-xs text-slate-500 text-center">
            결과 기록자: {matchResult.recorded_by === user.id ? '나' : '다른 참가자'}
          </div>
        )}
      </div>
    </div>
  );
}

interface MatchSchedule {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string;
  location: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  description: string;
  kind?: 'registration' | 'assigned';
  generated_match?: {
    id: string | number;
    session_id?: string | null;
    match_number: number;
    session_name: string;
    match_result?: any;
    team1_player1: {
      id?: string;
      user_id?: string;
      username?: string;
      full_name?: string;
      coin_balance?: number | null;
      skill_level: string;
      skill_level_name: string;
    };
    team1_player2: {
      id?: string;
      user_id?: string;
      username?: string;
      full_name?: string;
      coin_balance?: number | null;
      skill_level: string;
      skill_level_name: string;
    };
    team2_player1: {
      id?: string;
      user_id?: string;
      username?: string;
      full_name?: string;
      coin_balance?: number | null;
      skill_level: string;
      skill_level_name: string;
    };
    team2_player2: {
      id?: string;
      user_id?: string;
      username?: string;
      full_name?: string;
      coin_balance?: number | null;
      skill_level: string;
      skill_level_name: string;
    };
  };
}

interface MyScheduleStats {
  totalMatches: number;
  upcomingMatches: number;
  completedMatches: number;
  winRate: number;
  wins: number;
  losses: number;
}

interface MatchRecord {
  id: string;
  matchNumber: number;
  date: string;
  result: 'win' | 'loss' | 'pending';
  score: string;
  teammates: string[];
  opponents: string[];
  isUserTeam1: boolean;
}

interface MatchBetState {
  myProfileId: string | null;
  bets: Record<string, number>;
}

type MatchCenterTab = 'upcoming' | 'results' | 'tournaments';

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

function AssignedMatchCard({
  match,
  globalMatchNumber,
  currentActiveGlobalMatchNumber,
  showBetCardForMatch,
  profile,
  coinSettlementMode,
  onRefresh,
}: any) {
  const [score1, setScore1] = useState('');
  const [score2, setScore2] = useState('');
  const [resultSaving, setResultSaving] = useState(false);
  const [bet, setBet] = useState(DEFAULT_MATCH_WAGER);
  const [betSaving, setBetSaving] = useState(false);
  const [proposal, setProposal] = useState<any>(null);

  const isEditable = match.status === 'scheduled' || match.status === 'in_progress';
  const statusMeta = getMatchStatusMeta(match.status);

  useEffect(() => {
    const loadState = async () => {
      if (!match.id) return;
      try {
        if (showBetCardForMatch && match.generated_match_id) {
          const betResponse = await fetch(`/api/match-bets?match_id=${match.generated_match_id}`, { credentials: 'include' });
          const betPayload = await betResponse.json().catch(() => null);
          if (betResponse.ok) {
            const proposal = betPayload?.proposal;
            if (proposal && (proposal.status === 'pending' || proposal.status === 'accepted')) {
              setBet(proposal.wager_amount);
            } else {
              const myBet = (betPayload?.bets || []).find((item: any) => item.profile_id === profile?.id);
              setBet(myBet?.wager_amount ?? DEFAULT_MATCH_WAGER);
            }
            setProposal(proposal || null);
          }
        }

        if (isEditable) {
          const draft = window.localStorage.getItem(`match_draft_${match.id}`);
          if (draft) {
            try {
              const parsed = JSON.parse(draft);
              setScore1(parsed.team1Score ?? '');
              setScore2(parsed.team2Score ?? '');
            } catch {}
          }
        }
      } catch (err) {}
    };
    loadState();
  }, [match.id, profile?.id, isEditable, showBetCardForMatch]);

  const handleScore1 = (val: string) => {
    setScore1(val);
    window.localStorage.setItem(`match_draft_${match.id}`, JSON.stringify({ team1Score: val, team2Score: score2 }));
  };

  const handleScore2 = (val: string) => {
    setScore2(val);
    window.localStorage.setItem(`match_draft_${match.id}`, JSON.stringify({ team1Score: score1, team2Score: val }));
  };

  const handleResultSave = async () => {
    if (!match.generated_match_id) return;
    const team1Score = Number(score1);
    const team2Score = Number(score2);

    if (!Number.isFinite(team1Score) || !Number.isFinite(team2Score)) {
      alert('점수를 숫자로 입력해주세요.');
      return;
    }
    if (team1Score === team2Score) {
      alert('무승부는 저장할 수 없습니다.');
      return;
    }

    try {
      setResultSaving(true);
      const response = await fetch('/api/match-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          match_id: match.generated_match_id,
          winner_team1: team1Score > team2Score,
          team1_score: team1Score,
          team2_score: team2Score,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '점수 저장 실패');
      }

      window.localStorage.removeItem(`match_draft_${match.id}`);
      await onRefresh();
    } catch (error) {
      console.error('경기 결과 저장 오류:', error);
      alert(error instanceof Error ? error.message : '점수 저장 중 오류가 발생했습니다.');
    } finally {
      setResultSaving(false);
    }
  };

  const handleBetSave = async (wagerAmount: number) => {
    if (!match.generated_match_id) return;
    try {
      setBetSaving(true);
      const response = await fetch('/api/match-bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          match_id: match.generated_match_id,
          action: 'propose',
          wager_amount: wagerAmount,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '배팅 제안 실패');
      }
      setBet(wagerAmount); // keep it at the proposed amount
      
      // refresh proposal state
      const betResponse = await fetch(`/api/match-bets?match_id=${match.generated_match_id}`, { credentials: 'include' });
      const betPayload = await betResponse.json().catch(() => null);
      if (betResponse.ok) {
        setProposal(betPayload?.proposal || null);
      }
    } catch (error) {
      console.error('배팅 저장 오류:', error);
      alert(error instanceof Error ? error.message : '배팅 저장 중 오류가 발생했습니다.');
    } finally {
      setBetSaving(false);
    }
  };

  const handleRespond = async (responseStr: 'accept' | 'reject') => {
    if (!match.generated_match_id) return;
    try {
      setBetSaving(true);
      const response = await fetch('/api/match-bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          match_id: match.generated_match_id,
          action: 'respond',
          response: responseStr,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '응답 실패');
      }
      
      // refresh bet state
      const betResponse = await fetch(`/api/match-bets?match_id=${match.generated_match_id}`, { credentials: 'include' });
      const betPayload = await betResponse.json().catch(() => null);
      if (betResponse.ok) {
        const proposal = betPayload?.proposal;
        if (proposal && (proposal.status === 'pending' || proposal.status === 'accepted')) {
          setBet(proposal.wager_amount);
        } else {
          const myBet = (betPayload?.bets || []).find((item: any) => item.profile_id === profile?.id);
          setBet(myBet?.wager_amount ?? DEFAULT_MATCH_WAGER);
        }
        setProposal(proposal || null);
      }
    } catch (error) {
      console.error('응답 오류:', error);
      alert(error instanceof Error ? error.message : '응답 중 오류가 발생했습니다.');
    } finally {
      setBetSaving(false);
    }
  };

  const canComplete = score1 !== '' && score2 !== '' && score1 !== score2;

  const gamesLeft = globalMatchNumber - currentActiveGlobalMatchNumber;
  let waitingMessage = '';
  if (match.status === 'completed') {
    waitingMessage = '종료된 경기입니다';
  } else if (match.status === 'in_progress') {
    waitingMessage = '현재 진행중인 경기입니다';
  } else if (currentActiveGlobalMatchNumber > 0 && gamesLeft > 0) {
    waitingMessage = `현재 ${currentActiveGlobalMatchNumber}번째 경기 진행 중 (내 경기까지 ${gamesLeft}경기 남음)`;
  } else if (currentActiveGlobalMatchNumber > 0 && gamesLeft === 0) {
    waitingMessage = `곧 시작될 예정입니다 (현재 ${currentActiveGlobalMatchNumber}번째 경기 순서)`;
  } else if (currentActiveGlobalMatchNumber > 0 && gamesLeft < 0) {
    waitingMessage = '순서가 지난 경기입니다';
  } else {
    waitingMessage = `전체 ${globalMatchNumber}번째 경기`;
  }

  return (
    <div key={match.id} className="rounded-[20px] bg-slate-50 p-4">
      {waitingMessage && (
        <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
          {waitingMessage}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-800">
        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
          {match.generated_match?.match_number ? `경기 #${match.generated_match.match_number}` : (globalMatchNumber ? `전체 ${globalMatchNumber}번째 경기` : '경기')}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusMeta.chipClass}`}>
          {statusMeta.label}
        </span>
        <span>{formatTimeHHmm(match.match_time) || '시간 미정'}</span>
      </div>

      {isEditable ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center sm:gap-1.5">
          <div className="rounded-[16px] border border-blue-100 bg-white px-2.5 py-2.5 text-left flex flex-col justify-between h-full">
            <div className="text-sm leading-6 text-slate-800">
              <div className="truncate font-medium text-slate-900">
                {formatNameWithCoins(match.team1_player1_name, match.team1_player1_coin_balance)}
              </div>
              <div className="truncate font-medium text-slate-900">
                {formatNameWithCoins(match.team1_player2_name, match.team1_player2_coin_balance)}
              </div>
            </div>
            <div className="mt-2.5 sm:hidden">
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={score1}
                onChange={(e) => handleScore1(e.target.value)}
                disabled={match.status !== 'in_progress'}
                className="h-8 w-full rounded-lg border border-slate-300 bg-white px-1 text-center text-sm font-bold text-slate-900 outline-none transition focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed"
                placeholder="점수"
              />
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-1 px-0.5">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={score1}
              onChange={(e) => handleScore1(e.target.value)}
              disabled={match.status !== 'in_progress'}
              className="h-9 w-11 rounded-lg border border-slate-300 bg-white px-1 text-center text-sm font-bold text-slate-900 outline-none transition focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed"
            />
            <span className="text-[11px] font-semibold text-slate-400">:</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={score2}
              onChange={(e) => handleScore2(e.target.value)}
              disabled={match.status !== 'in_progress'}
              className="h-9 w-11 rounded-lg border border-slate-300 bg-white px-1 text-center text-sm font-bold text-slate-900 outline-none transition focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed"
            />
          </div>

          <div className="rounded-[16px] border border-emerald-100 bg-white px-2.5 py-2.5 text-right flex flex-col justify-between h-full">
            <div className="text-sm leading-6 text-slate-800">
              <div className="truncate font-medium text-slate-900">
                {formatNameWithCoins(match.team2_player1_name, match.team2_player1_coin_balance)}
              </div>
              <div className="truncate font-medium text-slate-900">
                {formatNameWithCoins(match.team2_player2_name, match.team2_player2_coin_balance)}
              </div>
            </div>
            <div className="mt-2.5 sm:hidden">
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={score2}
                onChange={(e) => handleScore2(e.target.value)}
                disabled={match.status !== 'in_progress'}
                className="h-8 w-full rounded-lg border border-slate-300 bg-white px-1 text-center text-sm font-bold text-slate-900 outline-none transition focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed"
                placeholder="점수"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-blue-100 bg-white px-3 py-3 text-left">
            <div className="text-sm leading-6 text-slate-800">
              <div className="font-medium text-slate-900">
                {formatNameWithCoins(match.team1_player1_name, match.team1_player1_coin_balance)}
              </div>
              <div className="font-medium text-slate-900">
                {formatNameWithCoins(match.team1_player2_name, match.team1_player2_coin_balance)}
              </div>
            </div>
            {match.match_result?.team1_score !== undefined ? (
              <div className="mt-3 text-center text-2xl font-bold text-blue-700">
                {match.match_result.team1_score}
              </div>
            ) : (
              <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-center text-xs text-slate-500">
                {match.status === 'scheduled' ? '게임 완료 후 입력' : '점수 대기'}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-white px-3 py-3 text-right">
            <div className="text-sm leading-6 text-slate-800">
              <div className="font-medium text-slate-900">
                {formatNameWithCoins(match.team2_player1_name, match.team2_player1_coin_balance)}
              </div>
              <div className="font-medium text-slate-900">
                {formatNameWithCoins(match.team2_player2_name, match.team2_player2_coin_balance)}
              </div>
            </div>
            {match.match_result?.team2_score !== undefined ? (
              <div className="mt-3 text-center text-2xl font-bold text-emerald-700">
                {match.match_result.team2_score}
              </div>
            ) : (
              <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-center text-xs text-slate-500">
                {match.status === 'scheduled' ? '게임 완료 후 입력' : '점수 대기'}
              </div>
            )}
          </div>
        </div>
      )}

      {isEditable && (
        <div className="mt-3 flex items-center gap-2">
          <div className={`rounded-full px-3 py-1 text-sm font-semibold shadow-sm transition-all ${
            match.status === 'in_progress' ? 'bg-white text-slate-700' : 'bg-slate-100 text-slate-400'
          }`}>
            현재 점수 {score1 || '0'} : {score2 || '0'}
          </div>
          <Button
            onClick={handleResultSave}
            disabled={resultSaving || !canComplete || match.status !== 'in_progress'}
            className="ml-auto h-8 rounded-xl px-5 text-xs"
          >
            {resultSaving ? '저장 중...' : '저장'}
          </Button>
        </div>
      )}

      {showBetCardForMatch && (
        <div className="mt-3 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-900">코인 배팅</p>
              <p className="text-xs text-amber-800">
                기본 {DEFAULT_MATCH_WAGER}코인, 최대 {MAX_MATCH_WAGER}코인
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-amber-700">현재 배팅</p>
              <p className="font-bold text-amber-900">{bet}코인</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3">
            {[1, 2, 3].map((wager) => {
              const disabled =
                betSaving ||
                (coinSettlementMode === 'all_in_one' &&
                  (profile?.coin_balance ?? 0) < wager) ||
                (coinSettlementMode === 'split_by_match' &&
                  (profile?.coin_balance ?? 0) < wager);

              return (
                <Button
                  key={wager}
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => handleBetSave(wager)}
                  className={`h-9 w-full rounded-xl border-amber-200 text-xs font-semibold ${
                    bet === wager
                      ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-white text-amber-700 hover:bg-amber-50 hover:text-amber-800'
                  }`}
                >
                  {wager}코인
                </Button>
              );
            })}
          </div>

          {/* Proposal Status UI */}
          {proposal && proposal.status === 'pending' ? (
            <div className="rounded-xl bg-amber-100 p-2 text-xs text-amber-900 mt-2">
              {proposal.proposed_by === profile?.id ? (
                <div className="text-center space-y-1">
                  <div>내가 <strong>{proposal.wager_amount}코인</strong> 배팅을 제안했습니다.</div>
                  <div className="text-amber-700">다른 참가자의 수락을 대기중입니다.</div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span><strong>누군가</strong> <strong>{proposal.wager_amount}코인</strong> 배팅을 제안했습니다.</span>
                  {proposal.my_response ? (
                    <span className="text-amber-700">
                      수락을 완료했습니다. 다른 참가자를 대기중입니다.
                    </span>
                  ) : (
                    <div className="flex gap-2 w-full mt-1">
                      <Button onClick={() => handleRespond('accept')} disabled={betSaving} size="sm" className="flex-1 bg-amber-500 hover:bg-amber-600 text-white h-7 text-xs">수락</Button>
                      <Button onClick={() => handleRespond('reject')} disabled={betSaving} size="sm" variant="outline" className="flex-1 border-amber-400 text-amber-700 bg-white hover:bg-amber-50 h-7 text-xs">거부</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : proposal && proposal.status === 'rejected' ? (
            <div className="rounded-xl bg-rose-50 p-2 text-xs text-rose-600 mt-2 text-center border border-rose-100">
              누군가 거부하여 기본 1코인 배팅으로 돌아갔습니다.
            </div>
          ) : proposal && proposal.status === 'accepted' ? (
            <div className="rounded-xl bg-emerald-50 p-2 text-xs text-emerald-700 mt-2 text-center border border-emerald-100">
              전원 수락으로 {proposal.wager_amount}코인 배팅이 확정되었습니다.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function MySchedulePage() {
  const { user, profile, loading: userLoading } = useUser();
  const { clubId } = useClub();
  const router = useRouter();
  const supabase = getSupabaseClient();
  const levelInfoMap = useLevelInfoMap();
  
  // 모든 상태를 상단에 선언
  const [loading, setLoading] = useState(true);
  const [myMatches, setMyMatches] = useState<MatchSchedule[]>([]);
  const [matchRecords, setMatchRecords] = useState<MatchRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<MatchRecord[]>([]);

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [activeTab, setActiveTab] = useState<MatchCenterTab>('upcoming');
  const [tournamentMatches, setTournamentMatches] = useState<MyTournamentMatchView[]>([]);
  const [allTournamentMatches, setAllTournamentMatches] = useState<MyTournamentMatchView[]>([]);
  const [allTournamentMatchCount, setAllTournamentMatchCount] = useState(0);
  const [stats, setStats] = useState<MyScheduleStats>({ 
    totalMatches: 0, 
    upcomingMatches: 0, 
    completedMatches: 0,
    winRate: 0,
    wins: 0,
    losses: 0
  });
  const [selectedMatch, setSelectedMatch] = useState<MatchSchedule | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [modalMode, setModalMode] = useState<'schedule' | 'complete'>('schedule');
  const [matchStatus, setMatchStatus] = useState<'scheduled' | 'in_progress' | 'completed' | 'cancelled'>('scheduled');
  const [matchResult, setMatchResult] = useState({
    winner: '' as 'team1' | 'team2' | '',
    score: ''
  });

  const isParticipantOfSelected = selectedMatch?.generated_match ? [
    selectedMatch.generated_match.team1_player1?.id,
    selectedMatch.generated_match.team1_player1?.user_id,
    selectedMatch.generated_match.team1_player2?.id,
    selectedMatch.generated_match.team1_player2?.user_id,
    selectedMatch.generated_match.team2_player1?.id,
    selectedMatch.generated_match.team2_player1?.user_id,
    selectedMatch.generated_match.team2_player2?.id,
    selectedMatch.generated_match.team2_player2?.user_id,
  ].filter(Boolean).includes(profile?.id || user?.id) : false;

  const canManageSelected = isAdminRole(profile?.role) || isManagerRole(profile?.role);
  
  // 각 경기의 결과 입력 상태를 추적하는 state
  const [, setMatchResultStates] = useState<Record<string, boolean | null>>({});
  const [selectedMatchBetState, setSelectedMatchBetState] = useState<MatchBetState>({ myProfileId: null, bets: {} });

  // 내 게임 (대시보드) 영역용 상태
  const [todayAssignedMatches, setTodayAssignedMatches] = useState<ScheduledMatchView[]>([]);
  const [todayAllMatches, setTodayAllMatches] = useState<ScheduledMatchView[]>([]);

  const [coinSettlementMode, setCoinSettlementMode] = useState<CoinSettlementMode | null>(null);


  const getTodayLocal = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    const syncTabFromUrl = () => {
      const requestedTab = new URLSearchParams(window.location.search).get('tab');
      if (requestedTab === 'upcoming' || requestedTab === 'results' || requestedTab === 'tournaments') {
        setActiveTab(requestedTab);
      }
    };

    syncTabFromUrl();
    window.addEventListener('popstate', syncTabFromUrl);

    return () => {
      window.removeEventListener('popstate', syncTabFromUrl);
    };
  }, []);



  // 모든 경기의 결과 상태 업데이트
  const updateMatchResultStates = async () => {
    // 진행 중이고 generated_match인 경기의 ID만 추출
    const inProgressMatchIds = myMatches
      .filter(match => match.generated_match && match.status === 'in_progress')
      .map(match => Number(match.id.replace('generated_', '')));

    if (inProgressMatchIds.length === 0) {
      setMatchResultStates({});
      return;
    }

    try {
      const { data, error } = await supabase
        .from('generated_matches')
        .select('id, match_result')
        .in('id', inProgressMatchIds);

      if (!error && data) {
        const states: Record<string, boolean | null> = {};
        for (const item of data) {
          states[`generated_${item.id}`] = !!item.match_result;
        }
        setMatchResultStates(states);
      }
    } catch (error) {
      console.error('결과 상태 업데이트 실패:', error);
    }
  };

  const loadSelectedMatchBets = async (match: MatchSchedule | null) => {
    if (!match?.generated_match) {
      setSelectedMatchBetState({ myProfileId: null, bets: {} });
      return;
    }

    try {
      const response = await fetch(`/api/match-bets?match_id=${Number(match.generated_match.id)}`, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || '배팅 정보 조회 실패');
      }

      const bets = Object.fromEntries(
        (payload?.bets || []).map((item: { profile_id: string; wager_amount: number }) => [
          item.profile_id,
          item.wager_amount ?? DEFAULT_MATCH_WAGER,
        ])
      );

      setSelectedMatchBetState({
        myProfileId: payload?.my_profile_id || null,
        bets,
      });
    } catch (error) {
      console.error('배팅 정보 조회 실패:', error);
      setSelectedMatchBetState({ myProfileId: profile?.id || null, bets: {} });
    }
  };

  useEffect(() => {
    if (user) {
      fetchMySchedule();
    }
  }, [user]);

  useEffect(() => {
    if (user && profile) {
      void fetchTournamentMatches();
    }
  }, [user?.id, profile?.id]);

  // 경기 목록이 변경될 때마다 결과 상태 업데이트
  useEffect(() => {
    if (myMatches.length > 0) {
      updateMatchResultStates();
    }
  }, [myMatches.length]); // 의존성을 단순화

  useEffect(() => {
    if (showDetailsModal && selectedMatch?.generated_match) {
      loadSelectedMatchBets(selectedMatch);
      return;
    }

    setSelectedMatchBetState({ myProfileId: profile?.id || null, bets: {} });
  }, [showDetailsModal, selectedMatch?.id, profile?.id]);

  // 내 경기 조회 함수
  const fetchMySchedule = async (tabToRefresh: 'upcoming' | 'results' | 'all' = 'all') => {
    if (!user) return;
    
    console.log('🔍 내 경기 일정 조회 시작...');
    setLoading(true);

    try {
      const matchesWithDetails: MatchSchedule[] = [];
      const myProfile = profile || await getProfileByUserId(supabase, user.id);
      const participantIds = Array.from(
        new Set([myProfile?.id, myProfile?.user_id, user.id].filter((value): value is string => Boolean(value)))
      );
      const todayLocal = getTodayLocal();

      let fetchedAssignedMatches = todayAssignedMatches;

       // Only fetch scheduled matches and coin settings if we need to update upcoming matches
      if (tabToRefresh === 'all' || tabToRefresh === 'upcoming') {
        const [aMatches, allMatches, coinSettingsResponse] = await Promise.all([
          fetchScheduledMatchesForDate(supabase, todayLocal, user.id),
          fetchScheduledMatchesForDate(supabase, todayLocal),
          fetch('/api/coin-settings', { credentials: 'include' })
        ]);

        fetchedAssignedMatches = aMatches;
        setTodayAssignedMatches(aMatches);
        setTodayAllMatches(allMatches);

        if (coinSettingsResponse.ok) {
          const payload = await coinSettingsResponse.json().catch(() => null);
          setCoinSettlementMode(payload?.coinSettings?.settlementMode || null);
        }
      }

      const assignedScheduleIds = new Set<string>();

      // If we are NOT refreshing all/upcoming, keep the existing upcoming matches in matchesWithDetails
      if (tabToRefresh === 'results') {
        matchesWithDetails.push(...myMatches.filter(m => m.status === 'scheduled' || m.status === 'in_progress'));
      } else {
        const todayAssignedMatches = fetchedAssignedMatches;

        todayAssignedMatches.forEach((match, index) => {
          if (!match.generated_match_id) {
            return;
          }

          const syntheticId = `generated_${match.generated_match_id}`;
          assignedScheduleIds.add(syntheticId);

          // Use the match_number directly or fallback to index
          const globalMatchNumber = match.match_number ?? index + 1;

        matchesWithDetails.push({
          id: syntheticId,
          match_date: match.match_date || todayLocal,
          start_time: match.match_time || '시간 미정',
          end_time: match.match_time || '시간 미정',
          location: match.court_name || `코트 ${match.court_number || '미정'}`,
          status: (match.status || 'scheduled') as 'scheduled' | 'in_progress' | 'completed' | 'cancelled',
          description: '오늘 배정 경기',
          kind: 'assigned',
          generated_match: {
            id: match.generated_match_id,
            session_id: null,
            match_number: globalMatchNumber,
            session_name: '오늘 배정 경기',
            team1_player1: {
              id: match.team1_player1 || undefined,
              username: match.team1_player1_name,
              full_name: match.team1_player1_name,
              coin_balance: match.team1_player1_coin_balance ?? null,
              skill_level: match.team1_player1_skill_level || 'E2',
              skill_level_name: match.team1_player1_skill_level_name || getLevelNameFromCode(levelInfoMap, match.team1_player1_skill_level || 'E2', match.team1_player1_skill_level || 'E2') || (match.team1_player1_skill_level || 'E2'),
            },
            team1_player2: {
              id: match.team1_player2 || undefined,
              username: match.team1_player2_name,
              full_name: match.team1_player2_name,
              coin_balance: match.team1_player2_coin_balance ?? null,
              skill_level: match.team1_player2_skill_level || 'E2',
              skill_level_name: match.team1_player2_skill_level_name || getLevelNameFromCode(levelInfoMap, match.team1_player2_skill_level || 'E2', match.team1_player2_skill_level || 'E2') || (match.team1_player2_skill_level || 'E2'),
            },
            team2_player1: {
              id: match.team2_player1 || undefined,
              username: match.team2_player1_name,
              full_name: match.team2_player1_name,
              coin_balance: match.team2_player1_coin_balance ?? null,
              skill_level: match.team2_player1_skill_level || 'E2',
              skill_level_name: match.team2_player1_skill_level_name || getLevelNameFromCode(levelInfoMap, match.team2_player1_skill_level || 'E2', match.team2_player1_skill_level || 'E2') || (match.team2_player1_skill_level || 'E2'),
            },
            team2_player2: {
              id: match.team2_player2 || undefined,
              username: match.team2_player2_name,
              full_name: match.team2_player2_name,
              coin_balance: match.team2_player2_coin_balance ?? null,
              skill_level: match.team2_player2_skill_level || 'E2',
              skill_level_name: match.team2_player2_skill_level_name || getLevelNameFromCode(levelInfoMap, match.team2_player2_skill_level || 'E2', match.team2_player2_skill_level || 'E2') || (match.team2_player2_skill_level || 'E2'),
            },
          },
        });
        });
      } // End of else

      // 2. 내가 배정받은 경기 및 완료된 경기 조회 (RLS 우회를 위해 API 라우트 사용)
      console.log('내 프로필 조회:', { myProfile, userId: user.id });

      let allMatches: any[] = [];
      let fetchError: any = null;

      if (participantIds.length > 0 && (tabToRefresh === 'all' || tabToRefresh === 'upcoming' || tabToRefresh === 'results')) {
        try {
          const statusFilter = tabToRefresh === 'upcoming' ? 'upcoming' : tabToRefresh === 'results' ? 'completed' : undefined;
          const response = await fetch('/api/user/generated-matches', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ participantIds, status: statusFilter }),
          });

          if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
          }

          const resData = await response.json();
          allMatches = resData.matches || [];
          console.log('fetch matchesCount:', allMatches.length);
        } catch (err: any) {
          fetchError = err;
          console.error('fetchError:', err.message);
        }
      }

      const assignedMatches = allMatches
        .filter((m: any) => m.status !== 'completed')
        .sort((a: any, b: any) => (a.match_number || 0) - (b.match_number || 0));
      const assignedError = fetchError;

      console.log('배정형 경기 조회 결과:', { 
        data: assignedMatches, 
        error: assignedError, 
        searchProfileId: myProfile?.id || null,
        matchCount: assignedMatches?.length || 0
      });

      if (!assignedError && assignedMatches && assignedMatches.length > 0) {
        // 배정된 게임을 가상의 일정로 변환
        assignedMatches.forEach((match: any, index) => {
          const syntheticId = `generated_${match.id}`;
          if (assignedScheduleIds.has(syntheticId)) {
            return;
          }
          const session = Array.isArray(match.match_sessions) ? match.match_sessions[0] : match.match_sessions; // 첫 번째 세션 정보 사용
          
          const getPlayerInfo = (playerData: any) => {
            if (!playerData) return { 
              id: null, 
              user_id: null,
              username: '미정', 
              full_name: '미정', 
              coin_balance: null,
              skill_level: 'E2',
              skill_level_name: getLevelNameFromCode(levelInfoMap, 'E2', 'E2') || 'E2'
            };
            return {
              id: playerData.id,
              user_id: playerData.user_id,
              username: playerData.full_name || playerData.username || '미정',
              full_name: playerData.full_name || playerData.username || '미정',
              coin_balance: playerData.coin_balance ?? null,
              skill_level: playerData.skill_level || 'E2',
              skill_level_name: playerData.level_info?.name || getLevelNameFromCode(levelInfoMap, playerData.skill_level || 'E2', playerData.skill_level || 'E2') || (playerData.skill_level || 'E2')
            };
          };

          matchesWithDetails.push({
            id: syntheticId,
            match_date: session?.session_date || todayLocal,
            start_time: `${9 + (index % 8)}:00`, // 9시부터 시작해서 8경기마다 순환
            end_time: `${10 + (index % 8)}:00`,
            location: '클럽 코트',
            status: (match.status || 'scheduled') as 'scheduled' | 'in_progress' | 'completed' | 'cancelled',
            description: session?.session_name || '배정 게임',
            kind: 'assigned',
            generated_match: {
              id: match.id,
              session_id: match.session_id || session?.id || null,
              match_number: match.match_number,
              session_name: session?.session_name || '세션 정보 없음',
              team1_player1: getPlayerInfo(match.team1_player1),
              team1_player2: getPlayerInfo(match.team1_player2),
              team2_player1: getPlayerInfo(match.team2_player1),
              team2_player2: getPlayerInfo(match.team2_player2)
            }
          });
        });
      }

      // 날짜 및 시간순 정렬
      matchesWithDetails.sort((a, b) => {
        const dateDiff = new Date(a.match_date).getTime() - new Date(b.match_date).getTime();
        if (dateDiff !== 0) return dateDiff;
        const timeA = a.start_time || '23:59';
        const timeB = b.start_time || '23:59';
        return timeA.localeCompare(timeB);
      });

      setMyMatches(matchesWithDetails);
      
      // 경기 기록 데이터 생성 (완료된 generated_matches만)
      const records: MatchRecord[] = [];
      let wins = 0;
      let losses = 0;

      // If refreshing upcoming ONLY, we don't recalculate records from scratch, just keep existing
      if (tabToRefresh === 'upcoming') {
        records.push(...matchRecords);
        // We also need to keep the completed matches in myMatches
        const existingCompleted = myMatches.filter(m => m.status === 'completed');
        matchesWithDetails.push(...existingCompleted);
        setMyMatches(matchesWithDetails);
      } else if (participantIds.length > 0) {
        const completedMatches = allMatches
          .filter((m: any) => m.status === 'completed' && m.match_result !== null)
          .sort((a: any, b: any) => (b.match_number || 0) - (a.match_number || 0));
        const completedError = fetchError;

        if (completedError) {
          console.error('completedError:', completedError);
        }
        if (completedMatches) {
          console.log('completed matchesCount:', completedMatches.length);
        }
        if (!completedError && completedMatches) {
          completedMatches.forEach((match: any) => {
            if (!match.match_result) return;

            const result = match.match_result as any;
            const session = Array.isArray(match.match_sessions) ? match.match_sessions[0] : match.match_sessions;
            const sessionDate = session?.session_date || new Date().toISOString().split('T')[0];
            
            // 🔽 배열로 반환될 수 있으니 항상 첫 번째 값만 사용
            const team1_player1 = Array.isArray(match.team1_player1) ? match.team1_player1[0] : match.team1_player1;
            const team1_player2 = Array.isArray(match.team1_player2) ? match.team1_player2[0] : match.team1_player2;
            const team2_player1 = Array.isArray(match.team2_player1) ? match.team2_player1[0] : match.team2_player1;
            const team2_player2 = Array.isArray(match.team2_player2) ? match.team2_player2[0] : match.team2_player2;

            const isTeam1 = team1_player1?.id === myProfile?.id || team1_player2?.id === myProfile?.id;
            const myTeamWon = (isTeam1 && result.winner === 'team1') || (!isTeam1 && result.winner === 'team2');
            
            if (myTeamWon) wins++;
            else losses++;

            // 팀원과 상대방 이름 정리
            const teammates = isTeam1 
              ? [team1_player1, team1_player2]
              : [team2_player1, team2_player2];

            const opponents = isTeam1 
              ? [team2_player1, team2_player2]
              : [team1_player1, team1_player2];

            const getPlayerNames = (players: any[]) => 
              players
                .filter(p => p && p.user_id !== user.id) // 나 제외
                .map(p => formatNameWithCoins(p.username || p.full_name || '미정', p.coin_balance));

            records.push({
              id: String(match.id),
              matchNumber: match.match_number,
              date: sessionDate,
              result: myTeamWon ? 'win' : 'loss',
              score: result.score || '',
              teammates: getPlayerNames(teammates),
              opponents: getPlayerNames(opponents),
              isUserTeam1: isTeam1
            });
          });
        }
      }

      setMatchRecords(records);
      setFilteredRecords(records);
      
      // 통계 계산
        const upcoming = matchesWithDetails.filter(
          (m) =>
            m.match_date >= todayLocal &&
            (m.status === 'scheduled' || m.status === 'in_progress')
        );
        const completed = matchesWithDetails.filter(m => m.status === 'completed');
      const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
      
      setStats({
        totalMatches: matchesWithDetails.length,
        upcomingMatches: upcoming.length,
        completedMatches: completed.length,
        winRate,
        wins,
        losses
      });

      console.log(`Debug Info: total = ${records.length}, filtered = ${records.length}, loading = false, user = ${user?.id}`);
      console.log(`✅ 내 경기 일정 조회 완료: ${matchesWithDetails.length}개`);
    } catch (error) {
      console.error('경기 조회 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // 날짜 필터 변경 핸들러
  const handleDateFilter = (date: string) => {
    setSelectedDate(date);
    if (date === '') {
      setFilteredRecords(matchRecords);
    } else {
      const filtered = matchRecords.filter(record => record.date === date);
      setFilteredRecords(filtered);
    }
  };

  // 선수 이름 조회
  const getPlayerName = (player: any) => {
    if (!player) return '미정';
    if (player.user_id === user?.id) return formatNameWithCoins('나', profile?.coin_balance);
    return formatNameWithCoins(player.full_name || player.username || '미정', player.coin_balance);
  };

  const getPlayerBet = (player?: { id?: string } | null) => {
    if (!player?.id) return DEFAULT_MATCH_WAGER;
    return selectedMatchBetState.bets[player.id] ?? DEFAULT_MATCH_WAGER;
  };

  // 레벨 이름 사용)
  const getLevelName = (player: any) => {
    // 이미 skill_level_name이 있으면 그것을 사용
    if (player?.skill_level_name) {
      return player.skill_level_name;
    }
    return getLevelNameFromCode(levelInfoMap, player?.skill_level, player?.skill_level || '미지정');
  };

  const refreshTopMatchSummary = async () => {
    try {
      await fetchMySchedule('upcoming');
    } catch (e) {
      console.error(e);
    }
  };

  const handleRefreshClick = async () => {
    if (activeTab === 'tournaments') {
      await fetchTournamentMatches();
    } else {
      await fetchMySchedule(activeTab);
    }
  };

  const fetchTournamentMatches = useCallback(async () => {
    try {
      const result = await fetchMyTournamentMatches(supabase, profile);
      setTournamentMatches(result.matches);
      setAllTournamentMatches(result.allMatches);
      setAllTournamentMatchCount(result.allTournamentMatchCount);
    } catch (error) {
      console.error('대회 경기 조회 실패:', error);
      setTournamentMatches([]);
      setAllTournamentMatches([]);
      setAllTournamentMatchCount(0);
    }
  }, [profile, supabase]);

  useEffect(() => {
    if (!user?.id || !profile || activeTab !== 'tournaments') {
      return;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        void fetchTournamentMatches();
      }, 250);
    };

    const channel = supabase
      .channel(`my-tournament-schedule-${user.id}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'tournament_matches',
        },
        (payload: any) => {
          const changedClubId = payload.new?.club_id || payload.old?.club_id;
          if (clubId && changedClubId && changedClubId !== clubId) {
            return;
          }
          scheduleRefresh();
        }
      )
      .subscribe();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    };

    window.addEventListener('focus', scheduleRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    scheduleRefresh();

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      window.removeEventListener('focus', scheduleRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [activeTab, clubId, fetchTournamentMatches, profile, supabase, user?.id]);

  const prioritizedAssignedMatches = [...todayAssignedMatches].sort((left, right) => {
    const timeL = left.match_time || '23:59';
    const timeR = right.match_time || '23:59';
    if (timeL !== timeR) return timeL.localeCompare(timeR);
    const matchNumberDiff = (left.match_number ?? 9999) - (right.match_number ?? 9999);
    if (matchNumberDiff !== 0) return matchNumberDiff;
    return (left.court_number || 0) - (right.court_number || 0);
  });
  
  const topMatch = prioritizedAssignedMatches.find(m => m.status !== 'completed' && m.status !== 'cancelled') || prioritizedAssignedMatches[0];
  
  const hasEditableTopMatch = Boolean(
    topMatch?.generated_match_id &&
      user?.id &&
      (topMatch.status === 'in_progress' || topMatch.status === 'scheduled')
  );
  
  const showTopMatchBetCard = hasEditableTopMatch && topMatch?.status === 'scheduled' && coinSettlementMode === 'zero_sum';

  // 경기 상태 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // 경기 상태 텍스트
  const getStatusText = (status: string) => {
    switch (status) {
      case 'scheduled': return '예정';
      case 'in_progress': return '진행중';
      case 'completed': return '완료';
      case 'cancelled': return '취소';
      default: return status;
    }
  };

  const uniqueRecordDates = Array.from(new Set(matchRecords.map((record) => record.date))).sort((a, b) =>
    new Date(b).getTime() - new Date(a).getTime()
  );

  const getMyTournamentTeam = (match: MyTournamentMatchView) => {
    const searchNames = [profile?.username, profile?.full_name]
      .map((value) => normalizeTournamentPlayerName(value))
      .filter((value) => value.length > 0);

    if (searchNames.length === 0) return null;

    const team1Names = (match.team1 || []).map((name) => normalizeTournamentPlayerName(name));
    const team2Names = (match.team2 || []).map((name) => normalizeTournamentPlayerName(name));

    if (searchNames.some((name) => team1Names.some((teamName) => tournamentNamesMatch(name, teamName)))) return 'team1';
    if (searchNames.some((name) => team2Names.some((teamName) => tournamentNamesMatch(name, teamName)))) return 'team2';
    return null;
  };

  const tournamentStats = tournamentMatches.reduce(
    (acc, match) => {
      const myTeam = getMyTournamentTeam(match);
      if (!myTeam) {
        return acc;
      }

      acc.total += 1;

      if (match.status === 'completed') {
        acc.completed += 1;
        if (match.winner === myTeam) acc.wins += 1;
        else if (match.winner === 'draw') acc.draws += 1;
        else acc.losses += 1;
      } else {
        acc.pending += 1;
      }

      return acc;
    },
    { total: 0, completed: 0, pending: 0, wins: 0, losses: 0, draws: 0 }
  );

  const selectTab = (tab: MatchCenterTab) => {
    setActiveTab(tab);
    router.replace(`/my-schedule?tab=${tab}`, { scroll: false });
  };

  const todayLocal = getTodayLocal();
  const upcomingMatches = myMatches.filter(
    (match) =>
      match.match_date >= todayLocal &&
      (match.status === 'scheduled' || match.status === 'in_progress')
  );

  const formatCompactDate = (value?: string | null) =>
    value
      ? formatKSTDate(value)
      : '날짜 미정';

  const formatTimeRange = (start?: string | null, end?: string | null) =>
    start && end ? `${start} - ${end}` : start || end || '시간 미정';

  const formatMatchBadge = (match: MatchSchedule) =>
    match.generated_match ? '배정 게임' : '등록 경기';

  const getUpcomingCardTitle = (match: MatchSchedule) => {
    if (match.generated_match) {
      return `게임 #${match.generated_match.match_number}`;
    }

    const rawDescription = String(match.description || '').trim();
    return rawDescription || '참가 신청 일정';
  };

  const getUpcomingCardSubtitle = (match: MatchSchedule) => {
    const rawDescription = String(match.description || '').trim();

    if (match.generated_match) {
      return match.generated_match.session_name || rawDescription || '오늘 경기 배정';
    }

    return '참가 신청한 경기 일정';
  };

  const normalizeTournamentLabel = (value?: string | null) =>
    String(value || '')
      .replace(/\s+/g, '')
      .replace(/[()]/g, '')
      .trim()
      .toLowerCase();

  const formatTournamentTypeLabel = (matchType?: string | null) => {
    switch ((matchType || '').toLowerCase()) {
      case 'random':
        return '랜덤';
      case 'level_based':
        return '레벨';
      case 'single_elimination':
        return '단판 토너먼트';
      case 'round_robin':
        return '리그전';
      default:
        return matchType || '대회 경기';
    }
  };

  const formatTournamentTitle = (title?: string | null, matchType?: string | null) => {
    const cleaned = String(title || '')
      .replace(/라뚱\s*대회?|대회경기/gu, '대회 경기')
      .replace(/\((레벨별|레벨 랜덤|레벨랜덤|랜덤|리그전|단판 토너먼트)\)\s*$/i, '')
      .trim();

    return cleaned || '대회';
  };

  const cleanAndFormatTournamentTitle = (title?: string | null, court?: string | null) => {
    let cleaned = String(title || '')
      .replace(/^(라뚱\s*대회?|대회\s*경기|대회경기|대회)\s*/i, '')
      .replace(/상위\s*그룹/g, 'A 그룹')
      .replace(/중상\s*그룹/g, 'B 그룹')
      .replace(/중위\s*그룹/g, 'B 그룹')
      .replace(/중하\s*그룹/g, 'C 그룹')
      .replace(/하위\s*그룹/g, 'C 그룹')
      .trim();

    const courtLabel = formatCourtLabel(court);
    if (courtLabel && courtLabel !== '코트 미정') {
      cleaned += `(${courtLabel})`;
    }

    return cleaned || '대회 경기';
  };

  const shouldShowTournamentTypeLabel = (title?: string | null, matchType?: string | null) => {
    const normalizedTitle = normalizeTournamentLabel(title);
    const normalizedType = normalizeTournamentLabel(formatTournamentTypeLabel(matchType));

    if (!normalizedType || normalizedType === normalizeTournamentLabel('대회 경기')) {
      return false;
    }

    return !normalizedTitle.includes(normalizedType);
  };

  const formatCourtLabel = (court?: string | null) => {
    let raw = String(court || '').trim();
    if (!raw) return '코트 미정';

    // bracket 접두사(예: [상위 그룹]) 제거
    raw = raw.replace(/^\[.*?\]\s*/g, '');

    const customPatternMatch = raw.match(/(\d+)코트$/i);
    if (customPatternMatch?.[1]) {
      return `${customPatternMatch[1]}코트`;
    }

    // court 1 -> Court 1 형식 통일
    if (/^court\s*\d+/i.test(raw)) {
      raw = raw.replace(/^court/i, 'Court');
    }

    return raw;
  };

  const getTournamentStatusLabel = (
    match: MyTournamentMatchView,
    didIWin: boolean,
    didILose: boolean
  ) => {
    if (match.status === 'completed') {
      if (didIWin) return '✓ 승리';
      if (didILose) return '✗ 패배';
      return '= 무승부';
    }

    if (match.status === 'pending') {
      return '⏳ 대기중';
    }

    return '⚡ 진행중';
  };

  const getTeamScoreText = (score?: number | null) =>
    typeof score === 'number' ? String(score) : '-';

  const getTournamentMatchOrder = (match: MyTournamentMatchView) => {
    const matchDate = match.scheduled_time?.slice(0, 10) || match.tournament_date || '';
    const orderedMatches = allTournamentMatches
      .filter((item) => (item.scheduled_time?.slice(0, 10) || item.tournament_date || '') === matchDate)
      .sort((left, right) => {
        const leftTime = left.scheduled_time || `${left.tournament_date || ''}T23:59:59`;
        const rightTime = right.scheduled_time || `${right.tournament_date || ''}T23:59:59`;
        if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);

        const courtDiff = String(left.court || '').localeCompare(String(right.court || ''), 'ko', { numeric: true });
        if (courtDiff !== 0) return courtDiff;

        if (left.round !== right.round) return left.round - right.round;
        return left.match_number - right.match_number;
      });
    const matchIndex = orderedMatches.findIndex((item) => item.id === match.id);
    const activeIndex = orderedMatches.findIndex((item) => item.status === 'in_progress');
    const scheduledIndex = orderedMatches.findIndex((item) => item.status === 'pending');

    return {
      total: orderedMatches.length,
      position: matchIndex + 1,
      currentPosition: activeIndex >= 0 ? activeIndex + 1 : scheduledIndex >= 0 ? scheduledIndex + 1 : 0,
    };
  };

  const getTournamentWaitingMessage = (match: MyTournamentMatchView) => {
    const { total, position } = getTournamentMatchOrder(match);
    if (total > 0 && position > 0) {
      return `전체 ${total}경기 중 ${position}번째 경기`;
    }
    return total > 0 ? `전체 ${total}경기 중 ${position}번째 경기` : '';
  };

  const isTournamentTab = activeTab === 'tournaments';

  const summaryItems = isTournamentTab
    ? [
        { label: '총', value: `${tournamentStats.total}` },
        { label: '승리', value: `${tournamentStats.wins}` },
        { label: '대기', value: `${tournamentStats.pending}` },
      ]
    : [
        { label: '예정', value: `${stats.upcomingMatches}` },
        { label: '완료', value: `${matchRecords.length}` },
        { label: '승률', value: `${stats.winRate}%` },
      ];

  // 경기 결과 보기/일정 상세 보기 핸들러 (통합)
  const handleScheduleDetails = (match: MatchSchedule) => {
    setSelectedMatch(match);
    setMatchStatus(match.status);
    setModalMode('schedule'); // 일정 확인 모드
    setShowDetailsModal(true);
    setMatchResult({ winner: '', score: '' });
  };

  // 완료 입력 핸들러 (진행중인 경우)
  const handleCompleteInput = (match: MatchSchedule) => {
    setSelectedMatch(match);
    setMatchStatus(match.status);
    setModalMode('complete'); // 완료 입력 모드
    setShowDetailsModal(true);
    setMatchResult({ winner: '', score: '' });
  };

  // 결과 수정 핸들러 (완료된 경기 수정용)
  const handleEditResult = (match: MatchSchedule) => {
    setSelectedMatch(match);
    setMatchStatus(match.status);
    setModalMode('complete'); // 수정도 동일한 완료 입력 폼 사용
    setShowDetailsModal(true);
    
    if (match.generated_match?.match_result) {
      const rawScore = (match.generated_match.match_result as any).score || '';
      const formattedScore = rawScore.replace(/:/g, '-');
      setMatchResult({
        winner: (match.generated_match.match_result as any).winner || '',
        score: formattedScore
      });
    } else {
      setMatchResult({ winner: '', score: '' });
    }
  };

  // 다음 경기 참가자들에게 준비 알림 발송
  const sendNextMatchNotification = async (currentMatch: MatchSchedule) => {
    if (!currentMatch.generated_match) return;

    try {
      const fallbackGeneratedMatchId = Number(currentMatch.id.replace('generated_', ''));
      let currentSessionId = currentMatch.generated_match.session_id || null;

      if (!currentSessionId) {
        const { data: currentMatchData, error: currentMatchError } = await supabase
          .from('generated_matches')
          .select('session_id')
          .eq('id', fallbackGeneratedMatchId)
          .maybeSingle();

        if (currentMatchError || !currentMatchData?.session_id) {
          console.error('현재 경기 session_id 조회 실패:', currentMatchError);
          return;
        }

        currentSessionId = currentMatchData.session_id;
      }

      if (!currentSessionId) {
        return;
      }

      // 현재 경기와 같은 세션의 다음 경기들 찾기 (순서 유지)
      const { data: sessionMatches, error } = await supabase
        .from('generated_matches')
        .select(`
          *,
          team1_player1:profiles!team1_player1_id(user_id, username, full_name),
          team1_player2:profiles!team1_player2_id(user_id, username, full_name),
          team2_player1:profiles!team2_player1_id(user_id, username, full_name),
          team2_player2:profiles!team2_player2_id(user_id, username, full_name)
        `)
        .eq('session_id', currentSessionId)
        .gt('match_number', currentMatch.generated_match.match_number)
        .eq('status', 'scheduled') // 아직 시작하지 않은 경기만
        .order('match_number', { ascending: true })
        .limit(2); // 다음 경기와 그 다음 경기까지

      if (error) {
        console.error('다음 경기 조회 실패:', error);
        return;
      }

      if (!sessionMatches || sessionMatches.length === 0) {
        console.log('다음 예정된 경기가 없습니다.');
        return;
      }

      // 알림 메시지 준비
      const notificationMessage = `경기 준비 알림

빈 코트로 이동하여 경기를 시작해 주세요.
진행중 선택 시 다음 참가자에게 준비 알림이 발송됩니다.

부상 없이 즐거운 운동 하세요!`;

      let totalNotifications = 0;
      const notifiedPlayers: string[] = [];

      // 각 다음 경기의 참가자들에게 알림 발송
      const activeClubId = clubId;

      for (const match of (sessionMatches as any[])) {
        const participants = [
          match.team1_player1,
          match.team1_player2,
          match.team2_player1,
          match.team2_player2
        ].filter(p => p && p.user_id);

        // 참가자별로 알림 기록 생성 및 실제 알림 발송
        for (const participant of participants) {
          const playerName = participant.full_name || participant.username || '선수';
          
          // 중복 발송 방지: 이미 같은 경기에 대한 준비 알림이 발송되었는지 확인
          const { data: existingNotification } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', participant.user_id)
            .eq('club_id', activeClubId || '')
            .eq('type', 'match_preparation')
            .eq('related_match_id', match.id)
            .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()) // 30분 내
            .single();

          if (existingNotification) {
            console.log(`⚠️ 중복 발송 방지: ${playerName}에게 이미 경기 #${match.match_number} 알림 발송됨`);
            continue; // 이미 발송된 경우 스킵
          }
          
          console.log(`🔔 알림 발송 대상: ${playerName} (경기 #${match.match_number})`);
          
          // 실제 브라우저 알림 + 소리 발송
          await NotificationService.sendMatchPreparationNotification(
            match.match_number, 
            [playerName]
          );
          
          notifiedPlayers.push(`${playerName} (경기#${match.match_number})`);
          
          // 알림 히스토리 기록
          try {

            await supabase.from('notifications').insert({
              user_id: participant.user_id,
              title: '경기 준비 알림',
              message: `경기 #${match.match_number} ${notificationMessage}`,
              type: 'match_preparation',
              related_match_id: match.id,
              club_id: activeClubId || '',
              is_read: false
            });
            totalNotifications++;
          } catch (notificationError) {
            console.error('알림 기록 저장 실패:', notificationError);
            // 알림 저장 실패는 전체 프로세스를 중단하지 않음
          }
        }
      }

      console.log(`✅ 다음 ${sessionMatches.length}경기의 ${totalNotifications}명에게 준비 알림을 발송했습니다.`);
      console.log(`📋 알림 발송 대상자: ${notifiedPlayers.join(', ')}`);
      
      return { 
        matchCount: sessionMatches.length, 
        playerCount: totalNotifications,
        players: notifiedPlayers
      };
      
    } catch (error) {
      console.error('다음 경기 알림 발송 실패:', error);
      // 알림 발송 실패는 사용자에게 별도 오류로 표시하지 않음 (부가 기능이므로)
    }
  };

  // 경기 상태 변경 핸들러
  const handleStatusChange = async (newStatus: 'scheduled' | 'in_progress' | 'completed' | 'cancelled') => {
    if (!selectedMatch) return;
    
    try {
      if (newStatus === 'completed') {
        // 완료를 선택한 경우: 완료 입력 모드로 전환
        setMatchStatus(newStatus);
        setModalMode('complete');
        // 실제 데이터베이스 업데이트는 결과 저장 시에 처리
      } else {
        // 다른 상태들: 바로 업데이트
        setMatchStatus(newStatus);
        if (newStatus === 'in_progress' && selectedMatch.generated_match) {
          const response = await fetch('/api/match-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              match_id: Number(selectedMatch.generated_match.id),
            }),
          });

          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(payload?.error || '게임 시작 중 오류가 발생했습니다.');
          }
        } else {
          await updateMatchStatus(newStatus);
        }
        
        // UI 즉각 반영 후 부분 새로고침
        await fetchMySchedule('upcoming');
        
        // '진행중'으로 상태 변경 시 다음 경기 참가자들에게 알림 발송
        if (newStatus === 'in_progress' && selectedMatch.generated_match) {
          const notificationResult = await sendNextMatchNotification(selectedMatch);
          
          if (notificationResult && notificationResult.playerCount > 0) {
            // 성공적으로 알림 발송된 경우
            alert(`경기 상태가 "진행중"으로 변경되었습니다! 🏸

📢 다음 경기 참가자들에게 준비 알림을 발송했습니다:

🔔 ${notificationResult.playerCount}명에게 알림 발송
📋 대상자: ${notificationResult.players.join(', ')}

💬 발송 메시지:
"경기 준비 빈 코트로 이동 경기를 시작해 주세요.
진행중 선택이 다음 사람에게 준비 알림 발송됩니다.
부상 없이 즐거운 운동 하세요! 🏸"

💡 참가자들에게 브라우저 알림과 소리로 알림이 전송되었습니다.`);
          } else {
            alert(`경기 상태가 "진행중"으로 변경되었습니다.

ℹ️ 다음 예정된 경기가 없거나 알림 발송에 실패했습니다.`);
          }
        } else {
          // 성공 메시지
          const statusText = {
            'scheduled': '예정',
            'in_progress': '진행중', 
            'cancelled': '취소'
          }[newStatus];
          
          alert(`경기 상태가 "${statusText}"으로 변경되었습니다.`);
        }
      }
    } catch (error) {
      console.error('상태 변경 실패:', error);
      alert('상태 변경 중 오류가 발생했습니다.');
    }
  };

  // 경기 상태 업데이트 (수정된 버전 - match_participants 테이블 사용)
  const updateMatchStatus = async (status: string, result?: any) => {
    if (!selectedMatch) return;

    try {
      // generated_matches에서 온 경기인지 확인
      if (selectedMatch.id.startsWith('generated_')) {
        const generatedMatchId = selectedMatch.id.replace('generated_', '');
        
        // generated_matches 테이블의 상태 업데이트 (updated_at 컬럼 제거)
        const updateData: any = { 
          status: status
        };
        
        // 결과가 있는 경우 추가
        if (result) {
          updateData.match_result = result;
        }

        const { error: matchStatusError } = await supabase
          .from('generated_matches')
          .update(updateData)
          .eq('id', Number(generatedMatchId));

        if (matchStatusError) {
          console.error('Generated match 상태 업데이트 실패:', matchStatusError);
          throw matchStatusError;
        }

        console.log(`✅ 경기 상태 업데이트 완료: 경기 ${generatedMatchId}, 상태 ${status}`);
        
      } else {
        // 일반 match_schedules 테이블 업데이트 (기존 로직 유지)
        const { data: currentMatch, error: checkError } = await supabase
          .from('match_schedules')
          .select('status')
          .eq('id', selectedMatch.id)
          .single();

        if (checkError) {
          console.error('경기 상태 확인 실패:', checkError);
          throw checkError;
        }

        if (currentMatch.status === status) {
          alert(`이미 경기 상태가 "${getStatusText(status)}"입니다.`);
          return;
        }
        
        if (currentMatch.status === 'completed' && status !== 'completed') {
          alert('완료된 경기의 상태는 변경할 수 없습니다.');
          return;
        }

        const updateData: any = { status };
        if (result) {
          updateData.match_result = result;
        }

        const { error } = await supabase
          .from('match_schedules')
          .update(updateData)
          .eq('id', selectedMatch.id)
          .eq('status', currentMatch.status);

        if (error) {
          console.error('Match schedule 상태 업데이트 실패:', error);
          throw error;
        }
      }

      // 로컬 상태 업데이트는 새로고침에서 처리됨
    } catch (error) {
      console.error('상태 업데이트 실패:', error);
      throw error;
    }
  };

  // 경기 결과 저장 핸들러 (수정된 버전)
  const handleSaveResult = async () => {
    if (!selectedMatch || !matchResult.winner || !matchResult.score) {
      alert('승부 결과와 점수를 모두 입력해주세요.');
      return;
    }

    if (!selectedMatch.generated_match) {
      alert('배정된 게임이 아니므로 결과를 저장할 수 없습니다.');
      return;
    }

    try {
      const generatedMatchId = selectedMatch.id.replace('generated_', '');

      const [team1ScoreText, team2ScoreText] = matchResult.score.split(':');
      const team1Score = Number(team1ScoreText);
      const team2Score = Number(team2ScoreText);

      if (!Number.isFinite(team1Score) || !Number.isFinite(team2Score)) {
        alert('점수 형식은 예: 21:18 처럼 입력해주세요.');
        return;
      }

      if (team1Score === team2Score) {
        alert('무승부는 저장할 수 없습니다.');
        return;
      }

      const response = await fetch('/api/match-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: Number(generatedMatchId),
          winner_team1: matchResult.winner === 'team1',
          team1_score: team1Score,
          team2_score: team2Score,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        alert(payload?.error || '결과 저장 중 오류가 발생했습니다.');
        return;
      }

      alert(
        `게임 결과가 저장되었습니다.\n\n승리팀: ${matchResult.winner === 'team1' ? '라켓팀' : '셔틀팀'}\n점수: ${team1Score}:${team2Score}\n코인 반영: 패자 배팅 코인이 승자에게 이동합니다. 기본 ${DEFAULT_MATCH_WAGER}코인, 최대 ${MAX_MATCH_WAGER}코인`
      );
      
      // 모달 닫기 및 상태 초기화
      setShowDetailsModal(false);
      setModalMode('schedule');
      setMatchResult({ winner: '', score: '' });
      
      // 부분 새로고침
      await fetchMySchedule('results');
      
      // 결과 상태 즉시 업데이트
      await updateMatchResultStates();
      
    } catch (error) {
      console.error('결과 저장 실패:', error);
      alert('결과 저장 중 예상치 못한 오류가 발생했습니다.');
    }
  };

  if (userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="mb-4">로그인이 필요합니다.</p>
          <Link href="/login">
            <Button>로그인하기</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-2.5 pt-0 pb-3 sm:gap-5 sm:px-5 sm:pt-0 sm:pb-5">
        <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
          <div className="relative z-10 flex items-center justify-between px-1">
            <div className="space-y-0.5 pl-2">
              <h1 className="text-xl font-bold tracking-tight">내 게임 현황</h1>
              <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">내 예정 경기 일정과 완료된 게임 기록을 확인합니다.</p>
            </div>
            
            <div className="flex gap-2 shrink-0 items-center">
              <Link href="/today-matches">
                <Button variant="outline" className="rounded-full bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0">
                  전체
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  홈
                </Button>
              </Link>
            </div>
          </div>

          <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-white/10 text-[11px]">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">
              {formatCurrentUserNameWithCoins(profile?.full_name || profile?.username || '회원', profile?.coin_balance)}
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">
              레벨 {profile?.skill_level_name || getLevelNameFromCode(levelInfoMap, profile?.skill_level, profile?.skill_level || '미지정')}
            </span>
            {summaryItems.map((item) => (
              <span
                key={item.label}
                className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200"
              >
                {item.label}: <span className="font-semibold text-white">{item.value}</span>
              </span>
            ))}
          </div>
        </section>

        <div className="rounded-[24px] bg-white px-3 py-3 shadow-sm">
          <div className="overflow-x-auto">
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => selectTab('upcoming')}
                  className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
                    activeTab === 'upcoming'
                      ? 'bg-slate-950 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  오늘 내 경기
                </button>
                <button
                  type="button"
                  onClick={() => selectTab('results')}
                  className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
                    activeTab === 'results'
                      ? 'bg-slate-950 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  완료 기록
                </button>
                <button
                  type="button"
                  onClick={() => selectTab('tournaments')}
                  className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
                    activeTab === 'tournaments'
                      ? 'bg-slate-950 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  대회 경기
                </button>
              </div>
            </div>
          </div>
        </div>

        {activeTab === 'upcoming' && (
          <div className="rounded-[24px] bg-white shadow-sm mt-3">
            {loading ? (
              <div className="p-12 text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500"></div>
                <p>경기 일정을 불러오는 중...</p>
              </div>
            ) : topMatch ? (
              <div className="p-4 space-y-3">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-semibold text-slate-800">예정된 내 경기</h3>
                </div>
                {prioritizedAssignedMatches.map((match, index) => {
                  const globalMatchIndex = todayAllMatches.findIndex(m => m.id === match.id);
                  const globalMatchNumber = globalMatchIndex !== -1 ? globalMatchIndex + 1 : (match.match_number ?? index + 1);
                  
                  // 진행중인 경기가 있으면 그 경기가 현재 진행중인 경기 순번
                  const activeMatchIndex = todayAllMatches.findIndex(m => m.status === 'in_progress');
                  let currentActiveGlobalMatchNumber = 0;
                  if (activeMatchIndex !== -1) {
                    currentActiveGlobalMatchNumber = activeMatchIndex + 1;
                  } else {
                    // 진행중이 없으면 예약된 경기 중 첫번째를 현재 차례로 간주
                    const scheduledMatchIndex = todayAllMatches.findIndex(m => m.status === 'scheduled');
                    if (scheduledMatchIndex !== -1) {
                      currentActiveGlobalMatchNumber = scheduledMatchIndex + 1;
                    }
                  }

                  // 예정 또는 진행 중인 모든 경기에서 배팅 UI를 보여줍니다 (zero_sum 모드일 때만)
                  const showBetCardForMatch = (match.status === 'scheduled' || match.status === 'in_progress') && coinSettlementMode === 'zero_sum';

                  return (
                    <AssignedMatchCard
                      key={match.id}
                      match={match}
                      globalMatchNumber={globalMatchNumber}
                      currentActiveGlobalMatchNumber={currentActiveGlobalMatchNumber}
                      showBetCardForMatch={showBetCardForMatch}
                      profile={profile}
                      coinSettlementMode={coinSettlementMode}
                      onRefresh={refreshTopMatchSummary}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="p-12 text-center">
                <div className="mb-4 text-6xl">🏸</div>
                <h3 className="mb-2 text-lg font-medium text-gray-900">예정된 내 게임이 없습니다</h3>
                <p className="mb-4 text-gray-600">새로운 경기에 등록하거나 관리자의 배정을 기다려주세요.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'results' && (
          <div className="rounded-[24px] bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200/80 p-4">
              <div>
                  <h2 className="text-lg font-semibold text-slate-900">완료된 게임 기록</h2>
                <p className="mt-1 text-sm text-slate-500">승패와 점수를 압축해서 빠르게 훑어볼 수 있습니다.</p>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="record-date-filter" className="text-sm font-medium text-gray-600">
                  날짜 필터
                </label>
                <select
                  id="record-date-filter"
                  value={selectedDate}
                  onChange={(e) => handleDateFilter(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">전체</option>
                  {uniqueRecordDates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredRecords.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <div className="mb-4 text-6xl">🏆</div>
                <h3 className="mb-2 text-lg font-medium text-gray-900">완료된 게임 기록이 없습니다</h3>
                <p>게임이 완료되면 여기에서 결과를 확인할 수 있습니다.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200/80">
                {filteredRecords.map((record) => (
                  <div key={record.id} className="p-2.5 py-2">
                    <div className="grid gap-1.5">
                      <div className="rounded-xl bg-slate-50 px-3 py-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                            #{record.matchNumber}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-medium ${
                              record.result === 'win' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {record.result === 'win' ? '승리' : '패배'}
                          </span>
                          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 shadow-sm">
                            {formatCompactDate(record.date)}
                          </span>
                        </div>
                      </div>
                      
                      {(() => {
                        const scoreParts = record.score ? record.score.split(':') : ['-', '-'];
                        const myScore = record.isUserTeam1 ? scoreParts[0] : scoreParts[1];
                        const opScore = record.isUserTeam1 ? scoreParts[1] : scoreParts[0];
                        return (
                          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 mt-0.5">
                            <div className="rounded-xl border border-blue-300 bg-blue-50/80 p-2">
                              <div className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-blue-700">우리 팀</div>
                              <div className="font-medium text-gray-800 text-xs flex flex-col gap-0.5">
                                {record.teammates.length > 0 ? (
                                  record.teammates.map((player, idx) => (
                                    <div key={idx}>{player}</div>
                                  ))
                                ) : (
                                  <div>없음</div>
                                )}
                              </div>
                            </div>
                            <div className="flex min-w-[56px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-1.5 py-1 text-center shadow-sm">
                              <div className="text-[9px] font-semibold tracking-[0.14em] text-slate-400">점수</div>
                              <div className="mt-0.5 flex items-center gap-0.5">
                                <span className="text-sm font-bold text-blue-600">{myScore}</span>
                                <span className="text-[10px] font-medium text-slate-400">:</span>
                                <span className="text-sm font-bold text-rose-600">{opScore}</span>
                              </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white p-2 text-right">
                              <div className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-slate-400">상대 팀</div>
                              <div className="font-medium text-slate-700 text-xs flex flex-col gap-0.5 items-end">
                                {record.opponents.length > 0 ? (
                                  record.opponents.map((player, idx) => (
                                    <div key={idx}>{player}</div>
                                  ))
                                ) : (
                                  <div>없음</div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'tournaments' && (
          <div className="rounded-[24px] bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 p-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">대회 경기</h2>
                <p className="mt-1 text-sm text-slate-500">참가 중인 대회 경기만 모아봅니다.</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                  전체 게임: {tournamentStats.total}
                </span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
                  완료 게임: {tournamentStats.completed}
                </span>
              </div>
            </div>

            {tournamentMatches.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <div className="mb-4 text-6xl">🎾</div>
                <h3 className="mb-2 text-lg font-medium text-gray-900">
                  {allTournamentMatchCount === 0 ? '등록된 대회 경기가 아직 없습니다' : '참가한 대회 경기가 없습니다'}
                </h3>
                <p>대회가 생성되면 이 탭에서 일반 경기와 분리해서 확인할 수 있습니다.</p>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                {tournamentMatches.map((match) => {
                  const myTeam = getMyTournamentTeam(match);
                  const waitingMessage = getTournamentWaitingMessage(match);
                  const didIWin = Boolean(match.status === 'completed' && match.winner === myTeam);
                  const didILose = Boolean(
                    match.status === 'completed' &&
                    match.winner &&
                    match.winner !== myTeam &&
                    match.winner !== 'draw'
                  );

                  return (
                    <div
                      key={match.id}
                      className={`relative rounded-[22px] border p-3 py-2.5 rounded-xl ${
                        didIWin
                          ? 'border-green-200 bg-green-50/80'
                          : didILose
                          ? 'border-red-200 bg-red-50/80'
                          : match.status === 'pending'
                          ? 'border-blue-200 bg-blue-50/80'
                          : 'border-slate-200 bg-slate-50/80'
                      }`}
                    >
                      {waitingMessage && (
                        <div className="mb-2 rounded-lg bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                          {waitingMessage}
                        </div>
                      )}
                      <span
                        className={`absolute right-3 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          match.status === 'completed'
                            ? didIWin
                              ? 'bg-green-200 text-green-800'
                              : didILose
                              ? 'bg-red-200 text-red-800'
                              : 'bg-gray-200 text-gray-800'
                            : match.status === 'pending'
                            ? 'bg-blue-200 text-blue-700'
                            : 'bg-yellow-200 text-yellow-800'
                        }`}
                      >
                        {getTournamentStatusLabel(match, didIWin, didILose)}
                      </span>

                      <div className="mb-2.5 pr-16">
                        <div className="text-sm font-semibold text-slate-800">
                          {match.match_number}. {formatCompactDate(match.scheduled_time || match.tournament_date)}
                          {match.scheduled_time ? ` ${formatTimeHHmm(match.scheduled_time)}` : ''} {cleanAndFormatTournamentTitle(match.tournament_title, match.court)}
                        </div>
                      </div>

                      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
                        <div className={`rounded-xl p-2.5 ${myTeam === 'team1' ? 'border border-blue-300 bg-blue-100' : 'bg-white'}`}>
                          <div className="mb-2 font-semibold text-blue-700">{myTeam === 'team1' ? '내 팀' : '상대 팀'}</div>
                          {match.team1.map((player, index) => (
                            <div key={`${match.id}-team1-${index}`} className="text-sm text-gray-800">
                              {player}
                            </div>
                          ))}
                        </div>

                        <div className="flex min-w-[64px] flex-col items-center justify-center rounded-[16px] bg-white px-2 py-1.5 text-center shadow-sm">
                          <div className="text-[9px] font-semibold tracking-[0.14em] text-slate-400">점수</div>
                          <div className="mt-0.5 flex items-center gap-1">
                            <span className="text-base font-bold text-blue-600">{getTeamScoreText(match.score_team1)}</span>
                            <span className="text-xs font-medium text-slate-400">:</span>
                            <span className="text-base font-bold text-rose-600">{getTeamScoreText(match.score_team2)}</span>
                          </div>
                        </div>

                        <div className={`rounded-xl p-2.5 text-right ${myTeam === 'team2' ? 'border border-blue-300 bg-blue-100' : 'bg-white'}`}>
                          <div className="mb-2 font-semibold text-red-700">{myTeam === 'team2' ? '내 팀' : '상대 팀'}</div>
                          {match.team2.map((player, index) => (
                            <div key={`${match.id}-team2-${index}`} className="text-sm text-gray-800">
                              {player}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        

        {showDetailsModal && selectedMatch && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-2 sm:items-center sm:p-4">
            <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_30px_80px_-45px_rgba(15,23,42,0.45)]">
              <div className="border-b border-slate-200/80 px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Match Detail</div>
                    <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">🏸 경기 상세 정보</h2>
                    <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                      모바일에 맞춰 세로형으로 경기 상태와 팀 정보를 확인할 수 있습니다.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="h-9 rounded-xl"
                    onClick={() => {
                      setShowDetailsModal(false);
                      setModalMode('schedule');
                      setMatchResult({ winner: '', score: '' });
                    }}
                  >
                    닫기
                  </Button>
                </div>
              </div>

              <div className="space-y-5 overflow-y-auto p-4 sm:p-6">
                <div className="grid grid-cols-1 gap-3">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">날짜</div>
                    <div className="mt-1 text-sm font-medium text-slate-800">
                      {formatKSTDate(selectedMatch.match_date)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">시간</div>
                    <div className="mt-1 text-sm font-medium text-slate-800">
                      {formatTimeHHmm(selectedMatch.start_time)} - {formatTimeHHmm(selectedMatch.end_time)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">장소</div>
                    <div className="mt-1 text-sm font-medium text-slate-800">{selectedMatch.location}</div>
                  </div>
                </div>

                {modalMode === 'schedule' && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">상태 변경</h3>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <button
                          onClick={() => handleStatusChange('scheduled')}
                          className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                            matchStatus === 'scheduled'
                              ? 'bg-blue-500 text-white'
                              : 'border border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
                          }`}
                        >
                          예정
                        </button>
                        <button
                          onClick={() => handleStatusChange('in_progress')}
                          className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                            matchStatus === 'in_progress'
                              ? 'bg-yellow-500 text-white'
                              : 'border border-yellow-200 bg-white text-yellow-700 hover:bg-yellow-50'
                          }`}
                        >
                          진행중
                        </button>
                        <button
                          onClick={() => handleStatusChange('cancelled')}
                          className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                            matchStatus === 'cancelled'
                              ? 'bg-red-500 text-white'
                              : 'border border-red-200 bg-white text-red-700 hover:bg-red-50'
                          }`}
                        >
                          취소
                        </button>
                      </div>
                    </div>

                    {selectedMatch.generated_match && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-800">
                            게임 #{selectedMatch.generated_match.match_number}
                          </div>
                          <div className="text-right text-sm text-slate-500">
                            {selectedMatch.generated_match.session_name}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                          <div className="rounded-[20px] border border-blue-100 bg-blue-50/80 p-4">
                            <div className="mb-2 text-sm font-semibold text-blue-900">라켓팀</div>
                            <div className="space-y-2 text-sm">
                              <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                                <span>{getPlayerName(selectedMatch.generated_match.team1_player1)}</span>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                                    배팅 {getPlayerBet(selectedMatch.generated_match.team1_player1)}
                                  </span>
                                  <span className="text-blue-600">
                                    {getLevelName(selectedMatch.generated_match.team1_player1)}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                                <span>{getPlayerName(selectedMatch.generated_match.team1_player2)}</span>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                                    배팅 {getPlayerBet(selectedMatch.generated_match.team1_player2)}
                                  </span>
                                  <span className="text-blue-600">
                                    {getLevelName(selectedMatch.generated_match.team1_player2)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[20px] border border-rose-100 bg-rose-50/80 p-4">
                            <div className="mb-2 text-sm font-semibold text-rose-900">셔틀팀</div>
                            <div className="space-y-2 text-sm">
                              <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                                <span>{getPlayerName(selectedMatch.generated_match.team2_player1)}</span>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                                    배팅 {getPlayerBet(selectedMatch.generated_match.team2_player1)}
                                  </span>
                                  <span className="text-rose-600">
                                    {getLevelName(selectedMatch.generated_match.team2_player1)}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                                <span>{getPlayerName(selectedMatch.generated_match.team2_player2)}</span>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                                    배팅 {getPlayerBet(selectedMatch.generated_match.team2_player2)}
                                  </span>
                                  <span className="text-rose-600">
                                    {getLevelName(selectedMatch.generated_match.team2_player2)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {matchStatus === 'completed' && (
                          <div className="space-y-3">
                            <div className="rounded-[20px] border border-green-200 bg-green-50/80 p-4">
                              <h4 className="mb-3 font-semibold text-green-800">🏆 게임 결과</h4>
                              <MatchResultDisplay selectedMatch={selectedMatch} user={user} supabase={supabase} />
                            </div>
                            {(isParticipantOfSelected || canManageSelected) && (
                              <div className="flex justify-end">
                                <button
                                  onClick={() => handleEditResult(selectedMatch)}
                                  className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 shadow-sm"
                                >
                                  ✏️ 결과 수정
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {matchStatus === 'in_progress' && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => setModalMode('complete')}
                          className="rounded-xl bg-green-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-600"
                        >
                          📝 완료 입력
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {modalMode === 'complete' && selectedMatch.generated_match && (
                  <div className="space-y-5">
                    <div className="text-center">
                      <h3 className="text-xl font-bold text-purple-700">🏆 게임 결과 입력</h3>
                      <p className="mt-1 text-sm text-slate-500">승리 팀과 점수를 기록해주세요.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <button
                        onClick={() => setMatchResult((prev) => ({ ...prev, winner: 'team1' }))}
                        className={`rounded-[20px] border-2 p-4 text-center transition-all ${
                          matchResult.winner === 'team1'
                            ? 'border-blue-500 bg-blue-100 text-blue-800 shadow-lg'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                        }`}
                      >
                        <div className="mb-2 text-lg font-bold text-blue-700">라켓팀</div>
                        <div className="text-sm">{getPlayerName(selectedMatch.generated_match.team1_player1)}</div>
                        <div className="text-sm">{getPlayerName(selectedMatch.generated_match.team1_player2)}</div>
                      </button>
                      <button
                        onClick={() => setMatchResult((prev) => ({ ...prev, winner: 'team2' }))}
                        className={`rounded-[20px] border-2 p-4 text-center transition-all ${
                          matchResult.winner === 'team2'
                            ? 'border-red-500 bg-red-100 text-red-800 shadow-lg'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-red-300'
                        }`}
                      >
                        <div className="mb-2 text-lg font-bold text-red-700">셔틀팀</div>
                        <div className="text-sm">{getPlayerName(selectedMatch.generated_match.team2_player1)}</div>
                        <div className="text-sm">{getPlayerName(selectedMatch.generated_match.team2_player2)}</div>
                      </button>
                    </div>

                    <div>
                      <input
                        type="text"
                        placeholder="예: 21-18, 21-19"
                        value={matchResult.score}
                        onChange={(e) => setMatchResult((prev) => ({ ...prev, score: e.target.value }))}
                        className="w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-center text-lg font-mono focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      />
                      <div className="mt-2 text-center text-xs text-slate-500">
                        점수 입력 예시: 21-18, 21-19 또는 21-15, 15-21, 21-17
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => {
                          setModalMode('schedule');
                          setMatchResult({ winner: '', score: '' });
                        }}
                        className="flex-1 rounded-xl bg-slate-200 px-4 py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-300"
                      >
                        ← 뒤로가기
                      </button>
                      <button
                        onClick={handleSaveResult}
                        disabled={!matchResult.winner || !matchResult.score}
                        className="flex-1 rounded-xl bg-green-500 px-4 py-3 font-semibold text-white transition-colors hover:bg-green-600 disabled:bg-slate-400"
                      >
                        💾 결과 저장
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Swords, Users, RefreshCw, Sparkles, MessageSquare, ShieldAlert, Award, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useUser } from '@/hooks/useUser';
import { formatCurrentUserNameWithCoins } from '@/lib/player-display';

type PrepPartner = {
  id: string;
  name: string;
  skill_level: string;
  gender: string;
};

type PrepPayload = {
  isRegistered: boolean;
  partner: PrepPartner | null;
  availablePartners: PrepPartner[];
};

type EligiblePlayer = {
  id: string;
  name: string;
  coin_balance: number | null;
  skill_level: string;
  today_match_count: number;
};

type ChallengePerson = {
  id: string;
  name: string;
  skill_level: string | null;
  coin_balance: number | null;
  response?: string;
};

type ChallengeItem = {
  id: string;
  challenge_date: string;
  status: string;
  note: string | null;
  created_at: string;
  responded_at: string | null;
  challenger: ChallengePerson | null;
  partner: ChallengePerson | null;
  opponents: ChallengePerson[];
  my_response: string | null;
  can_respond: boolean;
};

type ChallengePayload = {
  currentProfile: {
    id: string;
    name: string;
    coin_balance: number;
    eligible: boolean;
    ineligible_reason?: 'in_progress_match' | 'challenge_pending_or_accepted' | null;
    isAdmin: boolean;
  };
  eligiblePlayers: EligiblePlayer[];
  incomingChallenges: ChallengeItem[];
  outgoingChallenges: ChallengeItem[];
};

function getStatusBadgeClass(status: string) {
  if (status === 'accepted') return 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20';
  if (status === 'held') return 'bg-amber-500/10 text-amber-500 border border-amber-500/20';
  return 'bg-slate-500/10 text-slate-500 border border-slate-500/20';
}

function getResponseLabel(status?: string | null) {
  if (status === 'accepted') return '수락';
  if (status === 'held') return '보류';
  if (status === 'cancelled') return '취소됨';
  return '대기';
}

function getResponseBadgeClass(status?: string | null) {
  if (status === 'accepted') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25';
  if (status === 'held') return 'bg-amber-500/10 text-amber-600 border-amber-500/25';
  return 'bg-slate-100 text-slate-500 border-slate-200';
}

function formatChallengePlayer(
  name: string,
  _skillLevel: string | null | undefined,
  coinBalance: number | null | undefined,
  showCoins = true,
) {
  const coins = showCoins && typeof coinBalance === 'number' ? String(coinBalance) : '-';
  return `${name} (${coins})`;
}

export default function ChallengePage() {
  const { profile } = useUser();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [payload, setPayload] = useState<ChallengePayload | null>(null);
  const [partnerId, setPartnerId] = useState('');
  const [opponent1Id, setOpponent1Id] = useState('');
  const [opponent2Id, setOpponent2Id] = useState('');
  const [note, setNote] = useState('');
  const [resetting, setResetting] = useState(false);

  const [tab, setTab] = useState<'challenge' | 'tournament'>('challenge');
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepPayload, setPrepPayload] = useState<PrepPayload | null>(null);
  const [selectedPrepPartnerId, setSelectedPrepPartnerId] = useState('');
  const [prepSaving, setPrepSaving] = useState(false);
  const [isCoinEnabled, setIsCoinEnabled] = useState(true);

  const fetchCoinStatus = async () => {
    try {
      const res = await fetch('/api/coins/settings');
      const data = await res.json();
      if (res.ok) {
        setIsCoinEnabled(data.isCoinEnabled !== false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadTournamentPrep = async () => {
    try {
      setPrepLoading(true);
      const res = await fetch('/api/tournament-prep', { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setPrepPayload(data);
        if (data.partner) {
          setSelectedPrepPartnerId(data.partner.id);
        } else {
          setSelectedPrepPartnerId('');
        }
      }
    } catch (err) {
      console.error('loadTournamentPrep error', err);
    } finally {
      setPrepLoading(false);
    }
  };

  const handleSaveTournamentPrep = async (targetPartnerId: string | null) => {
    if (targetPartnerId && !await confirm('선택한 선수를 대회 준비 파트너로 지정하고 오늘 경기에 신청하시겠습니까? (서로 지정할 경우 1순위로 조가 편성됩니다.)')) {
      return;
    }
    if (!targetPartnerId && !await confirm('지정된 파트너를 취소하시겠습니까? (일반 랜덤 배정으로 전환됩니다.)')) {
      return;
    }

    try {
      setPrepSaving(true);
      const res = await fetch('/api/tournament-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: targetPartnerId }),
        credentials: 'include'
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || '설정 저장에 실패했습니다.');
      }
      alert(targetPartnerId ? '🏆 파트너가 지정되었습니다!' : '파트너 지정이 취소되었습니다.');
      await loadTournamentPrep();
    } catch (err) {
      console.error('handleSaveTournamentPrep error', err);
      alert(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setPrepSaving(false);
    }
  };

  const handleResetEligibility = async () => {
    if (!await confirm('현재 대기/수락 상태인 모든 게임 제안을 보류 상태로 변경하여 배정되지 않은 선수들을 대기 상태로 초기화하시겠습니까?')) {
      return;
    }
    
    try {
      setResetting(true);
      const response = await fetch('/api/challenges/reset', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || '초기화에 실패했습니다.');
      }
      alert('초기화 완료되었습니다.');
      await loadChallenges();
    } catch (error) {
      console.error('Reset error:', error);
      alert(error instanceof Error ? error.message : '오류가 발생했습니다.');
    } finally {
      setResetting(false);
    }
  };

  const loadChallenges = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/challenges', { credentials: 'include' });
      const nextPayload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(nextPayload?.error || '도전 데이터를 불러오지 못했습니다.');
      }

      setPayload(nextPayload);
    } catch (error) {
      console.error('challenge load error', error);
      alert(error instanceof Error ? error.message : '도전 데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCoinStatus();
    void loadChallenges();
    void loadTournamentPrep();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'tournament') {
        setTab('tournament');
      }
    }
  }, []);

  const eligiblePlayers = payload?.eligiblePlayers || [];

  const tournamentPartners = useMemo(() => {
    const list = [...eligiblePlayers];
    if (prepPayload?.partner && !list.some(p => p.id === prepPayload.partner?.id)) {
      list.push({
        id: prepPayload.partner.id,
        name: prepPayload.partner.name,
        skill_level: prepPayload.partner.skill_level,
        coin_balance: null,
        today_match_count: 0
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [eligiblePlayers, prepPayload?.partner]);

  const partnerOptions = useMemo(
    () => eligiblePlayers.filter((player) => player.id !== opponent1Id && player.id !== opponent2Id),
    [eligiblePlayers, opponent1Id, opponent2Id],
  );
  const opponent1Options = useMemo(
    () => eligiblePlayers.filter((player) => player.id !== partnerId && player.id !== opponent2Id),
    [eligiblePlayers, partnerId, opponent2Id],
  );
  const opponent2Options = useMemo(
    () => eligiblePlayers.filter((player) => player.id !== partnerId && player.id !== opponent1Id),
    [eligiblePlayers, partnerId, opponent1Id],
  );

  const handleCreateChallenge = async () => {
    if (!partnerId || !opponent1Id || !opponent2Id) {
      alert('파트너 1명과 상대 2명을 모두 선택해주세요.');
      return;
    }

    try {
      setSaving(true);
      const response = await fetch('/api/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          partner_id: partnerId,
          opponent1_id: opponent1Id,
          opponent2_id: opponent2Id,
          note,
        }),
      });

      const nextPayload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(nextPayload?.error || '도전 요청 생성에 실패했습니다.');
      }

      setPartnerId('');
      setOpponent1Id('');
      setOpponent2Id('');
      setNote('');
      await loadChallenges();
    } catch (error) {
      console.error('challenge create error', error);
      alert(error instanceof Error ? error.message : '도전 생성 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleRespond = async (challengeId: string, responseStatus: 'accepted' | 'held') => {
    try {
      setRespondingId(challengeId);
      const response = await fetch('/api/challenges/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          challenge_id: challengeId,
          response: responseStatus,
        }),
      });

      const nextPayload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(nextPayload?.error || '도전 응답 저장에 실패했습니다.');
      }

      await loadChallenges();
    } catch (error) {
      console.error('challenge respond error', error);
      alert(error instanceof Error ? error.message : '도전 응답 중 오류가 발생했습니다.');
    } finally {
      setRespondingId(null);
    }
  };

  const handleCancelChallenge = async (challengeId: string) => {
    if (!await confirm('모든 참여자가 아직 대기 중인 제안입니다. 취소하시겠습니까?')) {
      return;
    }

    try {
      setRespondingId(challengeId);
      const response = await fetch('/api/challenges', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challenge_id: challengeId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || '게임 제안 취소에 실패했습니다.');
      }

      await loadChallenges();
    } catch (error) {
      console.error('challenge cancel error', error);
      alert(error instanceof Error ? error.message : '게임 제안 취소 중 오류가 발생했습니다.');
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 pb-12">
      <div className="mx-auto w-full max-w-6xl px-2.5 pt-0 pb-4 sm:px-6 sm:pt-0 sm:pb-8">
        
        {/* Header Section with sleek gradient banner */}
        <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
          
          <div className="relative z-10 flex items-center justify-between px-1">
            <div className="space-y-0.5 pl-2">
              <h1 className="text-xl font-bold tracking-tight">게임 제안</h1>
              <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">마음에 드는 멤버를 골라 대결을 신청해 보세요.</p>
            </div>
            
            <Link href="/dashboard">
              <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                홈
              </Button>
            </Link>
          </div>
          
          <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-white/10 text-[11px]">
            <div className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1 text-slate-200">
              <Award className="h-3 w-3 text-indigo-400" />
              <span className="font-semibold text-slate-100">
                {formatCurrentUserNameWithCoins(
                  payload?.currentProfile.name || profile?.full_name || profile?.username || '회원', 
                  isCoinEnabled ? (payload?.currentProfile.coin_balance ?? profile?.coin_balance) : null
                )}
              </span>
            </div>
            
            {loading && !payload ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
                <RefreshCw className="h-3 w-3 animate-spin" />
                상태 확인 중
              </span>
            ) : !payload?.currentProfile.eligible && payload?.currentProfile.isAdmin ? (
              <button
                type="button"
                onClick={handleResetEligibility}
                disabled={resetting}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 active:scale-95 transition disabled:opacity-50 cursor-pointer"
                title="클릭하여 배정되지 않은 선수의 게임제안 제한 풀기"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse"></span>
                {resetting ? '해제 중...' : '제안 불가 (해제)'}
              </button>
            ) : (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${
                payload?.currentProfile.eligible 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${payload?.currentProfile.eligible ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                {payload?.currentProfile.eligible ? '제안 가능' : '제안 불가'}
              </span>
            )}
          </div>
        </section>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 mb-6 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/60 max-w-md mx-auto sm:mx-0">
          <button
            type="button"
            onClick={() => setTab('challenge')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm transition cursor-pointer ${
              tab === 'challenge'
                ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-4 h-4" />
            일반 게임 제안
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('tournament');
              void loadTournamentPrep();
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm transition cursor-pointer ${
              tab === 'tournament'
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Award className="w-4 h-4" />
            🏆 대회 준비
          </button>
        </div>

        {tab === 'tournament' ? (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="rounded-3xl bg-white border border-slate-100 p-6 sm:p-8 shadow-sm hover:shadow-md transition relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent rounded-full blur-3xl pointer-events-none -mr-16 -mt-16" />
              
              <div className="flex items-center justify-between border-b border-slate-100 pb-5 mb-6 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
                    <Award className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                      대회 준비 (지정 파트너 연습 신청)
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      외부 대회 출전을 위해 지정한 파트너와 우선적으로 같은 조로 배정됩니다.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadTournamentPrep()}
                  disabled={prepLoading}
                  className="rounded-full p-2.5 border border-slate-100 hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-50"
                  title="새로고침"
                >
                  <RefreshCw className={`h-4 w-4 ${prepLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="space-y-6 relative z-10">
                <div className="rounded-2xl bg-amber-50/70 border border-amber-200/60 p-4 text-xs text-amber-900 leading-relaxed space-y-1.5">
                  <div className="font-bold flex items-center gap-1.5 text-amber-950">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    대회 준비 조 배정 규칙 안내
                  </div>
                  <ul className="list-disc list-inside space-y-1 pl-1 text-slate-700">
                    <li>선택하신 파트너와 오늘 경기에 함께 출석 및 참가 신청이 이루어집니다.</li>
                    <li>두 선수가 서로를 지정(상호 지정)한 경우, <strong>1순위 고정 조</strong>로 편성됩니다.</li>
                    <li>한 명만 지정한 경우에도 파트너가 출석 중이면 2순위로 조가 편성됩니다.</li>
                    <li>상대편 조는 두 사람의 합산 레벨에 맞춰 가장 균형 잡힌 호적수가 자동 선정됩니다.</li>
                  </ul>
                </div>

                {prepLoading && !prepPayload ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <RefreshCw className="h-8 w-8 animate-spin mb-4 text-slate-300" />
                    <p className="text-sm font-medium">대회 준비 정보를 불러오는 중입니다...</p>
                  </div>
                ) : prepPayload ? (
                  <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-200/80 gap-3">
                      <div>
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">현재 상태</div>
                        <div className="flex items-center gap-2">
                          {prepPayload.isRegistered ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 border border-emerald-500/20">
                              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                              오늘 경기 출석 / 등록 완료
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-500/10 px-3 py-1 text-xs font-bold text-slate-600 border border-slate-500/20">
                              <span className="h-2 w-2 rounded-full bg-slate-400"></span>
                              미참가 상태 (아래에서 신청 시 출석 등록됨)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="sm:text-right">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">지정된 파트너</div>
                        {prepPayload.partner ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 px-3 py-1.5 text-sm font-extrabold text-amber-700 border border-amber-500/30">
                              <Award className="w-4 h-4 text-amber-600" />
                              {prepPayload.partner.name}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleSaveTournamentPrep(null)}
                              disabled={prepSaving}
                              className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 h-8 px-2.5 rounded-xl"
                            >
                              지정 취소
                            </Button>
                          </div>
                        ) : (
                          <span className="text-sm font-semibold text-slate-500">지정된 파트너 없음 (일반 랜덤)</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4 pt-2 border-t border-slate-100">
                      <label className="block text-sm font-bold text-slate-800">
                        연습 파트너 선택 <span className="text-rose-500">*</span>
                      </label>
                      <p className="text-xs text-slate-500 -mt-2">
                        목록에서 대회 준비를 함께할 파트너를 선택해주세요.
                      </p>

                      <div className="relative">
                        <select
                          value={selectedPrepPartnerId}
                          onChange={(e) => setSelectedPrepPartnerId(e.target.value)}
                          disabled={prepSaving}
                          className="w-full h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:bg-slate-50 appearance-none pr-10 cursor-pointer transition"
                        >
                          <option value="">-- 파트너 선택 안함 (지정 취소) --</option>
                          {tournamentPartners.map((p) => (
                            <option key={p.id} value={p.id}>
                            {formatChallengePlayer(p.name, p.skill_level, p.coin_balance, isCoinEnabled)}
                            </option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                          <Users className="h-4 w-4" />
                        </div>
                      </div>

                      <div className="pt-4 flex items-center justify-end gap-3">
                        <Button
                          type="button"
                          onClick={() => void handleSaveTournamentPrep(selectedPrepPartnerId || null)}
                          disabled={prepSaving}
                          className="w-full sm:w-auto h-12 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold px-6 shadow-lg shadow-orange-500/25 transition active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {prepSaving ? (
                            <>
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              저장 및 신청 중...
                            </>
                          ) : (
                            <>
                              <Award className="h-4 w-4" />
                              대회 준비 파트너 지정 및 신청하기
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT: Choose Partner & Opponents Form */}
            <section className="lg:col-span-5 rounded-3xl bg-white border border-slate-100 px-5 py-6 shadow-sm hover:shadow-md transition">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
                <div>
                <h2 className="text-lg font-bold text-slate-900">새 게임 제안</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-500/10">
                  대기 {eligiblePlayers.length}명
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void loadChallenges();
                  }}
                  disabled={loading}
                  className="rounded-full p-2 border border-slate-100 hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-50"
                  title="새로고침"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {loading && !payload ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <RefreshCw className="h-8 w-8 animate-spin mb-4 text-slate-300" />
                <p className="text-sm font-medium">플레이어 정보를 불러오는 중입니다...</p>
              </div>
            ) : payload && !payload.currentProfile.eligible ? (
              <div className="rounded-2xl bg-rose-50/50 border border-rose-100 p-4 text-sm text-rose-700 flex gap-3">
                <ShieldAlert className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  {payload.currentProfile.ineligible_reason === 'challenge_pending_or_accepted'
                    ? '현재 대기 또는 수락 상태의 게임 제안에 포함되어 있어 지금은 새 게임 제안을 만들 수 없습니다. (보류 상태가 되면 다시 후보에 표시됩니다.)'
                    : '현재 대기 또는 진행중인 배정 게임에 포함되어 있어 지금은 게임 제안을 할 수 없습니다.'}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">내 파트너</label>
                    <div className="relative">
                      <select
                        value={partnerId}
                        onChange={(event) => setPartnerId(event.target.value)}
                        className="block w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 cursor-pointer"
                      >
                        <option value="">파트너 선택</option>
                        {partnerOptions.map((player) => (
                          <option key={player.id} value={player.id}>
                            {formatChallengePlayer(player.name, player.skill_level, player.coin_balance, isCoinEnabled)}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">상대 팀 1</label>
                    <div className="relative">
                      <select
                        value={opponent1Id}
                        onChange={(event) => setOpponent1Id(event.target.value)}
                        className="block w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 cursor-pointer"
                      >
                        <option value="">첫 번째 상대 선택</option>
                        {opponent1Options.map((player) => (
                          <option key={player.id} value={player.id}>
                            {formatChallengePlayer(player.name, player.skill_level, player.coin_balance, isCoinEnabled)}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">상대 팀 2</label>
                    <div className="relative">
                      <select
                        value={opponent2Id}
                        onChange={(event) => setOpponent2Id(event.target.value)}
                        className="block w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 cursor-pointer"
                      >
                        <option value="">두 번째 상대 선택</option>
                        {opponent2Options.map((player) => (
                          <option key={player.id} value={player.id}>
                            {formatChallengePlayer(player.name, player.skill_level, player.coin_balance, isCoinEnabled)}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">한마디 메시지</label>
                    <div className="relative mb-2">
                      <select
                        onChange={(event) => {
                          if (event.target.value) {
                            setNote(event.target.value);
                          }
                        }}
                        defaultValue=""
                        className="block w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-xs text-slate-600 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 cursor-pointer"
                      >
                        <option value="">자주 쓰는 메시지 선택</option>
                        <option value="다음 코트 비면 바로 붙어요!">다음 코트 비면 바로 붙어요!</option>
                        <option value="한 게임 시원하게 하시죠!">한 게임 시원하게 하시죠!</option>
                        <option value="도전 신청합니다! 준비해 주세요.">도전 신청합니다! 준비해 주세요.</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                    <div className="relative">
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="메시지를 직접 입력하거나 위 드롭다운에서 선택하세요."
                        rows={3}
                        className="block w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-400"
                      />
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleCreateChallenge}
                  disabled={saving}
                  className="h-12 w-full mt-4 rounded-2xl bg-indigo-600 font-semibold text-white shadow-lg shadow-indigo-600/15 hover:bg-indigo-700 transition active:scale-98"
                >
                  {saving ? '제안 전송 중...' : '제안 보내기'}
                </Button>
              </div>
            )}
          </section>

          {/* RIGHT: Incoming & Outgoing Challenges */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Incoming Challenges Section */}
            <section className="rounded-3xl bg-white border border-slate-100 px-5 py-6 shadow-sm hover:shadow-md transition">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">받은 게임 제안</h2>
                </div>
                <div className="rounded-full bg-indigo-50 p-2 text-indigo-600">
                  <Users className="h-4 w-4" />
                </div>
              </div>

              <div className="space-y-4">
                {loading && !payload ? (
                  <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mb-3 text-slate-300" />
                    <p className="text-sm font-medium">정보를 불러오는 중입니다...</p>
                  </div>
                ) : (payload?.incomingChallenges || []).length === 0 ? (
                  <div className="rounded-2xl bg-slate-50/50 border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    받은 게임 제안이 현재 없습니다.
                  </div>
                ) : (
                  payload?.incomingChallenges.map((challenge) => (
                    <article key={challenge.id} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 transition-all hover:border-slate-200">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-200/50 pb-3 mb-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></div>
                          <span className="text-sm font-bold text-slate-800">
                            {challenge.challenger && formatChallengePlayer(challenge.challenger.name, challenge.challenger.skill_level, challenge.challenger.coin_balance, isCoinEnabled)}님의 매치 대결 요청
                          </span>
                        </div>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusBadgeClass(challenge.status)}`}>
                          {getResponseLabel(challenge.status)}
                        </span>
                      </div>
                      
                      <div className="space-y-2.5 text-sm text-slate-700 mb-4">
                        <div className="flex items-center justify-between gap-2 bg-white rounded-xl border border-slate-100 px-3 py-2">
                          <span className="text-slate-400 text-xs">우리 팀</span>
                          <span className="font-semibold text-slate-700">
                            {challenge.challenger && formatChallengePlayer(challenge.challenger.name, challenge.challenger.skill_level, challenge.challenger.coin_balance, isCoinEnabled)} & {challenge.partner && formatChallengePlayer(challenge.partner.name, challenge.partner.skill_level, challenge.partner.coin_balance, isCoinEnabled)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 bg-white rounded-xl border border-slate-100 px-3 py-2">
                          <span className="text-slate-400 text-xs">상대 팀</span>
                          <span className="font-semibold text-slate-700">
                            {challenge.opponents.map((player) => formatChallengePlayer(player.name, player.skill_level, player.coin_balance, isCoinEnabled)).join(' & ')}
                          </span>
                        </div>
                        
                        {challenge.note && (
                          <div className="flex gap-2 bg-indigo-50/30 rounded-xl px-3 py-2 border border-indigo-50/60 text-xs text-indigo-950 font-medium">
                            <MessageSquare className="h-3.5 w-3.5 text-indigo-500 shrink-0 mt-0.5" />
                            <span>{challenge.note}</span>
                          </div>
                        )}
                      </div>

                      {challenge.can_respond && (
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-200/30">
                          <Button
                            onClick={() => void handleRespond(challenge.id, 'accepted')}
                            disabled={respondingId === challenge.id}
                            className="h-10 flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm active:scale-95"
                          >
                            수락
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => void handleRespond(challenge.id, 'held')}
                            disabled={respondingId === challenge.id}
                            className="h-10 flex-1 rounded-xl border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold active:scale-95 bg-white"
                          >
                            보류
                          </Button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>

            {/* Outgoing Challenges Section */}
            <section className="rounded-3xl bg-white border border-slate-100 px-5 py-6 shadow-sm hover:shadow-md transition">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">보낸 게임 제안</h2>
                </div>
                <div className="rounded-full bg-indigo-50 p-2 text-indigo-600">
                  <Swords className="h-4 w-4" />
                </div>
              </div>

              <div className="space-y-4">
                {loading && !payload ? (
                  <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mb-3 text-slate-300" />
                    <p className="text-sm font-medium">정보를 불러오는 중입니다...</p>
                  </div>
                ) : (payload?.outgoingChallenges || []).length === 0 ? (
                  <div className="rounded-2xl bg-slate-50/50 border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    아직 보낸 게임 제안이 없습니다.
                  </div>
                ) : (
                  payload?.outgoingChallenges.map((challenge) => (
                    <article key={challenge.id} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 transition-all hover:border-slate-200">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-200/50 pb-3 mb-3">
                        <span className="text-sm font-bold text-slate-800">
                          {challenge.partner && formatChallengePlayer(challenge.partner.name, challenge.partner.skill_level, challenge.partner.coin_balance, isCoinEnabled)} 파트너 제안 매치
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusBadgeClass(challenge.status)}`}>
                          {getResponseLabel(challenge.status)}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <div className="rounded-xl border border-slate-200/60 bg-white px-3 py-2.5">
                          <div className="text-slate-400 mb-1.5">파트너</div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-slate-800 text-[13px]">
                              {challenge.partner && formatChallengePlayer(challenge.partner.name, challenge.partner.skill_level, challenge.partner.coin_balance, isCoinEnabled)}
                            </span>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold border ${getResponseBadgeClass(challenge.partner?.response)}`}>
                              {getResponseLabel(challenge.partner?.response)}
                            </span>
                          </div>
                        </div>

                        {challenge.opponents.map((opponent, idx) => (
                          <div key={opponent.id} className="rounded-xl border border-slate-200/60 bg-white px-3 py-2.5">
                            <div className="text-slate-400 mb-1.5">상대 {idx + 1}</div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-bold text-slate-800 text-[13px]">
                                {formatChallengePlayer(opponent.name, opponent.skill_level, opponent.coin_balance, isCoinEnabled)}
                              </span>
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold border ${getResponseBadgeClass(opponent.response)}`}>
                                {getResponseLabel(opponent.response)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {challenge.status === 'pending' && (
                        <div className="mt-3 flex justify-end border-t border-slate-200/30 pt-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleCancelChallenge(challenge.id)}
                            disabled={respondingId === challenge.id}
                            className="h-9 rounded-xl border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                          >
                            {respondingId === challenge.id ? '취소 중...' : '제안 취소'}
                          </Button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>

          </div>
        </div>
        )}

      </div>
    </div>
  );
}


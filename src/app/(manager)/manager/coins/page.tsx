'use client';

import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_COIN_SETTINGS, type CoinSettings, type CoinSettlementMode } from '@/lib/coins';
import { Button } from '@/components/ui/button';
import { formatKSTDateTime } from '@/lib/date';

type CoinProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  role: string;
  coin_balance: number;
  coin_wins: number;
  coin_losses: number;
  coin_updated_at: string;
};

type CoinTransaction = {
  id: number;
  profile_id: string;
  match_id: number;
  transaction_type: string;
  delta: number;
  wager_amount: number;
  team_side: string;
  team1_score: number;
  team2_score: number;
  created_at: string;
};

export default function AdminCoinsPage() {
  const [profiles, setProfiles] = useState<CoinProfile[]>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [setValues, setSetValues] = useState<Record<string, string>>({});
  const [coinSettings, setCoinSettings] = useState<CoinSettings>(DEFAULT_COIN_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [clearingTransactions, setClearingTransactions] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const isSuperAdmin = useMemo(() => {
    if (!currentUser) return false;
    return currentUser.email === 'kjh@hyojacho.es.kr' || currentUser.username === 'kjh' || currentUser.full_name === '김진호';
  }, [currentUser]);

  const profileNameMap = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile.full_name || profile.username || '회원'])),
    [profiles]
  );

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/coins', { credentials: 'include' });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || '코인 데이터 조회 실패');
      }

      setProfiles(payload?.profiles || []);
      setTransactions(payload?.transactions || []);
      setCoinSettings(payload?.coinSettings || DEFAULT_COIN_SETTINGS);
      setCurrentUser(payload?.currentUser || null);
      setSetValues(
        Object.fromEntries((payload?.profiles || []).map((profile: CoinProfile) => [profile.id, String(profile.coin_balance ?? 0)]))
      );
    } catch (error) {
      console.error('코인 관리 데이터 조회 오류:', error);
      alert(error instanceof Error ? error.message : '코인 데이터 조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const runAction = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/admin/coins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || '코인 관리 작업 실패');
    }
  };

  const adjustCoin = async (profileId: string, delta: number) => {
    try {
      setAdjustingId(profileId);
      await runAction({ action: 'adjust', profile_id: profileId, delta });
      await fetchData();
      alert(`코인 ${delta > 0 ? `+${delta}` : delta} 변경이 완료되었습니다.`);
    } catch (error) {
      console.error('코인 조정 오류:', error);
      alert(error instanceof Error ? error.message : '코인 조정 중 오류가 발생했습니다.');
    } finally {
      setAdjustingId(null);
    }
  };

  const setCoin = async (profileId: string) => {
    const rawValue = setValues[profileId] ?? '0';
    const coinBalance = Number(rawValue);

    if (!Number.isFinite(coinBalance) || !Number.isInteger(coinBalance) || coinBalance < 0) {
      alert('0 이상의 정수를 입력해주세요.');
      return;
    }

    try {
      setAdjustingId(profileId);
      await runAction({ action: 'set', profile_id: profileId, coin_balance: coinBalance });
      await fetchData();
      alert('코인 설정이 완료되었습니다.');
    } catch (error) {
      console.error('코인 설정 오류:', error);
      alert(error instanceof Error ? error.message : '코인 설정 중 오류가 발생했습니다.');
    } finally {
      setAdjustingId(null);
    }
  };

  const resetCoin = async (profileId: string, userName: string) => {
    if (!confirm(`${userName}님의 코인을 ${coinSettings.initialCoinBalance}개로 재설정할까요?`)) {
      return;
    }

    try {
      setAdjustingId(profileId);
      await runAction({ action: 'set', profile_id: profileId, coin_balance: coinSettings.initialCoinBalance });
      await fetchData();
      alert('코인 재설정이 완료되었습니다.');
    } catch (error) {
      console.error('코인 재설정 오류:', error);
      alert(error instanceof Error ? error.message : '코인 재설정 중 오류가 발생했습니다.');
    } finally {
      setAdjustingId(null);
    }
  };

  const saveCoinSettings = async (nextSettings?: CoinSettings) => {
    const targetSettings = nextSettings || coinSettings;

    try {
      setSavingSettings(true);
      await runAction({
        action: 'update_settings',
        initialCoinBalance: targetSettings.initialCoinBalance,
        settlementMode: targetSettings.settlementMode,
        fixedWinnerReward: targetSettings.fixedWinnerReward,
        attendanceReward: targetSettings.attendanceReward,
        guestInitialCoin: targetSettings.guestInitialCoin,
        guestAttendanceReward: targetSettings.guestAttendanceReward,
        isCoinEnabled: targetSettings.isCoinEnabled,
      });
      setCoinSettings(targetSettings);
      await fetchData();
      alert('코인 설정 저장이 완료되었습니다.');
    } catch (error) {
      console.error('코인 설정 저장 오류:', error);
      alert(error instanceof Error ? error.message : '코인 설정 저장 중 오류가 발생했습니다.');
    } finally {
      setSavingSettings(false);
    }
  };

  const resetAllCoins = async () => {
    if (!confirm(`모든 회원의 코인을 현재 설정된 시작 코인(${coinSettings.initialCoinBalance}개)으로 일괄 변경하시겠습니까?\n이 작업은 취소할 수 없으며 기존 코인 잔액이 모두 덮어씌워집니다.`)) {
      return;
    }

    try {
      setResettingAll(true);
      await runAction({ action: 'reset_all', coin_balance: coinSettings.initialCoinBalance });
      await fetchData();
      alert('모든 회원의 코인이 일괄 변경되었습니다.');
    } catch (error) {
      console.error('코인 일괄 변경 오류:', error);
      alert(error instanceof Error ? error.message : '코인 일괄 변경 중 오류가 발생했습니다.');
    } finally {
      setResettingAll(false);
    }
  };

  const clearRecentTransactions = async () => {
    if (!confirm('최근 코인 정산 기록을 모두 삭제할까요? 코인 잔액은 그대로 유지되고 아래 목록만 초기화됩니다.')) {
      return;
    }

    try {
      setClearingTransactions(true);
      await runAction({ action: 'clear_transactions' });
      await fetchData();
      alert('최근 코인 정산 기록이 초기화되었습니다.');
    } catch (error) {
      console.error('코인 정산 기록 초기화 오류:', error);
      alert(error instanceof Error ? error.message : '코인 정산 기록 초기화 중 오류가 발생했습니다.');
    } finally {
      setClearingTransactions(false);
    }
  };

  const applySettlementMode = (mode: CoinSettlementMode) => {
    setCoinSettings((prev) => ({
      ...prev,
      settlementMode: mode,
    }));
  };

  const applyPreset = (preset: 'zero_start_winner_one') => {
    setCoinSettings({
      initialCoinBalance: 0,
      settlementMode: 'winner_only_fixed',
      fixedWinnerReward: 1,
      attendanceReward: coinSettings.attendanceReward || 10,
      guestInitialCoin: coinSettings.guestInitialCoin ?? 5,
      guestAttendanceReward: coinSettings.guestAttendanceReward ?? 5,
      isCoinEnabled: coinSettings.isCoinEnabled ?? true,
    });
  };

  const settlementModeLabel: Record<CoinSettlementMode, string> = {
    zero_sum: '기본 제로섬',
    winner_only_pool: '패자 차감 없이 승자만 증가',
    winner_only_fixed: '승자만 고정 코인 증가',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">🪙 코인 관리</h1>
            <p className="mt-1 text-sm text-slate-500">
              기본 배팅은 1코인이고, 사용자는 경기별로 최대 3코인까지 설정할 수 있습니다.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Button
              variant={coinSettings.isCoinEnabled ? 'default' : 'destructive'}
              onClick={async () => {
                const nextEnabled = !coinSettings.isCoinEnabled;
                const message = nextEnabled 
                  ? '코인 기능을 ON(활성화) 상태로 변경하시겠습니까?' 
                  : '코인 기능을 OFF(비활성화) 상태로 변경하시겠습니까?\n프로젝트 전체에서 코인 표시가 숨김 처리됩니다.';
                if (!confirm(message)) {
                  return;
                }
                setCoinSettings((prev) => ({ ...prev, isCoinEnabled: nextEnabled }));
                await saveCoinSettings({
                  ...coinSettings,
                  isCoinEnabled: nextEnabled
                });
              }}
              disabled={savingSettings || loading}
              className="px-4 py-2 rounded-xl text-xs font-bold"
            >
              {coinSettings.isCoinEnabled ? '🟢 코인 기능: 온 중' : '🔴 코인 기능: 오프 중'}
            </Button>
            <Button variant="outline" onClick={fetchData} disabled={loading}>
              새로고침
            </Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">총 사용자</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{profiles.length}</div>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">총 코인</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">
              {profiles.reduce((sum, profile) => sum + (profile.coin_balance ?? 0), 0)}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">최근 정산</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{transactions.length}건</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">코인 정산 설정</h2>
            <p className="mt-1 text-sm text-slate-500">
              경기 결과 저장 시 적용할 정산 규칙과 시작 코인을 관리합니다.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            현재 모드: <span className="font-semibold text-slate-900">{settlementModeLabel[coinSettings.settlementMode]}</span>
          </div>
        </div>



        <div className="mt-5">
          <div className="mb-2 text-sm font-medium text-slate-700">정산 방식</div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={coinSettings.settlementMode === 'zero_sum' ? 'default' : 'outline'}
              disabled={savingSettings}
              onClick={() => applySettlementMode('zero_sum')}
            >
              제로섬 게임
            </Button>
            <Button
              variant={coinSettings.settlementMode === 'winner_only_fixed' ? 'default' : 'outline'}
              disabled={savingSettings}
              onClick={() => applyPreset('zero_start_winner_one')}
            >
              0코인 시작 + 승자 1코인
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="space-y-2 col-span-full md:col-span-1">
            <span className="text-sm font-medium text-slate-700">전원 시작 코인 설정</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={coinSettings.initialCoinBalance}
                onChange={(event) =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    initialCoinBalance: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    initialCoinBalance: DEFAULT_COIN_SETTINGS.initialCoinBalance,
                  }))
                }
                className="px-3 text-xs"
              >
                기본값(30)
              </Button>
              {isSuperAdmin && (
                <Button
                  variant="destructive"
                  type="button"
                  disabled={resettingAll}
                  onClick={resetAllCoins}
                  className="px-3 text-xs whitespace-nowrap"
                >
                  {resettingAll ? '변경 중...' : '전원 일괄 초기화'}
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-500">저장 시 신규 가입자에게 기본 제공되는 코인이 됩니다.</p>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-slate-700">승자 고정 보상</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={coinSettings.fixedWinnerReward}
                onChange={(event) =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    fixedWinnerReward: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    fixedWinnerReward: DEFAULT_COIN_SETTINGS.fixedWinnerReward,
                  }))
                }
                className="px-3 text-xs"
              >
                재설정
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-slate-700">하루 출석 보상</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={coinSettings.attendanceReward ?? 0}
                onChange={(event) =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    attendanceReward: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    attendanceReward: DEFAULT_COIN_SETTINGS.attendanceReward,
                  }))
                }
                className="px-3 text-xs"
              >
                재설정
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 border-t border-slate-100 pt-4">
          <div className="space-y-2">
            <span className="text-sm font-medium text-slate-700">게스트 시작 코인</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={coinSettings.guestInitialCoin ?? 5}
                onChange={(event) =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    guestInitialCoin: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    guestInitialCoin: DEFAULT_COIN_SETTINGS.guestInitialCoin,
                  }))
                }
                className="px-3 text-xs"
              >
                기본값(5)
              </Button>
            </div>
            <p className="text-xs text-slate-500">신규 게스트 등록 시 기본 지급되는 코인입니다.</p>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-slate-700">게스트 출석 보상 코인</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={coinSettings.guestAttendanceReward ?? 5}
                onChange={(event) =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    guestAttendanceReward: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  setCoinSettings((prev) => ({
                    ...prev,
                    guestAttendanceReward: DEFAULT_COIN_SETTINGS.guestAttendanceReward,
                  }))
                }
                className="px-3 text-xs"
              >
                기본값(5)
              </Button>
            </div>
            <p className="text-xs text-slate-500">게스트가 하루 출석 체크할 때 추가 지급되는 코인입니다.</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          제로섬 게임은 패자의 코인을 차감해 승자에게 그대로 나누는 방식입니다.
          경기 전체의 코인 총합이 유지되며, 승자 보상이 패자 차감분에서 계산됩니다.
          0코인 시작 + 승자 1코인은 전원 시작 코인을 0으로 두고, 정산 방식을 승자만 고정 코인 증가,
          보상을 1로 맞추는 빠른 프리셋입니다.
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={savingSettings} onClick={() => saveCoinSettings()}>
            {savingSettings ? '저장 중...' : '설정 저장'}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">사용자별 코인 현황</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-3">사용자</th>
                <th className="px-3 py-3">코인</th>
                <th className="px-3 py-3">승/패</th>
                <th className="px-3 py-3">빠른 조정</th>
                <th className="px-3 py-3">직접 설정</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id} className="border-b border-slate-100">
                  <td className="px-3 py-4">
                    <div className="font-medium text-slate-900">{profile.full_name || profile.username || '회원'}</div>
                    <div className="text-xs text-slate-500">{profile.email || profile.id}</div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="text-lg font-semibold text-amber-600">{profile.coin_balance ?? 0}</div>
                    <div className="text-xs text-slate-500">
                      업데이트 {formatKSTDateTime(profile.coin_updated_at)}
                    </div>
                  </td>
                  <td className="px-3 py-4 text-slate-700">
                    {profile.coin_wins ?? 0} / {profile.coin_losses ?? 0}
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-2">
                      {[-30, -20, -10, 10, 20, 30].map((delta) => (
                        <Button
                          key={delta}
                          variant="outline"
                          disabled={adjustingId === profile.id}
                          onClick={() => adjustCoin(profile.id, delta)}
                          className="h-8 px-3"
                        >
                          {delta > 0 ? `+${delta}` : delta}
                        </Button>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={setValues[profile.id] ?? ''}
                        onChange={(event) =>
                          setSetValues((prev) => ({ ...prev, [profile.id]: event.target.value }))
                        }
                        className="w-24 rounded-lg border border-slate-300 px-3 py-2"
                      />
                      <Button disabled={adjustingId === profile.id} onClick={() => setCoin(profile.id)}>
                        저장
                      </Button>
                      <Button
                        variant="outline"
                        disabled={adjustingId === profile.id}
                        onClick={() => resetCoin(profile.id, profile.full_name || profile.username || '회원')}
                      >
                        재설정
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold text-slate-900">최근 코인 정산</h2>
          <Button variant="outline" onClick={clearRecentTransactions} disabled={loading || clearingTransactions}>
            {clearingTransactions ? '초기화 중...' : '최근 정산 기록 초기화'}
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {transactions.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">아직 정산 기록이 없습니다.</div>
          ) : (
            transactions.map((transaction) => (
              <div key={transaction.id} className="rounded-xl border border-slate-200 px-4 py-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium text-slate-900">
                      {profileNameMap.get(transaction.profile_id) || transaction.profile_id}
                    </div>
                    <div className="text-xs text-slate-500">
                      경기 #{transaction.match_id} · 배팅 {transaction.wager_amount}코인 · {transaction.team1_score}:{transaction.team2_score}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-semibold ${transaction.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {transaction.delta >= 0 ? `+${transaction.delta}` : transaction.delta}
                    </div>
                    <div className="text-xs text-slate-500">
                      {transaction.transaction_type === 'win' ? '승리 정산' : '패배 차감'} · {formatKSTDateTime(transaction.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { ReactNode, useEffect, useState } from 'react';
import { ExtendedPlayer } from '../types';

interface AttendanceStatusProps {
  todayPlayers: ExtendedPlayer[] | null;
  onStatusChange?: (playerId: string, status: ExtendedPlayer['status']) => Promise<void> | void;
  onBulkStatusChange?: (playerIds: string[], status: ExtendedPlayer['status']) => Promise<void> | void;
  disabled?: boolean;
  headerActions?: ReactNode;
}

export default function AttendanceStatus({
  todayPlayers,
  onStatusChange,
  onBulkStatusChange,
  disabled = false,
  headerActions,
}: AttendanceStatusProps) {
  const formatPlayerScore = (score?: number) => {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      return '0.0';
    }

    return score.toFixed(1);
  };

  const [filter, setFilter] = useState<'all' | 'present' | 'lesson' | 'absent'>('all');
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [isPlayerListOpen, setIsPlayerListOpen] = useState(false);

  useEffect(() => {
    setSelectedPlayerIds([]);
  }, [todayPlayers]);

  useEffect(() => {
    if (!isPlayerListOpen) {
      setSelectedPlayerIds([]);
    }
  }, [isPlayerListOpen]);

  if (todayPlayers === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
        <span className="ml-3 text-lg text-gray-600">출석 데이터 로딩 중...</span>
      </div>
    );
  }

  if (todayPlayers.length === 0) {
    return (
      <div className="mb-8 rounded-r-lg border-l-4 border-yellow-400 bg-yellow-50 p-6 text-yellow-800">
        <div className="flex justify-between items-center">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-6 w-6 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">오늘 출석한 선수가 없습니다.</h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p>출석 체크를 먼저 진행해주세요.</p>
              </div>
            </div>
          </div>
          <div>
            {headerActions}
          </div>
        </div>
      </div>
    );
  }

  const levelCounts: Record<string, number> = {};
  const levelScoreByCode: Record<string, number> = {};
  const presentPlayers = todayPlayers.filter((player) => player.status === 'present');

  todayPlayers.forEach((player) => {
    const level = (player.skill_level || 'N1').toUpperCase();
    levelCounts[level] = (levelCounts[level] || 0) + 1;
    const score = typeof player.score === 'number' && Number.isFinite(player.score) ? player.score : Number.NEGATIVE_INFINITY;
    levelScoreByCode[level] = Math.max(levelScoreByCode[level] ?? Number.NEGATIVE_INFINITY, score);
  });

  const sortedPlayers = todayPlayers.slice().sort((a, b) => {
    const nameA = (a.name || '').trim();
    const nameB = (b.name || '').trim();
    return nameA.localeCompare(nameB, 'ko', { sensitivity: 'base' });
  });

  const filteredPlayers = sortedPlayers.filter((player) => {
    if (filter === 'all') {
      return true;
    }
    return player.status === filter;
  });

  const visiblePlayerIds = filteredPlayers.map((player) => player.id);
  const hasVisibleSelection = visiblePlayerIds.length > 0 && visiblePlayerIds.every((id) => selectedPlayerIds.includes(id));

  const togglePlayerSelection = (playerId: string) => {
    setSelectedPlayerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
    );
  };

  const toggleSelectAllVisible = () => {
    if (hasVisibleSelection) {
      setSelectedPlayerIds((prev) => prev.filter((id) => !visiblePlayerIds.includes(id)));
      return;
    }

    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      visiblePlayerIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const applySingleStatus = async (playerId: string, status: ExtendedPlayer['status']) => {
    if (disabled || !onStatusChange) {
      return;
    }

    await onStatusChange(playerId, status);
  };

  const getBulkTargetIds = (status: ExtendedPlayer['status']) => {
    return selectedPlayerIds
      .filter((id) => visiblePlayerIds.includes(id))
      .filter((id) => todayPlayers.find((player) => player.id === id)?.status !== status);
  };

  const applyBulkStatus = async (status: ExtendedPlayer['status']) => {
    if (disabled || !onBulkStatusChange || selectedPlayerIds.length === 0) {
      return;
    }

    const targetIds = getBulkTargetIds(status);
    if (targetIds.length === 0) {
      return;
    }

    await onBulkStatusChange(targetIds, status);
    setSelectedPlayerIds((prev) => prev.filter((id) => !targetIds.includes(id)));
  };

  const formatGender = (gender?: string) => {
    const normalized = String(gender || '').trim().toLowerCase();
    if (['male', 'm', 'man', '남', '남성'].includes(normalized)) {
      return '남';
    }
    if (['female', 'f', 'woman', '여', '여성'].includes(normalized)) {
      return '여';
    }
    return '성별 미지정';
  };

  const openPlayersModal = () => {
    setFilter('all');
    setIsPlayerListOpen(true);
  };

  return (
    <div className="mb-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">오늘 경기</span>
        <span className="font-semibold">오늘 참가자:</span>
        <span className="font-bold text-blue-600">{todayPlayers.length}명</span>
        <span className="ml-3 font-semibold">출석 체크:</span>
        <span className="font-bold text-green-600">{presentPlayers.length}명</span>
        <button
          type="button"
          onClick={openPlayersModal}
          className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
        >
          선수 목록 보기
        </button>
        {headerActions}
      </div>

      <div className="mb-4">
        <div className="mb-2 text-sm text-gray-700">레벨별 현황:</div>
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(levelCounts)
            .sort(([a], [b]) => {
              const scoreDiff = (levelScoreByCode[b] ?? Number.NEGATIVE_INFINITY) - (levelScoreByCode[a] ?? Number.NEGATIVE_INFINITY);
              if (scoreDiff !== 0) {
                return scoreDiff;
              }
              return a.localeCompare(b, 'ko', { sensitivity: 'base' });
            })
            .map(([level, count]) => (
              <span key={level} className="rounded border bg-blue-50 px-2 py-1 text-blue-700">
                {level}: {count}명
              </span>
            ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <button onClick={() => setFilter('all')} className={`rounded border px-3 py-1 ${filter === 'all' ? 'bg-blue-50' : 'bg-white'}`}>
          <span className="font-medium">전체</span>:
          <span className="ml-1 font-medium text-gray-700">{todayPlayers.length}명</span>
        </button>
        <button onClick={() => setFilter('present')} className={`rounded border px-3 py-1 ${filter === 'present' ? 'bg-green-50' : 'bg-white'}`}>
          <span className="font-medium">출석</span>:
          <span className="ml-1 font-medium text-green-600">{presentPlayers.length}명</span>
        </button>
        <button onClick={() => setFilter('lesson')} className={`rounded border px-3 py-1 ${filter === 'lesson' ? 'bg-yellow-50' : 'bg-white'}`}>
          <span className="font-medium">레슨</span>:
          <span className="ml-1 font-medium text-yellow-600">{todayPlayers.filter((player) => player.status === 'lesson').length}명</span>
        </button>
        <button onClick={() => setFilter('absent')} className={`rounded border px-3 py-1 ${filter === 'absent' ? 'bg-red-50' : 'bg-white'}`}>
          <span className="font-medium">불참</span>:
          <span className="ml-1 font-medium text-red-600">{todayPlayers.filter((player) => player.status === 'absent').length}명</span>
        </button>
      </div>

      {isPlayerListOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">선수 목록</h3>
                <p className="mt-1 text-sm text-gray-500">체크박스로 여러 명을 선택한 뒤 출석으로 일괄 변경할 수 있습니다.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPlayerListOpen(false)}
                className="rounded-md px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                닫기
              </button>
            </div>

            <div className="border-b bg-gray-50 px-6 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-700">현재 보기 {filteredPlayers.length}명</span>
                <button
                  type="button"
                  onClick={toggleSelectAllVisible}
                  disabled={disabled || visiblePlayerIds.length === 0}
                  className="rounded border border-blue-300 bg-white px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {hasVisibleSelection ? '전체 해제' : '전체 선택'}
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkStatus('present')}
                  disabled={disabled || getBulkTargetIds('present').length === 0}
                  className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
                >
                  선택한 회원 출석으로 변경
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkStatus('lesson')}
                  disabled={disabled || getBulkTargetIds('lesson').length === 0}
                  className="rounded bg-yellow-500 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-600 disabled:cursor-not-allowed disabled:bg-yellow-300"
                >
                  선택 레슨
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkStatus('absent')}
                  disabled={disabled || getBulkTargetIds('absent').length === 0}
                  className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                >
                  선택 불참
                </button>
                {selectedPlayerIds.length > 0 && (
                  <span className="ml-auto font-semibold text-blue-900">선택됨 {selectedPlayerIds.length}명</span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="mb-4 flex flex-wrap gap-2 text-sm">
                <button onClick={() => setFilter('all')} className={`rounded border px-3 py-1 ${filter === 'all' ? 'bg-blue-50' : 'bg-white'}`}>
                  <span className="font-medium">전체</span>:
                  <span className="ml-1 font-medium text-gray-700">{todayPlayers.length}명</span>
                </button>
                <button onClick={() => setFilter('present')} className={`rounded border px-3 py-1 ${filter === 'present' ? 'bg-green-50' : 'bg-white'}`}>
                  <span className="font-medium">출석</span>:
                  <span className="ml-1 font-medium text-green-600">{presentPlayers.length}명</span>
                </button>
                <button onClick={() => setFilter('lesson')} className={`rounded border px-3 py-1 ${filter === 'lesson' ? 'bg-yellow-50' : 'bg-white'}`}>
                  <span className="font-medium">레슨</span>:
                  <span className="ml-1 font-medium text-yellow-600">{todayPlayers.filter((player) => player.status === 'lesson').length}명</span>
                </button>
                <button onClick={() => setFilter('absent')} className={`rounded border px-3 py-1 ${filter === 'absent' ? 'bg-red-50' : 'bg-white'}`}>
                  <span className="font-medium">불참</span>:
                  <span className="ml-1 font-medium text-red-600">{todayPlayers.filter((player) => player.status === 'absent').length}명</span>
                </button>
              </div>

              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', justifyContent: 'start' }}>
                {filteredPlayers.map((player) => {
                  const checked = selectedPlayerIds.includes(player.id);
                  return (
                    <div
                      key={player.id}
                      className={`flex flex-col gap-3 rounded-lg border bg-white p-3 shadow-sm ${checked ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePlayerSelection(player.id)}
                          disabled={disabled}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{player.name}</div>
                          <div className="truncate text-xs text-gray-500">
                            {(player.skill_label || player.skill_level || 'N1').toUpperCase()} · {formatPlayerScore(player.score)}점 · {formatGender(player.gender)}
                          </div>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                          player.status === 'present' ? 'bg-green-100 text-green-800' :
                          player.status === 'lesson' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {player.status === 'present' ? '출석' : player.status === 'lesson' ? '레슨' : '불참'}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => applySingleStatus(player.id, 'present')}
                          disabled={disabled || player.status === 'present'}
                          className="rounded border border-green-200 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          출석으로 변경
                        </button>
                        <button
                          type="button"
                          onClick={() => applySingleStatus(player.id, 'lesson')}
                          disabled={disabled || player.status === 'lesson'}
                          className="rounded border border-yellow-200 px-2 py-1 text-xs font-medium text-yellow-700 hover:bg-yellow-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          레슨
                        </button>
                        <button
                          type="button"
                          onClick={() => applySingleStatus(player.id, 'absent')}
                          disabled={disabled || player.status === 'absent'}
                          className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          불참
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getLevelScore } from '@/utils/match-helpers';
import { GeneratedMatch, MatchSession } from '../types';
import type { ScheduledMatchView } from '@/lib/scheduled-matches';
import { getLevelScoreFromCode, type LevelInfoMap } from '@/lib/level-info';
import { formatKSTDateTime } from '@/lib/date';

type AssignedScheduleDetail = ScheduledMatchView & {
  session_id: string | null;
  match_number: number;
  team1_player1_skill_level: string;
  team1_player2_skill_level: string;
  team2_player1_skill_level: string;
  team2_player2_skill_level: string;
  team1_player1_score: number;
  team1_player2_score: number;
  team2_player1_score: number;
  team2_player2_score: number;
  team1_total_score: number;
  team2_total_score: number;
};

interface RegisteredScheduleSummary {
  id: string;
  generated_match_id?: number | null;
  schedule_source?: string | null;
  match_date: string | null;
  start_time: string | null;
  end_time: string | null;
  scheduled_time?: string | null;
  court_number?: number | null;
  description?: string | null;
  location: string | null;
  court_name?: string | null;
  status: string;
  current_participants: number | null;
  max_participants: number | null;
}

interface MatchSessionStatusProps {
  matchSessions: MatchSession[];
  registeredSchedules?: RegisteredScheduleSummary[];
  assignedScheduleDetails?: Record<string, AssignedScheduleDetail>;
  levelInfoMap?: LevelInfoMap;
  title?: string;
  onDeleteSession?: (sessionId: string) => void;
  onDeleteSessionMatch?: (sessionId: string, matchId: string) => void;
  onDeleteAllSessions?: () => void;
  deletingAllSessions?: boolean;
  deletingSessionIds?: Record<string, boolean>;
  deletingMatchIds?: Record<string, boolean>;
}

interface EditablePlayer {
  id: string;
  name: string;
  skill_level: string;
}

export default function MatchSessionStatus({
  matchSessions,
  registeredSchedules = [],
  assignedScheduleDetails = {},
  levelInfoMap = {},
  title = '📅 오늘의 경기 일정',
  onDeleteSession,
  onDeleteSessionMatch,
  onDeleteAllSessions,
  deletingAllSessions = false,
  deletingSessionIds = {},
  deletingMatchIds = {},
}: MatchSessionStatusProps) {
  const resolveLevelScore = (skillLevel?: string | null) =>
    getLevelScoreFromCode(levelInfoMap, skillLevel, getLevelScore(skillLevel || 'E2'));

  const parseGeneratedSequence = (description?: string | null) => {
    const normalized = description?.replace(/^\[일반 경기\]\s*/u, '').trim() || '';
    const matched = normalized.match(/^(?:\d{4}-\d{2}-\d{2}[_\s]+)?(\d+)-(\d+)$/u);

    if (!matched) {
      return { batch: 9999, order: 9999 };
    }

    return {
      batch: Number(matched[1]),
      order: Number(matched[2]),
    };
  };

  const getDisplaySequenceLabel = (schedule: RegisteredScheduleSummary, match: AssignedScheduleDetail | null) => {
    const sequence = parseGeneratedSequence(schedule.description);

    if (sequence.batch !== 9999 && sequence.order !== 9999) {
      return `${sequence.batch}-${sequence.order}`;
    }

    if (typeof match?.match_number === 'number' && match.match_number > 0) {
      return String(match.match_number);
    }

    return String(schedule.generated_match_id ?? '-');
  };

  const [assignedModalView, setAssignedModalView] = useState<'sequence' | 'bracket'>('sequence');
  const originalSchedules = registeredSchedules.filter(
    (schedule) => schedule.generated_match_id == null && schedule.schedule_source !== 'generated'
  );
  const generatedSchedules = registeredSchedules.filter(
    (schedule) => schedule.generated_match_id != null || schedule.schedule_source === 'generated'
  );
  const hasRegisteredSchedules = registeredSchedules.length > 0;
  const hasMatchSessions = matchSessions.length > 0;
  const [selectedSession, setSelectedSession] = useState<MatchSession | null>(null);
  const [sessionMatches, setSessionMatches] = useState<GeneratedMatch[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<EditablePlayer[]>([]);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [savingMatchId, setSavingMatchId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState<string>('');
  const [isAssignedMatchesModalOpen, setIsAssignedMatchesModalOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement | null>(null);

  const closeDetails = () => {
    setSelectedSession(null);
    setSessionMatches([]);
    setAvailablePlayers([]);
    setDetailError('');
    setLoadingSessionId(null);
  };

  const loadSessionMatches = async (sessionId: string) => {
    const response = await fetch(`/api/admin/match-sessions/${sessionId}/matches`, {
      method: 'GET',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || '배정내역 조회 실패');
    }
    return payload as { matches?: GeneratedMatch[]; players?: EditablePlayer[] };
  };

  const openSessionMatches = async (session: MatchSession) => {
    if (selectedSession?.id === session.id) {
      closeDetails();
      return;
    }

    try {
      setLoadingSessionId(session.id);
      setDetailError('');

      const payload = await loadSessionMatches(session.id);

      setSelectedSession(session);
      setSessionMatches(payload?.matches || []);
      setAvailablePlayers(payload?.players || []);
    } catch (error) {
      console.error('세션 경기 조회 오류:', error);
      setDetailError(error instanceof Error ? error.message : '배정내역을 불러오지 못했습니다.');
      setSelectedSession(session);
      setSessionMatches([]);
    } finally {
      setLoadingSessionId(null);
    }
  };

  const saveSessionMatch = async (match: GeneratedMatch) => {
    if (!selectedSession) return;

    try {
      setSavingMatchId(match.id);
      const response = await fetch(`/api/admin/match-sessions/${selectedSession.id}/matches`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: match.id,
          team1_player1_id: match.team1_player1.id,
          team1_player2_id: match.team1_player2.id,
          team2_player1_id: match.team2_player1.id,
          team2_player2_id: match.team2_player2.id,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || '경기 배정 저장 실패');

      const refreshed = await loadSessionMatches(selectedSession.id);
      setSessionMatches(refreshed.matches || []);
      setAvailablePlayers(refreshed.players || []);
      alert('경기 선수 배정이 저장되었습니다.');
    } catch (error) {
      alert(error instanceof Error ? error.message : '경기 배정 저장에 실패했습니다.');
    } finally {
      setSavingMatchId(null);
    }
  };

  const updateMatchPlayer = (matchId: number, key: keyof Pick<GeneratedMatch, 'team1_player1' | 'team1_player2' | 'team2_player1' | 'team2_player2'>, playerId: string) => {
    const player = availablePlayers.find((item) => item.id === playerId);
    if (!player) return;

    setSessionMatches((current) => current.map((match) => match.id === matchId
      ? { ...match, [key]: { id: player.id, name: player.name, skill_level: player.skill_level } }
      : match));
  };

  useEffect(() => {
    if (!selectedSession || !detailsRef.current) {
      return;
    }

    detailsRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [selectedSession, sessionMatches.length]);

  const detailRows = useMemo(() => {
    return sessionMatches.map((match) => {
      const team1Player1Score = resolveLevelScore(match.team1_player1.skill_level);
      const team1Player2Score = resolveLevelScore(match.team1_player2.skill_level);
      const team2Player1Score = resolveLevelScore(match.team2_player1.skill_level);
      const team2Player2Score = resolveLevelScore(match.team2_player2.skill_level);
      const team1Score = team1Player1Score + team1Player2Score;
      const team2Score = team2Player1Score + team2Player2Score;

      return {
        match,
        team1Player1Score,
        team1Player2Score,
        team2Player1Score,
        team2Player2Score,
        team1Score,
        team2Score,
        diff: Math.abs(team1Score - team2Score),
      };
    });
  }, [sessionMatches, levelInfoMap]);

  const averageScoreDiff = detailRows.length > 0
    ? detailRows.reduce((sum, row) => sum + row.diff, 0) / detailRows.length
    : 0;

  const maxScoreDiff = detailRows.length > 0
    ? Math.max(...detailRows.map((row) => row.diff))
    : 0;

  const scoreDiffCounts = useMemo(() => {
    const counts = new Map<number, number>();
    detailRows.forEach((row) => {
      const diff = Math.round(row.diff);
      counts.set(diff, (counts.get(diff) || 0) + 1);
    });
    return Array.from(counts.entries()).sort(([left], [right]) => left - right);
  }, [detailRows]);

  const playerGameCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    detailRows.forEach(({ match }) => {
      [
        match.team1_player1,
        match.team1_player2,
        match.team2_player1,
        match.team2_player2,
      ].forEach((player) => {
        const level = (player.skill_level || 'E2').toUpperCase();
        const key = `${player.name}(${level})`;
        counts[key] = (counts[key] || 0) + 1;
      });
    });

    return counts;
  }, [detailRows]);

  const totalPlayerGames = Object.values(playerGameCounts).reduce((sum, count) => sum + count, 0);
  const totalPlayers = Object.keys(playerGameCounts).length;

  const assignedScheduleRows = useMemo(() => {
    return [...generatedSchedules]
      .sort((a, b) => {
        const sequenceA = parseGeneratedSequence(a.description);
        const sequenceB = parseGeneratedSequence(b.description);

        const batchDiff = sequenceA.batch - sequenceB.batch;
        if (batchDiff !== 0) {
          return batchDiff;
        }

        const orderDiff = sequenceA.order - sequenceB.order;
        if (orderDiff !== 0) {
          return orderDiff;
        }

        return (a.generated_match_id ?? 9999) - (b.generated_match_id ?? 9999);
      })
      .map((schedule) => ({
        schedule,
        match: schedule.generated_match_id != null
          ? assignedScheduleDetails[String(schedule.generated_match_id)] ?? null
          : null,
      }));
  }, [assignedScheduleDetails, generatedSchedules]);

  const assignedCourtCount = useMemo(() => {
    return new Set(
      generatedSchedules
        .map((schedule) => schedule.court_number)
        .filter((courtNumber): courtNumber is number => typeof courtNumber === 'number' && courtNumber > 0)
    ).size;
  }, [generatedSchedules]);

  const renderAssignedPlayer = (name: string | null | undefined, skillLevel: string, score: number, align?: 'left' | 'right') => (
    <div className={`truncate text-xs text-gray-800 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {name || '선수 미정'} <span className="text-gray-500">({skillLevel})</span>
    </div>
  );

  const renderPlayerSelect = (
    match: GeneratedMatch,
    key: 'team1_player1' | 'team1_player2' | 'team2_player1' | 'team2_player2'
  ) => {
    const player = match[key];
    return (
      <select
        value={player.id || ''}
        onChange={(event) => updateMatchPlayer(match.id, key, event.target.value)}
        className="w-full min-w-36 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
        aria-label={`${match.match_number}회차 ${key} 선수`}
      >
        <option value="" disabled>선수 선택</option>
        {availablePlayers.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} ({option.skill_level})
          </option>
        ))}
      </select>
    );
  };

  return (
    <>
      <div className="mb-6 p-4 border border-blue-300 rounded bg-blue-50">
        <h3 className="text-lg font-semibold mb-3">{title}</h3>
        {!hasRegisteredSchedules && !hasMatchSessions ? (
          <div className="text-gray-600 text-center py-4">
            <p className="mb-2">📋 아직 생성된 경기 일정이 없습니다</p>
            <p className="text-sm">아래 버튼으로 경기를 생성하면 자동으로 경기 일정이 만들어집니다</p>
          </div>
        ) : (
          <div className="space-y-4">
            {hasRegisteredSchedules && (
              <div>
                {originalSchedules.length > 0 && (
                  <>
                    <div className="mb-2 text-sm font-medium text-blue-900">등록된 오늘 원본 일정</div>
                    <div className="grid grid-cols-1 justify-items-start gap-3 sm:grid-cols-2">
                      {originalSchedules.map((schedule) => (
                        <div key={schedule.id} className="w-full max-w-md rounded border bg-white p-3">
                          <div className="font-medium text-gray-800">
                            {schedule.start_time} - {schedule.end_time}
                          </div>
                          <div className="text-sm text-gray-600">{schedule.location || '장소 미정'}</div>
                          <div className="text-sm text-gray-600">
                            인원: {schedule.current_participants ?? 0} / {schedule.max_participants ?? 0}명
                          </div>
                          <div className="mt-1 text-xs text-gray-500">상태: {schedule.status}</div>
                          {generatedSchedules.length > 0 && (
                            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-emerald-900">배정된 경기</div>
                                  <div className="mt-1 text-xs text-emerald-800">
                                    총 {generatedSchedules.length}경기
                                    {assignedCourtCount > 0 ? ` · 코트 ${assignedCourtCount}개 사용` : ''}
                                  </div>
                                </div>
                                <div className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                  {generatedSchedules.length}개
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

              </div>
            )}

            {hasMatchSessions && (
              <div>
                <div className="mb-2 text-sm font-medium text-blue-900">생성된 경기 세션</div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {matchSessions.map((session) => (
                    <div key={session.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-white rounded border gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-800 truncate">{session.session_name}</div>
                        <div className="text-sm text-gray-600">
                          총 {session.total_matches}경기 | 배정 완료: {session.assigned_matches}경기 | 
                          남은 경기: {session.total_matches - session.assigned_matches}경기
                        </div>
                        <div className="text-xs text-gray-500">
                          생성일시: {formatKSTDateTime(session.created_at)}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openSessionMatches(session)}
                          disabled={loadingSessionId === session.id}
                          className="rounded border border-blue-200 bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {loadingSessionId === session.id
                            ? '불러오는 중...'
                            : selectedSession?.id === session.id
                            ? '배정닫기'
                            : '배정보기'}
                        </button>
                        {onDeleteSession && (
                          <button
                            type="button"
                            onClick={() => onDeleteSession(session.id)}
                            disabled={Boolean(deletingSessionIds[session.id])}
                            className="rounded border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingSessionIds[session.id] ? '삭제 중...' : '세션 삭제'}
                          </button>
                        )}
                        <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                          session.assigned_matches === session.total_matches 
                            ? 'bg-green-100 text-green-800' 
                            : session.assigned_matches > 0 
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {session.assigned_matches === session.total_matches 
                            ? '배정완료' 
                            : session.assigned_matches > 0 
                            ? '부분배정'
                            : '미배정'
                          }
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedSession && (
        <div
          ref={detailsRef}
          className="mb-8 rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex flex-col gap-3 border-b px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="text-lg font-semibold text-gray-900">배정내역 보기</h4>
              <p className="text-sm text-gray-600">{selectedSession.session_name}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                총 {selectedSession.total_matches}경기
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                배정 완료 {selectedSession.assigned_matches}경기
              </span>
              {onDeleteSession && (
                <button
                  type="button"
                  onClick={() => onDeleteSession(selectedSession.id)}
                  disabled={Boolean(deletingSessionIds[selectedSession.id])}
                  className="rounded border border-red-200 bg-red-50 px-3 py-1 text-sm text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingSessionIds[selectedSession.id] ? '세션 삭제 중...' : '세션 삭제'}
                </button>
              )}
              <button
                type="button"
                onClick={closeDetails}
                className="rounded border border-gray-200 px-3 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-100"
              >
                닫기
              </button>
            </div>
          </div>

          <div className="px-6 py-5">
            {detailError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {detailError}
              </div>
            ) : sessionMatches.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
                표시할 배정내역이 없습니다.
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h5 className="text-lg font-semibold text-gray-900">
                    ✋ 수동 배정 - 선수 선택 ({sessionMatches.length}경기)
                  </h5>
                    <div className="mt-3 flex flex-wrap gap-2 text-sm">
                      <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-800">
                        평균 차이: <span className="font-bold">{averageScoreDiff.toFixed(0)}점</span>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                        최대 차이: <span className="font-bold">{maxScoreDiff.toFixed(0)}점</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                        <span className="font-medium">점수 차이별 경기 수:</span>
                        {scoreDiffCounts.map(([diff, count]) => (
                          <span key={diff} className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-sm">
                            {diff}점 {count}경기
                          </span>
                        ))}
                      </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse border border-gray-300 bg-white">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-2 py-2 text-center text-sm font-semibold">회차</th>
                        <th className="border border-gray-300 px-3 py-2 text-center text-sm font-semibold">팀 1 선수 1</th>
                        <th className="border border-gray-300 px-3 py-2 text-center text-sm font-semibold">팀 1 선수 2</th>
                        <th className="border border-gray-300 px-2 py-2 text-center text-sm font-semibold">팀 1 점수</th>
                        <th className="border border-gray-300 px-3 py-2 text-center text-sm font-semibold">팀 2 선수 1</th>
                        <th className="border border-gray-300 px-3 py-2 text-center text-sm font-semibold">팀 2 선수 2</th>
                        <th className="border border-gray-300 px-2 py-2 text-center text-sm font-semibold">팀 2 점수</th>
                        <th className="border border-gray-300 px-2 py-2 text-center text-sm font-semibold">점수 차이</th>
                        <th className="border border-gray-300 px-2 py-2 text-center text-sm font-semibold">저장</th>
                        {onDeleteSessionMatch && (
                          <th className="border border-gray-300 px-2 py-2 text-center text-sm font-semibold">삭제</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((row) => {
                        const isWorstMatch = row.diff === maxScoreDiff && maxScoreDiff > 0;

                        return (
                          <tr
                            key={row.match.id}
                            className={isWorstMatch ? 'bg-rose-50' : 'hover:bg-gray-50'}
                          >
                            <td className="border border-gray-300 px-2 py-3 text-center text-sm font-medium">
                              {row.match.match_number}
                            </td>
                            <td className="border border-gray-300 px-2 py-3">{renderPlayerSelect(row.match, 'team1_player1')}</td>
                            <td className="border border-gray-300 px-2 py-3">{renderPlayerSelect(row.match, 'team1_player2')}</td>
                            <td className="border border-gray-300 px-2 py-3 text-center text-sm font-semibold text-blue-700">{row.team1Score.toFixed(0)}</td>
                            <td className="border border-gray-300 px-2 py-3">{renderPlayerSelect(row.match, 'team2_player1')}</td>
                            <td className="border border-gray-300 px-2 py-3">{renderPlayerSelect(row.match, 'team2_player2')}</td>
                            <td className="border border-gray-300 px-2 py-3 text-center text-sm font-semibold text-rose-700">{row.team2Score.toFixed(0)}</td>
                            <td className={`border border-gray-300 px-2 py-3 text-center text-sm font-semibold ${isWorstMatch ? 'text-rose-700' : 'text-gray-700'}`}>
                              <div>{row.diff.toFixed(0)}점</div>
                              {isWorstMatch && (
                                <div className="mt-1 text-xs font-medium text-rose-600">최대 편차</div>
                              )}
                            </td>
                            <td className="border border-gray-300 px-2 py-3 text-center text-sm">
                              <button
                                type="button"
                                onClick={() => saveSessionMatch(row.match)}
                                disabled={savingMatchId === row.match.id}
                                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {savingMatchId === row.match.id ? '저장 중...' : '저장'}
                              </button>
                            </td>
                            {onDeleteSessionMatch && (
                              <td className="border border-gray-300 px-2 py-3 text-center text-sm">
                                <button
                                  type="button"
                                  onClick={() => onDeleteSessionMatch(selectedSession.id, String(row.match.id))}
                                  disabled={Boolean(deletingMatchIds[String(row.match.id)])}
                                  className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {deletingMatchIds[String(row.match.id)] ? '삭제 중...' : '삭제'}
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h5 className="mb-3 text-lg font-semibold text-gray-900">1인당 총 게임수</h5>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div
                      className="grid gap-2 text-sm"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
                    >
                      {Object.entries(playerGameCounts)
                        .sort(([nameA], [nameB]) => nameA.localeCompare(nameB, 'ko', { sensitivity: 'base' }))
                        .map(([playerName, gameCount]) => (
                          <div
                            key={playerName}
                            className="flex justify-between rounded border bg-white p-2"
                          >
                            <span className="mr-2 truncate font-medium text-gray-800">{playerName}</span>
                            <span className="font-bold text-blue-600">{gameCount}</span>
                          </div>
                        ))}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-600">
                      <span>총 선수: {totalPlayers}명</span>
                      <span>총 경기: {sessionMatches.length}경기</span>
                      <span>
                        평균 경기수: {totalPlayers > 0 ? (totalPlayerGames / totalPlayers).toFixed(1) : '0'}경기/인
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isAssignedMatchesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <h4 className="text-lg font-semibold text-gray-900">배정된 경기</h4>
                <p className="hidden md:block mt-1 text-sm text-gray-500">
                  배정 순서대로 이어서 확인하거나 상세 대진표로 나눠서 볼 수 있습니다.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {onDeleteAllSessions && (
                  <button
                    type="button"
                    onClick={onDeleteAllSessions}
                    disabled={deletingAllSessions}
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingAllSessions ? '전체 삭제 중...' : '배정 경기 전체 삭제'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsAssignedMatchesModalOpen(false)}
                  className="rounded-md px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-2 border-b bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setAssignedModalView('sequence')}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  assignedModalView === 'sequence'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                배정 순서
              </button>
              <button
                type="button"
                onClick={() => setAssignedModalView('bracket')}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  assignedModalView === 'bracket'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                상세 대진표
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              {generatedSchedules.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
                  배정된 경기가 없습니다.
                </div>
              ) : assignedModalView === 'sequence' ? (
                <div className="space-y-3">
                  {assignedScheduleRows.map(({ schedule, match }) => (
                    <div key={schedule.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-2 text-sm font-semibold text-slate-900">
                        {schedule.description || `자동 배정된 경기 #${match?.match_number ?? (schedule.generated_match_id ?? '-')}`}
                        {(() => {
                          const time = schedule.scheduled_time || schedule.start_time;
                          if (!time) return '';
                          const hm = time.match(/^(\d{2}):(\d{2})/);
                          return `(${hm ? `${hm[1]}:${hm[2]}` : time})`;
                        })()}
                      </div>

                      {match ? (
                        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 w-full">
                          <div className="rounded-lg border border-sky-100 bg-sky-50 px-2 py-1.5 text-left">
                            <div className="mb-1 text-xs font-semibold text-sky-700">
                              팀 A · {match.team1_total_score.toFixed(0)}점
                            </div>
                            {renderAssignedPlayer(match.team1_player1_name, match.team1_player1_skill_level, match.team1_player1_score, 'left')}
                            {renderAssignedPlayer(match.team1_player2_name, match.team1_player2_skill_level, match.team1_player2_score, 'left')}
                          </div>
                          <div className="text-center text-xs font-semibold text-slate-400 px-1">VS</div>
                          <div className="rounded-lg border border-rose-100 bg-rose-50 px-2 py-1.5 text-right">
                            <div className="mb-1 text-xs font-semibold text-rose-700">
                              팀 B · {match.team2_total_score.toFixed(0)}점
                            </div>
                            {renderAssignedPlayer(match.team2_player1_name, match.team2_player1_skill_level, match.team2_player1_score, 'right')}
                            {renderAssignedPlayer(match.team2_player2_name, match.team2_player2_skill_level, match.team2_player2_score, 'right')}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-700">
                          해당 경기의 선수 대진표를 아직 불러오지 못했습니다.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {assignedScheduleRows.map(({ schedule, match }) => (
                    <div key={schedule.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="mb-2 text-sm font-semibold text-emerald-900">
                        {schedule.description || `자동 배정된 경기 #${match?.match_number ?? (schedule.generated_match_id ?? '-')}`}
                        {(() => {
                          const time = schedule.scheduled_time || schedule.start_time;
                          if (!time) return '';
                          const hm = time.match(/^(\d{2}):(\d{2})/);
                          return `(${hm ? `${hm[1]}:${hm[2]}` : time})`;
                        })()}
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          {getDisplaySequenceLabel(schedule, match)}
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">상태: {schedule.status}</div>

                      {match ? (
                        <div className="mt-3 rounded-lg border border-white/70 bg-white/80 p-3">
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 w-full">
                            <div className="rounded-lg border border-sky-100 bg-sky-50 px-2 py-1.5 text-left">
                              <div className="mb-1 text-xs font-semibold text-sky-700">
                                팀 A · {match.team1_total_score.toFixed(0)}점
                              </div>
                              {renderAssignedPlayer(match.team1_player1_name, match.team1_player1_skill_level, match.team1_player1_score, 'left')}
                              {renderAssignedPlayer(match.team1_player2_name, match.team1_player2_skill_level, match.team1_player2_score, 'left')}
                            </div>
                            <div className="text-center text-xs font-semibold text-slate-400 px-1">VS</div>
                            <div className="rounded-lg border border-rose-100 bg-rose-50 px-2 py-1.5 text-right">
                              <div className="mb-1 text-xs font-semibold text-rose-700">
                                팀 B · {match.team2_total_score.toFixed(0)}점
                              </div>
                              {renderAssignedPlayer(match.team2_player1_name, match.team2_player1_skill_level, match.team2_player1_score, 'right')}
                              {renderAssignedPlayer(match.team2_player2_name, match.team2_player2_skill_level, match.team2_player2_score, 'right')}
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-gray-500">
                            매치 상태: {match.status}
                          </div>
                          {onDeleteSessionMatch && match.session_id && schedule.generated_match_id != null && (
                            <button
                              type="button"
                              onClick={() => onDeleteSessionMatch(match.session_id as string, String(schedule.generated_match_id))}
                              disabled={Boolean(deletingMatchIds[String(schedule.generated_match_id)])}
                              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {deletingMatchIds[String(schedule.generated_match_id)] ? '삭제 중...' : '이 경기 삭제'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-700">
                          해당 경기의 선수 대진표를 아직 불러오지 못했습니다.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
